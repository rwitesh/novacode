import { Box, Text } from "ink"
import type { Effort, Model, PermissionMode, Usage } from "../../types.ts"

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
	effort,
	usage,
	busy,
	suggestions,
	selCmdIdx,
	exitConfirmKey,
	tip,
	permissionMode,
}: {
	model: Model
	effort: Effort
	usage: Usage
	busy: boolean
	suggestions: Array<{ name: string; desc: string }>
	selCmdIdx: number
	exitConfirmKey: "C" | null
	tip: string | null
	permissionMode: PermissionMode
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
									/{s.name.padEnd(12)}
								</Text>
								<Text dimColor> {s.desc}</Text>
							</Box>
						))}
					</Box>
				) : exitConfirmKey === "C" ? (
					<Text color="yellow">Press Ctrl+C again to exit</Text>
				) : busy ? (
					<Box>
						<Text dimColor>Esc abort</Text>
						{tip && (
							<>
								<Text dimColor> · </Text>
								<Text color="cyan" dimColor>
									{tip}
								</Text>
							</>
						)}
					</Box>
				) : (
					<Text dimColor>Enter to send · /help for commands</Text>
				)}
			</Box>

			<Box>
				<Text color={permissionMode === "restricted" ? "yellow" : "green"}>●</Text>
				<Text dimColor> {permissionMode}</Text>
				<Text dimColor> │ </Text>
				<Text dimColor>{formatTokenUsage(usage.in, model.contextWindow)}</Text>
				<Text dimColor> │ </Text>
				<Text dimColor>{model.id}</Text>
				{model.supportsThinking && (
					<>
						<Text dimColor> </Text>
						<Text dimColor>{effort}</Text>
					</>
				)}
			</Box>
		</Box>
	)
}
