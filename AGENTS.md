# Novacode — AGENTS.md

Project knowledge for coding agents working on this codebase.

## Project Overview

Novacode is an open-source, multi-provider coding agent built with Node.js and the Vercel AI SDK. The agent loop, streaming, and tool calling are handled by AI SDK primitives (`ToolLoopAgent`, `streamText`, `tool()`).

**Stack:** Node.js (>= 24), TypeScript, Vercel AI SDK (`ai` + `@ai-sdk/openai|anthropic|google`) for LLM/streaming/tools, `zod` for tool input schemas, `node:sqlite` (built-in) for session storage, `node:fs/promises` for file I/O, `node:child_process` for spawning processes.

**Config dir:** `~/.novacode/` (config.json, auth.json, state.db)

## Commands

```bash
npm run dev          # dev with hot-reload watch (node --import tsx/esm --watch src/main.ts)
npm run build        # compile and bundle the codebase using tsdown
npm run start        # run the bundled production build (node dist/main.mjs)
npm test             # run tests via vitest
npm run lint         # biome lint check
npm run lint:fix     # biome lint + auto-fix
npm run format       # biome format
npm run typecheck    # tsc --noEmit
npm run check        # build + typecheck + lint + test (run this before committing)
```

## Architecture

```
src/
├── main.ts              # entry: CLI parse → onboarding → interactive mode
├── types.ts             # NovaCode-specific types only (config, session, policy, CLI plumbing).
│                        # AI message/tool/usage types come from the `ai` package — do NOT redeclare them.
├── providers.ts         # AI SDK provider factory + HIGH reasoning defaults (replaces former src/llm/)
├── bootstrap.ts         # startup resource loader (skills discovery + AGENTS.md)
├── content.ts           # tool-result ↔ AI SDK ToolResultOutput converters + textPart helper
├── paths.ts             # path relativization helpers (getRelativeIfInside, makeRelative, shortenPath)
├── format.ts            # display formatters (formatToolArgs, formatRelativeTime)
├── tokens.ts            # estimateTokens — rough token estimation over ModelMessage[]
├── update.ts            # version check + self-update
├── compact.ts           # session splitting compaction (generateText summary → continuation) + title gen
├── models/
│   ├── catalog.ts      # static provider + model catalog DATA (PROVIDER ids, PROVIDERS list)
│   └── lookup.ts       # catalog accessors (getProvider, getModel, getModelsForProvider, ...)
├── config/
│   └── store.ts         # config.json (settings) + auth.json (API keys, 0600)
├── agent/
│   ├── agent.ts         # stateful Agent class wrapping an AI SDK ToolLoopAgent
│   ├── approval.ts      # withApproval(tools, policy) — gates tool execute, separate from tool defs
│   └── prompt.ts        # system prompt builder
├── tools/
│   ├── index.ts         # getAllTools(cwd) → AI SDK ToolSet
│   ├── fs.ts            # read, write, edit tools (AI SDK tool() + zod inputSchema)
│   ├── shell.ts         # bash tool
│   ├── search.ts        # glob, grep, ls, tree tools
│   ├── git.ts           # git status, log, diff, add, commit tool
│   └── web.ts           # web fetch/search tool
├── db/
│   ├── client.ts        # node:sqlite wrapper: WAL mode, schema init, singleton
│   └── sessionStore.ts  # SessionStore class: stores/restores canonical ModelMessage[] as JSON
├── policy/
│   └── engine.ts       # PolicyEngine — deterministic secret-block + risk classify + approver gate
├── onboarding/
│   └── wizard.ts        # first-run setup using Ink standalone prompts
├── commands/            # slash command handlers (/models, /providers, /compact, etc)
├── skills/              # skill discovery + dedupe/grouping
└── tui/
    ├── app.tsx          # interactive TUI application using Ink (consumes streamText fullStream)
    ├── prompts.tsx      # Ink-based select/password/confirm prompt components
    ├── markdown/        # markdown terminal renderer
    ├── hooks/
    │   ├── useStreamBuffer.ts # frame-rate-limited streaming text buffer hook
    │   └── useTip.ts
    └── components/
        ├── message.tsx      # ModelMessage renderer + hasMeaningfulContent filter
        ├── liveArea.tsx     # Spinner, Cursor, LiveArea (streaming/busy display)
        └── statusBar.tsx    # StatusBar (footer: hints, token usage, model id)
```

**Stack:** Node.js (>= 24), TypeScript, the Vercel AI SDK (`ai` + `@ai-sdk/openai|anthropic|google`) for all LLM/streaming/tool-calling, `zod` for tool input schemas, `node:sqlite` (built-in) for session storage, `node:fs/promises` for file I/O, `node:child_process` for spawning processes.

## Agent Loop & API Flow

NovaCode is built on AI SDK primitives — there is no hand-rolled streaming, SSE parser, tool dispatcher, or agent loop:

