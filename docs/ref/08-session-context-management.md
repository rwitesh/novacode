# 08 — Sessions

## Store (JSONL)

```typescript
// src/session/store.ts

import { join } from "node:path"
import { mkdir, readdir } from "node:fs/promises"
import type { Msg } from "../types.ts"

type Header = { id: string; cwd: string; model: string; created: number }
type Entry = { type: "header"; } & Header
  | { type: "user" | "assistant" | "tool_result"; msg: Msg }
  | { type: "compact"; summary: string; files: { read: string[]; wrote: string[] }; ts: number }

const PATH = (dir: string, id: string) => join(dir, `${id}.jsonl")

export class SessionStore {
  #dir: string
  #active?: string
  #entries: Entry[] = []

  constructor(dir: string) { this.#dir = dir }

  async init() { await mkdir(this.#dir, { recursive: true }) }

  async create(cwd: string, model: string): Promise<string> {
    const id = `${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`
    const header: Entry = { type: "header", id, cwd, model, created: Date.now() }
    await Bun.write(PATH(this.#dir, id), JSON.stringify(header) + "\n")
    this.#active = id
    this.#entries = [header]
    return id
  }

  async load(id: string): Promise<Header> {
    const raw = await Bun.file(PATH(this.#dir, id)).text()
    this.#entries = raw.split("\n").filter(Boolean).map(l => JSON.parse(l))
    this.#active = id
    return this.#entries[0] as Header
  }

  async append(msg: Msg): Promise<void> {
    if (!this.#active) return
    const role = msg.role === "tool_result" ? "tool_result" : msg.role
    const entry: Entry = { type: role as any, msg }
    this.#entries.push(entry)
    const f = Bun.file(PATH(this.#dir, this.#active))
    const existing = await f.text().catch(() => "")
    await Bun.write(PATH(this.#dir, this.#active), existing + JSON.stringify(entry) + "\n")
  }

  messages(): Msg[] {
    const out: Msg[] = []
    for (const e of this.#entries) {
      if (e.type === "compact") {
        out.length = 0
        out.push({ role: "user", content: `[Prior context]\n${(e as any).summary}`, ts: (e as any).ts })
      } else if ("msg" in e) {
        out.push((e as any).msg)
      }
    }
    return out
  }

  async list(): Promise<Header[]> {
    const files = await readdir(this.#dir)
    const headers: Header[] = []
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue
      try {
        const first = (await Bun.file(join(this.#dir, f)).text()).split("\n")[0]
        if (first) headers.push(JSON.parse(first))
      } catch {}
    }
    return headers.sort((a, b) => b.created - a.created)
  }

  async delete(id: string): Promise<void> {
    await Bun.file(PATH(this.#dir, id)).unlink?.()
    if (this.#active === id) { this.#active = undefined; this.#entries = [] }
  }

  get active() { return this.#active }
}
```

## Compaction

```typescript
// src/session/compact.ts

import type { Msg, Model } from "../types.ts"
import { stream } from "../provider/registry.ts"

const estimateTokens = (msgs: Msg[]): number =>
  Math.ceil(msgs.reduce((n, m) => n + JSON.stringify(m).length, 0) / 4)

export async function compact(
  messages: Msg[],
  model: Model,
  apiKey: string,
  keep: number = 10,
): Promise<{ summary: string; read: string[]; wrote: string[] } | null> {
  if (estimateTokens(messages) < model.ctxWindow * 0.8) return null

  const old = messages.slice(0, -keep)
  if (old.length === 0) return null

  const convo = old.map(m => {
    if (m.role === "user") return `User: ${typeof m.content === "string" ? m.content : m.content.map(c => c.type === "text" ? c.text : "").join("")}`
    if (m.role === "assistant") return `Asst: ${m.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("")}`
    if (m.role === "tool_result") return `Tool(${m.tool}): ${m.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("").slice(0, 200)}`
    return ""
  }).join("\n\n")

  const resp = stream(model, {
    system: "Summarize this coding session in ≤300 words. Cover: what was asked, files touched, what was done, key decisions.",
    messages: [{ role: "user", content: convo, ts: Date.now() }],
  }, { apiKey, maxTokens: 1000 })

  const result = await resp.result()
  const summary = result.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("")

  const read: string[] = []
  const wrote: string[] = []
  for (const m of old) {
    if (m.role === "tool_result" && m.tool === "read") read.push(m.tool)
    if (m.role === "tool_result" && (m.tool === "write" || m.tool === "edit")) wrote.push(m.tool)
  }

  return { summary, read: [...new Set(read)], wrote: [...new Set(wrote)] }
}
```
