import { Box, type DOMElement, Text, useBoxMetrics } from "ink"
import { useRef } from "react"
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
	const ref = useRef<DOMElement>(null)
	const { height, hasMeasured } = useBoxMetrics(ref)
	const capacity = Math.max(1, Math.min(items.length, visibleCount))
	const count = hasMeasured ? Math.max(1, Math.min(capacity, Math.floor(height))) : capacity

	if (items.length === 0) {
		return (
			<Box>
				<Text color={theme.palette.muted}>{emptyMessage ?? "No items"}</Text>
			</Box>
		)
	}

	const maxOffset = Math.max(0, items.length - count)
	const scrollOffset = Math.max(0, Math.min(selectedIndex, maxOffset))
	const visibleItems = items.slice(scrollOffset, scrollOffset + count)
	const showScrollbar = items.length > count
	const scrollbarThumb = Math.round((scrollOffset / (items.length - count)) * (count - 1))

	return (
		<Box
			ref={ref}
			flexDirection="row"
			width="100%"
			height={capacity}
			minHeight={1}
			flexShrink={1}
			overflow="hidden"
		>
			<Box flexDirection="column" flexGrow={1} flexShrink={1}>
				{visibleItems.map((item, i) => {
					const actualIndex = scrollOffset + i
					const isSelected = actualIndex === selectedIndex
					return (
						<Box key={keyExtractor(item, actualIndex)} height={1} flexShrink={0}>
							{renderItem(item, actualIndex, isSelected)}
						</Box>
					)
				})}
			</Box>
			{showScrollbar && (
				<Box flexDirection="column" marginLeft={1}>
					{scrollbarThumb > 0 && (
						<Text color={theme.palette.muted}>{"░\n".repeat(scrollbarThumb).slice(0, -1)}</Text>
					)}
					<Text color={theme.palette.primary}>█</Text>
					{count - scrollbarThumb - 1 > 0 && (
						<Text color={theme.palette.muted}>
							{"░\n".repeat(count - scrollbarThumb - 1).slice(0, -1)}
						</Text>
					)}
				</Box>
			)}
		</Box>
	)
}
