import type { ModelMessage, ToolResultPart } from "ai"
import { Box, Text } from "ink"
import { memo } from "react"
import { summarizeToolOutput } from "../../content.ts"
import { formatToolArgs } from "../../format.ts"
import { formatMarkdown } from "../markdown/index.ts"
import { useTheme } from "../theme/index.tsx"
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
			if (content.trim()) {
				events.push({
					id: `user-${i}`,
					type: "UserMessage",
					content,
				})
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

const SessionStartedView = memo(function SessionStartedView({ content }: { content: string }) {
	const theme = useTheme()
	return (
		<Box flexDirection="column" marginY={1}>
			<Text color={theme.palette.muted}>{content}</Text>
		</Box>
	)
})

const UserMessageView = memo(function UserMessageView({ content }: { content: string }) {
	const theme = useTheme()
	return (
		<Box flexDirection="column" alignItems="flex-start" marginTop={1} marginBottom={1}>
			<Text bold color={theme.palette.primary} wrap="wrap">
				{content}
			</Text>
		</Box>
	)
})

const AssistantMessageView = memo(function AssistantMessageView({
	content,
	isStreaming = false,
}: {
	content: string
	isStreaming?: boolean
}) {
	const theme = useTheme()
	const text = isStreaming ? content : formatMarkdown(content)
	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text color={theme.palette.fg} wrap="wrap">
				{text}
				{isStreaming && <Cursor />}
			</Text>
		</Box>
	)
})

const ToolEventView = memo(function ToolEventView({ event }: { event: TimelineEvent }) {
	const theme = useTheme()
	if (
		event.type !== "ToolStarted" &&
		event.type !== "ToolCompleted" &&
		event.type !== "ToolFailed"
	) {
		return null
	}

	const isRunning = event.type === "ToolStarted"
	const isFailure = event.type === "ToolFailed"
	const bulletColor = isRunning
		? theme.palette.warning
		: isFailure
			? theme.palette.error
			: theme.palette.success
	const bullet = isRunning ? "○" : "●"

	return (
		<Box flexDirection="column" marginBottom={0}>
			<Box flexDirection="row">
				<Text color={bulletColor}>{bullet} </Text>
				<Text bold color={theme.palette.primary}>
					{event.toolName}
				</Text>
				<Text color={theme.palette.muted}> {event.args}</Text>
				{event.type === "ToolCompleted" && event.resultLineCount !== undefined && (
					<Text color={theme.palette.muted}> ({event.resultLineCount} lines)</Text>
				)}
				{event.type === "ToolCompleted" && event.resultMatchCount !== undefined && (
					<Text color={theme.palette.muted}> ({event.resultMatchCount} matches)</Text>
				)}
			</Box>
			{isFailure && (
				<Box marginLeft={2}>
					<Text color={theme.palette.error}>{event.error}</Text>
				</Box>
			)}
		</Box>
	)
})

const ThinkingView = memo(function ThinkingView({ label }: { label: string }) {
	const theme = useTheme()
	return (
		<Box flexDirection="row" marginBottom={0}>
			<Box marginRight={1}>
				<Spinner />
			</Box>
			<Text color={theme.palette.warning}>{label}</Text>
		</Box>
	)
})

export const EventRenderer = memo(function EventRenderer({ event }: { event: TimelineEvent }) {
	const theme = useTheme()
	switch (event.type) {
		case "SessionStarted":
			return <SessionStartedView content={event.content} />

		case "UserMessage":
			return <UserMessageView content={event.content} />

		case "AssistantMessage":
			return (
				<AssistantMessageView content={event.content} isStreaming={event.id === "active-text"} />
			)

		case "ToolStarted":
		case "ToolCompleted":
		case "ToolFailed":
			return <ToolEventView event={event} />

		case "Thinking": {
			const label = event.id === "active-working" ? "Working…" : "Thinking…"
			return <ThinkingView label={label} />
		}

		case "Warning":
			return (
				<Box flexDirection="row" marginBottom={0}>
					<Text color={theme.palette.warning}>⚠ {event.content}</Text>
				</Box>
			)

		case "SystemMessage":
			return (
				<Box flexDirection="row" marginBottom={0}>
					<Text color={theme.palette.primary}>ℹ {event.content}</Text>
				</Box>
			)

		default:
			return null
	}
})
