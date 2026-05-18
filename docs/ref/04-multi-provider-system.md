# 04 — Multi-Provider System

## Types (Single Source of Truth)

```typescript
// src/types.ts

// ── Content ──────────────────────────────────────────────

export interface TextPart {
  type: "text"
  text: string
}

export interface ImagePart {
  type: "image"
  data: string       // base64
  mime: string
}

export interface ThinkPart {
  type: "thinking"
  text: string
}

export interface ToolCallPart {
  type: "tool_call"
  id: string
  name: string
  args: Record<string, unknown>
}

export type ContentPart = TextPart | ImagePart | ThinkPart | ToolCallPart

// ── Messages ─────────────────────────────────────────────

export interface UserMsg {
  role: "user"
  content: string | ContentPart[]
  ts: number
}

export interface AssistantMsg {
  role: "assistant"
  content: ContentPart[]
  model: string
  provider: string
  usage: { in: number; out: number; total: number }
  stop: "stop" | "length" | "tool_use" | "error" | "aborted"
  error?: string
  ts: number
}

export interface ToolResultMsg {
  role: "tool_result"
  callId: string
  tool: string
  content: ContentPart[]
  isError: boolean
  ts: number
}

export type Msg = UserMsg | AssistantMsg | ToolResultMsg

// ── Model ────────────────────────────────────────────────

export interface Model {
  id: string
  name: string
  api: string           // "openai" | "gemini"
  provider: string      // "glm" | "gemini"
  baseUrl: string
  ctxWindow: number
  maxTokens: number
  cost: { in: number; out: number }  // per million tokens
  reasoning: boolean
}

// ── Provider ─────────────────────────────────────────────

export interface ToolDef {
  name: string
  description: string
  params: Record<string, unknown>  // JSON Schema
}

export interface LlmRequest {
  system?: string
  messages: Msg[]
  tools?: ToolDef[]
}

export interface StreamOpts {
  apiKey?: string
  signal?: AbortSignal
  temperature?: number
  maxTokens?: number
}

// Streaming events from provider → agent loop
export type StreamEvent =
  | { type: "start"; msg: AssistantMsg }
  | { type: "text"; delta: string; msg: AssistantMsg }
  | { type: "tool_start"; index: number; msg: AssistantMsg }
  | { type: "tool_delta"; index: number; delta: string; msg: AssistantMsg }
  | { type: "tool_end"; index: number; call: ToolCallPart; msg: AssistantMsg }
  | { type: "done"; msg: AssistantMsg }
  | { type: "error"; msg: AssistantMsg }

export type StreamFn = (model: Model, req: LlmRequest, opts?: StreamOpts) => EventStream<StreamEvent, AssistantMsg>

// ── Tool ─────────────────────────────────────────────────

export interface ToolResult {
  content: ContentPart[]
  meta: unknown
  halt?: boolean  // stop agent after this tool
}

export interface Tool {
  name: string
  label: string
  description: string
  schema: unknown  // TypeBox schema
  run: (callId: string, args: unknown, signal?: AbortSignal) => Promise<ToolResult>
}

// ── Agent Events (loop → TUI) ───────────────────────────

export type AgentEvent =
  | { type: "start" }
  | { type: "end"; msgs: Msg[] }
  | { type: "turn" }
  | { type: "turn_end"; msg: AssistantMsg; results: ToolResultMsg[] }
  | { type: "msg_start"; msg: Msg }
  | { type: "msg_delta"; msg: AssistantMsg; text?: string }
  | { type: "msg_end"; msg: Msg }
  | { type: "tool_run"; callId: string; tool: string; args: unknown }
  | { type: "tool_done"; callId: string; tool: string; err: boolean }

// ── Config ───────────────────────────────────────────────

export interface ProviderConfig {
  name: string
  api: string
  baseUrl: string
  model: string
}

export interface AppConfig {
  provider: string
  model: string
  providers: Record<string, ProviderConfig>
}
```

## Event Stream

```typescript
// src/provider/stream.ts

export class EventStream<E, R> {
  #buffer: E[] = []
  #waiters: Array<(r: IteratorResult<E>) => void> = []
  #done = false
  #result?: R

  push(event: E): void {
    if (this.#done) return
    if (event && typeof event === "object" && "type" in event) {
      const t = (event as any).type
      if (t === "done") this.#result = (event as any).msg as R
      if (t === "error") this.#result = (event as any).msg as R
    }
    const w = this.#waiters.shift()
    w ? w({ done: false, value: event }) : this.#buffer.push(event)
  }

  end(result?: R): void {
    this.#done = true
    if (result) this.#result = result
    for (const w of this.#waiters) w({ done: true, value: undefined })
    this.#waiters = []
  }

  result(): Promise<R> {
    return (async () => {
      for await (const _ of this) { if (this.#result) return this.#result }
      return this.#result!
    })()
  }

  async *[Symbol.asyncIterator](): AsyncIterator<E> {
    while (true) {
      if (this.#buffer.length) { yield this.#buffer.shift()!; continue }
      if (this.#done) return
      yield await new Promise<E>(resolve => {
        this.#waiters.push(r => r.done || resolve(r.value!))
      })
    }
  }
}
```

