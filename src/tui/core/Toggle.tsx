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
				color={selected === "yes" ? theme.palette.bg : theme.palette.fg}
				backgroundColor={selected === "yes" ? theme.palette.primary : undefined}
			>
				{selected === "yes" ? "❯ " : "  "}
				{yesLabel}
			</Text>
			<Text color={theme.palette.muted}> </Text>
			<Text
				bold={selected === "no"}
				color={selected === "no" ? theme.palette.bg : theme.palette.fg}
				backgroundColor={selected === "no" ? theme.palette.primary : undefined}
			>
				{selected === "no" ? "❯ " : "  "}
				{noLabel}
			</Text>
		</Box>
	)
}
