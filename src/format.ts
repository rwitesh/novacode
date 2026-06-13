import chalk from "chalk"
import { makeRelative } from "./paths.ts"

export function formatToolArgs(
	args: Record<string, unknown> | undefined,
	useChalk = false,
): string {
	if (!args) return ""
	return Object.entries(args)
		.map(([k, v]) => {
			const val = typeof v === "string" ? makeRelative(v) : JSON.stringify(v)
			const valStr = val.length > 40 ? `${val.slice(0, 40)}…` : val
			const keyStr = useChalk ? chalk.dim(`${k}:`) : `${k}:`
			return `${keyStr} ${valStr}`
		})
		.join(" ")
}

export function formatRelativeTime(ts: number): string {
	const now = Date.now()
	const diffMs = now - ts
	const diffSec = Math.floor(diffMs / 1000)
	const diffMin = Math.floor(diffSec / 60)
	const diffHour = Math.floor(diffMin / 60)

	if (diffSec < 60) {
		return "just now"
	}
	if (diffMin < 60) {
		return `${diffMin}m ago`
	}
	if (diffHour < 24) {
		return `${diffHour}h ago`
	}
	return new Date(ts).toLocaleDateString()
}
