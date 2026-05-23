import { Box, Text } from "ink"
import type { Model } from "../../types.ts"

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
	model,
	usage,
	busy,
	suggestions,
	selCmdIdx,
	exitConfirmKey,
}: {
	model: Model
	usage: { in: number; out: number }
	busy: boolean
	suggestions: Array<{ name: string; desc: string }>
	selCmdIdx: number
	exitConfirmKey: "C" | null
}) {
	return (
		<Box justifyContent="space-between">
			<Box>
				{suggestions.length > 0 ? (
					<Box flexDirection="column" marginLeft={2}>
						{suggestions.map((s, i) => (
							<Box key={s.name}>
								<Text
									color={i === selCmdIdx ? "black" : "yellow"}
									backgroundColor={i === selCmdIdx ? "yellow" : undefined}
								>
									/{s.name.padEnd(10)}
								</Text>
								<Text dimColor> {s.desc}</Text>
							</Box>
						))}
					</Box>
				) : exitConfirmKey === "C" ? (
					<Text color="yellow">Press Ctrl+C again to exit</Text>
				) : busy ? (
					<Text dimColor>Press Esc to abort or terminate</Text>
				) : (
					<Text dimColor>Enter to send · /help for commands</Text>
				)}
			</Box>

			<Box>
				<Text dimColor>{formatTokenUsage(usage.in, model.contextWindow)}</Text>
				<Text dimColor> │ </Text>
				<Text dimColor>{model.id}</Text>
				{busy && <Text dimColor> │ Esc to stop</Text>}
			</Box>
		</Box>
	)
}
