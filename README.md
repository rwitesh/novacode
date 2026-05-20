# NovaCode

Open-source, multi-provider coding agent. 

> **Currently in early development.**

<img width="1164" height="720" alt="result" src="https://github.com/user-attachments/assets/a456c41a-ec19-4a4d-b3b7-180e6b83acc3" />

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


