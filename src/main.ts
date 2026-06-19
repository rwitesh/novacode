#!/usr/bin/env node
import { parseArgs } from "node:util"
/**
 * Entry point for the nova CLI.
 * Handles configuration, CLI flags, and runs interactive TUI mode.
 */
import chalk from "chalk"
import { Agent } from "./agent/agent.ts"
import { buildSystemPrompt } from "./agent/prompt.ts"
import { loadResources } from "./bootstrap.ts"
import { handleSessionCommand } from "./commands/session.ts"
import {
	getModel,
	getModelById,
	getModelsForProvider,
	getProvider,
	PROVIDERS,
} from "./config/catalog.ts"
import { configExists, loadAuth, loadConfig } from "./config/store.ts"
import { runOnboarding } from "./onboarding/wizard.ts"
import { PolicyEngine } from "./policy/engine.ts"
import { getSessionStore } from "./session/store.ts"
import { dedupeSkills } from "./skills/index.ts"
import { getAllTools } from "./tools/index.ts"
import { standaloneSelect } from "./tui/prompts.tsx"
import type { PermissionMode, Session } from "./types.ts"
import { getCurrentVersion, runUpdate } from "./update.ts"

function parseCli() {
	const { values, positionals } = parseArgs({
		options: {
			help: { type: "boolean", short: "h" },
			version: { type: "boolean", short: "v" },
			provider: { type: "string" },
			model: { type: "string" },
			"api-key": { type: "string" },
			sessions: { type: "string", short: "s" },
			resume: { type: "boolean", short: "r" },
			all: { type: "boolean" },
			restricted: { type: "boolean" },
			unrestricted: { type: "boolean" },
		},
		strict: false,
		allowPositionals: true,
	})

	return { flags: values, args: positionals }
}

function findModel(modelId: string, providerId?: string) {
	if (!providerId) return getModelById(modelId)
	return getModel(providerId, modelId)
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
  nova reset              Delete all nova data and exit
  nova -s ls [limit]      List sessions (last 10 by default)
  nova -s rm <id>         Delete a specific session
  nova -s rm --all        Delete all sessions
  nova -s <id>            Resume a session by ID
  nova -r, --resume       Resume the most recent session

Options:
  -h, --help              Show help
  -v, --version           Show version
  --provider <id>         Provider to use
  --model <id>            Model to use
  --api-key <key>         API key override
  -s, --sessions <id>     Resume/manage sessions
  -r, --resume            Resume the most recent session
  --restricted            Start in restricted mode (approve every action)
  --unrestricted          Start in unrestricted mode (no approvals)`)
		process.exit(0)
	}

	// Handle update subcommand
	if (args[0] === "update") {
		await runUpdate()
		return
	}

	// Handle reset subcommand
	if (args[0] === "reset") {
		const { handleCliReset } = await import("./commands/reset.ts")
		await handleCliReset()
		return
	}

	// Reject positional args — use interactive mode with / commands
	if (args.length > 0 && !flags.sessions) {
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

	// Handle --sessions commands (ls, rm)
	if (flags.sessions) {
		const sessionFlag = flags.sessions as string
		if (sessionFlag === "ls" || sessionFlag === "list") {
			const limitVal = args[0] ? parseInt(args[0], 10) : 10
			const limit = Number.isNaN(limitVal) ? 10 : limitVal
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
	} else if (flags.sessions) {
		session = await store.get(flags.sessions as string)
		if (!session) {
			console.error(`Session not found: ${flags.sessions}`)
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
		console.error(`Available: ${PROVIDERS.map((p) => p.id).join(", ")}`)
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
		for (const m of getModelsForProvider(providerId)) {
			console.error(`  ${m.id}`)
		}
		process.exit(1)
	}

	const cwd = process.cwd()

	// Resolve permission mode (interactive gate for tool execution).
	const mode = await resolvePermissionMode(flags)
	if (!mode) return
	const policy = new PolicyEngine(mode, cwd)

	const tools = getAllTools(cwd)
	const { skills, agentsMd } = await loadResources(cwd)
	const system = buildSystemPrompt(cwd, tools, dedupeSkills(skills), agentsMd ?? undefined)

	if (!session) {
		session = await store.create(cwd, model.id, providerId)
	}

	const sessionId = session.id
	const existingMessages = await store.messages(sessionId)

	const agent = new Agent({
		provider: provider.id,
		model,
		apiKey,
		baseUrl: provider.baseUrl,
		system,
		tools,
		messages: existingMessages,
		policy,
	})

	// Interactive TUI mode
	process.off("SIGINT", onSignal)
	process.off("SIGTERM", onSignal)
	const { interactive } = await import("./tui/app.tsx")
	await interactive(agent, store, sessionId, skills, !!agentsMd, policy)
}

async function resolvePermissionMode(flags: {
	restricted?: unknown
	unrestricted?: unknown
}): Promise<PermissionMode | null> {
	if (flags.restricted) return "restricted"
	if (flags.unrestricted) return "unrestricted"

	const picked = await standaloneSelect(
		"Choose a permission mode",
		[
			{
				value: "restricted",
				label: "Restricted  — ask permission before each action",
			},
			{
				value: "unrestricted",
				label: "Unrestricted — run without approval (may be dangerous)",
			},
		],
		undefined,
		chalk.dim(
			"Use /permission to switch later, or --restricted/--unrestricted to skip this prompt.",
		),
	)
	if (picked !== "restricted" && picked !== "unrestricted") {
		console.log(chalk.dim("Cancelled"))
		return null
	}
	return picked
}

process.on("unhandledRejection", (reason) => {
	console.error("Unhandled rejection:", reason)
	process.exit(1)
})

main().catch((e) => {
	console.error("Fatal:", e)
	process.exit(1)
})
