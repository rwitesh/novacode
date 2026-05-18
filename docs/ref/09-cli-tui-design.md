# 09 — CLI, TUI & Onboarding

## Entry Point

```typescript
// src/main.ts

import { existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { ConfigStore } from "./config/store.ts"
import { loadProviders } from "./provider/registry.ts"
import { onboard } from "./onboarding/wizard.ts"
import { interactive } from "./tui/app.tsx"
import { print } from "./tui/print.ts"

const DIR = join(homedir(), ".novacode")

async function main() {
  const cfg = new ConfigStore(DIR)
  const firstRun = !cfg.hasProviders()

  if (firstRun) await onboard(cfg)

  await cfg.load()
  await loadProviders()

  const arg = process.argv.slice(2).find(a => !a.startsWith("-"))
  arg ? await print(cfg, arg) : await interactive(cfg)
}

main()
```

## Config Store

```typescript
// src/config/store.ts

import { join } from "node:path"
import type { AppConfig, ProviderConfig } from "../types.ts"

const CFG = "config.json"
const AUTH = "auth.json"

export class ConfigStore {
  #dir: string
  #config!: AppConfig
  #keys: Record<string, string> = {}

  constructor(dir: string) {
    this.#dir = dir
    this.#config = this.#defaults()
  }

  async load(): Promise<void> {
    const f = Bun.file(join(this.#dir, CFG))
    if (await f.exists()) this.#config = await f.json() as AppConfig
    const a = Bun.file(join(this.#dir, AUTH))
    if (await a.exists()) this.#keys = await a.json().catch(() => ({}))
  }

  async save(): Promise<void> {
    await Bun.write(join(this.#dir, CFG), JSON.stringify(this.#config, null, 2))
  }

  async saveKeys(): Promise<void> {
    const p = join(this.#dir, AUTH)
    await Bun.write(p, JSON.stringify(this.#keys, null, 2))
    Bun.file(p).chmod?.(0o600)
  }

  hasProviders() { return Object.keys(this.#config.providers).length > 0 }
  get config() { return this.#config }
  get key() { return this.#keys }
  get dir() { return this.#dir }

  #defaults(): AppConfig {
    return {
      provider: "", model: "", providers: {},
    }
  }
}
```

## Provider Catalog

```typescript
// src/config/providers.ts

export interface ProviderInfo {
  name: string
  icon: string
  desc: string
  keyUrl: string
  api: string
  baseUrl: string
  models: Array<{
    id: string; name: string; ctx: number; maxOut: number;
    cost: { in: number; out: number }; think: boolean; note: string
  }>
}

export const PROVIDERS: Record<string, ProviderInfo> = {
  glm: {
    name: "GLM (Zhipu AI)", icon: "🟣", desc: "Zhipu AI — OpenAI-compatible",
    keyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    api: "openai", baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: [
      { id: "glm-4-plus", name: "GLM-4 Plus", ctx: 128000, maxOut: 4096, cost: { in: 0.05, out: 0.05 }, think: false, note: "best quality" },
      { id: "glm-4-flash", name: "GLM-4 Flash", ctx: 128000, maxOut: 4096, cost: { in: 0.0001, out: 0.0001 }, think: false, note: "fast, cheap" },
      { id: "glm-4-long", name: "GLM-4 Long", ctx: 1000000, maxOut: 4096, cost: { in: 0.001, out: 0.001 }, think: false, note: "1M context" },
    ],
  },
  gemini: {
    name: "Gemini (Google)", icon: "🔷", desc: "Google Gemini — native API",
    keyUrl: "https://aistudio.google.com/apikey",
    api: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    models: [
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", ctx: 1000000, maxOut: 65536, cost: { in: 1.25, out: 10.0 }, think: true, note: "best, 1M ctx" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", ctx: 1000000, maxOut: 65536, cost: { in: 0.15, out: 0.60 }, think: true, note: "fast, 1M ctx" },
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", ctx: 1000000, maxOut: 8192, cost: { in: 0.10, out: 0.40 }, think: false, note: "cheapest" },
    ],
  },
}
```

## Onboarding Wizard

