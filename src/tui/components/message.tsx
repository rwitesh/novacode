import type { ModelMessage, ToolCallPart, ToolResultPart } from "ai"
import { Box, Text } from "ink"
import { memo } from "react"
import { summarizeToolOutput } from "../../content.ts"
import { formatToolArgs } from "../../format.ts"
import { TOOL_STYLE } from "../constants.ts"
import { formatMarkdown } from "../markdown/index.ts"

export function hasMeaningfulContent(msg: ModelMessage): boolean {
	if (msg.role === "user") return true
	if (msg.role === "tool") return msg.content.some((p) => p.type === "tool-result")
	if (typeof msg.content === "string") return msg.content.trim().length > 0
	return msg.content.some((p) => p.type === "text" || p.type === "tool-call")
}
const UserMessage = memo(function UserMessage({
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

const ToolCallLine = memo(function ToolCallLine({ part }: { part: ToolCallPart }) {
	const tool = part.toolName
	const args = formatToolArgs(part.input as Record<string, unknown>, true)
	const color = TOOL_STYLE[tool] ?? "white"
	return (
		<Box flexDirection="row" marginTop={0}>
			<Text dimColor color={color}>
				→ {tool}
			</Text>
			{args && <Text dimColor> {args}</Text>}
		</Box>
	)
})

const ToolResultMessage = memo(function ToolResultMessage({ part }: { part: ToolResultPart }) {
	const { text, isError } = summarizeToolOutput(part.output)
	const tool = part.toolName
	const isRead = tool === "read"
	const lineCount = isRead && !isError ? text.split("\n").length : 0
	const color = TOOL_STYLE[tool] ?? "white"

	return (
		<Box flexDirection="row" marginTop={0}>
			<Text color={isError ? "red" : "green"}>{isError ? "✗" : "✓"} </Text>
			<Text color={color} bold>
				{tool}
			</Text>
			{isRead && !isError && <Text dimColor> ({lineCount} lines)</Text>}
			{isError && text && <Text color="red"> {text.slice(0, 80)}</Text>}
		</Box>
	)
})

export const Message = memo(function Message({
	msg,
	isFirst,
}: {
	msg: ModelMessage
	isFirst: boolean
}) {
	if (msg.role === "user") {
		const content =
			typeof msg.content === "string"
				? msg.content
				: msg.content.map((c) => (c.type === "text" ? c.text : "")).join("")
		return <UserMessage content={content} isFirst={isFirst} />
	}

	if (msg.role === "assistant") {
		const parts =
			typeof msg.content === "string" ? [{ type: "text" as const, text: msg.content }] : msg.content
		const textContent = parts
			.filter((p): p is { type: "text"; text: string } => p.type === "text")
			.map((p) => p.text)
			.join("")
		const toolCalls = parts.filter((p): p is ToolCallPart => p.type === "tool-call")

		if (!textContent.trim() && toolCalls.length === 0) return null

		return (
			<Box flexDirection="column" marginTop={0}>
				{textContent.trim() && <Text>{formatMarkdown(textContent)}</Text>}
				{toolCalls.map((c, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: stable within a message
					<ToolCallLine key={i} part={c} />
				))}
			</Box>
		)
	}

	// tool message: content is always an array of tool-result parts
	if (msg.role !== "tool") return null
	const results = msg.content.filter((p): p is ToolResultPart => p.type === "tool-result")
	if (results.length === 0) return null
	return (
		<Box flexDirection="column">
			{results.map((p, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: stable within a message
				<ToolResultMessage key={i} part={p} />
			))}
		</Box>
	)
})
