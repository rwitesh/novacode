import { Box, Text, useWindowSize } from "ink"
import { ScrollableList } from "../components/scrollableList.tsx"
import { useTheme } from "../theme/index.tsx"

interface SelectOption {
	value: string
	label: string
	hint?: string
}

export function OptionList({
	options,
	selectedIdx,
}: {
	options: SelectOption[]
	selectedIdx: number
}) {
	const theme = useTheme()
	const { rows } = useWindowSize()
	const terminalRows = rows || 24
	const visibleCount = Math.max(3, Math.min(options.length, terminalRows - 6))

	return (
		<ScrollableList
			items={options}
			selectedIndex={selectedIdx}
			visibleCount={visibleCount}
			keyExtractor={(opt) => opt.value}
			renderItem={(opt, _idx, isSelected) => (
				<Box flexDirection="row">
					<Text
						bold={isSelected}
						color={isSelected ? theme.palette.bg : theme.palette.fg}
						backgroundColor={isSelected ? theme.palette.primary : undefined}
					>
						{isSelected ? "❯ " : "  "}
						{opt.label}
					</Text>
					{opt.hint && isSelected && <Text color={theme.palette.muted}> {opt.hint}</Text>}
				</Box>
			)}
		/>
	)
}
