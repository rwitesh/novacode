import { describe, expect, it } from "vitest"
import { buildSystemPrompt } from "../src/agent/prompt.ts"
import { formatToolArgs } from "../src/format.ts"
import { getRelativeIfInside, makeRelative } from "../src/paths.ts"
import { getAllTools } from "../src/tools/index.ts"

describe("tool registration", () => {
	it("getAllTools returns 11 tools", () => {
		const tools = getAllTools("/tmp")
		expect(Object.keys(tools)).toEqual([
			"read",
			"write",
			"edit",
			"bash",
			"glob",
			"grep",
			"ls",
			"tree",
			"git",
			"web_search",
			"web_fetch",
		])
		expect(Object.keys(tools)).toHaveLength(11)
	})
})

describe("system prompt", () => {
	it("includes tool names and guidelines", () => {
		const tools = getAllTools("/tmp")
		const prompt = buildSystemPrompt("/tmp", tools)
		expect(prompt).toContain("read")
		expect(prompt).toContain("bash")
		expect(prompt).toContain("glob")
		expect(prompt).toContain("Safety")
		expect(prompt).toContain("Guidelines")
	})

	it("includes current date", () => {
		const tools = getAllTools("/tmp")
		const prompt = buildSystemPrompt("/tmp", tools)
		const today = new Date().toISOString().split("T")[0] ?? ""
		expect(prompt).toContain(today)
	})
})

describe("path helpers", () => {
	it("makeRelative converts absolute path to relative", () => {
		const cwd = process.cwd()
		const absPath = `${cwd}/src/main.ts`
		const rel = makeRelative(absPath)
		expect(rel).toBe("src/main.ts")
	})

	it("makeRelative converts file:// absolute URL to relative", () => {
		const cwd = process.cwd()
		const absUrl = `file://${cwd}/src/main.ts`
		const rel = makeRelative(absUrl)
		expect(rel).toBe("file://src/main.ts")
	})

	it("formatToolArgs formats and relativizes arguments", () => {
		const cwd = process.cwd()
		const args = {
			path: `${cwd}/src/tui/app.tsx`,
			line: 12,
		}
		const formatted = formatToolArgs(args)
		expect(formatted).toBe("path: src/tui/app.tsx line: 12")
	})

	it("makeRelative does not convert path outside cwd to relative", () => {
		const absPath = "/etc/hosts"
		const rel = makeRelative(absPath)
		expect(rel).toBe("/etc/hosts")
	})

	it("getRelativeIfInside relativizes path inside cwd", () => {
		const cwd = "/a/b"
		const path = "/a/b/c/d.txt"
		const rel = getRelativeIfInside(cwd, path)
		expect(rel).toBe("c/d.txt")
	})

	it("getRelativeIfInside preserves full path outside cwd", () => {
		const cwd = "/a/b"
		const path = "/a/other/c/d.txt"
		const rel = getRelativeIfInside(cwd, path)
		expect(rel).toBe("/a/other/c/d.txt")
	})

	it("getRelativeIfInside prevents false prefix matches", () => {
		const cwd = "/a/b"
		const path = "/a/b-other/c/d.txt"
		const rel = getRelativeIfInside(cwd, path)
		expect(rel).toBe("/a/b-other/c/d.txt")
	})
})
