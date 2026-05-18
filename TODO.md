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

## Phase 1: Agentic Core
- [x] System prompt — richer prompt with guidelines, tool usage conventions, safety rules
- [x] Tool improvements:
  - [x] edit tool — accept JSON array directly (not stringified), support multiple non-overlapping edits
  - [x] bash tool — streaming stdout/stderr, working directory awareness, proper timeout handling
  - [x] read tool — image/binary detection, auto-truncation with line numbers
  - [x] glob tool — file search by pattern (glob wrapper)
  - [x] grep tool — content search across files (rg/grep wrapper)
  - [x] ls tool — directory listing
- [x] Agent loop hardening:
  - [x] Max turns limit (prevent infinite loops)
  - [x] Context window tracking — warn when approaching limit
  - [x] Better abort/cancellation handling
  - [x] Streaming text deltas to print mode (currently buffers entire reply)
- [x] Error handling — provider errors (rate limits, auth, context overflow) surfaced cleanly

## Phase 2: Session Management
- [ ] src/session/store.ts — JSONL session persistence
- [ ] src/session/compact.ts — context compaction when approaching context limit
- [ ] Session list/resume/delete
- [ ] Tree branching (id/parentId entries)

## Phase 3: Interactive TUI
- [ ] src/tui/app.tsx — ink-based interactive TUI
- [ ] Streaming display (text deltas, tool calls, thinking)
- [ ] src/commands/models.ts — /models picker
- [ ] src/commands/config.ts — /config manager
- [ ] History, autocomplete, keybindings

## Phase 4: Polish
- [ ] Token tracking, cost display
- [ ] bun build --compile binary
- [ ] README.md
- [ ] CI (GitHub Actions)

## Backlog (open for later)
- [ ] Additional providers (Gemini, DeepSeek, OpenAI) — architecture supports them, implement when needed
- [ ] Key verification in onboarding (test key before saving)
- [ ] Provider-specific error handling (rate limits, context overflow)
