import { Text, useAnimation } from "ink"
import { SPINNER_FRAMES } from "../constants.ts"
import { useTheme } from "../theme/index.tsx"

export function Spinner() {
	const theme = useTheme()
	const { frame } = useAnimation({ interval: 80 })
	return <Text color={theme.palette.primary}>{SPINNER_FRAMES[frame % SPINNER_FRAMES.length]}</Text>
}

export function Cursor() {
	const theme = useTheme()
	const { frame } = useAnimation({ interval: 530 })
	return <Text color={theme.palette.muted}>{frame % 2 === 0 ? "█" : " "}</Text>
}
