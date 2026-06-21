import { Box, Text } from "ink"
import { memo } from "react"
import { formatMarkdown } from "../markdown/index.ts"
import { useTheme } from "../theme/index.tsx"
import type { TimelineEvent } from "../types.ts"
import { Cursor, Spinner } from "./liveArea.tsx"

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
		<Box flexDirection="column" paddingX={1} paddingY={1} backgroundColor={theme.palette.bg}>
			<Text bold color={theme.palette.fg} wrap="wrap">
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
