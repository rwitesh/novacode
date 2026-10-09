import type { ModelMessage } from "ai"
import { describe, expect, it } from "vitest"
import { deleteLastGrapheme, deriveEventsFromMessages } from "../src/tui/helpers.ts"

describe("TUI text helpers", () => {
	it.each(["😀", "𐐀", "é", "👩‍💻"])("deletes a complete grapheme: %s", (text) => {
		expect(deleteLastGrapheme(`abc${text}`)).toBe("abc")
	})
})

describe("TUI deriveEventsFromMessages", () => {
	it("should map UserMessage correctly", () => {
		const msgs: ModelMessage[] = [{ role: "user", content: "Hello world" }]
		const events = deriveEventsFromMessages(msgs)
		expect(events).toHaveLength(1)
		expect(events[0]).toEqual({
			id: "user-0",
			type: "UserMessage",
			content: "Hello world",
		})
	})

	it("should map AssistantMessage correctly", () => {
		const msgs: ModelMessage[] = [{ role: "assistant", content: "Response text" }]
		const events = deriveEventsFromMessages(msgs)
		expect(events).toHaveLength(1)
		expect(events[0]).toEqual({
			id: "assistant-0-0",
			type: "AssistantMessage",
			content: "Response text",
		})
	})

	it("should map running and completed tool calls", () => {
		const msgs: ModelMessage[] = [
			{
				role: "assistant",
				content: [
					{ type: "text", text: "Calling tool..." },
					{
						type: "tool-call",
						toolCallId: "call-1",
						toolName: "read",
						input: { path: "README.md" },
					},
				],
			},
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call-1",
						toolName: "read",
						output: { type: "text", value: "line 1\nline 2" },
					},
				],
			},
		]
		const events = deriveEventsFromMessages(msgs)
		expect(events).toHaveLength(2)
		expect(events[0]).toEqual({
			id: "assistant-0-0",
			type: "AssistantMessage",
			content: "Calling tool...",
		})
		expect(events[1]).toEqual({
			id: "tool-call-1",
			type: "ToolCompleted",
			toolCallId: "call-1",
			toolName: "read",
			args: "path: README.md",
			resultLineCount: 2,
		})
	})

	it.each([
		["No matches", 0],
		["", 0],
		["file.ts:1:match", 1],
		["a:1:x\nb:2:y", 2],
	])("counts grep results: %s", (text, count) => {
		const events = deriveEventsFromMessages([
			{
				role: "assistant",
				content: [{ type: "tool-call", toolCallId: "grep-1", toolName: "grep", input: {} }],
			},
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "grep-1",
						toolName: "grep",
						output: { type: "text", value: text },
					},
				],
			},
		])
		expect(events[0]).toMatchObject({ type: "ToolCompleted", resultMatchCount: count })
	})

	it("should map failed tool calls", () => {
		const msgs: ModelMessage[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "call-2",
						toolName: "bash",
						input: { command: "exit 1" },
					},
				],
			},
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call-2",
						toolName: "bash",
						output: { type: "error-text", value: "Command failed" },
					},
				],
			},
		]
		const events = deriveEventsFromMessages(msgs)
		expect(events).toHaveLength(1)
		expect(events[0]).toEqual({
			id: "tool-call-2",
			type: "ToolFailed",
			toolCallId: "call-2",
			toolName: "bash",
			args: "command: exit 1",
			error: "Command failed",
		})
	})
})