```typescript
// src/onboarding/wizard.ts

import * as clack from "@clack/prompts"
import chalk from "chalk"
import { ConfigStore } from "../config/store.ts"
import { PROVIDERS } from "../config/providers.ts"
import type { ProviderInfo } from "../config/providers.ts"

const banner = `
${chalk.bold.cyan("  ╭─────────────────────────────────────────────╮")}
${chalk.bold.cyan("  │")}  ${chalk.bold.white("⚡ novacode")}  ${chalk.dim("— your coding companion")}      ${chalk.bold.cyan("│")}
${chalk.bold.cyan("  │")}  ${chalk.dim("Let's pick a provider. Keys are stored at")}  ${chalk.bold.cyan("│")}
${chalk.bold.cyan("  │")}  ${chalk.dim("~/.novacode/auth.json")}                           ${chalk.bold.cyan("│")}
${chalk.bold.cyan("  ╰─────────────────────────────────────────────╯")}
`

export async function onboard(cfg: ConfigStore): Promise<void> {
  console.log(banner)

  const pick = await clack.select({
    message: "Provider",
    options: Object.entries(PROVIDERS).map(([k, v]) => ({ value: k, label: `${v.icon} ${v.name}`, hint: v.desc })),
  })
  if (clack.isCancel(pick)) return quit()

  const info = PROVIDERS[pick as string]!

  const key = await clack.password({
    message: `${info.name} API key`,
    validate: v => (!v || v.length < 8) ? "Enter a valid key" : undefined,
  })
  if (clack.isCancel(key)) return quit()

  const s = clack.spinner()
  s.start("Verifying key…")

  const ok = await verify(pick as string, info, key as string)
  if (!ok) { s.stop("❌ Key verification failed"); process.exit(1) }
  s.stop("✅ Key verified")

  const modelPick = await clack.select({
    message: "Default model",
    options: info.models.map(m => ({ value: m.id, label: m.id, hint: m.note })),
  })
  if (clack.isCancel(modelPick)) return quit()

  cfg.config.provider = pick as string
  cfg.config.model = modelPick as string
  cfg.config.providers[pick as string] = { name: info.name, api: info.api, baseUrl: info.baseUrl, model: modelPick as string }
  cfg.key[`${pick}_api_key`] = key as string

  await cfg.save()
  await cfg.saveKeys()

  console.log(chalk.green(`\n  ✓ ${info.name} configured`))
  console.log(chalk.dim("  Use /models to switch · /config to manage providers\n"))
}

async function verify(id: string, info: ProviderInfo, key: string): Promise<boolean> {
  try {
    if (info.api === "openai") {
      const { default: OpenAI } = await import("openai")
      const c = new OpenAI({ apiKey: key, baseURL: info.baseUrl })
      await c.chat.completions.create({ model: info.models[0].id, messages: [{ role: "user", content: "hi" }], max_tokens: 1 })
      return true
    }
    if (info.api === "gemini") {
      const { GoogleGenerativeAI } = await import("@google/generative-ai")
      const g = new GoogleGenerativeAI(key)
      const m = g.getGenerativeModel({ model: info.models[0].id })
      await m.generateContent("hi")
      return true
    }
  } catch (e: any) {
    if (/rate|quota/i.test(e.message)) return true
  }
  return false
}

function quit() { console.log(chalk.dim("\n  Run novacode again to set up.")); process.exit(0) }
```

## Commands

```typescript
// src/commands/index.ts

import { handleModels } from "./models.ts"
import { handleConfig } from "./config.ts"

const HELP = `
${chalk.bold("Commands:")}
  /models [id]    Switch model
  /config         Manage providers
  /compact        Compact context
  /help           This help
  /clear          Clear screen
  /quit           Exit (Ctrl+D)

${chalk.dim("Keys:")}
  Ctrl+C          Abort
  ↑ / ↓           History
`

export async function dispatch(input: string, cfg: ConfigStore): Promise<string | null> {
  const [cmd, ...rest] = input.slice(1).split(" ")
  const args = rest.join(" ")

  switch (cmd) {
    case "models": case "model": return handleModels(args, cfg)
    case "config": case "cfg": return handleConfig(cfg)
    case "help": return HELP
    case "clear": console.clear(); return ""
    case "quit": case "exit": process.exit(0)
    default: return chalk.yellow(`Unknown: /${cmd}. Type /help`)
  }
}
```

## /models

