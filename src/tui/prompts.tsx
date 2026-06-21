import { Box, render, Text, useInput, useWindowSize } from "ink"
import type { ReactNode } from "react"
import { useMemo, useState } from "react"
import type { ApprovalRequest } from "../types.ts"
import { ScrollableList } from "./components/scrollableList.tsx"
import { defaultTheme, ThemeProvider, useTheme } from "./theme/index.tsx"
import type { PromptMode } from "./types.ts"

interface SelectOption {
	value: string
	label: string
	hint?: string
}

function PromptFrame({ children }: { children: ReactNode }) {
	const theme = useTheme()
	return (
		<Box flexDirection="column" paddingX={1} paddingY={1} backgroundColor={theme.palette.bg}>
			{children}
		</Box>
	)
}

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

function Toggle({
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

export function SearchSelectPrompt({
	message,
	options,
	query,
	selectedIdx,
	header,
	footer,
}: {
	message: string
	options: SelectOption[]
	query: string
	selectedIdx: number
	header?: string
	footer?: string
}) {
	const theme = useTheme()

	const filtered = useMemo(() => {
		const trimmed = query.trim().toLowerCase()
		if (!trimmed) return options
		return options.filter((o) => o.label.toLowerCase().includes(trimmed))
	}, [options, query])

	const sel = Math.min(selectedIdx, Math.max(0, filtered.length - 1))

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

export function PromptOverlay({
	mode,
	searchQuery,
	searchSelectedIdx,
	onResolve,
}: {
	mode: PromptMode
	searchQuery?: string
	searchSelectedIdx?: number
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
					query={searchQuery ?? ""}
					selectedIdx={searchSelectedIdx ?? 0}
					header={mode.header}
					footer={mode.footer}
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

// Standalone wrappers for use outside the main TUI (e.g. onboarding)

export function standaloneSelect(
	message: string,
	options: SelectOption[],
	header?: string,
	footer?: string,
): Promise<string | null> {
	return new Promise((resolve) => {
		const { unmount } = render(
			<ThemeProvider theme={defaultTheme}>
				<SelectPrompt
					message={message}
					options={options}
					header={header}
					footer={footer}
					onSelect={(v) => {
						unmount()
						resolve(v)
					}}
				/>
			</ThemeProvider>,
		)
	})
}

export function standalonePassword(
	message: string,
	validate?: (v: string) => string | undefined,
): Promise<string | null> {
	return new Promise((resolve) => {
		const { unmount } = render(
			<ThemeProvider theme={defaultTheme}>
				<PasswordPrompt
					message={message}
					validate={validate}
					onSubmit={(v) => {
						unmount()
						resolve(v)
					}}
				/>
			</ThemeProvider>,
		)
	})
}
