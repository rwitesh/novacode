import { describe, expect, it } from "bun:test"
import { buildSystemPrompt } from "../src/agent/prompt.ts"
import { EventStream } from "../src/provider/stream.ts"
import { getAllTools, getDefaultTools } from "../src/tools/index.ts"

describe("tool registration", () => {
	it("getAllTools returns 9 tools", () => {
		const tools = getAllTools("/tmp")
		expect(tools).toHaveLength(9)
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
		])
	})

	it("getDefaultTools returns 4 core tools", () => {
		const tools = getDefaultTools("/tmp")
		expect(tools).toHaveLength(4)
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
