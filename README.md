# NovaCode

Open-source, multi-provider coding agent. 

> **Currently in early development.**

<img width="1164" height="720" alt="result" src="https://github.com/user-attachments/assets/a456c41a-ec19-4a4d-b3b7-180e6b83acc3" />

## Install
```bash
# With npm
npm install -g novacode
```

Then use it anywhere:

```bash
nova
```

## Quick Start

### 1. Launch nova

```bash
nova
```

### 2. First-run setup

On first launch, nova walks you through a quick setup:
1. **Pick a provider** 
2. **Enter your API key**
3. **Pick a default model** 

That's it. You're ready to go.

### 3. Start chatting

Just run `nova` to start chatting:

```bash
nova
```

You'll get a prompt where you can ask questions, give coding tasks, and use `/help` for available commands.

### 4. Flags & Commands

#### CLI Flags
* `nova` — Starts a new interactive session.
* `nova --resume` — Resumes the most recent active session.
* `nova --session <id>` — Resumes a specific session by ID.
* `nova --session ls` — Lists recent sessions with AI-generated titles and smart relative update times.
* `nova --session ls -n N` — Lists the last N sessions.
* `nova --session rm <id>` — Deletes a specific session.
* `nova --session rm --all` — Deletes all sessions.

#### Interactive Commands (TUI)
Inside interactive mode, type `/` to access commands:
* `/sessions` — Opens a beautiful, keyboard-driven picker to browse and switch between your sessions (using Up/Down arrows and Enter).
* `/compact` — Compacts the current session's context to optimize token usage.
* `/help` — Displays all available commands.

### Supported Providers

GLM (Z.AI), Gemini (Google), DeepSeek, OpenAI

## Development

```bash
npm install          # install dependencies
npm run dev          # dev with watch
npm test             # run tests
npm run lint         # biome lint check
npm run lint:fix     # biome lint + auto-fix
npm run format       # biome format
npm run typecheck    # tsc --noEmit
npm run check        # typecheck + lint + test (run this before committing)
```
