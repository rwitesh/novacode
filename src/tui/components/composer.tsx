import { Box, Text, useWindowSize } from "ink"
import { memo } from "react"
import type { Cmd } from "../../types.ts"
import { Cursor } from "../core/liveArea.tsx"
import { ScrollableList } from "../core/scrollableList.tsx"
import { sanitizeText } from "../helpers.ts"
import { useTheme } from "../theme/index.tsx"

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
		<Box
			flexDirection="column"
			width="100%"
			flexShrink={0}
			maxHeight={Math.max(3, terminalRows - 6)}
			overflowY="hidden"
			backgroundColor={theme.colors.background}
			paddingX={1}
			paddingBottom={1}
			marginTop={1}
		>
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
									backgroundColor={isSelected ? theme.colors.selection.background : undefined}
									color={isSelected ? theme.colors.selection.text : theme.colors.text}
									wrap="truncate-end"
								>
									/{cmd.name.padEnd(12)}
								</Text>
								<Text color={theme.colors.muted}> {cmd.desc}</Text>
							</Box>
						)}
					/>
				</Box>
			)}
			<Box flexDirection="row" paddingY={1}>
				<Box flexShrink={0} marginRight={1}>
					<Text bold color={theme.colors.muted}>
						{"❯"}
					</Text>
				</Box>
				<Box
					flexGrow={1}
					flexShrink={1}
					flexDirection="column"
					justifyContent="flex-end"
					overflowY="hidden"
				>
					<Box flexShrink={0}>
						<Text color={theme.colors.text} wrap="wrap">
							{sanitizeText(input)}
							<Cursor />
						</Text>
					</Box>
				</Box>
			</Box>
		</Box>
	)
})
