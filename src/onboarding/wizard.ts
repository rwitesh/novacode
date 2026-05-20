import chalk from "chalk"
import { getModelsForProvider, getProvider, PROVIDERS } from "../config/providers.ts"
import { saveAuth, saveConfig } from "../config/store.ts"
import { standalonePassword, standaloneSelect } from "../tui/prompts.tsx"
import type { NovaConfig } from "../types.ts"

export async function runOnboarding(): Promise<NovaConfig> {
	console.log(chalk.bold.cyan("\n⚡ Nova — your coding companion\n"))

	const providerId = await standaloneSelect(
		"Pick a provider",
		PROVIDERS.map((p) => ({ value: p.id, label: p.name })),
	)
	if (!providerId) {
		console.log(chalk.dim("Cancelled"))
		process.exit(0)
	}

	const provider = getProvider(providerId)
	if (!provider) {
		console.log(chalk.red("Unknown provider"))
		process.exit(1)
	}

	const apiKey = await standalonePassword(`Enter ${provider.name} API key`)
	if (!apiKey) {
		console.log(chalk.dim("Cancelled"))
		process.exit(0)
	}

	const models = getModelsForProvider(providerId)
	const modelId = await standaloneSelect(
		"Pick a default model",
		models.map((m) => ({
			value: m.id,
			label: `${m.name} (${(m.contextWindow / 1000).toFixed(0)}k ctx)`,
		})),
	)
	if (!modelId) {
		console.log(chalk.dim("Cancelled"))
		process.exit(0)
	}

	const config: NovaConfig = {
		provider: providerId,
		model: modelId,
	}

	await saveConfig(config)
	await saveAuth({ apiKeys: { [providerId]: apiKey } })

	console.log(chalk.green("\n✓ Ready. Type your prompt or /help for commands\n"))
	return config
}
