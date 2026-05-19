import * as clack from "@clack/prompts"
import chalk from "chalk"
import type { Agent } from "../agent/agent.ts"
import { getProvider, MODELS, PROVIDERS } from "../config/providers.ts"
import { loadAuth, loadConfig, saveAuth, saveConfig } from "../config/store.ts"

export async function handleProviders(agent: Agent): Promise<string> {
	const config = await loadConfig()
	const auth = await loadAuth()

	const configured = PROVIDERS.filter((p) => !!auth.apiKeys[p.id])

	console.log(chalk.bold("\n  ⚙  Configured Providers:\n"))
	if (configured.length === 0) {
		console.log(chalk.dim("    No providers configured. Use 'Add Provider' below.\n"))
	} else {
		for (const p of configured) {
			const isDefault = p.id === config.provider
			const active = isDefault ? chalk.green(" ●") : ""
			const key = chalk.green("✅")
			const currentModel = isDefault
				? config.model
				: (MODELS.find((m) => m.provider === p.id)?.id ?? "")
			console.log(`    ${key} ${p.name.padEnd(24)} ${currentModel}${active}`)
		}
		console.log("") // Spacer
	}

	const act = await clack.select({
		message: "Action",
		options: [
			{ value: "add", label: "Add Provider" },
			{ value: "update", label: "Update API Key" },
			{ value: "remove", label: "Remove API Key" },
			{ value: "default", label: "Set Default Provider" },
			{ value: "back", label: "Back" },
		],
	})
	if (clack.isCancel(act) || act === "back") return ""

	if (act === "add") return addProvider(agent)
	if (act === "update") return updateKey(agent)
	if (act === "remove") return removeKey(agent)
	if (act === "default") return setDefault(agent)
	return ""
}

async function addProvider(agent: Agent): Promise<string> {
	const auth = await loadAuth()
	const config = await loadConfig()

	const available = PROVIDERS.filter((p) => !auth.apiKeys[p.id])
	if (available.length === 0) {
		return chalk.yellow("All providers already have API keys configured.")
	}

	const pick = await clack.select({
		message: "Add Provider",
		options: available.map((p) => ({ value: p.id, label: p.name })),
	})
	if (clack.isCancel(pick)) return ""

	const pDef = getProvider(pick as string)
	if (!pDef) return chalk.red("Error: Provider not found")

	const key = await clack.password({
		message: `${pDef.name} API Key`,
		validate: (v) => (!v || v.length < 8 ? "Enter a valid key" : undefined),
	})
	if (clack.isCancel(key)) return ""

	auth.apiKeys[pDef.id] = key as string
	await saveAuth(auth)

	// Set as active if no provider is currently set
	if (!config.provider) {
		config.provider = pDef.id
		const mDef = MODELS.find((m) => m.provider === pDef.id)
		if (mDef) {
			config.model = mDef.id
		}
		await saveConfig(config)
		agent.updateConfig({
			api: pDef.api,
			model: MODELS.find((m) => m.id === config.model)!,
			apiKey: key as string,
			baseUrl: pDef.baseUrl,
		})
	}

	return chalk.green(`✓ ${pDef.name} configured`)
}

async function updateKey(agent: Agent): Promise<string> {
	const auth = await loadAuth()

	const configured = PROVIDERS.filter((p) => !!auth.apiKeys[p.id])
	if (configured.length === 0) {
		return chalk.yellow("No providers configured. Use 'Add Provider' first.")
	}

	const pick = await clack.select({
		message: "Update API Key",
		options: configured.map((p) => ({ value: p.id, label: p.name })),
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
		const currentModel = MODELS.find((m) => m.id === config.model && m.provider === config.provider)
		if (currentModel) {
			agent.updateConfig({
				api: pDef.api,
				model: currentModel,
				apiKey: key as string,
				baseUrl: pDef.baseUrl,
			})
		}
	}

	return chalk.green("✓ Key updated")
}

async function removeKey(agent: Agent): Promise<string> {
	const auth = await loadAuth()
	const config = await loadConfig()

	const configured = PROVIDERS.filter((p) => !!auth.apiKeys[p.id])
	if (configured.length === 0) {
		return chalk.yellow("No configured providers to remove.")
	}

	const pick = await clack.select({
		message: "Remove API Key",
		options: configured.map((p) => ({ value: p.id, label: p.name })),
	})
	if (clack.isCancel(pick)) return ""

	const pId = pick as string
	const confirm = await clack.confirm({
		message: `Are you sure you want to remove the API key for ${pId}?`,
	})
	if (clack.isCancel(confirm) || !confirm) return ""

	delete auth.apiKeys[pId]
	await saveAuth(auth)

	// If removing the active provider's key
	if (config.provider === pId) {
		config.provider = ""
		config.model = ""
		// Try to find another configured provider
		const next = Object.keys(auth.apiKeys)[0]
		if (next) {
			const pDef = getProvider(next)
			const mDef = MODELS.find((m) => m.provider === next)
			if (pDef && mDef) {
				config.provider = next
				config.model = mDef.id
				agent.updateConfig({
					api: pDef.api,
					model: mDef,
					apiKey: auth.apiKeys[next]!,
					baseUrl: pDef.baseUrl,
				})
			}
		}
		await saveConfig(config)
	}

	return chalk.green(`✓ Removed API key for ${pId}`)
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

	if (!pDef || !mDef) return chalk.red("Error: Provider or model not found")

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
