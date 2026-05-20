# Novacode — AGENTS.md

Project knowledge for coding agents working on this codebase.

## Project Overview

Novacode is an open-source, multi-provider coding agent built with Node.js. It follows a ReAct agent loop pattern (Reason → Act → Observe).

**Stack:** Node.js (>= 22), TypeScript, `node:fs/promises` for file I/O, `node:child_process` for spawning processes.

**Config dir:** `~/.novacode/` (config.json, auth.json, sessions/)

## Commands

```bash
npm run dev          # dev with watch (tsx watch)
npm run start        # run
npm test             # run tests (node built-in test runner via tsx)
npm run lint         # biome lint check
pm run lint:fix     # biome lint + auto-fix
npm run format       # biome format
npm run typecheck    # tsc --noEmit
npm run check        # typecheck + lint + test (run this before committing)
```

## Architecture

```
src/
├── main.ts              # entry: CLI parse → onboarding → interactive mode
├── types.ts             # ALL shared types (single source of truth)
├── config/
│   ├── store.ts         # config.json (settings) + auth.json (API keys, 0600)
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
│   ├── fs.ts            # read, write, edit tools
│   ├── shell.ts         # bash tool
│   └── search.ts        # glob, grep, ls tools
├── session/             # (TODO) JSONL session persistence + compaction
├── onboarding/
│   └── wizard.ts        # first-run setup using Ink standalone prompts
├── commands/            # slash command handlers (/models, /providers, /compact, etc)
└── tui/
    ├── app.tsx          # interactive TUI application using Ink
    ├── prompts.tsx      # Ink-based select/password/confirm prompt components
    └── markdown.ts      # markdown terminal renderer
```

## Design Rules

1. **One type file** — `src/types.ts` is the single source of truth. No scattered interfaces. If you need a new type, add it there.
2. **Pure functions first** — `loop.run()` is a function, not a method. Agent class wraps state. New logic goes in standalone functions unless it needs persistent state.
3. **Node.js APIs** — `node:fs/promises` for file I/O, `node:child_process` for spawning processes.
4. **Lazy providers** — SDKs are dynamically imported only when needed.
5. **No comments unless "why"** — code explains "what", comments explain "why". Do not add JSDoc to every function. Only add JSDoc when the function's purpose is non-obvious or has subtle behavior.
6. **Short names** — `Msg` not `AgentMessage`, `StreamFn` not `StreamFunction`.
7. **Private fields** — `#field` not `private field`. True encapsulation.
8. **Single rendering context** — All interactive UI (chat, prompts, menus) runs inside one Ink app. Never unmount/remount Ink to switch between modes. Use state-based mode switching instead.

## Coding Conventions

- Tabs for indentation (biome enforces this)
- Double quotes (biome enforces)
- No semicolons (biome enforces `asNeeded`)
- `async/await` over `.then()` chains
- Error handling: try/catch in tools, return `ToolResult` with `isError: true`
- No decorative comment separators — no `───` dashes, no `***` bars. Use plain `//` for section breaks or nothing at all. Let code structure speak.
- Tests: small, focused, in `test/` directory. Use `node:test` (describe/it/expect)

## Clean Code Rules

These rules prevent the most common mistakes AI agents make when editing this codebase.

### No Dead Code

- **No unused variables.** Every `const`, `let`, and function parameter must be used. If a parameter is required by an interface but unused, prefix with `_` (e.g. `_signal`).
- **No unused imports.** Remove any import that isn't referenced. Run `npm run lint` to catch these.
- **No dead arrays/objects.** If you create an array or object and never push/assign to it after initialization, remove it. Example: don't collect results into an array that's never consumed.
- **No unreachable code.** Code after `return`, `break`, `throw`, or `process.exit()` is a bug.

### No Redundant Code

- **No duplicate logic.** If two files have the same helper (e.g. the `text()` helper in tools), keep it in each file since it's tiny — but don't create a third copy. If it grows, extract to a shared util.
- **No redundant type assertions.** Don't write `as string` when TypeScript already infers `string`. Don't double-cast.
- **No unnecessary imports.** Don't import a type you don't use. Don't import `{ type Foo }` if `Foo` isn't referenced.
- **No re-exporting through intermediaries.** Import from the source module directly.

### No Verbose Code

