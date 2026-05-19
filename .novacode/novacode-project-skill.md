---
name: novacode-project
description: Project skill for the novacode coding agent codebase - multi-provider agent built with Bun
trigger: auto
---

# Novacode Project Skill

A coding agent skill for working on the novacode project - an open-source, multi-provider coding agent built with Bun.

## Project Overview

Novacode is a ReAct agent (Reason → Act → Observe) with streaming support, multi-provider architecture, and interactive TUI.

**Stack:** Bun runtime, TypeScript
**Config:** `~/.novacode/` (config.json, auth.json, sessions.db)

## Architecture

```
src/
├── main.ts              # CLI entry: first-run → onboarding → TUI/print mode
├── types.ts             # ALL shared types (single source of truth)
├── config/
│   ├── store.ts         # config.json + auth.json management
│   └── providers.ts     # provider catalog (GLM, Gemini, DeepSeek, OpenAI)
├── provider/
│   ├── stream.ts        # EventStream<T,R> — push-based async event stream
│   ├── registry.ts      # Map<ApiFormat, StreamFn> + bridge to agent events
│   ├── openai.ts        # OpenAI-compatible streaming (GLM, DeepSeek)
│   └── gemini.ts        # Google Gemini native API
├── agent/
│   ├── loop.ts          # pure ReAct loop function (run)
│   ├── agent.ts         # stateful Agent class wrapping loop
│   └── prompt.ts        # system prompt builder
├── tools/
│   ├── index.ts         # tool factory exports (allTools, codingTools)
│   ├── fs.ts            # read, write, edit (Bun.file, Bun.write)
│   ├── shell.ts         # bash (Bun.spawn)
│   └── search.ts        # grep, find, ls
├── session/
│   ├── store.ts         # SQLite session persistence (bun:sqlite)
│   └── compact.ts       # context compaction
├── commands/
│   ├── index.ts         # /command router
│   ├── models.ts        # /models — switch models
│   ├── providers.ts     # /providers — manage API keys
│   ├── session.ts      # session management
│   └── compact.ts      # context compaction
├── onboarding/
│   └── wizard.ts        # first-run @clack/prompts setup
└── tui/
    └── print.ts         # pipe-friendly print mode
```

## Key Types (src/types.ts)

```typescript
// Content Parts
type ContentPart = TextPart | ImagePart | ThinkPart | ToolCallPart
interface TextPart { type: "text"; text: string; signature?: string }
interface ImagePart { type: "image"; data: string; mime: string }
interface ThinkPart { type: "thinking"; text: string; signature?: string }
interface ToolCallPart { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }

// Messages
type Msg = UserMsg | AssistantMsg | ToolResultMsg
type StopReason = "stop" | "length" | "tool_use" | "error" | "aborted"

// Provider
type ApiFormat = "openai" | "gemini"
interface Model { id: string; name: string; provider: string; contextWindow: number; maxTokens: number; supportsThinking: boolean }

// Tools
interface ToolDef { name: string; description: string; parameters: ToolParamDef }
interface ToolResult { content: ContentPart[]; isError: boolean }
interface Tool { def: ToolDef; execute: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolResult> }

// Agent Events
type AgentEvent = "start" | "turn" | "text_delta" | "thinking_delta" | "tool_call" | "assistant_msg" | "tool_result" | "turn_end" | "usage"

// Loop Types
interface LoopCtx { system: string; messages: Msg[]; tools: Tool[] }
interface LoopOpts { api: ApiFormat; model: Model; apiKey: string; baseUrl: string; maxTurns?: number }
```

## Commands

```bash
bun run dev          # dev with watch
bun run start        # run
bun test             # run tests
bun run lint         # biome lint check
bun run lint:fix     # biome lint + auto-fix
bun run format       # biome format
bun run typecheck    # tsc --noEmit
bun run check        # typecheck + lint + test (run before committing)
bun run build        # compile to binary (outputs `novacode`, accessible as `nova`)
```

