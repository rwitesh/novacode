import { homedir } from "node:os"
import { isAbsolute, relative } from "node:path"

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

// Compact a path for display: relative to cwd when inside it, else ~/ for home, else as-is.
export function shortenPath(path: string): string {
	const cwd = process.cwd()
	if (path === cwd || path.startsWith(`${cwd}/`)) return relative(cwd, path) || "."
	const home = homedir()
	if (path === home || path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`
	return path
}
