import { describe, expect, it } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildSystemPrompt } from "../src/agent/prompt.ts"
import { EventStream } from "../src/provider/stream.ts"
import { editTool, readTool, writeTool } from "../src/tools/fs.ts"
import { getAllTools, getDefaultTools } from "../src/tools/index.ts"
import { globTool, grepTool, lsTool } from "../src/tools/search.ts"
import { bashTool } from "../src/tools/shell.ts"

const mkdtemp = async () => {
	const dir = join(tmpdir(), `nova-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
	await mkdir(dir, { recursive: true })
	return dir
}

describe("tool registration", () => {
	it("getAllTools returns 7 tools", () => {
		const tools = getAllTools("/tmp")
		expect(tools).toHaveLength(7)
		expect(tools.map((t) => t.def.name)).toEqual([
			"read",
			"write",
			"edit",
			"bash",
			"glob",
			"grep",
			"ls",
		])
	})

	it("getDefaultTools returns 4 core tools", () => {
		const tools = getDefaultTools("/tmp")
		expect(tools).toHaveLength(4)
	})
})

describe("read tool", () => {
	it("adds line numbers to output", async () => {
		const cwd = await mkdtemp()
		const read = readTool(cwd)
		const write = writeTool(cwd)
		await write.execute({ path: "a.txt", content: "line1\nline2\nline3" })
		const result = await read.execute({ path: "a.txt" })
		expect(result.isError).toBe(false)
		const t = result.content[0]!
		expect(t.type).toBe("text")
		if (t.type === "text") {
			expect(t.text).toContain("1│line1")
			expect(t.text).toContain("2│line2")
			expect(t.text).toContain("3│line3")
		}
		await rm(cwd, { recursive: true })
	})

	it("respects offset and limit", async () => {
		const cwd = await mkdtemp()
		const read = readTool(cwd)
		const write = writeTool(cwd)
		await write.execute({ path: "b.txt", content: "a\nb\nc\nd\ne" })
		const result = await read.execute({ path: "b.txt", offset: 2, limit: 2 })
		expect(result.isError).toBe(false)
		const t = result.content[0]!
		if (t.type === "text") {
			expect(t.text).toContain("2│b")
			expect(t.text).toContain("3│c")
			expect(t.text).not.toContain("a")
		}
		await rm(cwd, { recursive: true })
	})

	it("shows truncation notice when limit exceeded", async () => {
		const cwd = await mkdtemp()
		const read = readTool(cwd)
		const write = writeTool(cwd)
		const lines = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n")
		await write.execute({ path: "c.txt", content: lines })
		const result = await read.execute({ path: "c.txt", limit: 5 })
		expect(result.isError).toBe(false)
		const t = result.content[0]!
		if (t.type === "text") {
			expect(t.text).toContain("more lines")
		}
		await rm(cwd, { recursive: true })
	})

	it("returns error for missing file", async () => {
		const cwd = await mkdtemp()
		const read = readTool(cwd)
		const result = await read.execute({ path: "nonexistent.txt" })
		expect(result.isError).toBe(true)
		await rm(cwd, { recursive: true })
	})
})

describe("edit tool", () => {
	it("accepts edits as JSON array directly", async () => {
		const cwd = await mkdtemp()
		const write = writeTool(cwd)
		const edit = editTool(cwd)
		await write.execute({ path: "edit.txt", content: "hello world" })

		const result = await edit.execute({
			path: "edit.txt",
			edits: [{ oldText: "hello", newText: "goodbye" }],
		})
		expect(result.isError).toBe(false)

		const read = readTool(cwd)
		const after = await read.execute({ path: "edit.txt" })
		const t = after.content[0]!
		if (t.type === "text") {
			expect(t.text).toContain("goodbye world")
			expect(t.text).not.toContain("hello")
		}
		await rm(cwd, { recursive: true })
	})

	it("applies multiple edits", async () => {
		const cwd = await mkdtemp()
		const write = writeTool(cwd)
		const edit = editTool(cwd)
		await write.execute({ path: "multi.txt", content: "foo bar baz" })

		const result = await edit.execute({
			path: "multi.txt",
			edits: [
				{ oldText: "foo", newText: "one" },
				{ oldText: "baz", newText: "three" },
			],
		})
		expect(result.isError).toBe(false)

		const read = readTool(cwd)
		const after = await read.execute({ path: "multi.txt" })
		const t = after.content[0]!
		if (t.type === "text") {
			expect(t.text).toContain("one bar three")
		}
		await rm(cwd, { recursive: true })
	})

	it("rejects ambiguous oldText", async () => {
		const cwd = await mkdtemp()
		const write = writeTool(cwd)
		const edit = editTool(cwd)
		await write.execute({ path: "ambig.txt", content: "aaa aaa bbb" })

		const result = await edit.execute({
			path: "ambig.txt",
			edits: [{ oldText: "aaa", newText: "ccc" }],
		})
		expect(result.isError).toBe(true)
		await rm(cwd, { recursive: true })
	})

	it("reports when oldText not found", async () => {
		const cwd = await mkdtemp()
		const write = writeTool(cwd)
		const edit = editTool(cwd)
		await write.execute({ path: "nofind.txt", content: "hello" })

		const result = await edit.execute({
			path: "nofind.txt",
			edits: [{ oldText: "xyz", newText: "abc" }],
		})
		expect(result.isError).toBe(true)
		await rm(cwd, { recursive: true })
	})
})

describe("bash tool", () => {
	it("runs a command and returns output", async () => {
		const cwd = await mkdtemp()
		const bash = bashTool(cwd)
		const result = await bash.execute({ command: "echo hello" })
		expect(result.isError).toBe(false)
		const t = result.content[0]!
		if (t.type === "text") {
			expect(t.text).toContain("hello")
			expect(t.text).toContain("[exit 0]")
		}
		await rm(cwd, { recursive: true })
	})

	it("captures stderr", async () => {
		const cwd = await mkdtemp()
		const bash = bashTool(cwd)
		const result = await bash.execute({ command: "echo err >&2 && exit 1" })
		expect(result.isError).toBe(true)
		const t = result.content[0]!
		if (t.type === "text") {
			expect(t.text).toContain("err")
			expect(t.text).toContain("[exit 1]")
		}
		await rm(cwd, { recursive: true })
	})

	it("kills process on timeout", async () => {
		const cwd = await mkdtemp()
		const bash = bashTool(cwd)
		const result = await bash.execute({ command: "sleep 10", timeout: 1 })
		expect(result.isError).toBe(true)
		const t = result.content[0]!
		if (t.type === "text") {
			expect(t.text).toContain("timeout")
		}
		await rm(cwd, { recursive: true })
	})
})

describe("glob tool", () => {
	it("finds files by pattern", async () => {
		const cwd = await mkdtemp()
		const write = writeTool(cwd)
		await write.execute({ path: "a.ts", content: "" })
		await write.execute({ path: "b.ts", content: "" })
		await write.execute({ path: "c.js", content: "" })

		const glob = globTool(cwd)
		const result = await glob.execute({ pattern: "**/*.ts" })
		expect(result.isError).toBe(false)
		const t = result.content[0]!
		if (t.type === "text") {
			expect(t.text).toContain("a.ts")
			expect(t.text).toContain("b.ts")
			expect(t.text).not.toContain("c.js")
		}
		await rm(cwd, { recursive: true })
	})
})

describe("grep tool", () => {
	it("finds matching lines", async () => {
		const cwd = await mkdtemp()
		const write = writeTool(cwd)
		await write.execute({ path: "search.txt", content: "hello world\nfoo bar\nhello again" })

		const grep = grepTool(cwd)
		const result = await grep.execute({ pattern: "hello" })
		expect(result.isError).toBe(false)
		const t = result.content[0]!
		if (t.type === "text") {
			expect(t.text).toContain("hello")
		}
		await rm(cwd, { recursive: true })
	})
})

describe("ls tool", () => {
	it("lists directory contents", async () => {
		const cwd = await mkdtemp()
		const write = writeTool(cwd)
		await write.execute({ path: "file1.txt", content: "" })
		await write.execute({ path: "file2.txt", content: "" })
		await mkdir(join(cwd, "subdir"), { recursive: true })

		const ls = lsTool(cwd)
		const result = await ls.execute({ path: "." })
		expect(result.isError).toBe(false)
		const t = result.content[0]!
		if (t.type === "text") {
			expect(t.text).toContain("file1.txt")
			expect(t.text).toContain("subdir/")
		}
		await rm(cwd, { recursive: true })
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
