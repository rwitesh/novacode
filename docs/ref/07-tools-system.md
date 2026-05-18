# 07 — Tools

## Types

```typescript
// Re-exported from src/types.ts — Tool and ToolResult defined there
```

## Tool Factory

```typescript
// src/tools/index.ts

import type { Tool } from "../types.ts"
import { makeRead } from "./fs.ts"
import { makeBash } from "./shell.ts"
import { makeGrep, makeFind, makeLs } from "./search.ts"

export const allTools = (cwd: string): Tool[] => [
  makeRead(cwd), makeWrite(cwd), makeEdit(cwd),
  makeBash(cwd),
  makeGrep(cwd), makeFind(cwd), makeLs(cwd),
]

export const codingTools = (cwd: string): Tool[] => [
  makeRead(cwd), makeWrite(cwd), makeEdit(cwd), makeBash(cwd),
]
```

## File Tools (read / write / edit)

```typescript
// src/tools/fs.ts

import { Type } from "@sinclair/typebox"
import type { Tool, ToolResult, ContentPart } from "../types.ts"
import { resolve, dirname, extname } from "node:path"
import { mkdir } from "node:fs/promises"

const text = (s: string): ContentPart => ({ type: "text", text: s })
const safe = (cwd: string, p: string) => { const f = resolve(cwd, p); if (!f.startsWith(cwd)) throw new Error(`Path outside project: ${p}`); return f }
const IMAGES = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"])

// ── Read ─────────────────────────────────────────────────

const ReadSchema = Type.Object({
  path: Type.String({ description: "File path to read" }),
  offset: Type.Optional(Type.Number({ description: "Start line (1-based)" })),
  limit: Type.Optional(Type.Number({ description: "Max lines" })),
})

export function makeRead(cwd: string): Tool {
  return {
    name: "read",
    label: "Read",
    description: "Read file contents. Images return base64. Output truncated to 2000 lines with line numbers.",
    schema: ReadSchema,
    async run(_, args, signal) {
      const p = safe(cwd, (args as any).path)
      const ext = extname(p).toLowerCase()

      if (IMAGES.has(ext)) {
        const buf = await Bun.file(p).arrayBuffer()
        return { content: [{ type: "image", data: Buffer.from(buf).toString("base64"), mime: `image/${ext === ".jpg" ? "jpeg" : ext.slice(1)}` }], meta: { path: p } }
      }

      const content = await Bun.file(p).text()
      const lines = content.split("\n")
      const start = ((args as any).offset ?? 1) - 1
      const max = (args as any).limit ?? 2000
      const slice = lines.slice(start, start + max)
      const cut = start + max < lines.length

      const out = slice.map((l, i) => `${String(start + i + 1).padStart(4)}│${l}`).join("\n")
        + (cut ? `\n…${lines.length - start - max} more lines` : "")

      return { content: [text(out)], meta: { path: p, lines: lines.length, cut } }
    },
  }
}

// ── Write ────────────────────────────────────────────────

const WriteSchema = Type.Object({
  path: Type.String({ description: "File path to create/overwrite" }),
  content: Type.String({ description: "File content" }),
})

export function makeWrite(cwd: string): Tool {
  return {
    name: "write",
    label: "Write",
    description: "Create or overwrite a file. Creates parent dirs.",
    schema: WriteSchema,
    async run(_, args) {
      const p = safe(cwd, (args as any).path)
      const c = (args as any).content as string
      await mkdir(dirname(p), { recursive: true })
      await Bun.write(p, c)
      return { content: [text(`Wrote ${c.length} bytes → ${p}`)], meta: { path: p, size: c.length } }
    },
  }
}

// ── Edit ─────────────────────────────────────────────────

const EditSchema = Type.Object({
  path: Type.String({ description: "File path" }),
  edits: Type.Array(Type.Object({
    old: Type.String({ description: "Exact text to find (must be unique)" }),
    new: Type.String({ description: "Replacement text" }),
  })),
})

export function makeEdit(cwd: string): Tool {
  return {
    name: "edit",
    label: "Edit",
    description: "Precise text replacement. Each oldText must be unique in the file.",
    schema: EditSchema,
    async run(_, args) {
      const p = safe(cwd, (args as any).path)
      let content = await Bun.file(p).text()
      const edits = (args as any).edits as Array<{ old: string; new: string }>

      for (const e of edits) {
        const count = content.split(e.old).length - 1
        if (count === 0) return { content: [text(`Not found: "${e.old.slice(0, 60)}…"`)], meta: {} }
        if (count > 1) return { content: [text(`Found ${count} matches — add context to make unique`)], meta: {} }
        content = content.replace(e.old, e.new)
      }

      await Bun.write(p, content)
      return { content: [text(`Edited ${p} (${edits.length} change${edits.length > 1 ? "s" : ""})`)], meta: { path: p, edits: edits.length } }
    },
  }
}
```

## Shell Tool (bash)

