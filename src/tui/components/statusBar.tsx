import { Box, Text } from "ink"
import type { Model } from "../../types.ts"
import { useTheme } from "../theme/index.tsx"

function fmtK(n: number): string {
	const k = n / 1000
	return k >= 100 ? `${Math.round(k)}K` : `${k.toFixed(1)}K`
}

function formatTokenUsage(used: number, contextWindow: number): string {
	if (used === 0) return `0/${fmtK(contextWindow)}`
	const pct = Math.round((used / contextWindow) * 100)
	return `${fmtK(used)}/${fmtK(contextWindow)} (${pct}%)`
}

export function StatusBar({
	activity,
	activityColor,
	model,
	contextTokens,
	tip,
}: {
	activity: string
	activityColor: string
	model: Model
	contextTokens: number
	tip: string
}) {
	const theme = useTheme()

	return (
		<Box
			flexDirection="row"
			width="100%"
			flexShrink={0}
			paddingX={1}
			paddingBottom={1}
			backgroundColor={theme.palette.bg}
		>
			<Text color={activityColor}>{activity}</Text>
			<Text color={theme.palette.muted}> • Tip: </Text>
			<Text color={theme.palette.primary}>{tip}</Text>
			<Box flexGrow={1} />
			<Text color={theme.palette.muted}>
				{formatTokenUsage(contextTokens, model.contextWindow)}
			</Text>
			<Text color={theme.palette.muted}> • </Text>
			<Text bold color={theme.palette.fg}>
				{model.id}
			</Text>
		</Box>
	)
}
