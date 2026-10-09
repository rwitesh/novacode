import { Box, Text } from "ink"
import { useTheme } from "../theme/index.tsx"

export function Toggle({
	yesLabel,
	noLabel,
	selected,
}: {
	yesLabel: string
	noLabel: string
	selected: "yes" | "no"
}) {
	const theme = useTheme()
	return (
		<Box flexDirection="row">
			<Text
				bold={selected === "yes"}
				color={selected === "yes" ? theme.colors.selection.text : theme.colors.text}
				backgroundColor={selected === "yes" ? theme.colors.selection.background : undefined}
			>
				{selected === "yes" ? "❯ " : "  "}
				{yesLabel}
			</Text>
			<Text color={theme.colors.muted}> </Text>
			<Text
				bold={selected === "no"}
				color={selected === "no" ? theme.colors.selection.text : theme.colors.text}
				backgroundColor={selected === "no" ? theme.colors.selection.background : undefined}
			>
				{selected === "no" ? "❯ " : "  "}
				{noLabel}
			</Text>
		</Box>
	)
}