```typescript
// src/tools/shell.ts

import { Type } from "@sinclair/typebox"
import type { Tool, ContentPart } from "../types.ts"
import { spawn } from "bun"

const text = (s: string): ContentPart => ({ type: "text", text: s })

const BashSchema = Type.Object({
  command: Type.String({ description: "Shell command" }),
  timeout: Type.Optional(Type.Number({ description: "Seconds (default 120)" })),
})

export function makeBash(cwd: string): Tool {
  return {
    name: "bash",
    label: "Shell",
    description: "Execute a bash command. Returns stdout + stderr.",
    schema: BashSchema,
    async run(_, args, signal) {
      const cmd = (args as any).command as string
      const ms = ((args as any).timeout ?? 120) * 1000

      const proc = spawn({ cmd: ["bash", "-c", cmd], cwd, stdout: "pipe", stderr: "pipe" })
      const timer = setTimeout(() => proc.kill(), ms)
      signal?.addEventListener("abort", () => proc.kill())

      const code = await proc.exited
      clearTimeout(timer)

      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()

      let out = ""
      if (stdout) out += stdout
      if (stderr) out += (out ? "\n" : "") + stderr
      out += `\n[exit ${code}]`

      return { content: [text(out)], meta: { code, cmd } }
    },
  }
}
```

## Search Tools (grep / find / ls)

```typescript
// src/tools/search.ts

import { Type } from "@sinclair/typebox"
import type { Tool, ContentPart } from "../types.ts"
import { resolve } from "node:path"
import { readdir, stat } from "node:fs/promises"
import { Glob } from "glob"

const text = (s: string): ContentPart => ({ type: "text", text: s })
const safe = (cwd: string, p: string) => resolve(cwd, p || ".")

// ── Grep ─────────────────────────────────────────────────

const GrepSchema = Type.Object({
  pattern: Type.String({ description: "Regex pattern" }),
  path: Type.Optional(Type.String({ description: "Directory" })),
  glob: Type.Optional(Type.String({ description: "File filter, e.g. *.ts" })),
})

export function makeGrep(cwd: string): Tool {
  return {
    name: "grep",
    label: "Grep",
    description: "Search file contents with regex. Uses ripgrep if available.",
    schema: GrepSchema,
    async run(_, args, signal) {
      const { pattern, glob: g } = args as any
      const dir = safe(cwd, (args as any).path)

      // Try ripgrep first (much faster)
      try {
        const proc = spawn({ cmd: ["rg", "--line-number", "--max-count", "200", glob ? `--glob=${g}` : [], "--", pattern, dir], cwd, stdout: "pipe", stderr: "pipe" })
        signal?.addEventListener("abort", () => proc.kill())
        const code = await proc.exited
        if (code === 0) {
          const out = await new Response(proc.stdout).text()
          const lines = out.split("\n").slice(0, 200).join("\n")
          return { content: [text(lines)], meta: { pattern, dir } }
        }
      } catch {}

      // Fallback: read files and filter
      const globber = new Glob(g ?? "**/*")
      const matches: string[] = []
      const re = new RegExp(pattern, "i")
      for await (const file of globber.scan({ cwd: dir })) {
        if (signal?.aborted) break
        try {
          const content = await Bun.file(resolve(dir, file)).text()
          const lines = content.split("\n")
          for (let i = 0; i < lines.length && matches.length < 200; i++) {
            if (re.test(lines[i])) matches.push(`${file}:${i + 1}:${lines[i]}`)
          }
        } catch {}
      }
      return { content: [text(matches.join("\n") || "No matches")], meta: { pattern, dir } }
    },
  }
}

// ── Find ─────────────────────────────────────────────────

const FindSchema = Type.Object({
  pattern: Type.String({ description: "File name pattern" }),
  path: Type.Optional(Type.String({ description: "Directory" })),
})

export function makeFind(cwd: string): Tool {
  return {
    name: "find",
    label: "Find",
    description: "Find files by name pattern.",
    schema: FindSchema,
    async run(_, args) {
      const dir = safe(cwd, (args as any).path)
      const pattern = (args as any).pattern as string
      const globber = new Glob(`**/*${pattern}*`)
      const files = await globber.scan({ cwd: dir })
      return { content: [text(files.slice(0, 200).join("\n") || "No files found")], meta: { pattern, dir } }
    },
  }
}

// ── Ls ───────────────────────────────────────────────────

const LsSchema = Type.Object({
  path: Type.String({ description: "Directory", default: "." }),
})

export function makeLs(cwd: string): Tool {
  return {
    name: "ls",
    label: "List",
    description: "List directory contents.",
    schema: LsSchema,
    async run(_, args) {
      const dir = safe(cwd, (args as any).path)
      const entries = await readdir(dir, { withFileTypes: true })
      const lines = entries.map(e => {
        const s = e.isDirectory() ? "/" : e.isSymbolicLink() ? "@" : ""
        return `${e.name}${s}`
      })
      return { content: [text(lines.join("\n"))], meta: { dir, count: lines.length } }
    },
  }
}
```
