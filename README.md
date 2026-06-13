# NovaCode

Open-source, multi-provider coding agent.

> **Currently in early development (v0.x). Breaking changes may occur.**

https://github.com/user-attachments/assets/c4c8dfee-3a9e-4b40-9d74-dbb9354aed96

## Install

**Requires Node.js >= 24.**

```bash
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

Just run `nova` to start chatting. You'll get a prompt where you can ask questions, give coding tasks, and use `/help` for available commands.

### 4. CLI Flags

Run `nova --help` to see all available flags and commands.

### Supported Providers

Anthropic, DeepSeek, Gemini (Google), GLM (Z.AI), OpenAI

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
