import type { ModelMessage, ToolResultPart } from "ai"
import { summarizeToolOutput } from "../content.ts"
import { formatToolArgs } from "../format.ts"
import type { TimelineEvent } from "./types.ts"

export function deriveEventsFromMessages(msgs: ModelMessage[]): TimelineEvent[] {
	const events: TimelineEvent[] = []

	for (let i = 0; i < msgs.length; i++) {
		const msg = msgs[i]!

		if (msg.role === "user") {
			const content =
				typeof msg.content === "string"
					? msg.content
					: msg.content.map((c) => (c.type === "text" ? c.text : "")).join("")
			if (content.trim()) {
				events.push({ id: `user-${i}`, type: "UserMessage", content })
			}
			continue
		}

		if (msg.role === "assistant") {
			const parts =
				typeof msg.content === "string"
					? [{ type: "text" as const, text: msg.content }]
					: msg.content

			for (let j = 0; j < parts.length; j++) {
				const part = parts[j]!
				if (part.type === "text") {
					if (part.text.trim()) {
						events.push({
							id: `assistant-${i}-${j}`,
							type: "AssistantMessage",
							content: part.text,
						})
					}
				} else if (part.type === "tool-call") {
					let foundResult: ToolResultPart | null = null
					for (let k = i + 1; k < msgs.length; k++) {
						const nextMsg = msgs[k]!
						if (nextMsg.role === "tool" && Array.isArray(nextMsg.content)) {
							const resPart = nextMsg.content.find(
								(p): p is ToolResultPart =>
									p.type === "tool-result" && p.toolCallId === part.toolCallId,
							)
							if (resPart) {
								foundResult = resPart
								break
							}
						}
					}

					const args = formatToolArgs(part.input as Record<string, unknown>, false)

					if (foundResult) {
						const { text, isError } = summarizeToolOutput(foundResult.output)
						if (isError) {
							events.push({
								id: `tool-${part.toolCallId}`,
								type: "ToolFailed",
								toolCallId: part.toolCallId,
								toolName: part.toolName,
								args,
								error: text,
							})
						} else {
							const completedEvent: TimelineEvent = {
								id: `tool-${part.toolCallId}`,
								type: "ToolCompleted",
								toolCallId: part.toolCallId,
								toolName: part.toolName,
								args,
							}
							if (part.toolName === "read") {
								completedEvent.resultLineCount = text.split("\n").length
							} else if (part.toolName === "grep") {
								completedEvent.resultMatchCount = text.split("\n").filter(Boolean).length
							}
							events.push(completedEvent)
						}
					} else {
						events.push({
							id: `tool-${part.toolCallId}`,
							type: "ToolStarted",
							toolCallId: part.toolCallId,
							toolName: part.toolName,
							args,
						})
					}
				}
			}
		}
	}

	return events
}
