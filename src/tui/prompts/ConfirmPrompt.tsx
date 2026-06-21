import { Box, Text, useInput } from "ink"
import { useState } from "react"
import { useTheme } from "../theme/index.tsx"
import { PromptFrame } from "./PromptFrame.tsx"
import { Toggle } from "./Toggle.tsx"

function PromptMessage({ message }: { message: string }) {
	const theme = useTheme()
	return (
		<Box marginBottom={1}>
			<Text bold color={theme.palette.muted}>
				{message}
			</Text>
		</Box>
	)
}

export function ConfirmPrompt({
	message,
	onConfirm,
}: {
	message: string
	onConfirm: (value: boolean | null) => void
}) {
	const [yes, setYes] = useState(true)

	useInput((_, key) => {
		if (key.escape) {
			onConfirm(null)
			return
		}
		if (key.leftArrow || key.rightArrow || key.tab) {
			setYes((y) => !y)
			return
		}
		if (key.return) {
			onConfirm(yes)
		}
	})

	return (
		<PromptFrame>
			<PromptMessage message={message} />
			<Toggle yesLabel="Yes" noLabel="No" selected={yes ? "yes" : "no"} />
			<Box marginTop={1}>
				<Text color={useTheme().palette.muted}>←→ toggle · Enter confirm · Esc cancel</Text>
			</Box>
		</PromptFrame>
	)
}
