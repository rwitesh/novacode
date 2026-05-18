# TODO

## Phase 0: Bootstrap ✅
- [x] bun init, tsconfig, package.json
- [x] biome linter + formatter
- [x] lefthook pre-commit hooks
- [x] src/types.ts — all types
- [x] src/provider/stream.ts — EventStream
- [x] src/config/store.ts + providers.ts
- [x] src/tools/fs.ts — read, write, edit, bash
- [x] src/agent/loop.ts — ReAct loop
- [x] src/agent/agent.ts — stateful wrapper
- [x] src/onboarding/wizard.ts — @clack prompts
- [x] src/main.ts — first-run detect → onboard → print mode
- [x] AGENTS.md project knowledge
- [x] Initial tests

## Phase 1: Providers
- [ ] src/provider/gemini.ts — Gemini streaming via Google SDK
- [ ] Key verification in onboarding (test key before saving)
- [ ] Provider-specific error handling (rate limits, context overflow)

## Phase 2: Session Management
- [ ] src/session/store.ts — JSONL session persistence
- [ ] src/session/compact.ts — context compaction
- [ ] Session list/resume/delete
- [ ] Tree branching (id/parentId entries like pi)

## Phase 3: Interactive TUI
- [ ] src/tui/app.tsx — ink-based interactive TUI
- [ ] Streaming display (text deltas, tool calls, thinking)
- [ ] src/commands/models.ts — /models picker
- [ ] src/commands/config.ts — /config manager
- [ ] History, autocomplete, keybindings

## Phase 4: Polish
- [ ] Error handling, retries, rate limits
- [ ] Token tracking, cost display
- [ ] bun build --compile binary
- [ ] README.md
- [ ] CI (GitHub Actions)
- [ ] Grep, find, ls tools
