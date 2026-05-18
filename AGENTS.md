# Novacode — AGENTS.md

Project knowledge for coding agents working on this codebase.

## Project Overview

Novacode is an open-source, multi-provider coding agent built with Bun. It follows a ReAct agent loop pattern (Reason → Act → Observe) inspired by pi-coding-agent's architecture but simplified.

**Stack:** Bun runtime, TypeScript, no Node.js APIs for file I/O (prefer `Bun.file()`, `Bun.write()`, `Bun.spawn()`).

**Config dir:** `~/.novacode/` (config.json, auth.json, sessions/)

## Commands

```bash
bun run dev          # dev with watch
bun run start        # run
bun test             # run tests
bun run lint         # biome lint check
bun run lint:fix     # biome lint + auto-fix
bun run format       # biome format
bun run typecheck    # tsc --noEmit
bun run check        # typecheck + lint + test (run this before committing)
bun run build        # compile to binary (outputs `novacode`, accessible as `nova` too)
```

## Architecture

```
src/
├── main.ts              # entry: CLI parse → onboarding → print/interactive mode
├── types.ts             # ALL shared types (single source of truth)
├── config/
│   ├── store.ts         # config.json + auth.json persistence
│   └── providers.ts     # provider catalog (GLM, Gemini, DeepSeek, OpenAI)
├── provider/
│   ├── stream.ts        # EventStream<T,R> — push-based async event stream
│   ├── registry.ts      # Map<ApiFormat, StreamFn> + bridge to agent events
│   └── openai.ts        # OpenAI-compatible streaming (GLM, DeepSeek, OpenAI)
├── agent/
│   ├── loop.ts          # pure ReAct loop function (run)
│   ├── agent.ts         # stateful Agent class wrapping loop
│   └── prompt.ts        # system prompt builder
├── tools/
│   ├── index.ts         # tool factory exports
│   └── fs.ts            # read, write, edit, bash tools
├── session/             # (TODO) JSONL session persistence + compaction
├── onboarding/
│   └── wizard.ts        # first-run @clack/prompts setup
├── commands/            # (TODO) /models, /config, etc
└── tui/
    └── print.ts         # print mode (non-interactive)
```

## Design Rules

1. **One type file** — `src/types.ts` is the single source of truth. No scattered interfaces.
2. **Pure functions first** — `loop.run()` is a function, not a method. Agent class wraps state.
3. **Bun APIs** — `Bun.file()`, `Bun.write()`, `Bun.spawn()`. Use `node:fs/promises` only when Bun doesn't have an equivalent.
4. **Lazy providers** — SDKs are dynamically imported only when needed.
5. **No comments unless "why"** — code explains "what", comments explain "why".
6. **Short names** — `Msg` not `AgentMessage`, `StreamFn` not `StreamFunction`.
7. **Private fields** — `#field` not `private field`. True encapsulation.

## Coding Conventions

- Tabs for indentation (biome enforces this)
- Double quotes (biome enforces)
- No semicolons (biome enforces `asNeeded`)
- `async/await` over `.then()` chains
- Error handling: try/catch in tools, return `ToolResult` with `isError: true`
- Tests: small, focused, in `test/` directory. Use `bun:test` (describe/it/expect)

## Pre-commit

Lefthook runs `bun run lint` and `bun test` on pre-commit. If lint fails, run `bun run lint:fix` to auto-fix.

## Providers

| Provider | API | Status |
|----------|-----|--------|
| GLM (Zhipu AI) | OpenAI-compat | ✅ registered |
| Gemini (Google) | Gemini | 🔜 needs gemini.ts |
| DeepSeek | OpenAI-compat | ✅ registered (via openai.ts) |
| OpenAI | OpenAI | ✅ registered (via openai.ts) |

## Reference Docs

Full architecture docs from the original design are in `docs/ref/`. These are the planning documents, not source code.
