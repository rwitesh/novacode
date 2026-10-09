import { Box, type DOMElement, render, Text, useBoxMetrics, useInput, useWindowSize } from "ink"
import { useEffect, useMemo, useRef, useState } from "react"
import type { ApprovalRequest } from "../types.ts"
import { PromptFrame } from "./core/layout.tsx"
import { Cursor } from "./core/liveArea.tsx"
import { ScrollableList } from "./core/scrollableList.tsx"
import { Toggle } from "./core/Toggle.tsx"
import { deleteLastGrapheme, sanitizeText } from "./helpers.ts"
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

	return (
		<ScrollableList
			items={options}
			selectedIndex={selectedIdx}
			visibleCount={options.length}
			keyExtractor={(opt) => opt.value}
			renderItem={(opt, _idx, isSelected) => (
				<Box flexDirection="row">
					<Text
						wrap="truncate-end"
						bold={isSelected}
						color={isSelected ? theme.palette.bg : theme.palette.fg}
						backgroundColor={isSelected ? theme.palette.primary : undefined}
					>
						{isSelected ? "❯ " : "  "}
						{sanitizeText(opt.label)}
					</Text>
					{opt.hint && isSelected && (
						<Text color={theme.palette.muted}> {sanitizeText(opt.hint)}</Text>
					)}
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
					{sanitizeText(message)}
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
	header: rawHeader,
	footer: rawFooter,
	onSelect,
}: {
	message: string
	options: SelectOption[]
	header?: string
	footer?: string
	onSelect: (value: string | null) => void
}) {
	const theme = useTheme()
	const header = rawHeader && sanitizeText(rawHeader)
	const footer = rawFooter && sanitizeText(rawFooter)
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
					{sanitizeText(message)}
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
	header: rawHeader,
	footer: rawFooter,
	onSelect,
}: {
	message: string
	options: SelectOption[]
	header?: string
	footer?: string
	onSelect: (value: string | null) => void
}) {
	const theme = useTheme()
	const header = rawHeader && sanitizeText(rawHeader)
	const footer = rawFooter && sanitizeText(rawFooter)
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
			setQuery((prev) => deleteLastGrapheme(prev))
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
					{sanitizeText(message)}
				</Text>
			</Box>
			<Box flexDirection="row" marginBottom={1}>
				<Text color={theme.palette.muted}>Search: </Text>
				<Text color={theme.palette.fg}>{sanitizeText(query)}</Text>
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
			setValue((v) => deleteLastGrapheme(v))
			setError("")
			return
		}
		if (ch && !key.ctrl && !key.meta) {
			setValue((v) => v + ch)
			setError("")
		}
	})

	return (
		<PromptFrame>
			<Box marginBottom={1}>
				<Text bold color={theme.palette.muted}>
					{sanitizeText(message)}
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
						✗ {sanitizeText(error)}
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
function ApprovalSummary({
	text,
	onEndChange,
}: {
	text: string
	onEndChange: (atEnd: boolean) => void
}) {
	const theme = useTheme()
	const { rows } = useWindowSize()
	const viewportRef = useRef<DOMElement>(null)
	const contentRef = useRef<DOMElement>(null)
	const viewport = useBoxMetrics(viewportRef)
	const content = useBoxMetrics(contentRef)
	const [offset, setOffset] = useState(0)
	const height = Math.max(1, Math.floor(viewport.height))
	const maxOffset = Math.max(0, Math.ceil(content.height) - height)
	const scrollOffset = Math.min(offset, maxOffset)
	const atEnd = viewport.hasMeasured && content.hasMeasured && scrollOffset === maxOffset

	useEffect(() => {
		onEndChange(atEnd)
	}, [atEnd, onEndChange])

	useInput((_, key) => {
		if (key.upArrow) setOffset(Math.max(0, scrollOffset - 1))
		else if (key.downArrow) setOffset(Math.min(maxOffset, scrollOffset + 1))
		else if (key.pageUp) setOffset(Math.max(0, scrollOffset - height))
		else if (key.pageDown) setOffset(Math.min(maxOffset, scrollOffset + height))
		else if (key.home) setOffset(0)
		else if (key.end) setOffset(maxOffset)
	})

	return (
		<Box flexDirection="column" flexShrink={1} minHeight={2}>
			<Box
				ref={viewportRef}
				flexDirection="column"
				height={Math.min(rows, content.height || text.split("\n").length)}
				minHeight={1}
				flexShrink={1}
				overflowY="hidden"
			>
				<Box ref={contentRef} flexDirection="column" flexShrink={0} marginTop={-scrollOffset}>
					<Text color={theme.palette.fg}>{text}</Text>
				</Box>
			</Box>
			<Box flexShrink={0}>
				<Text color={theme.palette.muted} wrap="truncate-end">
					{maxOffset > 0
						? `↑↓ / PgUp/PgDn scroll · ${scrollOffset + 1}–${Math.min(scrollOffset + height, content.height)}/${content.height}${atEnd ? " · end" : " · more below"}`
						: ""}
				</Text>
			</Box>
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
	const [allow, setAllow] = useState(false)
	const [canApprove, setCanApprove] = useState(false)

	useInput((_, key) => {
		if (key.escape) {
			onResolve(null)
			return
		}
		if (key.leftArrow || key.rightArrow || key.tab) {
			if (canApprove) setAllow((a) => !a)
			return
		}
		if (key.return) onResolve(allow && canApprove)
	})

	return (
		<PromptFrame>
			{req.warning && (
				<Box marginBottom={1}>
					<Text bold color={theme.palette.warning}>
						{sanitizeText(req.warning)}
					</Text>
				</Box>
			)}
			<Box flexDirection="row" flexShrink={0}>
				<Text bold color={theme.palette.warning}>
					Approve?{" "}
				</Text>
				<Text color={theme.palette.muted}>{sanitizeText(req.tool)}</Text>
			</Box>
			<ApprovalSummary text={sanitizeText(req.summary)} onEndChange={setCanApprove} />
			<Box flexShrink={0}>
				<Toggle
					yesLabel="Allow once"
					noLabel="Deny"
					selected={allow && canApprove ? "yes" : "no"}
				/>
			</Box>
			<Box flexShrink={0}>
				<Text color={theme.palette.muted}>
					{canApprove
						? "←→ toggle · Enter confirm · Esc deny"
						: "Scroll to end to enable Allow · Esc deny"}
				</Text>
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