## Provider Registry

```typescript
// src/provider/registry.ts

import type { Model, StreamFn, LlmRequest, StreamOpts, StreamEvent, AssistantMsg } from "../types.ts"
import { EventStream } from "./stream.ts"

const providers = new Map<string, StreamFn>()

export const register = (api: string, fn: StreamFn) => providers.set(api, fn)

export const stream = (model: Model, req: LlmRequest, opts?: StreamOpts): EventStream<StreamEvent, AssistantMsg> => {
  const fn = providers.get(model.api)
  if (!fn) throw new Error(`No provider for API: ${model.api}`)
  return fn(model, req, opts)
}

// Lazy-load built-in providers
export const loadProviders = async () => {
  const [{ createOpenAI }, { createGemini }] = await Promise.all([
    import("./openai.ts"),
    import("./gemini.ts"),
  ])
  register("openai", createOpenAI())
  register("gemini", await createGemini())
}
```

## OpenAI-Compatible Provider (GLM, DeepSeek, any `/v1/chat/completions`)

```typescript
// src/provider/openai.ts

import OpenAI from "openai"
import type { StreamFn, Model, LlmRequest, StreamOpts, AssistantMsg, Msg, ToolDef } from "../types.ts"
import { EventStream } from "./stream.ts"

const EMPTY_MSG = (model: Model): AssistantMsg => ({
  role: "assistant", content: [], model: model.id, provider: model.provider,
  usage: { in: 0, out: 0, total: 0 }, stop: "stop", ts: Date.now(),
})

const ERROR_MSG = (model: Model, err: unknown): AssistantMsg => ({
  role: "assistant", content: [{ type: "text", text: String(err) }],
  model: model.id, provider: model.provider, usage: { in: 0, out: 0, total: 0 },
  stop: "error", error: String(err), ts: Date.now(),
})

function toOpenAIMessages(messages: Msg[]): OpenAI.ChatCompletionMessageParam[] {
  const out: OpenAI.ChatCompletionMessageParam[] = []
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: typeof m.content === "string" ? m.content : m.content.map(c => c.type === "text" ? { type: "text", text: c.text } : { type: "image_url", image_url: { url: `data:${c.mime};base64,${c.data}` } }) })
    } else if (m.role === "assistant") {
      const text = m.content.filter(c => c.type === "text").map(c => c.text).join("")
      const calls = m.content.filter(c => c.type === "tool_call").map(c => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.args) } }))
      out.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) })
    } else if (m.role === "tool_result") {
      out.push({ role: "tool", tool_call_id: m.callId, content: m.content.filter(c => c.type === "text").map(c => c.text).join("\n") })
    }
  }
  return out
}

function toOpenAITools(tools?: ToolDef[]): OpenAI.ChatCompletionTool[] {
  return tools?.map(t => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.params } })) ?? []
}

export function createOpenAI(): StreamFn {
  return (model, req, opts) => {
    const es = new EventStream<import("../types.ts").StreamEvent, AssistantMsg>()
    const client = new OpenAI({ apiKey: opts?.apiKey, baseURL: model.baseUrl })

    ;(async () => {
      try {
        const msgs = toOpenAIMessages(req.messages)
        const tools = toOpenAITools(req.tools)
        const params: OpenAI.ChatCompletionCreateParamsStreaming = {
          model: model.id, messages: req.system ? [{ role: "system", content: req.system }, ...msgs] : msgs,
          stream: true, ...(tools.length ? { tools } : {}),
        }
        const resp = await client.chat.completions.create(params)

        let partial = EMPTY_MSG(model)
        const tcMap = new Map<number, { id: string; name: string; args: string }>()
        es.push({ type: "start", msg: partial })

        for await (const chunk of resp) {
          const d = chunk.choices[0]?.delta
          if (!d) continue

          if (d.content) {
            const txt = partial.content.find(c => c.type === "text") as any
            txt ? (txt.text += d.content) : partial.content.push({ type: "text", text: d.content })
            es.push({ type: "text", delta: d.content, msg: { ...partial, content: [...partial.content] } })
          }

          for (const tc of d.tool_calls ?? []) {
            if (tc.index === undefined) continue
            if (!tcMap.has(tc.index)) {
              tcMap.set(tc.index, { id: tc.id ?? `tc_${tc.index}`, name: tc.function?.name ?? "", args: tc.function?.arguments ?? "" })
            } else {
              const e = tcMap.get(tc.index)!
              if (tc.function?.name) e.name = tc.function.name
              if (tc.function?.arguments) e.args += tc.function.arguments
            }
          }
        }

        for (const [i, tc] of tcMap) {
          let args: Record<string, unknown> = {}
          try { args = JSON.parse(tc.args) } catch {}
          const call: import("../types.ts").ToolCallPart = { type: "tool_call", id: tc.id, name: tc.name, args }
          partial.content.push(call)
          es.push({ type: "tool_end", index: i, call, msg: { ...partial, content: [...partial.content] } })
        }

        const final: AssistantMsg = { ...partial, stop: tcMap.size ? "tool_use" : "stop", ts: Date.now() }
        es.push({ type: "done", msg: final })
        es.end(final)
      } catch (e) {
        const err = ERROR_MSG(model, e)
        es.push({ type: "error", msg: err })
        es.end(err)
      }
    })()

    return es
  }
}
```

