import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
	bashSecretHint,
	classifyRisk,
	isSecretFile,
	PolicyEngine,
	summarizeCall,
} from "../src/policy/engine.ts"
import type { PolicyApprover, ToolCallPart } from "../src/types.ts"

const cwd = join(tmpdir(), "nova-policy-test")

function call(name: string, args: Record<string, unknown> = {}): ToolCallPart {
	return { type: "tool_call", id: "1", name, args }
}

describe("isSecretFile", () => {
	it("flags .env and variants but not templates", () => {
		expect(isSecretFile(`${cwd}/.env`)).toBe(true)
		expect(isSecretFile(`${cwd}/.env.local`)).toBe(true)
		expect(isSecretFile(`${cwd}/.env.production`)).toBe(true)
		expect(isSecretFile(`${cwd}/.env.example`)).toBe(false)
		expect(isSecretFile(`${cwd}/.env.sample`)).toBe(false)
		expect(isSecretFile(`${cwd}/.env.template`)).toBe(false)
	})

	it("does not flag unrelated dotfiles", () => {
		expect(isSecretFile(`${cwd}/.envrc`)).toBe(false)
		expect(isSecretFile(`${cwd}/.environment`)).toBe(false)
		expect(isSecretFile(`${cwd}/package.json`)).toBe(false)
		expect(isSecretFile(`${cwd}/src/index.ts`)).toBe(false)
	})

	it("flags private keys and credentials by name/extension", () => {
		expect(isSecretFile(`${cwd}/id_rsa`)).toBe(true)
		expect(isSecretFile(`${cwd}/id_ed25519`)).toBe(true)
		expect(isSecretFile(`${cwd}/server.pem`)).toBe(true)
		expect(isSecretFile(`${cwd}/cert.key`)).toBe(true)
		expect(isSecretFile(`${cwd}/credentials.json`)).toBe(true)
		expect(isSecretFile(`${cwd}/.npmrc`)).toBe(true)
	})

	it("flags paths inside secret directories", () => {
		expect(isSecretFile(`${cwd}/.ssh/config`)).toBe(true)
		expect(isSecretFile(`${cwd}/.aws/credentials`)).toBe(true)
		expect(isSecretFile(`${cwd}/secrets/api.json`)).toBe(true)
	})
})

describe("classifyRisk", () => {
	it("classifies read-only tools as safe", () => {
		expect(classifyRisk(call("read"))).toBe("safe")
		expect(classifyRisk(call("ls"))).toBe("safe")
		expect(classifyRisk(call("grep"))).toBe("safe")
		expect(classifyRisk(call("glob"))).toBe("safe")
		expect(classifyRisk(call("tree"))).toBe("safe")
	})

	it("classifies mutations and execution/network", () => {
		expect(classifyRisk(call("write"))).toBe("write")
		expect(classifyRisk(call("edit"))).toBe("write")
		expect(classifyRisk(call("bash"))).toBe("execution")
		expect(classifyRisk(call("web_fetch"))).toBe("network")
		expect(classifyRisk(call("web_search"))).toBe("network")
		expect(classifyRisk(call("git", { action: "commit" }))).toBe("write")
		expect(classifyRisk(call("git", { action: "status" }))).toBe("safe")
	})
})

describe("summarizeCall", () => {
	it("shows the command for bash", () => {
		expect(summarizeCall(call("bash", { command: "rm -rf node_modules" }))).toBe(
			"rm -rf node_modules",
		)
	})

	it("shows paths for file tools", () => {
		expect(summarizeCall(call("read", { path: "src/a.ts" }))).toBe("read src/a.ts")
		expect(summarizeCall(call("web_fetch", { url: "https://x.io" }))).toBe("fetch https://x.io")
	})
})

describe("bashSecretHint", () => {
	it("warns about .env but not .env.example", () => {
		expect(bashSecretHint("cat .env")).not.toBe("")
		expect(bashSecretHint("cat .env.example")).toBe("")
	})

	it("is silent on benign commands", () => {
		expect(bashSecretHint("ls -la")).toBe("")
		expect(bashSecretHint("npm test")).toBe("")
	})
})

describe("PolicyEngine", () => {
	it("unrestricted mode allows everything including secrets", async () => {
		const engine = new PolicyEngine("unrestricted", cwd)
		expect((await engine.check(call("read", { path: ".env" }))).allow).toBe(true)
		expect((await engine.check(call("bash", { command: "rm -rf /" }))).allow).toBe(true)
	})

	it("restricted mode hard-blocks secret reads without an approver", async () => {
		const engine = new PolicyEngine("restricted", cwd)
		const d = await engine.check(call("read", { path: ".env" }))
		expect(d.allow).toBe(false)
		expect(d.reason).toContain("secret")
	})

	it("restricted mode allows reading .env.example", async () => {
		const engine = new PolicyEngine("restricted", cwd)
		expect((await engine.check(call("read", { path: ".env.example" }))).allow).toBe(true)
	})

	it("restricted mode auto-allows safe read-only tools", async () => {
		const engine = new PolicyEngine("restricted", cwd)
		expect((await engine.check(call("ls", { path: "." }))).allow).toBe(true)
		expect((await engine.check(call("git", { action: "status" }))).allow).toBe(true)
	})

	it("restricted mode asks the approver for side-effecting tools", async () => {
		let asked = 0
		const approver: PolicyApprover = {
			request: async (req) => {
				asked++
				return req.tool === "bash"
			},
		}
		const engine = new PolicyEngine("restricted", cwd)
		engine.setApprover(approver)

		expect((await engine.check(call("bash", { command: "echo hi" }))).allow).toBe(true)
		expect((await engine.check(call("write", { path: "a.txt" }))).allow).toBe(false)
		expect(asked).toBe(2)
	})

	it("restricted mode blocks without an approver", async () => {
		const engine = new PolicyEngine("restricted", cwd)
		const d = await engine.check(call("bash", { command: "echo hi" }))
		expect(d.allow).toBe(false)
		expect(d.reason).toContain("approval")
	})

	it("setMode switches behaviour live", async () => {
		const engine = new PolicyEngine("restricted", cwd)
		expect((await engine.check(call("bash", { command: "echo hi" }))).allow).toBe(false)
		engine.setMode("unrestricted")
		expect((await engine.check(call("bash", { command: "echo hi" }))).allow).toBe(true)
	})
})
