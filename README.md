# novacode

Open-source, multi-provider coding agent. Built with Bun.

> **Currently in early development.**

## Install

Requires [Bun](https://bun.sh) >= 1.3.

```bash
bun add -g novacode
```

Then use it anywhere:

```bash
nova
```

You can also run without installing using `bunx novacode`.

## Quick Start

### 1. Launch novacode

```bash
nova
```

`novacode` and `nova` are the same command — use whichever you prefer.

### 2. First-run setup

On first launch, novacode walks you through a quick setup:

1. **Pick a provider** — GLM (Z.AI), Gemini (Google), DeepSeek, or OpenAI
2. **Enter your API key** — stored securely in `~/.novacode/auth.json`
3. **Pick a default model** — choose from the provider's available models

That's it. You're ready to go.

### 3. Two ways to use it

**Interactive mode** — just run `nova` and chat:

```bash
nova
```

You'll get a prompt where you can ask questions, give coding tasks, and use `/help` for available commands.

**Print mode** — pass a prompt as an argument (non-interactive, streams output to stdout):

```bash
nova "explain the auth module in this project"
nova "fix the type error in src/utils.ts"
```

### 4. CLI flags

```bash
nova                              # interactive mode
nova "your prompt"                # print mode
nova --provider gemini            # override provider
nova --model gemini-2.5-pro       # override model
nova --api-key <key>              # override API key
nova -s <session-id>              # resume a previous session
nova session list                 # list saved sessions
nova session delete <id>          # delete a session
nova -v                           # show version
nova -h                           # show help
```

### Supported Providers

GLM (Z.AI), Gemini (Google), DeepSeek, OpenAI

You can set API keys via environment variables or let the onboarding wizard store them in `~/.novacode/auth.json`.

## Build from Source

```bash
git clone https://github.com/rwitesh/novacode.git
cd novacode
bun install
bun run dev          # run with watch mode
bun run build        # compile to binary
```
