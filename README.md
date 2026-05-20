# NovaCode

Open-source, multi-provider coding agent. 

> **Currently in early development.**

<img width="1164" height="720" alt="result" src="https://github.com/user-attachments/assets/a456c41a-ec19-4a4d-b3b7-180e6b83acc3" />

## Install

Requires [Node.js](https://nodejs.org) >= 22.

```bash
# With npm
npm install -g novacode

# With bun
bun add -g novacode
```

Then use it anywhere:

```bash
nova
```

You can also run without installing:

```bash
# With npx
npx novacode

# With bunx
bunx novacode
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

### 4. Flags & commands

Available flags: `--provider`, `--model`, `--api-key`, `-s` (resume session)

Session commands: `nova session list`, `nova session delete <id>`

Run `nova -h` or type `/help` in interactive mode to see everything.

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