1. **ToolLoopAgent** – `src/agent/agent.ts` builds a `ToolLoopAgent` per turn (`model`, `instructions`, `tools`, `stopWhen: stepCountIs(50)`, `providerOptions`). The SDK runs the multi-step tool loop itself via `agent.stream({ messages, abortSignal, onStepFinish })`.
2. **Providers** – `src/providers.ts` maps a provider id to an AI SDK `LanguageModel` (`createOpenAI` for openai/glm/deepseek, `createAnthropic`, `createGoogleGenerativeAI`) and attaches a HIGH reasoning `providerOption` for reasoning-capable models. GLM/DeepSeek are OpenAI-compatible.
3. **Tools** – `src/tools/` defines each tool with `tool({ description, inputSchema: z.object(...), execute, toModelOutput })`. Tools return a NovaCode `ToolResult`; `toModelOutput` (in `content.ts`) converts it to an AI SDK `ToolResultOutput`, preserving images and surfacing errors.
4. **Approval** – `src/agent/approval.ts` `withApproval(tools, policy)` wraps each tool's `execute` so `PolicyEngine.check` runs first. A denial returns an error result the model sees — single-stream, no extra model round-trip. Policy is a separate concern from tool definitions.
5. **Streaming UI** – `src/tui/app.tsx` consumes `result.fullStream` parts (`text-delta`, `reasoning-delta`, `tool-call`, `tool-result`, `error`) directly.
6. **Persistence** – `ModelMessage[]` is the single canonical message format everywhere. `onStepFinish` appends each step's `response.messages` + usage to the store; on resume, stored `ModelMessage[]` flow straight back into `streamText({ messages })`. Tool calls, tool results, and reasoning round-trip losslessly.

## Design Rules

1. **One type file** — `src/types.ts` is the single source of truth for NovaCode-specific types (config, session, policy, CLI plumbing). AI message/tool/usage types are NOT redeclared — import them from `ai` (`ModelMessage`, `ToolSet`, `LanguageModel`, etc.). UI-specific rendering types (e.g., `TimelineEvent`, `ActiveTool`) must reside locally inside the `src/tui/` folder for proper encapsulation.
2. **AI SDK primitives first** — Use `ToolLoopAgent`/`streamText`/`generateText` + `tool()` + zod schemas. Do not hand-roll streaming, SSE parsing, tool dispatch, or agent loops. The Agent class wraps state and delegates the loop to the SDK.
3. **Node.js APIs** — `node:fs/promises` for file I/O, `node:child_process` for spawning processes.
4. **One canonical message format** — `ModelMessage[]` flows unchanged through agent → store → restore → UI. Never convert to/from a custom message type.
5. **No comments unless "why"** — code explains "what", comments explain "why". Do not add JSDoc to every function. Only add JSDoc when the function's purpose is non-obvious or has subtle behavior.
6. **Short names** — `ProviderDef` not `ProviderDefinition`.
7. **Private fields** — `#field` not `private field`. True encapsulation.
8. **Single rendering context** — All interactive UI (chat, prompts, menus) runs inside one Ink app. Never unmount/remount Ink to switch between modes. Use state-based mode switching instead. Prompts (approval, select, confirm, password) must be rendered inline under the timeline instead of replacing the entire layout, ensuring the timeline history is preserved and stable. A persistent `working...` status indicator (or spinner with `active-working` event) must be shown at the bottom of the timeline while the turn loop is executing (`busy` state).
9. **Synchronous Session Store** — The `SessionStore` class is backed by SQLite (`~/.novacode/state.db`) via `node:sqlite` (synchronous `DatabaseSync`). Store methods are `async` for API compatibility but execute synchronously internally. All store methods must be awaited.
10. **Approval is separate from tools** — Tool definitions know nothing about policy. `withApproval(tools, policy)` (`src/agent/approval.ts`) gates execution at wiring time. The `PolicyEngine` is the single approval authority.
11. **CLI vs Interactive Inputs** — Outside interactive TUI mode, use `--` flags exclusively (e.g. `nova --sessions ls`, `nova --sessions rm <id>`, `nova --resume`). Subcommand style (e.g., `nova sessions ls`) is not permitted. Inside interactive mode, use `/` commands exclusively (e.g. `/compact`, `/sessions`).

## Coding Conventions

- Tabs for indentation (biome enforces this)
- Double quotes (biome enforces)
- No semicolons (biome enforces `asNeeded`)
- `async/await` over `.then()` chains
- Error handling: try/catch in tools, return `ToolResult` with `isError: true`
- No decorative comment separators — no `───` dashes, no `***` bars. Use plain `//` for section breaks or nothing at all. Let code structure speak.
- Tests: small, focused, in `test/` directory. Use `vitest` (describe/it/expect)
- **File naming:** use `camelCase` for multi-word filenames (e.g. `liveArea.tsx`, `statusBar.tsx`). Never use kebab-case or snake_case.

## Clean Code Rules

These rules prevent the most common mistakes AI agents make when editing this codebase.

### No Dead Code

