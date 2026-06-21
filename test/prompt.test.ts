import type { ModelMessage } from "ai"
import { describe, expect, it } from "vitest"
import { preparePrompt } from "../src/agent/prompt.ts"

describe("preparePrompt", () => {
	it("moves compaction summary into system instructions", () => {
		const system = "You are Nova."
		const messages: ModelMessage[] = [
			{ role: "user", content: "[Prior context summary]\nWe fixed the login bug." },
			{ role: "user", content: "Now refactor auth" },
		]

		const { instructions, messages: out } = preparePrompt(system, messages)

		expect(instructions).toBe("You are Nova.\n\n[Prior context summary]\nWe fixed the login bug.")
		expect(out).toHaveLength(1)
		expect(out[0]).toEqual({ role: "user", content: "Now refactor auth" })
	})

	it("leaves system unchanged when no summary is present", () => {
		const system = "You are Nova."
		const messages: ModelMessage[] = [
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Hi there" },
		]

		const { instructions, messages: out } = preparePrompt(system, messages)

		expect(instructions).toBe("You are Nova.")
		expect(out).toEqual(messages)
	})

	it("prunes old reasoning and tool calls but keeps text and last-turn artifacts", () => {
		// Simulate a 3-turn conversation with reasoning and tool usage.
		const messages: ModelMessage[] = [
			// Turn 1 — old, will be pruned
			{ role: "user", content: "Read package.json" },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "I'll read it." },
					{ type: "reasoning", text: "The user wants to see dependencies." },
					{
						type: "tool-call",
						toolCallId: "tc1",
						toolName: "read",
						input: { path: "package.json" },
					},
				],
			},
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "tc1",
						toolName: "read",
						output: { type: "text", value: '{"name": "app"}' },
					},
				],
			},
			// Turn 2 — old, will be pruned
			{ role: "user", content: "Grep for 'foo'" },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "Searching..." },
					{ type: "reasoning", text: "Need to find occurrences." },
					{
						type: "tool-call",
						toolCallId: "tc2",
						toolName: "grep",
						input: { pattern: "foo" },
					},
				],
			},
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "tc2",
						toolName: "grep",
						output: { type: "text", value: "src/index.ts:10\nsrc/lib.ts:22" },
					},
				],
			},
			// Turn 3 — last turn, everything is kept
			{ role: "user", content: "Edit src/index.ts line 10" },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "I'll edit it." },
					{ type: "reasoning", text: "Should replace foo with bar." },
					{
						type: "tool-call",
						toolCallId: "tc3",
						toolName: "edit",
						input: { path: "src/index.ts", oldString: "foo", newString: "bar" },
					},
				],
			},
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "tc3",
						toolName: "edit",
						output: { type: "text", value: "Done" },
					},
				],
			},
		]

		const { messages: out } = preparePrompt("system", messages)

		// Should drop empty tool messages from old turns.
		expect(out.filter((m) => m.role === "tool")).toHaveLength(1)

		// Turn 1 assistant: only text remains.
		const turn1Assistant = out.find(
			(m, i) =>
				m.role === "assistant" &&
				out[i - 1]?.role === "user" &&
				out[i - 1]?.content === "Read package.json",
		)
		expect(turn1Assistant).toBeDefined()
		expect(Array.isArray(turn1Assistant!.content)).toBe(true)
		expect(turn1Assistant!.content).toEqual([{ type: "text", text: "I'll read it." }])

		// Turn 2 assistant: only text remains.
		const turn2Assistant = out.find(
			(m, i) =>
				m.role === "assistant" &&
				out[i - 1]?.role === "user" &&
				out[i - 1]?.content === "Grep for 'foo'",
		)
		expect(turn2Assistant).toBeDefined()
		expect(turn2Assistant!.content).toEqual([{ type: "text", text: "Searching..." }])

		// Turn 3 assistant: text + tool-call kept, but reasoning stripped
		// because reasoning is only kept in the literal last message.
		// The tool-call "tc3" is kept because its result appears in the last message.
		const turn3Assistant = out[out.length - 2]
		expect(turn3Assistant?.role).toBe("assistant")
		expect(Array.isArray(turn3Assistant!.content)).toBe(true)
		const t3a = turn3Assistant!.content as Array<Record<string, unknown>>
		expect(t3a).toHaveLength(2)
		expect(t3a[0]).toEqual({ type: "text", text: "I'll edit it." })
		expect(t3a[1]!.type).toBe("tool-call")

		// Turn 3 tool result (literal last message): kept intact.
		const turn3Tool = out[out.length - 1]
		expect(turn3Tool?.role).toBe("tool")
		const t3t = turn3Tool!.content as Array<Record<string, unknown>>
		expect(t3t).toHaveLength(1)
		expect(t3t[0]!.type).toBe("tool-result")
	})
})
