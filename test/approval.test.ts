import { tool } from "ai"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { withApproval } from "../src/agent/approval.ts"
import { PolicyEngine } from "../src/policy/engine.ts"
import type { ToolResult } from "../src/types.ts"

const cwd = "/test"

// A toy tool that flips `ran` when its body executes.
function makeTool(ran: () => void) {
	return tool({
		description: "test",
		inputSchema: z.object({ command: z.string().optional(), path: z.string().optional() }),
		execute: async (): Promise<ToolResult> => {
			ran()
			return { content: [{ type: "text", text: "ran" }], isError: false }
		},
	})
}

async function run(t: ReturnType<typeof makeTool>, input: unknown): Promise<ToolResult> {
	const out = await t.execute!(input as never, { toolCallId: "1", messages: [] })
	return out as ToolResult
}

describe("withApproval", () => {
	it("allows safe tools without asking", async () => {
		let asked = 0
		const policy = new PolicyEngine("restricted", cwd)
		policy.setApprover({
			request: async () => {
				asked++
				return true
			},
		})

		let ran = false
		const wrapped = withApproval({ read: makeTool(() => (ran = true)) }, policy)
		const res = await run(wrapped.read as ReturnType<typeof makeTool>, { path: "src/a.ts" })

		expect(res.isError).toBe(false)
		expect(ran).toBe(true)
		expect(asked).toBe(0)
	})

	it("hard-blocks secret reads even with an approver", async () => {
		const policy = new PolicyEngine("restricted", cwd)
		policy.setApprover({ request: async () => true })

		let ran = false
		const wrapped = withApproval({ read: makeTool(() => (ran = true)) }, policy)
		const res = await run(wrapped.read as ReturnType<typeof makeTool>, { path: ".env" })

		expect(res.isError).toBe(true)
		expect(ran).toBe(false)
	})

	it("routes execution-risk tools through the approver and denies", async () => {
		let asked = 0
		const policy = new PolicyEngine("restricted", cwd)
		policy.setApprover({
			request: async () => {
				asked++
				return false
			},
		})

		let ran = false
		const wrapped = withApproval({ bash: makeTool(() => (ran = true)) }, policy)
		const res = await run(wrapped.bash as ReturnType<typeof makeTool>, { command: "echo hi" })

		expect(res.isError).toBe(true)
		expect(asked).toBe(1)
		expect(ran).toBe(false)
	})

	it("runs the tool when the approver approves", async () => {
		const policy = new PolicyEngine("restricted", cwd)
		policy.setApprover({ request: async () => true })

		let ran = false
		const wrapped = withApproval({ bash: makeTool(() => (ran = true)) }, policy)
		const res = await run(wrapped.bash as ReturnType<typeof makeTool>, { command: "echo hi" })

		expect(res.isError).toBe(false)
		expect(ran).toBe(true)
	})

	it("is a no-op without a policy", async () => {
		let ran = false
		const wrapped = withApproval({ bash: makeTool(() => (ran = true)) }, null)
		const res = await run(wrapped.bash as ReturnType<typeof makeTool>, { command: "echo hi" })

		expect(res.isError).toBe(false)
		expect(ran).toBe(true)
	})
})