## Gemini Provider

```typescript
// src/provider/gemini.ts

import { GoogleGenerativeAI } from "@google/generative-ai"
import type { StreamFn, Model, LlmRequest, AssistantMsg, Msg, ToolDef, ToolCallPart } from "../types.ts"
import { EventStream } from "./stream.ts"

function toGeminiHistory(messages: Msg[]): any[] {
  return messages.map(m => {
    if (m.role === "user") return { role: "user", parts: [{ text: typeof m.content === "string" ? m.content : m.content.map(c => c.type === "text" ? c.text : "").join("") }] }
    if (m.role === "assistant") return { role: "model", parts: m.content.filter(c => c.type === "text").map(c => ({ text: c.text })) }
    if (m.role === "tool_result") return { role: "user", parts: [{ functionResponse: { name: m.tool, response: { content: m.content.filter(c => c.type === "text").map(c => c.text).join("\n") } } }] }
    return null
  }).filter(Boolean)
}

function toGeminiTools(tools?: ToolDef[]): any[] | undefined {
  if (!tools?.length) return undefined
  return [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.params })) }]
}

function lastUserText(messages: Msg[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      const c = messages[i].content
      return typeof c === "string" ? c : c.filter(p => p.type === "text").map(p => p.text).join("")
    }
  }
  return ""
}

export async function createGemini(): Promise<StreamFn> {
  return (model, req, opts) => {
    const es = new EventStream<import("../types.ts").StreamEvent, AssistantMsg>()
    const gen = new GoogleGenerativeAI(opts?.apiKey ?? "")
    const gm = gen.getGenerativeModel({
      model: model.id,
      systemInstruction: req.system,
      tools: toGeminiTools(req.tools),
    })

    ;(async () => {
      try {
        const chat = gm.startChat({ history: toGeminiHistory(req.messages.slice(0, -1)) })
        const result = await chat.sendMessageStream(lastUserText(req.messages))

        let partial: AssistantMsg = {
          role: "assistant", content: [], model: model.id, provider: model.provider,
          usage: { in: 0, out: 0, total: 0 }, stop: "stop", ts: Date.now(),
        }
        es.push({ type: "start", msg: partial })
        const calls: ToolCallPart[] = []

        for await (const chunk of result.stream) {
          for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
            if (part.text) {
              partial.content.push({ type: "text", text: part.text })
              es.push({ type: "text", delta: part.text, msg: { ...partial, content: [...partial.content] } })
            }
            if (part.functionCall) {
              const call: ToolCallPart = { type: "tool_call", id: `tc_${calls.length}`, name: part.functionCall.name, args: part.functionCall.args as Record<string, unknown> }
              calls.push(call)
              partial.content.push(call)
              es.push({ type: "tool_end", index: calls.length - 1, call, msg: { ...partial, content: [...partial.content] } })
            }
          }
        }

        const final: AssistantMsg = { ...partial, stop: calls.length ? "tool_use" : "stop" }
        es.push({ type: "done", msg: final })
        es.end(final)
      } catch (e) {
        const err: AssistantMsg = { role: "assistant", content: [{ type: "text", text: String(e) }], model: model.id, provider: model.provider, usage: { in: 0, out: 0, total: 0 }, stop: "error", error: String(e), ts: Date.now() }
        es.push({ type: "error", msg: err })
        es.end(err)
      }
    })()

    return es
  }
}
```
