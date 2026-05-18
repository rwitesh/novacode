import { parseArgs } from "node:util"
import { Agent } from "./agent/agent.ts"
import { buildSystemPrompt } from "./agent/prompt.ts"
import { getProvider, MODELS } from "./config/providers.ts"
import { configExists, loadConfig } from "./config/store.ts"
import { runOnboarding } from "./onboarding/wizard.ts"
import { getDefaultTools } from "./tools/index.ts"
import { runPrintMode } from "./tui/print.ts"
import type { Model } from "./types.ts"

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
		},
		strict: false,
		allowPositionals: true,
	})

	return { flags: values, args: positionals }
}

async function findModel(modelId: string, providerId?: string): Promise<Model | undefined> {
	return MODELS.find((m) => {
		if (providerId) return m.provider === providerId && m.id === modelId
		return m.id === modelId
	})
}

async function main() {
	const { flags, args } = parseCli()

	if (flags.version) {
		console.log("forge 0.1.0")
		process.exit(0)
	}

	if (flags.help) {
		console.log(`forge — open-source coding agent

Usage:
  forge                    Interactive mode
  forge "prompt"           Print mode (non-interactive)
  forge --provider <id>    Set provider
  forge --model <id>       Set model

Options:
  -h, --help               Show help
  -v, --version            Show version
  --provider <id>          Provider to use
  --model <id>             Model to use
  --api-key <key>          API key override`)
		process.exit(0)
	}

	// First-run onboarding
	const config = await ((await configExists()) ? loadConfig() : runOnboarding())

	// CLI overrides
	const providerId = (flags.provider as string) || config.provider
	const modelId = (flags.model as string) || config.model
	const apiKey = (flags["api-key"] as string) || config.apiKeys[providerId]

	const provider = getProvider(providerId)
	if (!provider) {
		console.error(`Unknown provider: ${providerId}`)
		console.error(`Available: ${getProvider("glm") ? "glm, " : ""}gemini, deepseek, openai`)
		process.exit(1)
	}

	if (!apiKey) {
		console.error(
			`No API key for ${provider.name}. Set ${provider.envKey} or run forge for onboarding.`,
		)
		process.exit(1)
	}

	const model = await findModel(modelId, providerId)
	if (!model) {
		console.error(`Unknown model: ${modelId}`)
		console.error("Available models:")
		for (const m of MODELS.filter((m) => m.provider === providerId)) {
			console.error(`  ${m.id} — ${m.name}`)
		}
		process.exit(1)
	}

	const cwd = process.cwd()
	const tools = getDefaultTools(cwd)
	const system = buildSystemPrompt(cwd, tools)

	const agent = new Agent({
		model,
		apiKey,
		baseUrl: provider.baseUrl,
		system,
		tools,
	})

	// Print mode: prompt provided as arg
	const prompt = args.join(" ")
	if (prompt) {
		await runPrintMode(agent, prompt)
		return
	}

	// TODO: Interactive TUI mode (Phase 3)
	console.log('Interactive mode coming soon. Use: forge "your prompt"')
	process.exit(0)
}

main().catch((e) => {
	console.error("Fatal:", e.message)
	process.exit(1)
})
