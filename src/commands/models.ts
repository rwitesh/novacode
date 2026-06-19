import chalk from "chalk"
import type { Agent } from "../agent/agent.ts"
import { loadAuth, loadConfig, saveConfig } from "../config/store.ts"
import { PROVIDERS } from "../models/catalog.ts"
import { getModel, getModelById, getModelsForProvider, getProvider } from "../models/lookup.ts"
import type { Prompts } from "../types.ts"

export async function handleModels(args: string, agent: Agent, prompts?: Prompts): Promise<string> {
	const config = await loadConfig()
	const auth = await loadAuth()

	if (args) return await switchDirect(args.trim(), agent)

	if (!prompts) return chalk.red("Prompts not available in this context")

	const activeModels = PROVIDERS.filter((p) => auth.apiKeys[p.id]).flatMap((p) =>
		getModelsForProvider(p.id),
	)

	if (!activeModels.length)
		return chalk.yellow("No models available. Use /providers to add a provider API key.")

	const maxLen = Math.max(...activeModels.map((m) => m.id.length), 20)

	const options: Array<{ value: string; label: string; hint?: string }> = []
	for (const m of activeModels) {
		const cur = m.id === config.model && m.provider === config.provider
		const pDef = getProvider(m.provider)!

		options.push({
			value: `${m.provider}:${m.id}`,
			label: `${cur ? chalk.green("●") : "○"} ${m.id.padEnd(maxLen + 2)} ${fmt(m.contextWindow).padEnd(8)}`,
			hint: pDef.name,
		})
	}

	const pick = await prompts.searchSelect({ message: "Model (type to filter)", options })
	if (!pick) return ""

	const [pk, mid] = pick.split(":")
	const selectedModel = getModel(pk!, mid!)
	const selectedProvider = getProvider(pk!)

	if (!selectedModel || !selectedProvider) return chalk.red("Error: Model or provider not found")

	config.provider = pk!
	config.model = mid!
	await saveConfig(config)

	agent.updateConfig({
		provider: selectedProvider.id,
		model: selectedModel,
		apiKey: auth.apiKeys[pk!] ?? "",
		baseUrl: selectedProvider.baseUrl,
	})
	return chalk.green(`✓ Switched to ${mid}`)
}

async function switchDirect(id: string, agent: Agent): Promise<string> {
	const config = await loadConfig()
	const auth = await loadAuth()

	const m = getModelById(id)
	if (!m) return chalk.yellow(`"${id}" not found. Use /models`)

	const pk = m.provider
	if (!auth.apiKeys[pk]) {
		return chalk.yellow(`No API key configured for ${pk}. Use /providers`)
	}

	const selectedProvider = getProvider(pk)
	if (!selectedProvider) return chalk.red("Error: Provider not found")

	config.provider = pk
	config.model = id
	await saveConfig(config)

	agent.updateConfig({
		provider: selectedProvider.id,
		model: m,
		apiKey: auth.apiKeys[pk],
		baseUrl: selectedProvider.baseUrl,
	})

	return chalk.green(`✓ Switched to ${id}`)
}

const fmt = (n: number) => (n >= 1_000_000 ? `${n / 1_000_000}M` : `${n / 1000}K`)
