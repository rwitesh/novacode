import { Box } from "ink"
import type { PropsWithChildren } from "react"

export function PromptFrame({ children }: PropsWithChildren) {
	return (
		<Box flexDirection="column" borderStyle="round" borderColor="dim" padding={1} width="100%">
			{children}
		</Box>
	)
}
