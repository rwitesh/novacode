import chalk from "chalk"
import type { Agent } from "../agent/agent.ts"
import { getProvider, MODELS, PROVIDERS } from "../config/providers.ts"
import { loadAuth, loadConfig, saveAuth, saveConfig } from "../config/store.ts"
import type { Prompts } from "../types.ts"

export async function handleProviders(agent: Agent, prompts?: Prompts): Promise<string> {
	if (!prompts) return chalk.red("Prompts not available in this context")

	const config = await loadConfig()
	const auth = await loadAuth()
	const configured = PROVIDERS.filter((p) => !!auth.apiKeys[p.id])

	const headerLines =
		configured.length === 0
			? chalk.dim("No providers configured. Use 'Add Provider' below.")
			: configured
					.map((p) => {
						const isDefault = p.id === config.provider
						const active = isDefault ? chalk.green(" ●") : ""
						const currentModel = isDefault
							? config.model
							: (MODELS.find((m) => m.provider === p.id)?.id ?? "")
						return `  ✅ ${p.name.padEnd(24)} ${currentModel}${active}`
					})
					.join("\n")

	const act = await prompts.select({
		message: "Action",
		header: headerLines,
		options: [
			{ value: "add", label: "Add Provider" },
			{ value: "update", label: "Update API Key" },
			{ value: "remove", label: "Remove API Key" },
			{ value: "default", label: "Set Default Provider" },
			{ value: "back", label: "Back" },
		],
	})
	if (!act || act === "back") return ""

	if (act === "add") return addProvider(agent, prompts)
	if (act === "update") return updateKey(agent, prompts)
	if (act === "remove") return removeKey(agent, prompts)
	if (act === "default") return setDefault(agent, prompts)
	return ""
}

async function addProvider(agent: Agent, prompts: Prompts): Promise<string> {
	const auth = await loadAuth()
	const config = await loadConfig()

	const available = PROVIDERS.filter((p) => !auth.apiKeys[p.id])
	if (available.length === 0) {
		return chalk.yellow("All providers already have API keys configured.")
	}

	const pick = await prompts.select({
		message: "Add Provider",
		options: available.map((p) => ({ value: p.id, label: p.name })),
	})
	if (!pick) return ""

	const pDef = getProvider(pick)
	if (!pDef) return chalk.red("Error: Provider not found")

	const key = await prompts.password({
		message: `${pDef.name} API Key`,
		validate: (v) => (!v || v.length < 8 ? "Enter a valid key" : undefined),
	})
	if (!key) return ""

	auth.apiKeys[pDef.id] = key
	await saveAuth(auth)

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
			apiKey: key,
			baseUrl: pDef.baseUrl,
		})
	}

	return chalk.green(`✓ ${pDef.name} configured`)
}

async function updateKey(agent: Agent, prompts: Prompts): Promise<string> {
	const auth = await loadAuth()

	const configured = PROVIDERS.filter((p) => !!auth.apiKeys[p.id])
	if (configured.length === 0) {
		return chalk.yellow("No providers configured. Use 'Add Provider' first.")
	}

	const pick = await prompts.select({
		message: "Update API Key",
		options: configured.map((p) => ({ value: p.id, label: p.name })),
	})
	if (!pick) return ""

	const pDef = getProvider(pick)
	if (!pDef) return chalk.red("Error: Provider not found")

	const key = await prompts.password({ message: `New key for ${pDef.name}` })
	if (!key) return ""

	auth.apiKeys[pDef.id] = key
	await saveAuth(auth)

	const config = await loadConfig()
	if (config.provider === pDef.id) {
		const currentModel = MODELS.find((m) => m.id === config.model && m.provider === config.provider)
		if (currentModel) {
			agent.updateConfig({
				api: pDef.api,
				model: currentModel,
				apiKey: key,
				baseUrl: pDef.baseUrl,
			})
		}
	}

	return chalk.green("✓ Key updated")
}

async function removeKey(agent: Agent, prompts: Prompts): Promise<string> {
	const auth = await loadAuth()
	const config = await loadConfig()

	const configured = PROVIDERS.filter((p) => !!auth.apiKeys[p.id])
	if (configured.length === 0) {
		return chalk.yellow("No configured providers to remove.")
	}

	const pick = await prompts.select({
		message: "Remove API Key",
		options: configured.map((p) => ({ value: p.id, label: p.name })),
	})
	if (!pick) return ""

	const confirm = await prompts.confirm({
		message: `Are you sure you want to remove the API key for ${pick}?`,
	})
	if (!confirm) return ""

	delete auth.apiKeys[pick]
	await saveAuth(auth)

	if (config.provider === pick) {
		config.provider = ""
		config.model = ""
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

	return chalk.green(`✓ Removed API key for ${pick}`)
}

async function setDefault(agent: Agent, prompts: Prompts): Promise<string> {
	const config = await loadConfig()
	const auth = await loadAuth()

	const pick = await prompts.select({
		message: "Default Provider",
		options: PROVIDERS.map((p) => ({
			value: p.id,
			label: `${auth.apiKeys[p.id] ? "✅" : "❌"} ${p.name}`,
		})),
	})
	if (!pick) return ""

	if (!auth.apiKeys[pick]) {
		return chalk.yellow(`No API key for ${pick}. Please set one first.`)
	}

	const pDef = getProvider(pick)
	const mDef = MODELS.find((m) => m.provider === pick)

	if (!pDef || !mDef) return chalk.red("Error: Provider or model not found")

	config.provider = pick
	config.model = mDef.id
	await saveConfig(config)

	agent.updateConfig({
		api: pDef.api,
		model: mDef,
		apiKey: auth.apiKeys[pick],
		baseUrl: pDef.baseUrl,
	})

	return chalk.green(`✓ Default set to ${pDef.name} (${mDef.id})`)
}
