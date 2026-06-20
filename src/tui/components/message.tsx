import type { ModelMessage, ToolResultPart } from "ai"
import { Box, Text } from "ink"
import { memo } from "react"
import { summarizeToolOutput } from "../../content.ts"
import { formatToolArgs } from "../../format.ts"
import { TOOL_STYLE } from "../constants.ts"
import { formatMarkdown } from "../markdown/index.ts"
import type { TimelineEvent } from "../types.ts"
import { Cursor, Spinner } from "./liveArea.tsx"

export function deriveEventsFromMessages(msgs: ModelMessage[]): TimelineEvent[] {
	const events: TimelineEvent[] = []

	for (let i = 0; i < msgs.length; i++) {
		const msg = msgs[i]!

		if (msg.role === "user") {
			const content =
				typeof msg.content === "string"
					? msg.content
					: msg.content.map((c) => (c.type === "text" ? c.text : "")).join("")
			events.push({
				id: `user-${i}`,
				type: "UserMessage",
				content,
			})
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
					// Search for tool result in subsequent messages
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

					const formattedArgs = formatToolArgs(part.input as Record<string, unknown>, true)

					if (foundResult) {
						const { text, isError } = summarizeToolOutput(foundResult.output)
						if (isError) {
							events.push({
								id: `tool-${part.toolCallId}`,
								type: "ToolFailed",
								toolCallId: part.toolCallId,
								toolName: part.toolName,
								args: formattedArgs,
								error: text,
							})
						} else {
							let lineCount: number | undefined
							let matchCount: number | undefined
							if (part.toolName === "read") {
								lineCount = text.split("\n").length
							} else if (part.toolName === "grep") {
								matchCount = text.split("\n").filter(Boolean).length
							}
							events.push({
								id: `tool-${part.toolCallId}`,
								type: "ToolCompleted",
								toolCallId: part.toolCallId,
								toolName: part.toolName,
								args: formattedArgs,
								resultLineCount: lineCount,
								resultMatchCount: matchCount,
							})
						}
					} else {
						events.push({
							id: `tool-${part.toolCallId}`,
							type: "ToolStarted",
							toolCallId: part.toolCallId,
							toolName: part.toolName,
							args: formattedArgs,
						})
					}
				}
			}
		}
	}

	return events
}

const UserMessageView = memo(function UserMessageView({
	content,
	isFirst,
}: {
	content: string
	isFirst: boolean
}) {
	const columns = process.stdout.columns || 80
	const dividerWidth = Math.max(10, columns - 2)
	const divider = "─".repeat(dividerWidth)

	return (
		<Box flexDirection="column" marginTop={isFirst ? 0 : 1} marginBottom={1}>
			<Text color="green">{divider}</Text>
			<Box flexDirection="row">
				<Box flexShrink={0} marginRight={1}>
					<Text bold color="greenBright">
						{"❯"}
					</Text>
				</Box>
				<Box flexGrow={1} flexShrink={1}>
					<Text>{content}</Text>
				</Box>
			</Box>
			<Text color="green">{divider}</Text>
		</Box>
	)
})

export const EventRenderer = memo(function EventRenderer({
	event,
	isFirst = false,
}: {
	event: TimelineEvent
	isFirst?: boolean
}) {
	switch (event.type) {
		case "UserMessage":
			return <UserMessageView content={event.content} isFirst={isFirst} />

		case "AssistantMessage": {
			const text = formatMarkdown(event.content)
			return (
				<Box flexDirection="column" marginTop={0}>
					<Text>
						{text}
						{event.id === "active-text" && <Cursor />}
					</Text>
				</Box>
			)
		}

		case "ToolStarted": {
			const color = TOOL_STYLE[event.toolName] ?? "white"
			return (
				<Box flexDirection="row" marginTop={0}>
					<Box marginRight={1}>
						<Spinner />
					</Box>
					<Text color={color} bold>
						{event.toolName}
					</Text>
					{event.args && <Text dimColor> {event.args}</Text>}
				</Box>
			)
		}

		case "ToolCompleted": {
			const color = TOOL_STYLE[event.toolName] ?? "white"
			return (
				<Box flexDirection="row" marginTop={0}>
					<Text color="green">● </Text>
					<Text color={color} bold>
						{event.toolName}
					</Text>
					{event.args && <Text dimColor> {event.args}</Text>}
					{event.resultLineCount !== undefined && (
						<Text dimColor> ({event.resultLineCount} lines)</Text>
					)}
					{event.resultMatchCount !== undefined && (
						<Text dimColor> ({event.resultMatchCount} matches)</Text>
					)}
				</Box>
			)
		}

		case "ToolFailed": {
			const color = TOOL_STYLE[event.toolName] ?? "white"
			return (
				<Box flexDirection="column" marginTop={0}>
					<Box flexDirection="row">
						<Text color="red">✖ </Text>
						<Text color={color} bold>
							{event.toolName}
						</Text>
						{event.args && <Text dimColor> {event.args}</Text>}
					</Box>
					<Box marginLeft={2}>
						<Text color="red">{event.error}</Text>
					</Box>
				</Box>
			)
		}

		case "Thinking": {
			const label = event.id === "active-working" ? "working…" : "Thinking…"
			return (
				<Box flexDirection="row" marginTop={0}>
					<Box marginRight={1}>
						<Spinner />
					</Box>
					<Text color="yellow">{label}</Text>
				</Box>
			)
		}

		case "Warning":
			return (
				<Box flexDirection="row" marginTop={0}>
					<Text color="yellow">⚠ {event.content}</Text>
				</Box>
			)

		case "SystemMessage":
			return (
				<Box flexDirection="row" marginTop={0}>
					<Text color="blue">ℹ {event.content}</Text>
				</Box>
			)

		default:
			return null
	}
})