- **No unused variables.** Every `const`, `let`, and function parameter must be used. If a parameter is required by an interface but unused, prefix with `_` (e.g. `_signal`).
- **No unused imports.** Remove any import that isn't referenced. Run `npm run lint` to catch these.
- **No dead arrays/objects.** If you create an array or object and never push/assign to it after initialization, remove it. Example: don't collect results into an array that's never consumed.
- **No unreachable code.** Code after `return`, `break`, `throw`, or `process.exit()` is a bug.

### No Redundant Code

- **No duplicate logic.** If two files have the same helper (e.g. the `text()` helper in tools), keep it in each file since it's tiny — but don't create a third copy. If it grows, extract to a shared module (`src/content.ts`, `src/paths.ts`, `src/format.ts`).
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
- **Use discriminated unions.** AI SDK message parts (`ModelMessage`, `ToolCallPart`, `ToolResultPart`) and our `PromptMode` use `type` discriminants. Pattern-match on them with `if (x.type === "...")` / `if (x.role === "...")` and TypeScript will narrow automatically.

### Module Boundaries

- **`types.ts`** — NovaCode-specific types only. No runtime code, no imports from other src files. AI message/tool/usage types are imported from `ai`, never redeclared here.
- **`providers.ts`** — AI SDK provider/model construction + reasoning defaults. No agent logic, no tool definitions.
- **`models/`** — static provider/model catalog only. `catalog.ts` holds the `PROVIDER` ids + `PROVIDERS` list (data); `lookup.ts` holds accessors (getProvider, getModel, ...). No I/O, no agent logic. (Runtime provider/model construction lives in top-level `providers.ts`.)
- **`config/`** — reads/writes config files (`config.json`, `auth.json`). No agent or streaming logic, no model data.
- **`db/`** — all SQLite access. `client.ts` is the connection wrapper; `sessionStore.ts` is the `SessionStore`. No agent or streaming logic.
- **`compact.ts`** — session compaction + title generation. Composes `db/` + `providers.ts` + `models/lookup.ts`; not a DB or config concern itself.
- **`tools/`** — AI SDK `tool()` definitions only. No agent loop logic, no policy. Tools receive `cwd` as a parameter, they don't read config.
- **`agent/`** — `agent.ts` builds a `ToolLoopAgent` and delegates the loop to the SDK; `approval.ts` gates tool execution via `PolicyEngine`; `prompt.ts` builds the system prompt. No direct HTTP calls or file I/O (those live in tools).
- **`policy/`** — the deterministic approval authority. No AI SDK dependency (operates on a local `PolicyCall` shape), no tool definitions.
- **`commands/`** — slash command handlers. Receive a `Prompts` interface from the TUI for interactive menus. Never import Ink or render directly — use the injected `Prompts` object.
- **`tui/`** — all rendering lives here. `app.tsx` owns the Ink app, consumes `streamText` `fullStream`, and exposes a `Prompts` implementation. `prompts.tsx` has reusable Ink prompt components plus standalone wrappers for onboarding (outside the main TUI).
- **Cross-module imports go one direction:** `main → agent → providers`, `main → tools`, `main → config`, `main → db`, `main → models`, `main → tui`, `compact → providers | db | models`. Never `tools → agent` or `providers → agent` or `commands → tui`.

## Before Every Commit

1. Run `npm run check` (typecheck + lint + test). Fix all errors before committing.
2. If lint fails with unused imports/variables, run `npm run lint:fix`.
3. Verify no dead code was introduced: unused variables, unreachable returns, empty catches.
4. Verify imports: only `import type` for types, no unused imports.

## Common Mistakes to Avoid

| Mistake | Correct approach |
|---------|-----------------|
| Adding an AI message/tool type to `types.ts` | Import it from `ai` (`ModelMessage`, `ToolSet`, etc.) — never redeclare |
| Using `private field` instead of `#field` | Use `#field` for true private encapsulation |
| Using `fs.readFile` / `fs.writeFile` (callback style) | Use `node:fs/promises` (`readFile`, `writeFile`) |
| Adding `import { Foo }` for a type | Use `import type { Foo }` |
| Empty `catch {}` block | Return error result or re-throw |
| Commenting `// this function does X` | Rename the function so the name says X |
| Adding a `console.log` for debugging | Remove it before committing |
| Nesting `if/else` 3+ levels deep | Use early returns and guard clauses |
| Using callback-style `node:fs` | Use `node:fs/promises` for all file I/O. Prefer async APIs. |
| Using JSONL files for session storage | All session data lives in SQLite (`state.db`). Use `SessionStore` methods. |
| Mutating existing session/message rows in SQLite | Use session splitting: `endSession` + `createContinuation`. Never UPDATE old rows. |
| Coupling policy/approval into a tool definition | Keep tools policy-agnostic; gate via `withApproval(tools, policy)` at wiring time |
| Hand-rolling streaming/SSE/tool dispatch | Use AI SDK primitives (`ToolLoopAgent`, `streamText`, `tool()`) |
| Adding a new prompt/interactive library (e.g. clack, inquirer, prompts) | Use the existing Ink-based `Prompts` interface in `tui/prompts.tsx`. All interactive UI runs inside one Ink app. |