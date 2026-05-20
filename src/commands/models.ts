import chalk from "chalk"
import type { Agent } from "../agent/agent.ts"
import { getProvider, MODELS } from "../config/providers.ts"
import { loadAuth, loadConfig, saveConfig } from "../config/store.ts"
import type { Prompts } from "../types.ts"

export async function handleModels(args: string, agent: Agent, prompts?: Prompts): Promise<string> {
	const config = await loadConfig()
	const auth = await loadAuth()

	if (args) return await switchDirect(args.trim(), agent)

	if (!prompts) return chalk.red("Prompts not available in this context")

	const options: Array<{ value: string; label: string; hint?: string }> = []
	for (const m of MODELS) {
		const cur = m.id === config.model && m.provider === config.provider
		const pDef = getProvider(m.provider)
		if (!pDef) continue

		const hasKey = !!auth.apiKeys[m.provider]
		if (!hasKey) continue

		options.push({
			value: `${m.provider}:${m.id}`,
			label: `${cur ? chalk.green("●") : "○"} ${m.id.padEnd(20)} ${fmt(m.contextWindow).padEnd(8)}`,
			hint: pDef.name,
		})
	}

	if (!options.length)
		return chalk.yellow("No models available. Use /providers to add a provider API key.")

	const pick = await prompts.select({ message: "Model", options })
	if (!pick) return ""

	const [pk, mid] = pick.split(":")
	const selectedModel = MODELS.find((m) => m.provider === pk && m.id === mid)
	const selectedProvider = getProvider(pk!)

	if (!selectedModel || !selectedProvider) return chalk.red("Error: Model or provider not found")

	config.provider = pk!
	config.model = mid!
	await saveConfig(config)

	agent.updateConfig({
		api: selectedProvider.api,
		model: selectedModel,
		apiKey: auth.apiKeys[pk!] ?? "",
		baseUrl: selectedProvider.baseUrl,
	})
	return chalk.green(`✓ Switched to ${mid}`)
}

async function switchDirect(id: string, agent: Agent): Promise<string> {
	const config = await loadConfig()
	const auth = await loadAuth()

	const m = MODELS.find((m) => m.id === id)
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
		api: selectedProvider.api,
		model: m,
		apiKey: auth.apiKeys[pk],
		baseUrl: selectedProvider.baseUrl,
	})

	return chalk.green(`✓ Switched to ${id}`)
}

const fmt = (n: number) => (n >= 1_000_000 ? `${n / 1_000_000}M` : `${n / 1000}K`)
