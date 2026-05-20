import { execSync } from "node:child_process"
import { mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { editTool, readTool, writeTool } from "../src/tools/fs.ts"
import { gitTool } from "../src/tools/git.ts"
import { globTool, grepTool, lsTool, treeTool } from "../src/tools/search.ts"
import { bashTool } from "../src/tools/shell.ts"

const mkdtemp = async () => {
	const dir = join(tmpdir(), `nova-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
	await mkdir(dir, { recursive: true })
	return dir
}

describe("read tool", () => {
	it("returns file content", async () => {
		const cwd = await mkdtemp()
		const read = readTool(cwd)
		const write = writeTool(cwd)
		await write.execute({ path: "a.txt", content: "line1\nline2\nline3" })
		const result = await read.execute({ path: "a.txt" })
		expect(result.isError).toBe(false)
		const t = result.content[0]!
		expect(t.type).toBe("text")
		if (t.type === "text") {
			expect(t.text).toContain("line1")
			expect(t.text).toContain("line2")
			expect(t.text).toContain("line3")
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
			expect(t.text).toContain("b")
			expect(t.text).toContain("c")
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
			expect(t.text).toContain("file2.txt")
			expect(t.text).toContain("subdir/")
		}
		await rm(cwd, { recursive: true })
	})
})

describe("tree tool", () => {
	it("renders visual directory tree", async () => {
		const cwd = await mkdtemp()
		const write = writeTool(cwd)
		await write.execute({ path: "file.txt", content: "" })
		await mkdir(join(cwd, "folder"), { recursive: true })
		await write.execute({ path: "folder/subfile.txt", content: "" })

		// tree ignores node_modules and .git, let's verify it ignores node_modules
		await mkdir(join(cwd, "node_modules"), { recursive: true })
		await write.execute({ path: "node_modules/dep.js", content: "" })

		const tree = treeTool(cwd)
		const result = await tree.execute({ path: "." })
		expect(result.isError).toBe(false)
		const t = result.content[0]!
		if (t.type === "text") {
			expect(t.text).toContain("file.txt")
			expect(t.text).toContain("folder/")
			expect(t.text).toContain("subfile.txt")
			expect(t.text).not.toContain("node_modules")
			expect(t.text).not.toContain("dep.js")
		}
		await rm(cwd, { recursive: true })
	})
})

describe("git tool", () => {
	it("executes safe git status commands", async () => {
		const cwd = await mkdtemp()

		// Initialize a dummy git repo inside the test directory
		execSync("git init", { cwd, stdio: "ignore" })

		const git = gitTool(cwd)
		const result = await git.execute({ action: "status" })

		expect(result.isError).toBe(false)
		const t = result.content[0]!
		if (t.type === "text") {
			expect(t.text).toContain("On branch")
		}
		await rm(cwd, { recursive: true })
	})

	it("rejects disallowed commands", async () => {
		const cwd = await mkdtemp()
		const git = gitTool(cwd)
		const result = await git.execute({ action: "push" }) // disallowed

		expect(result.isError).toBe(true)
		const t = result.content[0]!
		if (t.type === "text") {
			expect(t.text).toContain("not supported")
		}
		await rm(cwd, { recursive: true })
	})
})
