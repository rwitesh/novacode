import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import semver from "semver"

const __dirname = dirname(fileURLToPath(import.meta.url))

let cachedLatest: string | null = null
let cachedCurrent: string | null = null

export async function getCurrentVersion(): Promise<string> {
	if (cachedCurrent) return cachedCurrent
	try {
		const raw = await readFile(join(__dirname, "..", "package.json"), "utf-8")
		const pkg = JSON.parse(raw)
		cachedCurrent = (pkg.version as string) ?? "0.0.0"
		return cachedCurrent
	} catch {
		return "0.0.0"
	}
}

export async function getLatestVersion(): Promise<string | null> {
	if (cachedLatest) return cachedLatest
	try {
		const proc = spawn("npm", ["info", "novacode", "version"], {
			stdio: ["ignore", "pipe", "ignore"],
		})
		const text = await new Promise<string>((resolve) => {
			let out = ""
			proc.stdout.on("data", (chunk: Buffer) => {
				out += chunk.toString()
			})
			proc.on("close", () => resolve(out.trim()))
		})
		if (text) {
			cachedLatest = text
			return text
		}
	} catch {}
	return null
}

export async function checkForUpdate(): Promise<{
	hasUpdate: boolean
	current: string
	latest: string
} | null> {
	const current = await getCurrentVersion()
	const latest = await getLatestVersion()
	if (!latest) return null
	return {
		hasUpdate: semver.gt(latest, current),
		current,
		latest,
	}
}

export async function runUpdate(silent = false): Promise<boolean> {
	const proc = spawn("npm", ["update", "-g", "novacode"], {
		stdio: silent ? "ignore" : "inherit",
	})
	const exitCode = await new Promise<number>((resolve) => {
		proc.on("close", resolve)
	})
	if (exitCode === 0) {
		if (!silent) {
			console.log("✓ novacode updated to latest version successfully.")
		}
		return true
	} else {
		if (!silent) {
			console.error(`Update failed (exit code ${exitCode})`)
			process.exit(1)
		}
		return false
	}
}
