import chalk from "chalk"
import { Box, Text } from "ink"
import { useEffect, useState } from "react"
import { SPINNER_FRAMES } from "../constants.ts"
import { formatMarkdown } from "../markdown.ts"

export function Spinner() {
	const [frame, setFrame] = useState(0)

	useEffect(() => {
		const timer = setInterval(() => {
			setFrame((f) => (f + 1) % SPINNER_FRAMES.length)
		}, 80)
		return () => clearInterval(timer)
	}, [])

	return <Text color="yellow">{SPINNER_FRAMES[frame]}</Text>
}

export function Cursor() {
	const [visible, setVisible] = useState(true)
	useEffect(() => {
		const timer = setInterval(() => setVisible((v) => !v), 530)
		return () => clearInterval(timer)
	}, [])
	return <Text color="green">{visible ? "│" : " "}</Text>
}

export function LiveArea({
	stream,
	thinking,
	busy,
	status,
}: {
	stream: string
	thinking: boolean
	busy: boolean
	status: string
}) {
	const isActive = !!(stream || thinking || busy)
	if (!isActive) return null

	return (
		<Box flexDirection="column" marginTop={0}>
			{stream && (
				<Box flexDirection="row">
					<Box flexGrow={1} flexShrink={1}>
						<Text>
							{formatMarkdown(stream)}
							<Cursor />
						</Text>
					</Box>
				</Box>
			)}
			{busy && !stream && !thinking && (
				<Box flexDirection="row">
					<Box marginRight={1}>
						<Spinner />
					</Box>
					<Text dimColor>{status ? status.replace("⏳ ", "") : chalk.yellow("working…")}</Text>
				</Box>
			)}
			{thinking && !stream && (
				<Box flexDirection="row">
					<Box marginRight={1}>
						<Spinner />
					</Box>
					<Text dimColor>{chalk.yellow("Thinking…")}</Text>
				</Box>
			)}
		</Box>
	)
}