```typescript
// src/commands/models.ts

import * as clack from "@clack/prompts"
import chalk from "chalk"
import { ConfigStore } from "../config/store.ts"
import { PROVIDERS } from "../config/providers.ts"

export async function handleModels(args: string, cfg: ConfigStore): Promise<string> {
  if (args) return switchDirect(args.trim(), cfg)

  const options: clack.Option[] = []
  for (const [pk, pc] of Object.entries(cfg.config.providers)) {
    const info = PROVIDERS[pk]
    if (!info || !cfg.key[`${pk}_api_key`]) continue

    for (const m of info.models) {
      const cur = m.id === cfg.config.model
      options.push({
        value: `${pk}:${m.id}`,
        label: `${cur ? chalk.green("●") : "○"} ${m.id.padEnd(20)} ${fmt(m.ctx).padEnd(8)} $${m.cost.out}/M`,
        hint: pc.name,
      })
    }
  }

  if (!options.length) return chalk.yellow("No models. Use /config to add a provider.")

  const pick = await clack.select({ message: "Model", options })
  if (clack.isCancel(pick)) return ""

  const [pk, mid] = (pick as string).split(":")
  cfg.config.provider = pk
  cfg.config.model = mid
  await cfg.save()
  return chalk.green(`✓ ${mid}`)
}

function switchDirect(id: string, cfg: ConfigStore): string {
  for (const [pk, info] of Object.entries(PROVIDERS)) {
    if (info.models.some(m => m.id === id) && cfg.config.providers[pk]) {
      cfg.config.provider = pk
      cfg.config.model = id
      cfg.save()
      return chalk.green(`✓ ${id}`)
    }
  }
  return chalk.yellow(`"${id}" not found. Use /models`)
}

const fmt = (n: number) => n >= 1_000_000 ? `${n / 1_000_000}M` : `${n / 1000}K`
```

## /config

```typescript
// src/commands/config.ts

import * as clack from "@clack/prompts"
import chalk from "chalk"
import { ConfigStore } from "../config/store.ts"
import { PROVIDERS } from "../config/providers.ts"

export async function handleConfig(cfg: ConfigStore): Promise<string> {
  console.log(chalk.bold("\n  ⚙  Providers:\n"))
  for (const [k, p] of Object.entries(cfg.config.providers)) {
    const active = k === cfg.config.provider ? chalk.green(" ●") : ""
    const key = cfg.key[`${k}_api_key`] ? chalk.green("✅") : chalk.red("❌")
    console.log(`    ${key} ${p.name.padEnd(24)} ${p.model}${active}`)
  }

  const act = await clack.select({
    message: "Action",
    options: [
      { value: "add", label: "Add provider" },
      { value: "remove", label: "Remove" },
      { value: "key", label: "Change key" },
      { value: "default", label: "Set default" },
      { value: "back", label: "Back" },
    ],
  })
  if (clack.isCancel(act)) return ""

  if (act === "add") return addProvider(cfg)
  if (act === "remove") return removeProvider(cfg)
  if (act === "key") return changeKey(cfg)
  if (act === "default") return setDefault(cfg)
  return ""
}

async function addProvider(cfg: ConfigStore): Promise<string> {
  const opts = [
    ...Object.entries(PROVIDERS)
      .filter(([k]) => !cfg.config.providers[k])
      .map(([k, v]) => ({ value: `b:${k}`, label: `${v.icon} ${v.name}`, hint: v.desc })),
    { value: "custom", label: "🔧 Custom OpenAI-compat", hint: "Ollama, vLLM, etc." },
  ]

  const pick = await clack.select({ message: "Add provider", options: opts })
  if (clack.isCancel(pick)) return ""

  if (pick === "custom") return addCustom(cfg)

  const pk = (pick as string).replace("b:", "")
  const info = PROVIDERS[pk]!
  const key = await clack.password({ message: `${info.name} API key` })
  if (clack.isCancel(key)) return ""

  cfg.key[`${pk}_api_key`] = key as string
  cfg.config.providers[pk] = { name: info.name, api: info.api, baseUrl: info.baseUrl, model: info.models[0].id }
  await cfg.save()
  await cfg.saveKeys()
  return chalk.green(`✓ ${info.name} added. /models to pick a model.`)
}

async function addCustom(cfg: ConfigStore): Promise<string> {
  const name = await clack.text({ message: "Name" })
  const url = await clack.text({ message: "Base URL", placeholder: "http://localhost:11434/v1" })
  const key = await clack.password({ message: "API key (Enter to skip)" })
  const model = await clack.text({ message: "Model ID", placeholder: "llama3" })
  if (clack.isCancel(name) || clack.isCancel(url) || clack.isCancel(model)) return ""

  const id = `custom-${Date.now()}`
  if (!clack.isCancel(key) && key) cfg.key[`${id}_api_key`] = key as string
  cfg.config.providers[id] = { name: name as string, api: "openai", baseUrl: url as string, model: model as string }
  await cfg.save()
  await cfg.saveKeys()
  return chalk.green(`✓ "${name}" added`)
}

async function removeProvider(cfg: ConfigStore): Promise<string> {
  const entries = Object.entries(cfg.config.providers)
  if (entries.length <= 1) return chalk.yellow("Can't remove the only provider")
  const pick = await clack.select({ message: "Remove", options: entries.map(([k, v]) => ({ value: k, label: v.name })) })
  if (clack.isCancel(pick)) return ""
  delete cfg.config.providers[pick as string]
  delete cfg.key[`${pick}_api_key`]
  if (cfg.config.provider === pick) { const first = Object.keys(cfg.config.providers)[0]; cfg.config.provider = first; cfg.config.model = cfg.config.providers[first].model }
  await cfg.save()
  await cfg.saveKeys()
  return chalk.green("✓ Removed")
}

async function changeKey(cfg: ConfigStore): Promise<string> {
  const pick = await clack.select({ message: "Provider", options: Object.entries(cfg.config.providers).map(([k, v]) => ({ value: k, label: v.name })) })
  if (clack.isCancel(pick)) return ""
  const key = await clack.password({ message: "New key" })
  if (clack.isCancel(key)) return ""
  cfg.key[`${pick}_api_key`] = key as string
  await cfg.saveKeys()
  return chalk.green("✓ Key updated")
}

async function setDefault(cfg: ConfigStore): Promise<string> {
  const pick = await clack.select({ message: "Default", options: Object.entries(cfg.config.providers).map(([k, v]) => ({ value: k, label: v.name, hint: v.model })) })
  if (clack.isCancel(pick)) return ""
  cfg.config.provider = pick as string
  cfg.config.model = cfg.config.providers[pick as string].model
  await cfg.save()
  return chalk.green("✓ Default set")
}
```