- **Prefer early return over nesting.** Guard clauses first, then the happy path — no deep `if/else` chains.
- **Prefer `const` over `let`.** Only use `let` when reassignment is genuinely needed.
- **Prefer concise conditionals.** Use `?.` and `??` instead of `if (x !== null && x !== undefined)`.
- **One concern per function.** If a function does three things, split it into three functions.
- **No wrapper functions that add nothing.** If a function just calls another function with the same args, inline the call.
- **Template literals only when needed.** `"hello"` not `` `hello` ``. Use template literals only for interpolation or multi-line strings.
- **No unnecessary blocks.** Don't wrap single statements in `{ }` unless required by syntax.

### Mutation Rules

- **Mutate only when intentional.** Tools like `edit` or `write` mutate the filesystem — that's their job. But agent state, config, and provider registries should be treated as append-only or immutable unless there's a clear reason.
- **Don't mutate function arguments.** Treat all arguments as read-only. If you need a modified copy, spread into a new object/array.
- **No side effects in constructors.** Constructors assign fields only. Do async work in `init()` methods or factory functions.

### Error Handling

- **Never swallow errors silently.** Every `catch` must either: (a) return a `ToolResult` with `isError: true`, (b) re-throw, or (c) log meaningfully. Empty `catch {}` is banned.
- **Don't wrap errors in errors.** If a function already returns a `{ content, isError }` result, don't wrap it again. Propagate as-is.
- **Error messages must be useful.** `"Error reading file: ${e.message}"` not `"Error"`. Include the path, the operation, and the original message.

### Type Safety

- **Use `type` imports for types.** `import type { Foo }` not `import { Foo }` when only the type is needed. This is enforced by `verbatimModuleSyntax` in tsconfig.
- **No `any` without justification.** Use `unknown` and narrow with type guards. If you must use `any`, add a `// biome-ignore` comment explaining why.
- **Trust the type system.** Don't add runtime checks that duplicate what TypeScript already enforces. Don't add `!` non-null assertions — fix the type instead.
- **Use discriminated unions.** Our `Msg`, `ContentPart`, and `AgentEvent` types use `type` discriminants. Pattern-match on them with `if (x.type === "...")` and TypeScript will narrow automatically.

### Module Boundaries

- **`types.ts`** — types only. No runtime code, no imports from other src files.
- **`provider/`** — streaming and API logic only. No agent logic, no tool definitions.
- **`tools/`** — tool definitions only. No agent loop logic. Tools receive `cwd` as a parameter, they don't read config.
- **`agent/`** — orchestrates providers and tools. No direct HTTP calls or file I/O (those live in tools and providers).
- **`config/`** — reads/writes config files. No agent or provider logic.
- **`commands/`** — slash command handlers. Receive a `Prompts` interface from the TUI for interactive menus. Never import Ink or render directly — use the injected `Prompts` object.
- **`tui/`** — all rendering lives here. `app.tsx` owns the Ink app and exposes a `Prompts` implementation. `prompts.tsx` has reusable Ink prompt components plus standalone wrappers for onboarding (outside the main TUI).
- **Cross-module imports go one direction:** `main → agent → provider`, `main → tools`, `main → config`, `main → tui`. Never `tools → agent` or `provider → agent` or `commands → tui`.

## Before Every Commit

1. Run `npm run check` (typecheck + lint + test). Fix all errors before committing.
2. If lint fails with unused imports/variables, run `npm run lint:fix`.
3. Verify no dead code was introduced: unused variables, unreachable returns, empty catches.
4. Verify imports: only `import type` for types, no unused imports.

## Common Mistakes to Avoid

| Mistake | Correct approach |
|---------|-----------------|
| Adding a type to a tool file instead of `types.ts` | Put all shared types in `types.ts` |
| Using `private field` instead of `#field` | Use `#field` for true private encapsulation |
| Using `fs.readFile` / `fs.writeFile` (callback style) | Use `node:fs/promises` (`readFile`, `writeFile`) |
| Adding `import { Foo }` for a type | Use `import type { Foo }` |
| Empty `catch {}` block | Return error result or re-throw |
| Commenting `// this function does X` | Rename the function so the name says X |
| Adding a `console.log` for debugging | Remove it before committing |
| Nesting `if/else` 3+ levels deep | Use early returns and guard clauses |
| Using callback-style `node:fs` | Use `node:fs/promises` for all file I/O. Prefer async APIs. |
| Creating a new interface in a tool file | Add it to `types.ts` if shared, or keep it local with a clear `/** ... */` doc if it's file-scoped |
| Adding a new prompt/interactive library (e.g. clack, inquirer, prompts) | Use the existing Ink-based `Prompts` interface in `tui/prompts.tsx`. All interactive UI runs inside one Ink app. |