## Coding Conventions

- **Tabs** for indentation (biome enforces)
- **Double quotes** (biome enforces)
- **No semicolons** (biome enforces `asNeeded`)
- **Async/await** over `.then()` chains
- **Private fields** — `#field` not `private field`
- **Short names** — `Msg` not `AgentMessage`, `StreamFn` not `StreamFunction`
- **No comments unless "why"** — code explains "what"
- **Type imports** — `import type { Foo }` not `import { Foo }`
- **Discriminated unions** — use `if (x.type === "...")` pattern matching

## Bun APIs

- Use `Bun.file()`, `Bun.write()`, `Bun.spawn()` for file I/O
- Use `node:fs/promises` only when Bun doesn't have equivalent (chmod, readdir with dirent options)

## Design Rules

1. **One type file** — `src/types.ts` is single source of truth
2. **Pure functions first** — `loop.run()` is a function, not a method
3. **Lazy providers** — SDKs dynamically imported only when needed
4. **Module boundaries:**
   - `types.ts` — types only, no runtime code
   - `provider/` — streaming and API logic only
   - `tools/` — tool definitions only, receive `cwd` as parameter
   - `agent/` — orchestrates providers and tools, no direct HTTP/file I/O
   - `config/` — reads/writes config files

## Error Handling

- Return `ToolResult` with `isError: true` on errors
- Never swallow errors silently — every catch must: (a) return error result, (b) re-throw, or (c) log meaningfully
- Error messages must be useful: `"Error reading file: ${e.message}"` not `"Error"`

## Providers

| Provider | API | Status |
|----------|-----|--------|
| GLM (Zhipu AI) | openai | ✅ registered |
| Gemini (Google) | gemini | ✅ registered |
| DeepSeek | openai | ✅ registered (via openai.ts) |
| OpenAI | openai | ✅ registered (via openai.ts) |

## Adding a New Provider

1. Add provider to `src/config/providers.ts` with models, baseUrl, api format
2. If API is "openai", it reuses `src/provider/openai.ts`
3. If new API format, create `src/provider/<name>.ts` implementing `StreamFn`
4. Register in `src/provider/registry.ts`: `register("api-name", streamFn)`

## Tool Pattern

Tools are factories that take `cwd` and return a `Tool`:

```typescript
// Example from src/tools/fs.ts
export function makeRead(cwd: string): Tool {
  return {
    def: { name: "read", description: "...", parameters: {...} },
    async execute(args, signal) {
      const path = resolve(cwd, args.path)
      const content = await Bun.file(path).text()
      return { content: [{ type: "text", text: content }], isError: false }
    }
  }
}
```

## Agent Loop Flow

1. User input → `Agent.prompt(input)`
2. `loop.run(input, ctx, opts)` creates EventStream
3. Add user message to context
4. Loop until maxTurns (default 50):
   - Call `registry.stream()` to get provider response
   - Handle text_delta, thinking_delta, tool_call events
   - Execute tools sequentially, emit tool_result events
   - Add results back to context
   - If no more tool calls, break
5. Return all messages

## Session Management

- SQLite via `bun:sqlite` in `~/.novacode/sessions.db`
- Tables: sessions, messages, compactions
- Auto-compaction when approaching 80% context limit
- JSONL fallback not implemented (see docs/ref for plan)

## Before Committing

1. Run `bun run check` (typecheck + lint + test)
2. If lint fails: `bun run lint:fix`
3. Check for: unused imports, unreachable code, empty catches
4. Verify: only `import type` for types

## Common Mistakes

| Mistake | Correct |
|---------|---------|
| Adding type to tool file | Add to `types.ts` |
| Using `private field` | Use `#field` |
| Using `fs.readFile` | Use `Bun.file()` |
| Empty `catch {}` | Return error result or re-throw |
| Importing type without `type` | Use `import type { Foo }` |