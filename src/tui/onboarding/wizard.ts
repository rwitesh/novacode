import chalk from "chalk"
import { saveAuth, saveConfig } from "../../config/store.ts"
import { PROVIDERS } from "../../models/catalog.ts"
import { getModelsForProvider, getProvider } from "../../models/lookup.ts"
import type { NovaConfig } from "../../types.ts"
import { standalonePassword, standaloneSelect } from "../prompts.tsx"

export async function runOnboarding(): Promise<NovaConfig> {
	console.log(chalk.bold.cyan("\n⚡ Nova — your coding companion\n"))

	const sortedProviders = [...PROVIDERS].sort((a, b) => a.name.localeCompare(b.name))
	const providerId = await standaloneSelect(
		"Pick a provider",
		sortedProviders.map((p) => ({ value: p.id, label: p.name })),
	)
	if (!providerId) {
		console.log("Cancelled")
		process.exit(0)
	}

	const provider = getProvider(providerId)
	if (!provider) {
		console.log(chalk.red("Unknown provider"))
		process.exit(1)
	}

	const apiKey = await standalonePassword(`Enter ${provider.name} API key`)
	if (!apiKey) {
		console.log("Cancelled")
		process.exit(0)
	}

	const models = getModelsForProvider(providerId)
	const modelId = await standaloneSelect(
		"Pick a default model",
		models.map((m) => ({
			value: m.id,
			label: `${m.id} (${(m.contextWindow / 1000).toFixed(0)}k ctx)`,
		})),
	)
	if (!modelId) {
		console.log("Cancelled")
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
