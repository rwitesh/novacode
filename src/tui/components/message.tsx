import { Box, Text } from "ink"
import BigText from "ink-big-text"
import { memo } from "react"
import { Spinner } from "../core/liveArea.tsx"
import { isErrorMessage, sanitizeText } from "../helpers.ts"
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
	const lines = sanitizeText(content).split("\n")
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
				<Text key={line} color={theme.colors.muted}>
					{line}
				</Text>
			))}
			{update && (
				<Box marginTop={1}>
					<Text color={theme.colors.success} bold>
						⬆ v{sanitizeText(update.current)} → v{sanitizeText(update.latest)}
					</Text>
					<Text color={theme.colors.muted}> Run /update to upgrade</Text>
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
				backgroundColor={theme.colors.user.background}
			>
				<Text bold color={theme.colors.user.text} wrap="wrap">
					{sanitizeText(content)}
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
	const isError = isErrorMessage(content)
	const text = isError ? sanitizeText(content) : isStreaming ? content : formatMarkdown(content)
	return (
		<Box flexDirection="column" paddingX={1} paddingBottom={1}>
			<Text color={isError ? theme.colors.error : theme.colors.assistant} wrap="wrap">
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
		? theme.colors.warning
		: isFailure
			? theme.colors.error
			: theme.colors.success
	const bullet = isRunning ? "○" : "●"

	return (
		<Box flexDirection="column" paddingX={1} paddingBottom={1}>
			<Box flexDirection="row">
				<Text color={bulletColor}>{bullet} </Text>
				<Text bold color={isFailure ? theme.colors.error : theme.colors.tool}>
					{sanitizeText(event.toolName)}
				</Text>
				<Text color={isFailure ? theme.colors.error : theme.colors.muted}>
					{" "}
					{sanitizeText(event.args)}
				</Text>
				{event.type === "ToolCompleted" && event.resultLineCount !== undefined && (
					<Text color={theme.colors.muted}> ({event.resultLineCount} lines)</Text>
				)}
				{event.type === "ToolCompleted" && event.resultMatchCount !== undefined && (
					<Text color={theme.colors.muted}> ({event.resultMatchCount} matches)</Text>
				)}
			</Box>
			{isFailure && (
				<Box marginLeft={2}>
					<Text color={theme.colors.error}>{sanitizeText(event.error)}</Text>
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
			<Text color={theme.colors.reasoning}>{label}</Text>
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
					<Text color={theme.colors.warning}>⚠ {sanitizeText(event.content)}</Text>
				</Box>
			)

		case "SystemMessage":
			return (
				<Box flexDirection="row" marginBottom={0}>
					<Text color={theme.colors.info}>ℹ {sanitizeText(event.content)}</Text>
				</Box>
			)

		case "Notice":
			return (
				<Box flexDirection="column" paddingX={1} paddingBottom={1}>
					<Text
						color={isErrorMessage(event.content) ? theme.colors.error : theme.colors.text}
						wrap="wrap"
					>
						{sanitizeText(event.content)}
					</Text>
				</Box>
			)

		case "UpdateAvailable":
			return (
				<Box flexDirection="column" marginBottom={1}>
					<Box flexDirection="row">
						<Text color={theme.colors.success} bold>
							⬆ v{sanitizeText(event.current)} → v{sanitizeText(event.latest)}
						</Text>
					</Box>
					<Box marginLeft={2}>
						<Text color={theme.colors.muted}>Run /update to upgrade</Text>
					</Box>
				</Box>
			)

		default:
			return null
	}
})
