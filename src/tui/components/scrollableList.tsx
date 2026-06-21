import { Box, Text } from "ink"
import { useTheme } from "../theme/index.tsx"

export interface ScrollableListProps<T> {
	items: T[]
	selectedIndex: number
	visibleCount: number
	renderItem: (item: T, index: number, isSelected: boolean) => React.ReactNode
	keyExtractor: (item: T, index: number) => string
	emptyMessage?: string
}

export function ScrollableList<T>({
	items,
	selectedIndex,
	visibleCount,
	renderItem,
	keyExtractor,
	emptyMessage,
}: ScrollableListProps<T>) {
	const theme = useTheme()

	if (items.length === 0) {
		return (
			<Box>
				<Text color={theme.palette.muted}>{emptyMessage ?? "No items"}</Text>
			</Box>
		)
	}

	const maxOffset = Math.max(0, items.length - visibleCount)
	const scrollOffset = Math.max(0, Math.min(selectedIndex, maxOffset))
	const visibleItems = items.slice(scrollOffset, scrollOffset + visibleCount)
	const showScrollbar = items.length > visibleCount
	const scrollbarThumb = Math.round(
		(scrollOffset / (items.length - visibleCount)) * (visibleCount - 1),
	)

	return (
		<Box flexDirection="row" width="100%">
			<Box flexDirection="column" flexGrow={1}>
				{visibleItems.map((item, i) => {
					const actualIndex = scrollOffset + i
					const isSelected = actualIndex === selectedIndex
					return (
						<Box key={keyExtractor(item, actualIndex)}>
							{renderItem(item, actualIndex, isSelected)}
						</Box>
					)
				})}
			</Box>
			{showScrollbar && (
				<Box flexDirection="column" marginLeft={1}>
					<Text color={theme.palette.muted}>
						{scrollbarThumb > 0 ? "░\n".repeat(scrollbarThumb).slice(0, -1) : ""}
					</Text>
					<Text color={theme.palette.primary}>█</Text>
					<Text color={theme.palette.muted}>
						{visibleCount - scrollbarThumb - 1 > 0
							? "░\n".repeat(visibleCount - scrollbarThumb - 1).slice(0, -1)
							: ""}
					</Text>
				</Box>
			)}
		</Box>
	)
}
