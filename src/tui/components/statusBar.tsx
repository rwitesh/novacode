import { Box, Text } from "ink"
import type { Model, Usage } from "../../types.ts"
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
	usage,
	tip,
}: {
	activity: string
	activityColor: string
	model: Model
	usage: Usage
	tip: string
}) {
	const theme = useTheme()

	return (
		<Box flexDirection="row" flexShrink={0} paddingX={1} backgroundColor={theme.palette.bg}>
			<Text wrap="truncate-end" color={theme.palette.fg}>
				<Text color={activityColor}>{activity}</Text>
				<Text color={theme.palette.muted}> • </Text>
				<Text bold>{model.id}</Text>
				<Text color={theme.palette.muted}> • </Text>
				<Text color={theme.palette.muted}>{formatTokenUsage(usage.in, model.contextWindow)}</Text>
				<Text color={theme.palette.muted}> • </Text>
				<Text color={theme.palette.primary}>Tip: {tip}</Text>
			</Text>
		</Box>
	)
}
