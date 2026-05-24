import { Box, Text } from "ink"
import type { Msg } from "../../types.ts"
import { formatToolArgs } from "../../util.ts"
import { TERMINATION_PHRASES, TOOL_STYLE } from "../constants.ts"
import { formatMarkdown } from "../markdown.ts"

export function hasMeaningfulContent(msg: Msg): boolean {
	if (msg.role === "user") return true
	if (msg.role === "tool_result") return true
	if (msg.role === "assistant") {
		if (msg.model === "system") return true
		if (msg.stop === "aborted") return true
		return msg.content.some((c) => {
			if (c.type === "text") return c.text.trim().length > 0
			return false
		})
	}
	return false
}

export function Message({ msg, isFirst }: { msg: Msg; isFirst: boolean }) {
	if (msg.role === "user") {
		return (
			<Box marginTop={isFirst ? 0 : 1} flexDirection="row">
				<Box flexShrink={0} marginRight={1}>
					<Text bold color="green">
						{">"}
					</Text>
				</Box>
				<Box flexGrow={1} flexShrink={1}>
					<Text>
						{typeof msg.content === "string"
							? msg.content
							: msg.content.map((c) => (c.type === "text" ? c.text : "")).join("")}
					</Text>
				</Box>
			</Box>
		)
	}

	if (msg.role === "assistant") {
		if (msg.model === "system") {
			return (
				<Box flexDirection="column" marginTop={0}>
					{msg.content.map((c, i) =>
						// biome-ignore lint/suspicious/noArrayIndexKey: stable turn content
						c.type === "text" ? <Text key={i}>{formatMarkdown(c.text)}</Text> : null,
					)}
				</Box>
			)
		}

		const isAborted = msg.stop === "aborted"
		const hasVisibleContent = isAborted || msg.content.some((c) => c.type === "text")
		if (!hasVisibleContent) return null

		const termPhrase = isAborted
			? (TERMINATION_PHRASES[msg.ts % TERMINATION_PHRASES.length] ?? "Terminated by user")
			: ""

		return (
			<Box flexDirection="column" marginTop={0}>
				{msg.content.map((c, i) => {
					if (c.type === "text") {
						// biome-ignore lint/suspicious/noArrayIndexKey: stable turn content
						return <Text key={i}>{formatMarkdown(c.text)}</Text>
					}
					return null
				})}
				{isAborted && (
					<Box marginTop={0}>
						<Text color="red" italic>
							▲ {termPhrase}
						</Text>
					</Box>
				)}
			</Box>
		)
	}

	if (msg.role === "tool_result") {
		const args = msg.args ? formatToolArgs(msg.args, true) : ""

		const resText = msg.content
			.map((c) => (c.type === "text" ? c.text : ""))
			.join("")
			.trim()

		const isRead = msg.tool === "read"
		const lineCount = isRead ? resText.split("\n").length : 0
		const color = TOOL_STYLE[msg.tool] || "white"

		return (
			<Box flexDirection="row">
				<Text color={msg.isError ? "red" : "green"}>{msg.isError ? "✗" : "✓"} </Text>
				<Text color={color} bold>
					{msg.tool}
				</Text>
				{args && <Text> {args}</Text>}
				{isRead && !msg.isError && <Text dimColor> ({lineCount} lines)</Text>}
				{msg.isError && resText && <Text color="red"> {resText.slice(0, 80)}</Text>}
			</Box>
		)
	}

	return null
}
