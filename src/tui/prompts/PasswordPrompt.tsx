import { Box, Text, useInput } from "ink"
import { useState } from "react"
import { useTheme } from "../theme/index.tsx"
import { PromptFrame } from "./PromptFrame.tsx"

export function PasswordPrompt({
	message,
	validate,
	onSubmit,
}: {
	message: string
	validate?: (v: string) => string | undefined
	onSubmit: (value: string | null) => void
}) {
	const theme = useTheme()
	const [value, setValue] = useState("")
	const [error, setError] = useState("")

	useInput((ch, key) => {
		if (key.escape) {
			onSubmit(null)
			return
		}
		if (key.return) {
			const err = validate?.(value)
			if (err) {
				setError(err)
				return
			}
			onSubmit(value)
			return
		}
		if (key.backspace || key.delete) {
			setValue((v) => v.slice(0, -1))
			setError("")
			return
		}
		if (ch) {
			setValue((v) => v + ch)
			setError("")
		}
	})

	return (
		<PromptFrame>
			<Box marginBottom={1}>
				<Text bold color={theme.palette.muted}>
					{message}
				</Text>
			</Box>
			<Box flexDirection="row">
				<Text color={theme.palette.muted}>│ </Text>
				<Text bold color={theme.palette.fg}>
					{"*".repeat(value.length)}
				</Text>
				<Text color={theme.palette.muted}>│</Text>
			</Box>
			{error && (
				<Box marginTop={1}>
					<Text bold color={theme.palette.error}>
						✗ {error}
					</Text>
				</Box>
			)}
			<Box marginTop={1}>
				<Text color={theme.palette.muted}>Enter submit · Esc cancel</Text>
			</Box>
		</PromptFrame>
	)
}
