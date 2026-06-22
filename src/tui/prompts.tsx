import { Box, render, Text, useInput, useWindowSize } from "ink"
import { useMemo, useState } from "react"
import type { ApprovalRequest } from "../types.ts"
import { Cursor } from "./core/liveArea.tsx"
import { PromptFrame } from "./core/PromptFrame.tsx"
import { ScrollableList } from "./core/scrollableList.tsx"
import { Toggle } from "./core/Toggle.tsx"
import { useTheme } from "./theme/index.tsx"
import type { PromptMode } from "./types.ts"

interface SelectOption {
	value: string
	label: string
	hint?: string
}

// Sub-component: OptionList
function OptionList({ options, selectedIdx }: { options: SelectOption[]; selectedIdx: number }) {
	const theme = useTheme()
	const { rows } = useWindowSize()
	const terminalRows = rows || 24
	const visibleCount = Math.max(3, Math.min(options.length, terminalRows - 6))

	return (
		<ScrollableList
			items={options}
			selectedIndex={selectedIdx}
			visibleCount={visibleCount}
			keyExtractor={(opt) => opt.value}
			renderItem={(opt, _idx, isSelected) => (
				<Box flexDirection="row">
					<Text
						bold={isSelected}
						color={isSelected ? theme.palette.bg : theme.palette.fg}
						backgroundColor={isSelected ? theme.palette.primary : undefined}
					>
						{isSelected ? "❯ " : "  "}
						{opt.label}
					</Text>
					{opt.hint && isSelected && <Text color={theme.palette.muted}> {opt.hint}</Text>}
				</Box>
			)}
		/>
	)
}

// Prompt: ConfirmPrompt
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
			<Box marginBottom={1}>
				<Text bold color={useTheme().palette.muted}>
					{message}
				</Text>
			</Box>
			<Toggle yesLabel="Yes" noLabel="No" selected={yes ? "yes" : "no"} />
			<Box marginTop={1}>
				<Text color={useTheme().palette.muted}>←→ toggle · Enter confirm · Esc cancel</Text>
			</Box>
		</PromptFrame>
	)
}

// Prompt: SelectPrompt
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
	const theme = useTheme()
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
		<PromptFrame>
			{header && (
				<Box marginBottom={1}>
					<Text color={theme.palette.muted}>{header}</Text>
				</Box>
			)}
			<Box marginBottom={1}>
				<Text bold color={theme.palette.muted}>
					{message}
				</Text>
			</Box>
			<OptionList options={options} selectedIdx={idx} />
			<Box marginTop={1}>
				<Text color={theme.palette.muted}>↑↓ navigate · Enter select · Esc cancel</Text>
			</Box>
			{footer && (
				<Box marginTop={1}>
					<Text color={theme.palette.muted}>{footer}</Text>
				</Box>
			)}
		</PromptFrame>
	)
}

// Prompt: SearchSelectPrompt
export function SearchSelectPrompt({
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
	const theme = useTheme()
	const [query, setQuery] = useState("")
	const [selectedIdx, setSelectedIdx] = useState(0)

	const filtered = useMemo(() => {
		const trimmed = query.trim().toLowerCase()
		if (!trimmed) return options
		return options.filter((o) => o.label.toLowerCase().includes(trimmed))
	}, [options, query])

	const sel = Math.min(selectedIdx, Math.max(0, filtered.length - 1))

	useInput((ch, key) => {
		if (key.escape) {
			onSelect(null)
			return
		}
		if (key.return) {
			if (filtered.length > 0) {
				onSelect(filtered[sel]?.value ?? null)
			}
			return
		}
		if (key.upArrow) {
			setSelectedIdx((prev) =>
				filtered.length === 0 ? 0 : (prev - 1 + filtered.length) % filtered.length,
			)
			return
		}
		if (key.downArrow) {
			setSelectedIdx((prev) => (filtered.length === 0 ? 0 : (prev + 1) % filtered.length))
			return
		}
		if (key.backspace || key.delete) {
			setQuery((prev) => prev.slice(0, -1))
			setSelectedIdx(0)
			return
		}
		if (ch && !key.ctrl && !key.meta) {
			setQuery((prev) => prev + ch)
			setSelectedIdx(0)
		}
	})

	return (
		<PromptFrame>
			{header && (
				<Box marginBottom={1}>
					<Text color={theme.palette.muted}>{header}</Text>
				</Box>
			)}
			<Box marginBottom={1}>
				<Text bold color={theme.palette.muted}>
					{message}
				</Text>
			</Box>
			<Box flexDirection="row" marginBottom={1}>
				<Text color={theme.palette.muted}>Search: </Text>
				<Text color={theme.palette.fg}>{query}</Text>
				<Cursor />
			</Box>
			{filtered.length === 0 ? (
				<Box>
					<Text color={theme.palette.muted}>No matches</Text>
				</Box>
			) : (
				<OptionList options={filtered} selectedIdx={sel} />
			)}
			<Box marginTop={1}>
				<Text color={theme.palette.muted}>
					type to filter · ↑↓ navigate · Enter select · Esc cancel
				</Text>
			</Box>
			{footer && (
				<Box marginTop={1}>
					<Text color={theme.palette.muted}>{footer}</Text>
				</Box>
			)}
		</PromptFrame>
	)
}

// Prompt: PasswordPrompt
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

// Prompt: ApprovalPrompt
export function ApprovalPrompt({
	req,
	onResolve,
}: {
	req: ApprovalRequest
	onResolve: (allow: boolean | null) => void
}) {
	const theme = useTheme()
	const [allow, setAllow] = useState(true)

	useInput((_, key) => {
		if (key.escape) {
			onResolve(null)
			return
		}
		if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.tab) {
			setAllow((a) => !a)
			return
		}
		if (key.return) {
			onResolve(allow)
		}
	})

	return (
		<PromptFrame>
			{req.warning && (
				<Box marginBottom={1}>
					<Text bold color={theme.palette.warning}>
						{req.warning}
					</Text>
				</Box>
			)}
			<Box flexDirection="row" marginBottom={1}>
				<Text bold color={theme.palette.warning}>
					Approve?{" "}
				</Text>
				<Text color={theme.palette.muted}>{req.summary}</Text>
			</Box>
			<Toggle yesLabel="Allow once" noLabel="Deny" selected={allow ? "yes" : "no"} />
			<Box marginTop={1}>
				<Text color={theme.palette.muted}>←→ toggle · Enter confirm · Esc deny</Text>
			</Box>
		</PromptFrame>
	)
}

// Prompts overlay switcher
export function PromptOverlay({
	mode,
	onResolve,
}: {
	mode: PromptMode
	onResolve: (value: unknown) => void
}) {
	switch (mode.type) {
		case "select":
			return (
				<SelectPrompt
					message={mode.message}
					options={mode.options}
					header={mode.header}
					footer={mode.footer}
					onSelect={onResolve}
				/>
			)
		case "searchSelect":
			return (
				<SearchSelectPrompt
					message={mode.message}
					options={mode.options}
					header={mode.header}
					footer={mode.footer}
					onSelect={onResolve}
				/>
			)
		case "password":
			return <PasswordPrompt message={mode.message} validate={mode.validate} onSubmit={onResolve} />
		case "confirm":
			return <ConfirmPrompt message={mode.message} onConfirm={onResolve} />
		case "approval":
			return <ApprovalPrompt req={mode.req} onResolve={onResolve} />
		default:
			return null
	}
}

// Standalone prompt runners (for onboarding etc.)
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
