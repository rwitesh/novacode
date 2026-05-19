import { join } from "node:path"
import type { NovaAuth, NovaConfig } from "../types.ts"

const NOVA_DIR = () => join(process.env.HOME ?? "~", ".novacode")
const CONFIG_PATH = () => join(NOVA_DIR(), "config.json")
const AUTH_PATH = () => join(NOVA_DIR(), "auth.json")

const defaultConfig: NovaConfig = {
	provider: "",
	model: "",
}

const defaultAuth: NovaAuth = {
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

export async function loadAuth(): Promise<NovaAuth> {
	try {
		const raw = await Bun.file(AUTH_PATH()).json()
		return { ...defaultAuth, ...raw }
	} catch {
		return { ...defaultAuth }
	}
}

async function ensureDir(): Promise<void> {
	const { mkdir } = await import("node:fs/promises")
	await mkdir(NOVA_DIR(), { recursive: true })
}

export async function saveConfig(config: NovaConfig): Promise<void> {
	await ensureDir()
	await Bun.write(CONFIG_PATH(), JSON.stringify(config, null, 2))
}

export async function saveAuth(auth: NovaAuth): Promise<void> {
	await ensureDir()
	await Bun.write(AUTH_PATH(), JSON.stringify(auth, null, 2))
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
