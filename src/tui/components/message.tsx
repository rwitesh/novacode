import { Box, Text } from "ink"
import BigText from "ink-big-text"
import { memo } from "react"
import { Spinner } from "../core/liveArea.tsx"
import { formatMarkdown } from "../markdown/index.ts"
import { useTheme } from "../theme/index.tsx"
import type { TimelineEvent } from "../types.ts"

const SplashView = memo(function SplashView({
	content,
	update,
}: {
	content: string
	update?: { current: string; latest: string }
}) {
	const theme = useTheme()
	const lines = content.split("\n")
	return (
		<Box flexDirection="column" marginBottom={0}>
			<BigText
				text="novacode"
				font="block"
				colors={["cyan", "blue"]}
				space={false}
				lineHeight={0}
			/>
			{lines.map((line) => (
				<Text key={line} color={theme.palette.muted}>
					{line}
				</Text>
			))}
			{update && (
				<Box marginTop={1}>
					<Text color={theme.palette.success} bold>
						⬆ v{update.current} → v{update.latest}
					</Text>
					<Text color={theme.palette.muted}> Run /update to upgrade</Text>
				</Box>
			)}
		</Box>
	)
})

const UserMessageView = memo(function UserMessageView({ content }: { content: string }) {
	const theme = useTheme()
	return (
		<Box flexDirection="column" width="100%" marginBottom={1}>
			<Box
				flexDirection="column"
				width="100%"
				paddingX={1}
				paddingY={1}
				backgroundColor={theme.palette.bg}
			>
				<Text bold color={theme.palette.fg} wrap="wrap">
					{content}
				</Text>
			</Box>
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
		<Box flexDirection="column" paddingX={1} paddingBottom={1}>
			<Text color={theme.palette.fg} wrap="wrap">
				{text}
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
		<Box flexDirection="column" paddingX={1} paddingBottom={1}>
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
		<Box flexDirection="row" paddingX={1} paddingBottom={1}>
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
		case "Splash":
			return <SplashView content={event.content} update={event.update} />

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

		case "Notice":
			return (
				<Box flexDirection="column" paddingX={1} paddingBottom={1}>
					<Text wrap="wrap">{event.content}</Text>
				</Box>
			)

		case "UpdateAvailable":
			return (
				<Box flexDirection="column" marginBottom={1}>
					<Box flexDirection="row">
						<Text color={theme.palette.success} bold>
							⬆ v{event.current} → v{event.latest}
						</Text>
					</Box>
					<Box marginLeft={2}>
						<Text color={theme.palette.muted}>Run /update to upgrade</Text>
					</Box>
				</Box>
			)

		default:
			return null
	}
})
