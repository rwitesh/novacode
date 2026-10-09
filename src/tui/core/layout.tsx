import { Box, useWindowSize } from "ink"
import type { PropsWithChildren } from "react"

export function Viewport({ children }: PropsWithChildren) {
	const { rows } = useWindowSize()
	// Only immutable Static output may overflow into terminal scrollback.
	return (
		<Box flexDirection="column" width="100%" maxHeight={Math.max(1, rows - 1)} overflowY="hidden">
			{children}
		</Box>
	)
}

export function PromptFrame({ children }: PropsWithChildren) {
	const { rows } = useWindowSize()
	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor="dim"
			padding={1}
			width="100%"
			maxHeight={Math.max(1, rows - 1)}
			overflow="hidden"
		>
			{children}
		</Box>
	)
}
