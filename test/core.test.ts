import { describe, expect, it } from "vitest"
import { buildSystemPrompt } from "../src/agent/prompt.ts"
import { EventStream } from "../src/provider/stream.ts"
import { getAllTools, getDefaultTools } from "../src/tools/index.ts"
import { consolidate, formatToolArgs, getRelativeIfInside, makeRelative } from "../src/util.ts"

describe("tool registration", () => {
	it("getAllTools returns 11 tools", () => {
		const tools = getAllTools("/tmp")
		expect(tools).toHaveLength(11)
		expect(tools.map((t) => t.def.name)).toEqual([
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
	})

	it("getDefaultTools returns 6 core tools", () => {
		const tools = getDefaultTools("/tmp")
		expect(tools).toHaveLength(6)
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
		const tools = getDefaultTools("/tmp")
		const prompt = buildSystemPrompt("/tmp", tools)
		const today = new Date().toISOString().split("T")[0] ?? ""
		expect(prompt).toContain(today)
	})
})

describe("EventStream", () => {
	it("pushes and iterates", async () => {
		const es = new EventStream<string, number>()
		es.push("a")
		es.push("b")
		es.finish(42)

		const items: string[] = []
		for await (const item of es) {
			items.push(item)
		}

		expect(items).toEqual(["a", "b"])
		expect(es.result).toBe(42)
	})
})

describe("util helpers", () => {
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

	it("consolidate merges text/thinking and filters out whitespace-only text when tool calls are present", () => {
		const parts1 = [
			{ type: "text" as const, text: "hello " },
			{ type: "text" as const, text: "world" },
		]
		expect(consolidate(parts1)).toEqual([{ type: "text", text: "hello world" }])

		const parts2 = [
			{ type: "text" as const, text: "\n" },
			{ type: "tool_call" as const, id: "c1", name: "read", args: {} },
			{ type: "text" as const, text: "  \n  " },
		]
		expect(consolidate(parts2)).toEqual([{ type: "tool_call", id: "c1", name: "read", args: {} }])

		const parts3 = [{ type: "text" as const, text: "\n" }]
		expect(consolidate(parts3)).toEqual([{ type: "text", text: "\n" }])

		const parts4 = [
			{ type: "text" as const, text: "Thinking...\n" },
			{ type: "tool_call" as const, id: "c2", name: "tree", args: {} },
		]
		expect(consolidate(parts4)).toEqual([
			{ type: "text", text: "Thinking...\n" },
			{ type: "tool_call", id: "c2", name: "tree", args: {} },
		])
	})
})
