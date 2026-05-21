import { isAbsolute, relative } from "node:path"
import chalk from "chalk"
import type { Msg, TextPart } from "./types.ts"

// ~4 chars per token for English/code. Close enough for capacity warnings.
export function estimateTokens(messages: Msg[]): number {
	let chars = 0
	for (const msg of messages) {
		if (typeof msg.content === "string") {
			chars += msg.content.length
		} else if (Array.isArray(msg.content)) {
			for (const part of msg.content) {
				if (part.type === "text") chars += part.text.length
			}
		}
	}
	return Math.ceil(chars / 4)
}

export function textPart(s: string): TextPart {
	return { type: "text", text: s }
}

export function getRelativeIfInside(cwd: string, filePath: string): string {
	if (filePath === cwd || filePath.startsWith(`${cwd}/`)) {
		return relative(cwd, filePath) || "."
	}
	return filePath
}

export function makeRelative(val: string): string {
	if (typeof val !== "string") return val

	let pathVal = val
	let prefix = ""
	if (val.startsWith("file://")) {
		pathVal = val.slice(7)
		prefix = "file://"
	}

	if (isAbsolute(pathVal)) {
		const cwd = process.cwd()
		return prefix + getRelativeIfInside(cwd, pathVal)
	}
	return val
}

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
