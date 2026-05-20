import { join } from "node:path"
import { semver } from "bun"

let cachedLatest: string | null = null

export async function getCurrentVersion(): Promise<string> {
	try {
		const pkg = await Bun.file(join(import.meta.dir, "..", "package.json")).json()
		return pkg.version ?? "0.0.0"
	} catch {
		return "0.0.0"
	}
}

export async function getLatestVersion(): Promise<string | null> {
	if (cachedLatest) return cachedLatest
	try {
		const proc = Bun.spawn(["bun", "info", "novacode", "version"], {
			stdout: "pipe",
			stderr: "ignore",
		})
		const text = await new Response(proc.stdout).text()
		const latest = text.trim()
		if (latest) {
			cachedLatest = latest
			return latest
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
		hasUpdate: semver.order(latest, current) === 1,
		current,
		latest,
	}
}

export async function runUpdate(silent = false): Promise<boolean> {
	const proc = Bun.spawn(["bun", "update", "-g", "novacode", "--latest"], {
		stdout: silent ? "ignore" : "inherit",
		stderr: silent ? "ignore" : "inherit",
	})
	const exitCode = await proc.exited
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
