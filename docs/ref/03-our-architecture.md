# 03 — Architecture

## Runtime: Bun

```
bun run src/main.ts --watch     # dev
bun build src/main.ts --compile  # binary
bun test                         # test
```

No Node.js. No build step. Bun runs `.ts` natively.

## File Tree

```
forge/
├── src/
│   ├── main.ts                    # entry — first-run detect → onboarding → TUI
│   │
│   ├── types.ts                   # ALL shared types in one file
│   │
│   ├── config/
│   │   ├── store.ts               # config.json + auth.json (0600)
│   │   └── providers.ts           # provider catalog (GLM, Gemini)
│   │
│   ├── provider/
│   │   ├── stream.ts              # EventStream<T,R> class
│   │   ├── registry.ts            # Map<api, StreamFn> + lazy load
│   │   ├── openai.ts              # OpenAI-compat (GLM, DeepSeek, etc.)
│   │   └── gemini.ts              # Google Gemini
│   │
│   ├── agent/
│   │   ├── loop.ts                # pure ReAct loop function
│   │   └── agent.ts               # stateful Agent class
│   │
│   ├── tools/
│   │   ├── index.ts               # tool factories
│   │   ├── fs.ts                  # read, write, edit (Bun.file / Bun.write)
│   │   ├── shell.ts               # bash (Bun.spawn)
│   │   └── search.ts              # grep (rg), find (glob), ls
│   │
│   ├── session/
│   │   ├── store.ts               # JSONL session persistence
│   │   └── compact.ts             # context compaction
│   │
│   ├── onboarding/
│   │   └── wizard.ts              # first-run @clack/prompts setup
│   │
│   ├── commands/
│   │   ├── index.ts               # /command router
│   │   ├── models.ts              # /models — switch models
│   │   └── config.ts              # /config — manage providers
│   │
│   └── tui/
│       ├── app.tsx                # ink/React interactive TUI
│       └── print.ts               # pipe-friendly print mode
│
├── package.json
└── tsconfig.json
```

## Design Rules

1. **One type file** — `src/types.ts` is the single source of truth. No scattered interfaces.
2. **Pure functions first** — `loop.run()` is a function, not a method. Agent class wraps it with state.
3. **Bun APIs** — `Bun.file()`, `Bun.write()`, `Bun.spawn()`, `Bun.file().chmod()`. No `node:fs/promises` for file I/O.
4. **Lazy providers** — SDKs (`openai`, `@google/generative-ai`) are dynamically imported only when needed.
5. **No comments unless "why"** — code explains "what", comments explain "why".
6. **Short names** — `Msg` not `AgentMessage`, `StreamFn` not `StreamFunction`, `run` not `executeAgentLoop`.
7. **Private fields** — `#field` not `private field`. True encapsulation.

## Data Flow

```
$ forge
  │
  ├─ no config? → onboarding wizard (pick provider, key, model)
  │                  → saves ~/.forge/{config,auth}.json
  │
  ├─ has config → load providers, build Agent
  │
  ├─ arg given? → print mode (stream to stdout, exit)
  │
  └─ no arg → interactive TUI
       │
       user types "fix bug"
         │
         ▼
       Agent.prompt("fix bug")
         │
         ▼
       loop.run(input, ctx, opts)
         │
         ├─ llmStream(model, {system, messages, tools})
         │     └─ registry → openai or gemini provider
         │           └─ streaming SSE → EventStream
         │
         ├─ tool calls? → Tool.run() → result → back to LLM
         │
         └─ no tool calls → done → render in TUI
```

## ~/:forge: Layout

```
~/.forge/
├── config.json     # providers, default model
├── auth.json       # API keys (chmod 600)
└── sessions/
    └── *.jsonl     # one file per session
```
