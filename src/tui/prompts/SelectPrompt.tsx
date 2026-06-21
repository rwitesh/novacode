import { Box, Text, useInput } from "ink"
import { useState } from "react"
import { useTheme } from "../theme/index.tsx"
import { OptionList } from "./OptionList.tsx"
import { PromptFrame } from "./PromptFrame.tsx"

interface SelectOption {
	value: string
	label: string
	hint?: string
}

export function SelectPrompt({
	message,
	options,
	header,
	footer,
	onSelect,
}: {
	message: string
	options: SelectOption[]
	header?: string
	footer?: string
	onSelect: (value: string | null) => void
}) {
	const theme = useTheme()
	const [idx, setIdx] = useState(0)

	useInput((_, key) => {
		if (key.escape) {
			onSelect(null)
			return
		}
		if (key.upArrow) {
			setIdx((i) => (i - 1 + options.length) % options.length)
			return
		}
		if (key.downArrow) {
			setIdx((i) => (i + 1) % options.length)
			return
		}
		if (key.return) {
			onSelect(options[idx]?.value ?? null)
		}
	})

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
			<OptionList options={options} selectedIdx={idx} />
			<Box marginTop={1}>
				<Text color={theme.palette.muted}>↑↓ navigate · Enter select · Esc cancel</Text>
			</Box>
			{footer && (
				<Box marginTop={1}>
					<Text color={theme.palette.muted}>{footer}</Text>
				</Box>
			)}
		</PromptFrame>
	)
}
