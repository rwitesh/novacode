import { Box, Text } from "ink"
import { memo } from "react"
import { formatToolArgs } from "../../format.ts"
import type { Msg } from "../../types.ts"
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

const SystemMessage = memo(function SystemMessage({ text }: { text: string }) {
	return <Text>{formatMarkdown(text)}</Text>
})

const AssistantMessage = memo(function AssistantMessage({
	content,
	isAborted,
	termPhrase,
}: {
	content: string
	isAborted: boolean
	termPhrase: string
}) {
	return (
		<Box flexDirection="column" marginTop={0}>
			<Text>{content}</Text>
			{isAborted && (
				<Box marginTop={0}>
					<Text color="red" italic>
						▲ {termPhrase}
					</Text>
				</Box>
			)}
		</Box>
	)
})

const ToolResultMessage = memo(function ToolResultMessage({
	tool,
	args,
	isError,
	resText,
}: {
	tool: string
	args: string
	isError: boolean
	resText: string
}) {
	const isRead = tool === "read"
	const lineCount = isRead ? resText.split("\n").length : 0
	const color = TOOL_STYLE[tool] || "white"

	return (
		<Box flexDirection="row" marginTop={0}>
			<Text color={isError ? "red" : "green"}>{isError ? "✗" : "✓"} </Text>
			<Text color={color} bold>
				{tool}
			</Text>
			{args && <Text> {args}</Text>}
			{isRead && !isError && <Text dimColor> ({lineCount} lines)</Text>}
			{isError && resText && <Text color="red"> {resText.slice(0, 80)}</Text>}
		</Box>
	)
})

export const Message = memo(function Message({ msg, isFirst }: { msg: Msg; isFirst: boolean }) {
	if (msg.role === "user") {
		const content =
			typeof msg.content === "string"
				? msg.content
				: msg.content.map((c) => (c.type === "text" ? c.text : "")).join("")
		return <UserMessage content={content} isFirst={isFirst} />
	}

	if (msg.role === "assistant") {
		if (msg.model === "system") {
			return (
				<Box flexDirection="column" marginTop={0}>
					{msg.content.map((c, i) =>
						// biome-ignore lint/suspicious/noArrayIndexKey: stable turn content
						c.type === "text" ? <SystemMessage key={i} text={c.text} /> : null,
					)}
				</Box>
			)
		}

		const isAborted = msg.stop === "aborted"
		const hasVisibleContent = isAborted || msg.content.some((c) => c.type === "text")
		if (!hasVisibleContent) return null

		const textContent = msg.content
			.filter((c) => c.type === "text")
			.map((c) => c.text)
			.join("")

		const termPhrase = isAborted
			? (TERMINATION_PHRASES[msg.ts % TERMINATION_PHRASES.length] ?? "Terminated by user")
			: ""

		const rendered = formatMarkdown(textContent)
		return <AssistantMessage content={rendered} isAborted={isAborted} termPhrase={termPhrase} />
	}

	if (msg.role === "tool_result") {
		const args = msg.args ? formatToolArgs(msg.args, true) : ""
		const resText = msg.content
			.map((c) => (c.type === "text" ? c.text : ""))
			.join("")
			.trim()

		return <ToolResultMessage tool={msg.tool} args={args} isError={msg.isError} resText={resText} />
	}

	return null
})
