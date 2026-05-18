# 05 — Roadmap

## Phase 0: Bootstrap (Day 1–2)

- [ ] `bun init`, tsconfig, package.json
- [ ] `src/types.ts` — all types
- [ ] `src/provider/stream.ts` — EventStream
- [ ] `src/config/store.ts` + `providers.ts`
- [ ] `src/config/auth.ts` — key storage (0600)
- [ ] `src/onboarding/wizard.ts` — @clack prompts
- [ ] `src/main.ts` — first-run detect → onboard

**Done when:** `novacode` → wizard → saves config → exits

---

## Phase 1: Providers (Day 3–5)

- [ ] `src/provider/registry.ts` — register + lazy load
- [ ] `src/provider/openai.ts` — GLM via OpenAI SDK
- [ ] `src/provider/gemini.ts` — Gemini via Google SDK
- [ ] Key verification in onboarding

**Done when:** `bun test` → stream "hello" from GLM and Gemini

---

## Phase 2: Agent + Tools (Day 6–10)

- [ ] `src/agent/loop.ts` — ReAct loop
- [ ] `src/agent/agent.ts` — stateful wrapper
- [ ] `src/tools/fs.ts` — read, write, edit (Bun.file, Bun.write)
- [ ] `src/tools/shell.ts` — bash (Bun.spawn)
- [ ] `src/tools/search.ts` — grep (rg), find, ls
- [ ] System prompt builder
- [ ] Print mode: `novacode "explain this"`

**Done when:** `novacode "read package.json"` → agent reads file, responds

---

## Phase 3: TUI + Commands (Day 11–15)

- [ ] `src/tui/app.tsx` — ink TUI (streaming, tool display, diffs)
- [ ] `src/commands/models.ts` — /models picker
- [ ] `src/commands/config.ts` — /config manager
- [ ] History, autocomplete, keybindings

**Done when:** Full interactive session with model switching

---

## Phase 4: Sessions (Day 16–20)

- [ ] `src/session/store.ts` — JSONL persistence
- [ ] `src/session/compact.ts` — auto-compaction
- [ ] Session list/resume/delete

---

## Phase 5: Ship (Day 21–25)

- [ ] Error handling, retries, rate limits
- [ ] Token tracking, cost display
- [ ] `bun build --compile` binary
- [ ] README, tests, CI

---

## MVP = Phase 0–2 (10 days)

```
onboarding → provider → agent loop → tools → print mode
```
