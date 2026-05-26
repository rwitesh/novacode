import { Box, render, Text, useInput } from "ink"
import { useState } from "react"

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
		<Box flexDirection="column" paddingX={1}>
			{header && (
				<Box marginBottom={1}>
					<Text>{header}</Text>
				</Box>
			)}
			<Box marginBottom={1}>
				<Text bold>{message}</Text>
			</Box>
			{options.map((opt, i) => (
				<Box key={opt.value}>
					<Text color={i === idx ? "green" : undefined}>
						{i === idx ? "❯ " : "  "}
						{opt.label}
					</Text>
					{opt.hint && i === idx && <Text dimColor> {opt.hint}</Text>}
				</Box>
			))}
			<Box marginTop={1}>
				<Text dimColor>↑↓ navigate · Enter select · Esc cancel</Text>
			</Box>
			{footer && (
				<Box marginTop={1}>
					<Text>{footer}</Text>
				</Box>
			)}
		</Box>
	)
}

export function PasswordPrompt({
	message,
	validate,
	onSubmit,
}: {
	message: string
	validate?: (v: string) => string | undefined
	onSubmit: (value: string | null) => void
}) {
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
		<Box flexDirection="column" paddingX={1}>
			<Box marginBottom={1}>
				<Text bold>{message}</Text>
			</Box>
			<Box>
				<Text color="green">│ </Text>
				<Text dimColor>{"*".repeat(value.length)}</Text>
				<Text color="green">│</Text>
			</Box>
			{error && (
				<Box>
					<Text color="red">{error}</Text>
				</Box>
			)}
			<Box marginTop={1}>
				<Text dimColor>Enter submit · Esc cancel</Text>
			</Box>
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
		<Box flexDirection="column" paddingX={1}>
			<Box marginBottom={1}>
				<Text bold>{message}</Text>
			</Box>
			<Box>
				<Text color={yes ? "green" : undefined}>{yes ? "❯ " : "  "}Yes</Text>
			</Box>
			<Box>
				<Text color={!yes ? "red" : undefined}>{!yes ? "❯ " : "  "}No</Text>
			</Box>
			<Box marginTop={1}>
				<Text dimColor>←→ toggle · Enter confirm · Esc cancel</Text>
			</Box>
		</Box>
	)
}

// Standalone wrappers for use outside the main TUI (e.g. onboarding)

export function standaloneSelect(
	message: string,
	options: SelectOption[],
	header?: string,
	footer?: string,
): Promise<string | null> {
	return new Promise((resolve) => {
		const { unmount } = render(
			<SelectPrompt
				message={message}
				options={options}
				header={header}
				footer={footer}
				onSelect={(v) => {
					unmount()
					resolve(v)
				}}
			/>,
		)
	})
}

export function standalonePassword(
	message: string,
	validate?: (v: string) => string | undefined,
): Promise<string | null> {
	return new Promise((resolve) => {
		const { unmount } = render(
			<PasswordPrompt
				message={message}
				validate={validate}
				onSubmit={(v) => {
					unmount()
					resolve(v)
				}}
			/>,
		)
	})
}
