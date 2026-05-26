#!/usr/bin/env node
import { parseArgs } from "node:util"
/**
 * Entry point for the nova CLI.
 * Handles configuration, CLI flags, and runs interactive TUI mode.
 */
import chalk from "chalk"
import { Agent } from "./agent/agent.ts"
import { buildSystemPrompt } from "./agent/prompt.ts"
import { handleSessionCommand } from "./commands/session.ts"
import { getProvider, MODELS } from "./config/providers.ts"
import { configExists, loadAuth, loadConfig } from "./config/store.ts"
import { runOnboarding } from "./onboarding/wizard.ts"
import { loadResources } from "./resource.ts"
import { getSessionStore } from "./session/store.ts"
import { getAllTools } from "./tools/index.ts"
import type { Session } from "./types.ts"
import { getCurrentVersion, runUpdate } from "./update.ts"

function parseCli() {
	const { values, positionals } = parseArgs({
		options: {
			help: { type: "boolean", short: "h" },
			version: { type: "boolean", short: "v" },
			provider: { type: "string" },
			model: { type: "string" },
			"api-key": { type: "string" },
			session: { type: "string", short: "s" },
			resume: { type: "boolean" },
			n: { type: "string" },
			limit: { type: "string" },
			all: { type: "boolean" },
		},
		strict: false,
		allowPositionals: true,
	})

	return { flags: values, args: positionals }
}

function findModel(modelId: string, providerId?: string) {
	return MODELS.find((m) => {
		if (providerId) return m.provider === providerId && m.id === modelId
		return m.id === modelId
	})
}

const NODE_MIN = 24

async function main() {
	const major = Number(process.versions.node.split(".")[0])
	if (!major || major < NODE_MIN) {
		console.error(`novacode requires Node.js >= ${NODE_MIN}. You have ${process.version}.`)
		console.error(`Upgrade: https://nodejs.org/`)
		process.exit(1)
	}

	const { flags, args } = parseCli()

	if (flags.version) {
		const version = await getCurrentVersion()
		console.log(`nova ${version}`)
		process.exit(0)
	}

	if (flags.help) {
		console.log(`nova — open-source coding agent

Usage:
  nova                    Interactive mode
  nova update             Update to latest version
  nova --session ls       List sessions (last 10 by default)
  nova --session ls -n N  List last N sessions
  nova --session rm <id>  Delete a specific session
  nova --session rm --all Delete all sessions
  nova --session <id>     Resume a session by ID
  nova --resume           Resume the most recent session

Options:
  -h, --help              Show help
  -v, --version           Show version
  --provider <id>         Provider to use
  --model <id>            Model to use
  --api-key <key>         API key override
  -s, --session <id>      Resume/manage session`)
		process.exit(0)
	}

	// Handle update subcommand
	if (args[0] === "update") {
		await runUpdate()
		return
	}

	// Reject positional args — use interactive mode with / commands
	if (args.length > 0 && !flags.session) {
		console.error(chalk.yellow(`Unknown command: ${args.join(" ")}`))
		console.error("Run `nova --help` for usage.")
		process.exit(1)
	}

	const controller = new AbortController()

	const onSignal = () => {
		controller.abort()
		process.stderr.write("\nAborted.\n")
		process.exit(130)
	}
	process.on("SIGINT", onSignal)
	process.on("SIGTERM", onSignal)

	// First-run onboarding
	const config = await ((await configExists()) ? loadConfig() : runOnboarding())
	const auth = await loadAuth()

	const store = await getSessionStore()
	await store.prune()

	// Handle --session commands (ls, rm)
	if (flags.session) {
		const sessionFlag = flags.session as string
		if (sessionFlag === "ls" || sessionFlag === "list") {
			const limit = parseInt((flags.n as string) || (flags.limit as string) || "10", 10)
			await handleSessionCommand(store, ["ls"], { limit })
			return
		}
		if (sessionFlag === "rm" || sessionFlag === "delete") {
			const id = args[0]
			const all = !!flags.all
			await handleSessionCommand(store, ["rm", id ?? ""], { all })
			return
		}
	}

	let session: Session | null = null
	if (flags.resume) {
		session = await store.latest()
		if (!session) {
			console.error("No recent session found to resume.")
			process.exit(1)
		}
	} else if (flags.session) {
		session = await store.get(flags.session as string)
		if (!session) {
			console.error(`Session not found: ${flags.session}`)
			process.exit(1)
		}
	}

	// CLI overrides or session default or config default
	const providerId = (flags.provider as string) || session?.provider || config.provider
	const modelId = (flags.model as string) || session?.model || config.model
	const apiKey = (flags["api-key"] as string) || auth.apiKeys[providerId]

	const provider = getProvider(providerId)
	if (!provider) {
		console.error(`Unknown provider: ${providerId}`)
		console.error(`Available: ${getProvider("glm") ? "glm, " : ""}gemini, deepseek, openai`)
		process.exit(1)
	}

	if (!apiKey) {
		console.error(
			`No API key for ${provider.name}. Set ${provider.envKey} or run nova for onboarding.`,
		)
		process.exit(1)
	}

	const model = findModel(modelId, providerId)
	if (!model) {
		console.error(`Unknown model: ${modelId}`)
		console.error("Available models:")
		for (const m of MODELS.filter((m) => m.provider === providerId)) {
			console.error(`  ${m.id} — ${m.name}`)
		}
		process.exit(1)
	}

	const cwd = process.cwd()
	const tools = getAllTools(cwd)
	const { skills, agentsMd } = await loadResources(cwd)
	const system = buildSystemPrompt(cwd, tools, skills, agentsMd ?? undefined)

	if (!session) {
		session = await store.create(cwd, model.id, providerId)
	}

	const sessionId = session.id
	const existingMessages = await store.messages(sessionId)

	const agent = new Agent({
		api: provider.api,
		model,
		apiKey,
		baseUrl: provider.baseUrl,
		system,
		tools,
		messages: existingMessages,
	})

	// Interactive TUI mode
	process.off("SIGINT", onSignal)
	process.off("SIGTERM", onSignal)
	const { interactive } = await import("./tui/app.tsx")
	await interactive(agent, store, sessionId, skills, !!agentsMd)
}

process.on("unhandledRejection", (reason) => {
	console.error("Unhandled rejection:", reason)
	process.exit(1)
})

main().catch((e) => {
	console.error("Fatal:", e)
	process.exit(1)
})
