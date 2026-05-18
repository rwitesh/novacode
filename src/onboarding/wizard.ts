import * as clack from "@clack/prompts"
import { getModelsForProvider, getProvider, PROVIDERS } from "../config/providers.ts"
import { saveConfig } from "../config/store.ts"
import type { NovaConfig } from "../types.ts"

export async function runOnboarding(): Promise<NovaConfig> {
	clack.intro("⚡ Nova — your coding companion")

	const providerId = await clack.select({
		message: "Pick a provider",
		options: PROVIDERS.map((p) => ({ value: p.id, label: p.name })),
	})

	if (clack.isCancel(providerId)) {
		clack.cancel("Cancelled")
		process.exit(0)
	}

	const provider = getProvider(providerId as string)
	if (!provider) {
		clack.cancel("Unknown provider")
		process.exit(1)
	}

	const apiKey = await clack.password({
		message: `Enter ${provider.name} API key`,
	})

	if (clack.isCancel(apiKey)) {
		clack.cancel("Cancelled")
		process.exit(0)
	}

	const models = getModelsForProvider(providerId as string)
	const modelId = await clack.select({
		message: "Pick a default model",
		options: models.map((m) => ({
			value: m.id,
			label: `${m.name} (${(m.contextWindow / 1000).toFixed(0)}k ctx)`,
		})),
	})

	if (clack.isCancel(modelId)) {
		clack.cancel("Cancelled")
		process.exit(0)
	}

	const config: NovaConfig = {
		provider: providerId as string,
		model: modelId as string,
		apiKeys: { [providerId as string]: apiKey as string },
	}

	await saveConfig(config)

	clack.note("Ready. Type your prompt or /help for commands")
	return config
}