## TUI (Interactive)

```typescript
// src/tui/app.tsx

import React, { useState, useEffect, useRef } from "react"
import { render, Box, Text, useInput, useApp, useStdout } from "ink"
import chalk from "chalk"
import { Agent } from "../agent/agent.ts"
import { allTools } from "../tools/index.ts"
import type { AgentEvent, Msg } from "../types.ts"
import { ConfigStore } from "../config/store.ts"
import { PROVIDERS } from "../config/providers.ts"
import { dispatch } from "../commands/index.ts"

export async function interactive(cfg: ConfigStore): Promise<void> {
  const pk = cfg.config.provider
  const info = PROVIDERS[pk]
  const m = info?.models.find(m => m.id === cfg.config.model)
  const model = { id: cfg.config.model, name: m?.name ?? cfg.config.model, api: cfg.config.providers[pk]?.api ?? "openai", provider: pk, baseUrl: cfg.config.providers[pk]?.baseUrl ?? "", ctxWindow: m?.ctx ?? 128000, maxTokens: m?.maxOut ?? 4096, cost: m?.cost ?? { in: 0, out: 0 }, reasoning: m?.think ?? false }
  const agent = new Agent({ model, tools: allTools(process.cwd()), apiKey: cfg.key[`${pk}_api_key`] })
  render(<App agent={agent} cfg={cfg} />)
}

function App({ agent, cfg }: { agent: Agent; cfg: ConfigStore }) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [stream, setStream] = useState("")
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState("")
  const [status, setStatus] = useState("")
  const history = useRef<string[]>([])
  const hIdx = useRef(-1)

  useEffect(() => {
    return agent.on((ev: AgentEvent) => {
      switch (ev.type) {
        case "start": setBusy(true); setStream(""); setStatus(""); break
        case "msg_delta":
          if (ev.text) setStream(prev => prev + ev.text)
          break
        case "msg_end": setStream(""); setMsgs(prev => [...prev, (ev as any).msg]); break
        case "tool_run": setStatus(chalk.dim(`⏳ ${ev.tool}…`)); break
        case "tool_done": setStatus(ev.err ? chalk.red(`✗ ${ev.tool}`) : chalk.green(`✓ ${ev.tool}`)); break
        case "turn_end": setStatus(""); break
        case "end": setBusy(false); break
      }
    })
  }, [])

  useInput((ch, key) => {
    if (key.escape) { agent.abort(); return }
    if (!key.return) {
      setInput(prev => key.backspace ? prev.slice(0, -1) : prev + ch)
      return
    }

    const line = input.trim()
    if (!line) return
    setInput("")
    history.current.unshift(line)
    hIdx.current = -1

    if (line.startsWith("/")) {
      dispatch(line, cfg).then(r => r && setMsgs(prev => [...prev, { role: "assistant" as const, content: [{ type: "text" as const, text: r }], model: "", provider: "", usage: { in: 0, out: 0, total: 0 }, stop: "stop" as const, ts: Date.now() }]))
      return
    }

    agent.prompt(line)
  })

  // History nav
  useInput((ch, key) => {
    if (key.upArrow && history.current.length) {
      hIdx.current = Math.min(hIdx.current + 1, history.current.length - 1)
      setInput(history.current[hIdx.current])
    }
    if (key.downArrow) {
      hIdx.current = Math.max(hIdx.current - 1, -1)
      setInput(hIdx.current >= 0 ? history.current[hIdx.current] : "")
    }
  })

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">⚡ novacode</Text>
        <Text dimColor> │ {agent.model.id}</Text>
        <Text dimColor> │ {busy ? chalk.yellow("working…") : chalk.green("ready")}</Text>
      </Box>

      {/* Messages */}
      {msgs.map((m, i) => <Message key={i} msg={m} />)}

      {/* Streaming */}
      {stream && (
        <Box flexDirection="column">
          <Text color="magenta">{stream}</Text>
          <Text dimColor>▎</Text>
        </Box>
      )}

      {/* Status */}
      {status && <Box><Text>{status}</Text></Box>}

      {/* Input */}
      <Box marginTop={1}>
        <Text bold color="green">{"> "} </Text>
        <Text>{input}</Text>
        <Text dimColor>▎</Text>
      </Box>

      {/* Footer */}
      <Box>
        <Text dimColor>{busy ? "Ctrl+C stop" : "Enter send · /help commands"}</Text>
      </Box>
    </Box>
  )
}

function Message({ msg }: { msg: Msg }) {
  if (msg.role === "user") {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">You</Text>
        <Text>{typeof msg.content === "string" ? msg.content : msg.content.map(c => c.type === "text" ? c.text : "").join("")}</Text>
      </Box>
    )
  }
  if (msg.role === "assistant") {
    const text = msg.content.filter(c => c.type === "text").map(c => c.text).join("")
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="magenta">novacode</Text>
        <Text>{text}</Text>
      </Box>
    )
  }
  return null
}
```

