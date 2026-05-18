# novacode

Open-source multi-provider coding agent. Bun-native. Fast.

## Providers

| Provider | API | Status |
|----------|-----|--------|
| **GLM (Zhipu AI)** | OpenAI-compat | ✅ MVP |
| **Gemini (Google)** | Gemini | ✅ MVP |
| OpenAI / DeepSeek / Anthropic | — | 🔜 later |
| Custom OpenAI-compat | — | 🔜 `/config` |

## First Run

```
$ novacode

  ╭──────────────────────────────────────────╮
  │  ⚡ novacode  — your coding companion        │
  │  Let's pick a provider.                  │
  ╰──────────────────────────────────────────╯

  ❯ 🟣 GLM (Zhipu AI)
    🔷 Gemini (Google)

  API Key: ************
  ✓ Key verified

  ❯ glm-4-plus        best quality
    glm-4-flash        fast, cheap
    glm-4-long         1M context

  ✓ Ready. /models to switch · /config to manage
```

## Docs

| # | File | What |
|---|------|------|
| — | [01](./01-how-coding-agents-work.md) | How all coding agents work (ReAct loop, events, streaming) |
| — | [02](./02-conceptual-comparison.md) | Pi vs Mastra vs Claude Code comparison |
| **→** | [03](./03-our-architecture.md) | File tree, design rules, data flow |
| **→** | [04](./04-multi-provider-system.md) | Types, provider registry, GLM + Gemini implementations |
| — | [05](./05-implementation-roadmap.md) | 25-day phased plan |
| **→** | [06](./06-agent-loop-deep-dive.md) | Agent loop + Agent class (clean TS) |
| **→** | [07](./07-tools-system.md) | read/write/edit/bash/grep/find/ls |
| **→** | [08](./08-session-context-management.md) | JSONL sessions + compaction |
| **→** | [09](./09-cli-tui-design.md) | Onboarding, /models, /config, ink TUI |
| — | [10](./10-extension-plugin-system.md) | Extensions, skills, MCP |
