/**
 * Entry point for the novacode CLI.
 * Handles configuration, CLI flags, and switches between interactive/print modes.
 */
import { parseArgs } from "node:util"
import { Agent } from "./agent/agent.ts"
import { buildSystemPrompt } from "./agent/prompt.ts"
import { handleSessionCommand } from "./commands/session.ts"
import { getProvider, MODELS } from "./config/providers.ts"
import { configExists, loadAuth, loadConfig } from "./config/store.ts"
import { runOnboarding } from "./onboarding/wizard.ts"
import { getSessionStore } from "./session/store.ts"
import { getAllTools } from "./tools/index.ts"
import { runPrintMode } from "./tui/print.ts"

// Ensure providers are registered
import "./provider/openai.ts"

function parseCli() {
	const { values, positionals } = parseArgs({
		options: {
			help: { type: "boolean", short: "h" },
			version: { type: "boolean", short: "v" },
			provider: { type: "string" },
			model: { type: "string" },
			"api-key": { type: "string" },
			session: { type: "string", short: "s" },
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

async function main() {
	const { flags, args } = parseCli()

	if (flags.version) {
		console.log("novacode 0.1.0")
		process.exit(0)
	}

	if (flags.help) {
		console.log(`novacode — open-source coding agent

Usage:
  novacode                Interactive mode
  novacode "prompt"       Print mode (non-interactive)
  novacode session <cmd>  Session management (list, delete)
  novacode --session <id> Resume a session

Options:
  -h, --help              Show help
  -v, --version           Show version
  --provider <id>         Provider to use
  --model <id>            Model to use
  --api-key <key>         API key override
  -s, --session <id>      Resume session by ID`)
		process.exit(0)
	}

	// Handle session subcommand
	if (args[0] === "session") {
		await handleSessionCommand(args.slice(1))
		return
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

	// CLI overrides
	const providerId = (flags.provider as string) || config.provider
	const modelId = (flags.model as string) || config.model
	const apiKey = (flags["api-key"] as string) || auth.apiKeys[providerId]

	const provider = getProvider(providerId)
	if (!provider) {
		console.error(`Unknown provider: ${providerId}`)
		console.error(`Available: ${getProvider("glm") ? "glm, " : ""}gemini, deepseek, openai`)
		process.exit(1)
	}

	if (!apiKey) {
		console.error(
			`No API key for ${provider.name}. Set ${provider.envKey} or run novacode for onboarding.`,
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
	const system = buildSystemPrompt(cwd, tools)

	// Session persistence
	const store = getSessionStore()
	const session = flags.session
		? store.get(flags.session as string)
		: store.create(cwd, model.id, providerId)

	if (flags.session && !session) {
		console.error(`Session not found: ${flags.session}`)
		process.exit(1)
	}

	const sessionId = session!.id
	const existingMessages = store.messages(sessionId)

	const agent = new Agent({
		api: provider.api,
		model,
		apiKey,
		baseUrl: provider.baseUrl,
		system,
		tools,
		messages: existingMessages,
	})

	// Print mode: prompt provided as arg
	const prompt = args.join(" ")
	if (prompt) {
		const result = await runPrintMode(agent, prompt, controller.signal)
		if (result) {
			store.appendMany(sessionId, result)
		}
		return
	}

	// Interactive TUI mode (Phase 3)
	process.off("SIGINT", onSignal)
	process.off("SIGTERM", onSignal)
	const { interactive } = await import("./tui/app.tsx")
	await interactive(agent, store, sessionId)
}

main().catch((e) => {
	console.error("Fatal:", e.message)
	process.exit(1)
})
