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
  - [x] Standardize tool helpers — migrate to shared `textPart` utility
- [x] Agent loop hardening:
  - [x] Max turns limit (prevent infinite loops)
  - [x] Context window tracking — warn when approaching limit
  - [x] Better abort/cancellation handling
  - [x] Streaming text deltas to print mode (currently buffers entire reply)
- [x] Error handling — provider errors (rate limits, auth, context overflow) surfaced cleanly

## Phase 2: Session Management
- [x] src/session/store.ts — SQLite session persistence (migration from JSONL)
- [x] src/session/compact.ts — context compaction when approaching context limit
- [x] Session list/resume/delete (CLI/TUI commands)

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

## Phase 5: CLI Best Practices

### High Priority
- [x] LICENSE file
- [x] Add `format` to lefthook pre-commit hook
- [x] CI: add `bun run build` step
- [x] SIGINT/SIGTERM graceful shutdown handling
- [x] `engines` field in package.json to pin Bun version

### Medium Priority
- [ ] CHANGELOG.md (Keep a Changelog format)
- [ ] `.editorconfig` (tabs, LF, trailing newline)
- [ ] `--verbose` / `--debug` flag for diagnostics
- [ ] Config validation on load (required fields, clear error messages)
- [ ] `NO_COLOR` env support (no-color.org standard)
- [ ] CONTRIBUTING.md (branch naming, PR process, `bun run check`)
- [ ] Dependabot or Renovate config

### Nice to Have
- [ ] Shell completions (`novacode completions bash/zsh/fish`)
- [ ] Release workflow (multi-platform binary builds: linux/amd64, linux/arm64, macOS/arm64)
- [ ] Auto-updater / version check on startup
- [ ] Man page or long-form `--help` with examples
- [ ] Logging to stderr, output to stdout (pipe-friendly)

## Backlog (open for later)
- [ ] Additional providers (Gemini, DeepSeek, OpenAI) — architecture supports them, implement when needed
- [ ] Key verification in onboarding (test key before saving)
- [x] Provider-specific error handling (rate limits, context overflow)
