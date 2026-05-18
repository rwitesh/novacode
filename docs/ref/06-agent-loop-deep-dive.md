# 06 — Agent Loop

## Loop (Pure Function)

```typescript
// src/agent/loop.ts

import type { Msg, AssistantMsg, ToolResultMsg, ToolCallPart, AgentEvent, Tool, Model } from "../types.ts"
import { stream as llmStream } from "../provider/registry.ts"
import { EventStream } from "../provider/stream.ts"

interface LoopCtx {
  system: string
  messages: Msg[]
  tools: Tool[]
}

interface LoopOpts {
  model: Model
  apiKey?: string
  beforeTool?: (call: ToolCallPart, args: unknown, ctx: LoopCtx) => Promise<{ block?: boolean; reason?: string } | void>
  afterTool?: (call: ToolCallPart, result: ToolResult, err: boolean, ctx: LoopCtx) => Promise<Partial<ToolResult> | void>
}

const isToolCall = (c: any): c is ToolCallPart => c?.type === "tool_call"
const text = (s: string) => ({ type: "text" as const, text: s })

export function run(
  input: string,
  ctx: LoopCtx,
  opts: LoopOpts,
  signal?: AbortSignal,
): EventStream<AgentEvent, Msg[]> {
  const es = new EventStream<AgentEvent, Msg[]>()
  const out: Msg[] = []

  const userMsg: Msg = { role: "user", content: input, ts: Date.now() }
  ctx.messages.push(userMsg)
  out.push(userMsg)

  const tick = async () => {
    es.push({ type: "start" })

    try {
      while (true) {
        es.push({ type: "turn" })
        const reply = await getReply(ctx, opts, signal)
        out.push(reply)

        if (reply.stop === "error" || reply.stop === "aborted") {
          es.push({ type: "turn_end", msg: reply, results: [] })
          break
        }

        const calls = reply.content.filter(isToolCall)
        if (calls.length === 0) {
          es.push({ type: "turn_end", msg: reply, results: [] })
          break
        }

        const results = await execTools(ctx, reply, calls, opts, es, signal)
        for (const r of results) { ctx.messages.push(r); out.push(r) }
        es.push({ type: "turn_end", msg: reply, results })

        if (results.every(r => (r as any).halt)) break
      }
    } catch (e) {
      if ((e as any).name !== "AbortError") throw e
    }

    es.push({ type: "end", msgs: out })
    es.end(out)
  }

  tick()
  return es
}

async function getReply(ctx: LoopCtx, opts: LoopOpts, signal?: AbortSignal): Promise<AssistantMsg> {
  const resp = llmStream(opts.model, { system: ctx.system, messages: ctx.messages, tools: ctx.tools.map(t => ({ name: t.name, description: t.description, params: (t.schema as any) })) }, { apiKey: opts.apiKey, signal })

  for await (const ev of resp) {
    if (ev.type === "done") return ev.msg
    if (ev.type === "error") return ev.msg
  }
  return resp.result() ?? { role: "assistant", content: [], model: opts.model.id, provider: opts.model.provider, usage: { in: 0, out: 0, total: 0 }, stop: "error", error: "No response", ts: Date.now() }
}

async function execTools(
  ctx: LoopCtx, reply: AssistantMsg, calls: ToolCallPart[],
  opts: LoopOpts, es: EventStream<AgentEvent, Msg[]>, signal?: AbortSignal,
): Promise<ToolResultMsg[]> {
  return Promise.all(calls.map(async call => {
    es.push({ type: "tool_run", callId: call.id, tool: call.name, args: call.args })

    const tool = ctx.tools.find(t => t.name === call.name)
    let result: import("../types.ts").ToolResult
    let err = false

    if (!tool) {
      result = { content: [text(`Tool "${call.name}" not found`)], meta: {} }
      err = true
    } else {
      try {
        if (opts.beforeTool) {
          const block = await opts.beforeTool(call, call.args, ctx)
          if (block?.block) { result = { content: [text(block.reason ?? "Blocked")], meta: {} }; err = true }
        }
        if (!err) result = await tool.run(call.id, call.args, signal)
      } catch (e) {
        result = { content: [text(e instanceof Error ? e.message : String(e))], meta: {} }
        err = true
      }
    }

    if (!err && opts.afterTool) {
      try {
        const patch = await opts.afterTool(call, result, err, ctx)
        if (patch) result = { ...result, ...patch }
      } catch (e) {
        result = { content: [text(e instanceof Error ? e.message : String(e))], meta: {} }
        err = true
      }
    }

    es.push({ type: "tool_done", callId: call.id, tool: call.name, err })

    return {
      role: "tool_result" as const, callId: call.id, tool: call.name,
      content: result.content, isError: err, ts: Date.now(),
    }
  }))
}
```

## Agent (Stateful Wrapper)

```typescript
// src/agent/agent.ts

import type { Msg, AssistantMsg, Tool, Model, AgentEvent } from "../types.ts"
import { run } from "./loop.ts"
import { EventStream } from "../provider/stream.ts"

export class Agent {
  #system: string
  #messages: Msg[] = []
  #tools: Tool[]
  #model: Model
  #apiKey?: string
  #listeners = new Set<(ev: AgentEvent) => void>()
  #abort?: AbortController
  #streaming = false

  constructor(init: { model: Model; system?: string; tools?: Tool[]; apiKey?: string }) {
    this.#model = init.model
    this.#system = init.system ?? ""
    this.#tools = init.tools ?? []
    this.#apiKey = init.apiKey
  }

  on(fn: (ev: AgentEvent) => void): () => void {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  async prompt(input: string): Promise<void> {
    if (this.#streaming) throw new Error("Busy")
    this.#abort = new AbortController()
    this.#streaming = true

    try {
      const es = run(input, {
        system: this.#system,
        messages: [...this.#messages],
        tools: this.#tools,
      }, {
        model: this.#model,
        apiKey: this.#apiKey,
      }, this.#abort.signal)

      for await (const ev of es) {
        if (ev.type === "end") this.#messages.push(...ev.msgs)
        if ("msg" in ev && "msgs" in ev === false) this.#messages.push((ev as any).msg)
        this.#emit(ev)
      }
    } finally {
      this.#streaming = false
      this.#abort = undefined
    }
  }

  abort() { this.#abort?.abort() }
  get busy() { return this.#streaming }
  get history() { return this.#messages as readonly Msg[] }
  get model() { return this.#model }
  set model(m: Model) { this.#model = m }

  #emit(ev: AgentEvent) { for (const fn of this.#listeners) fn(ev) }
}
```
