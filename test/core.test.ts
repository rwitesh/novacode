import { describe, expect, it } from "bun:test"
import { buildSystemPrompt } from "../src/agent/prompt.ts"
import { EventStream } from "../src/provider/stream.ts"
import { getDefaultTools } from "../src/tools/index.ts"

describe("tools", () => {
	it("provides 4 default tools", () => {
		const tools = getDefaultTools("/tmp")
		expect(tools).toHaveLength(4)
		expect(tools.map((t) => t.def.name)).toEqual(["read", "write", "edit", "bash"])
	})

	it("write + read roundtrip", async () => {
		const cwd = `/tmp/forge-test-${Date.now()}`
		await import("node:fs/promises").then((fs) => fs.mkdir(cwd, { recursive: true }))
		const tools = getDefaultTools(cwd)
		const write = tools.find((t) => t.def.name === "write")!
		const read = tools.find((t) => t.def.name === "read")!

		const wResult = await write.execute({ path: "hello.txt", content: "hello forge" })
		expect(wResult.isError).toBe(false)

		const rResult = await read.execute({ path: "hello.txt" })
		expect(rResult.isError).toBe(false)
		expect(rResult.content[0]!.type === "text" && rResult.content[0]!.text).toBe("hello forge")
	})
})

describe("system prompt", () => {
	it("includes tool names", () => {
		const tools = getDefaultTools("/tmp")
		const prompt = buildSystemPrompt("/tmp", tools)

		expect(prompt).toContain("read")
		expect(prompt).toContain("bash")
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
