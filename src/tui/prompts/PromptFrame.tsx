import { Box } from "ink"
import type { ReactNode } from "react"
import { useTheme } from "../theme/index.tsx"

export function PromptFrame({ children }: { children: ReactNode }) {
	const theme = useTheme()
	return (
		<Box flexDirection="column" paddingX={1} paddingY={1} backgroundColor={theme.palette.bg}>
			{children}
		</Box>
	)
}
