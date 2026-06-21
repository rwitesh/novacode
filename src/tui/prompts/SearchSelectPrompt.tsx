import { Box, Text } from "ink"
import { useMemo } from "react"
import { useTheme } from "../theme/index.tsx"
import { OptionList } from "./OptionList.tsx"
import { PromptFrame } from "./PromptFrame.tsx"

interface SelectOption {
	value: string
	label: string
	hint?: string
}

export function SearchSelectPrompt({
	message,
	options,
	query,
	selectedIdx,
	header,
	footer,
}: {
	message: string
	options: SelectOption[]
	query: string
	selectedIdx: number
	header?: string
	footer?: string
}) {
	const theme = useTheme()

	const filtered = useMemo(() => {
		const trimmed = query.trim().toLowerCase()
		if (!trimmed) return options
		return options.filter((o) => o.label.toLowerCase().includes(trimmed))
	}, [options, query])

	const sel = Math.min(selectedIdx, Math.max(0, filtered.length - 1))

	return (
		<PromptFrame>
			{header && (
				<Box marginBottom={1}>
					<Text color={theme.palette.muted}>{header}</Text>
				</Box>
			)}
			<Box marginBottom={1}>
				<Text bold color={theme.palette.muted}>
					{message}
				</Text>
			</Box>
			{filtered.length === 0 ? (
				<Box>
					<Text color={theme.palette.muted}>No matches</Text>
				</Box>
			) : (
				<OptionList options={filtered} selectedIdx={sel} />
			)}
			<Box marginTop={1}>
				<Text color={theme.palette.muted}>
					type to filter · ↑↓ navigate · Enter select · Esc cancel
				</Text>
			</Box>
			{footer && (
				<Box marginTop={1}>
					<Text color={theme.palette.muted}>{footer}</Text>
				</Box>
			)}
		</PromptFrame>
	)
}
