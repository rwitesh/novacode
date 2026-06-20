import type { ModelMessage } from "ai"
import { describe, expect, it } from "vitest"
import { deriveEventsFromMessages } from "../src/tui/components/message.tsx"

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
