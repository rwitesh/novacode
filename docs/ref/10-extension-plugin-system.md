# 10 — Extensions

## Extension Interface

```typescript
// src/extensions/types.ts

import type { Tool, ToolCallPart, ToolResult, LoopCtx } from "../types.ts"

export interface Extension {
  name: string
  tools?: Tool[]
  beforeTool?: (call: ToolCallPart, args: unknown, ctx: LoopCtx) => Promise<{ block?: boolean; reason?: string } | void>
  afterTool?: (call: ToolCallPart, result: ToolResult, err: boolean, ctx: LoopCtx) => Promise<Partial<ToolResult> | void>
  commands?: Record<string, (args: string) => Promise<string>>
  promptAddon?: string
}
```

## Loader

```typescript
// src/extensions/loader.ts

import type { Extension } from "./types.ts"
import type { Tool } from "../types.ts"

const exts: Extension[] = []

export const loadBuiltins = () => {
  exts.push({
    name: "builtin",
    commands: {
      help: async () => "Commands: /models /config /compact /help /clear /quit",
      compact: async (_, ctx: any) => { await (ctx as any).compact(); return "Compacted" },
    },
  })
}

export const loadUserExts = async (dir: string) => {
  const glob = new Bun.Glob("*.js")
  for await (const file of glob.scan({ cwd: dir })) {
    try {
      const mod = await import(`${dir}/${file}`)
      const ext = mod.default ?? mod
      if (ext?.name && typeof ext.name === "string") exts.push(ext)
    } catch {}
  }
}

export const tools = (): Tool[] => exts.flatMap(e => e.tools ?? [])
export const commands = () => exts.flatMap(e => Object.entries(e.commands ?? {}).map(([k, fn]) => ({ name: k, fn })))
export const promptAddons = () => exts.map(e => e.promptAddon).filter(Boolean).join("\n\n")
```

## Skills (Markdown)

```typescript
// src/extensions/skills.ts

export interface Skill {
  name: string
  trigger: "auto" | "keyword"
  keywords: string[]
  body: string
}

export const loadSkills = async (dir: string): Promise<Skill[]> => {
  const skills: Skill[] = []
  const glob = new Bun.Glob("*.md")
  for await (const file of glob.scan({ cwd: dir })) {
    const raw = await Bun.file(`${dir}/${file}`).text()
    const [, frontmatter = "", body = ""] = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? []
    const meta = Object.fromEntries(frontmatter.split("\n").filter(Boolean).map(l => { const [k, ...v] = l.split(":"); return [k.trim(), v.join(":").trim()] }))
    skills.push({
      name: meta.name ?? file.replace(".md", ""),
      trigger: (meta.trigger as any) ?? "keyword",
      keywords: (meta.keywords ?? "").split(",").map((s: string) => s.trim()).filter(Boolean),
      body,
    })
  }
  return skills
}

export const matchSkills = (skills: Skill[], msg: string): Skill[] =>
  skills.filter(s => s.trigger === "auto" || s.keywords.some(k => msg.toLowerCase().includes(k.toLowerCase())))

export const skillsToPrompt = (skills: Skill[]): string =>
  skills.length ? "\n\n<skills>\n" + skills.map(s => `<skill name="${s.name}">\n${s.body}\n</skill>`).join("\n\n") + "\n</skills>" : ""
```

## MCP Client (Sketch)

```typescript
// src/extensions/mcp.ts

import type { Tool, ToolResult, ContentPart } from "../types.ts"

interface MCPServer {
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
}

const text = (s: string): ContentPart => ({ type: "text" as const, text: s })

export async function loadMcpTools(config: Record<string, MCPServer>): Promise<Tool[]> {
  const tools: Tool[] = []

  for (const [name, cfg] of Object.entries(config)) {
    // Connect via stdio or SSE, discover tools, wrap as Agent tools
    // Full implementation deferred — this is the integration point
  }

  return tools
}
```

## Example Extension

```javascript
// ~/.novacode/extensions/db.js
export default {
  name: "db",
  tools: [{
    name: "db_query",
    label: "DB Query",
    description: "Run a SQL query",
    schema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
    async run(_, args) {
      const { default: pg } = await import("pg")
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
      try {
        const r = await pool.query(args.sql)
        return { content: [{ type: "text", text: JSON.stringify(r.rows, null, 2) }], meta: { rows: r.rowCount } }
      } finally { await pool.end() }
    },
  }],
  beforeTool: async (call) => {
    if (call.name === "db_query" && /drop|truncate/i.test(call.args.sql ?? ""))
      return { block: true, reason: "Destructive SQL blocked" }
  },
}
```

## Example Skill

```markdown
---
name: react
trigger: keyword
keywords: react, component, jsx, tsx
---

Use functional components with hooks.
TypeScript for all components.
Keep under 200 lines.
Named exports, PascalCase files.
```