## Print Mode

```typescript
// src/tui/print.ts

import type { ConfigStore } from "../config/store.ts"
import { Agent } from "../agent/agent.ts"
import { codingTools } from "../tools/index.ts"
import { PROVIDERS } from "../config/providers.ts"

export async function print(cfg: ConfigStore, input: string): Promise<void> {
  const pk = cfg.config.provider
  const info = PROVIDERS[pk]
  const m = info?.models.find(m => m.id === cfg.config.model)
  const model = { id: cfg.config.model, name: m?.name ?? cfg.config.model, api: cfg.config.providers[pk]?.api ?? "openai", provider: pk, baseUrl: cfg.config.providers[pk]?.baseUrl ?? "", ctxWindow: m?.ctx ?? 128000, maxTokens: m?.maxOut ?? 4096, cost: m?.cost ?? { in: 0, out: 0 }, reasoning: m?.think ?? false }

  const agent = new Agent({ model, tools: codingTools(process.cwd()), apiKey: cfg.key[`${pk}_api_key`] })

  agent.on(ev => {
    if (ev.type === "msg_delta" && ev.text) process.stdout.write(ev.text)
    if (ev.type === "tool_run") process.stderr.write(`\n[🔧 ${ev.tool}]\n`)
    if (ev.type === "end") process.stdout.write("\n")
  })

  await agent.prompt(input)
}
```
