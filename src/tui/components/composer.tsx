import { Box, Text, useWindowSize } from "ink"
import { memo } from "react"
import type { Cmd } from "../../types.ts"
import { useTheme } from "../theme/index.tsx"
import { Cursor } from "./liveArea.tsx"
import { ScrollableList } from "./scrollableList.tsx"

export const Composer = memo(function Composer({
	input,
	suggestions,
	selCmdIdx,
}: {
	input: string
	suggestions: Cmd[]
	selCmdIdx: number
}) {
	const theme = useTheme()
	const { rows } = useWindowSize()
	const terminalRows = rows || 24
	const visibleCount = Math.max(3, Math.min(suggestions.length, terminalRows - 5))

	return (
		<Box flexDirection="column" flexShrink={0} backgroundColor={theme.palette.bg} paddingX={1}>
			{suggestions.length > 0 && (
				<Box paddingTop={1}>
					<ScrollableList
						items={suggestions}
						selectedIndex={selCmdIdx}
						visibleCount={visibleCount}
						keyExtractor={(cmd) => cmd.name}
						renderItem={(cmd, _idx, isSelected) => (
							<Box flexDirection="row">
								<Text
									backgroundColor={isSelected ? theme.palette.primary : undefined}
									color={isSelected ? theme.palette.bg : theme.palette.fg}
									wrap="truncate-end"
								>
									/{cmd.name.padEnd(12)}
								</Text>
								<Text color={theme.palette.muted}> {cmd.desc}</Text>
							</Box>
						)}
					/>
				</Box>
			)}
			<Box flexDirection="row" paddingY={1}>
				<Box flexShrink={0} marginRight={1}>
					<Text bold color={theme.palette.muted}>
						{"❯"}
					</Text>
				</Box>
				<Box flexGrow={1} flexShrink={1}>
					<Text color={theme.palette.fg} wrap="wrap">
						{input}
						<Cursor />
					</Text>
				</Box>
			</Box>
		</Box>
	)
})
