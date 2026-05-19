import * as clack from "@clack/prompts"
import chalk from "chalk"
import type { Agent } from "../agent/agent.ts"
import { getProvider, MODELS, PROVIDERS } from "../config/providers.ts"
import { loadAuth, loadConfig, saveAuth, saveConfig } from "../config/store.ts"

export async function handleConfig(agent: Agent): Promise<string> {
	const config = await loadConfig()
	const auth = await loadAuth()

	console.log(chalk.bold("\n  ⚙  Providers:\n"))
	for (const p of PROVIDERS) {
		const isDefault = p.id === config.provider
		const active = isDefault ? chalk.green(" ●") : ""
		const key = auth.apiKeys[p.id] ? chalk.green("✅") : chalk.red("❌")
		const currentModel = isDefault
			? config.model
			: (MODELS.find((m) => m.provider === p.id)?.id ?? "")
		console.log(`    ${key} ${p.name.padEnd(24)} ${currentModel}${active}`)
	}

	const act = await clack.select({
		message: "Action",
		options: [
			{ value: "key", label: "Set API Key" },
			{ value: "default", label: "Set Default Provider" },
			{ value: "back", label: "Back" },
		],
	})
	if (clack.isCancel(act) || act === "back") return ""

	if (act === "key") return changeKey(agent)
	if (act === "default") return setDefault(agent)
	return ""
}

async function changeKey(agent: Agent): Promise<string> {
	const auth = await loadAuth()

	const pick = await clack.select({
		message: "Provider",
		options: PROVIDERS.map((p) => ({ value: p.id, label: p.name })),
	})
	if (clack.isCancel(pick)) return ""

	const pDef = getProvider(pick as string)
	if (!pDef) return chalk.red("Error: Provider not found")

	const key = await clack.password({ message: `New key for ${pDef.name}` })
	if (clack.isCancel(key)) return ""

	auth.apiKeys[pDef.id] = key as string
	await saveAuth(auth)

	// If this is the active provider, update the agent's key
	const config = await loadConfig()
	if (config.provider === pDef.id) {
		agent.updateConfig({
			api: pDef.api,
			model: agent.model,
			apiKey: key as string,
			baseUrl: pDef.baseUrl,
		})
	}

	return chalk.green("✓ Key updated")
}

async function setDefault(agent: Agent): Promise<string> {
	const config = await loadConfig()
	const auth = await loadAuth()

	const pick = await clack.select({
		message: "Default Provider",
		options: PROVIDERS.map((p) => {
			const hasKey = !!auth.apiKeys[p.id]
			return {
				value: p.id,
				label: `${hasKey ? "✅" : "❌"} ${p.name}`,
			}
		}),
	})
	if (clack.isCancel(pick)) return ""

	const pId = pick as string
	if (!auth.apiKeys[pId]) {
		return chalk.yellow(`No API key for ${pId}. Please set one first.`)
	}

	const pDef = getProvider(pId)
	const mDef = MODELS.find((m) => m.provider === pId)
	if (!pDef || !mDef) return chalk.red("Error: Provider or default model not found")

	config.provider = pId
	config.model = mDef.id
	await saveConfig(config)

	agent.updateConfig({
		api: pDef.api,
		model: mDef,
		apiKey: auth.apiKeys[pId],
		baseUrl: pDef.baseUrl,
	})

	return chalk.green(`✓ Default set to ${pDef.name} (${mDef.id})`)
}
