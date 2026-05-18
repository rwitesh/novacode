import { join } from "node:path"
import type { NovaConfig } from "../types.ts"

const NOVA_DIR = () => join(process.env.HOME ?? "~", ".novacode")
const CONFIG_PATH = () => join(NOVA_DIR(), "config.json")
const AUTH_PATH = () => join(NOVA_DIR(), "auth.json")

const defaultConfig: NovaConfig = {
	provider: "",
	model: "",
	apiKeys: {},
}

export async function configExists(): Promise<boolean> {
	try {
		await Bun.file(CONFIG_PATH()).stat()
		return true
	} catch {
		return false
	}
}

export async function loadConfig(): Promise<NovaConfig> {
	try {
		const raw = await Bun.file(CONFIG_PATH()).json()
		return { ...defaultConfig, ...raw }
	} catch {
		return { ...defaultConfig }
	}
}

export async function saveConfig(config: NovaConfig): Promise<void> {
	const dir = NOVA_DIR()
	const { mkdir } = await import("node:fs/promises")
	await mkdir(dir, { recursive: true })
	await Bun.write(CONFIG_PATH(), JSON.stringify(config, null, 2))

	// Save API keys separately with restricted permissions
	const authData = { apiKeys: config.apiKeys }
	await Bun.write(AUTH_PATH(), JSON.stringify(authData, null, 2))
	// chmod 0600 on auth file (Node.js for cross-platform compat)
	try {
		const { chmod } = await import("node:fs/promises")
		await chmod(AUTH_PATH(), 0o600)
	} catch {
		// chmod may fail on some platforms, non-fatal
	}
}

export function getNovaDir(): string {
	return NOVA_DIR()
}
