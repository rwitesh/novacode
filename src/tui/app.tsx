import chalk from "chalk"
import { Box, render, Static, Text, useInput } from "ink"
import { useCallback, useEffect, useRef, useState } from "react"
import type { Agent } from "../agent/agent.ts"
import { COMMANDS, dispatch } from "../commands/index.ts"
import type { SessionStore } from "../session/store.ts"
import type { Msg, Prompts } from "../types.ts"
import { checkForUpdate, getCurrentVersion } from "../update.ts"
import { formatToolArgs } from "../util.ts"
import { formatMarkdown } from "./markdown.ts"
import { ConfirmPrompt, PasswordPrompt, SelectPrompt } from "./prompts.tsx"

type PromptMode =
	| { type: "chat" }
	| {
			type: "select"
			message: string
			options: Array<{ value: string; label: string; hint?: string }>
			header?: string
	  }
	| {
			type: "password"
			message: string
			validate?: (v: string) => string | undefined
	  }
	| { type: "confirm"; message: string }

export async function interactive(
	agent: Agent,
	store: SessionStore,
	sessionId: string,
): Promise<void> {
	process.stdout.write("\x1B[?25l")
	const version = await getCurrentVersion()
	process.stdout.write(`${chalk.cyan.bold("⚡ novacode")} ${chalk.gray(`v${version}`)}\n`)

	try {
		const { waitUntilExit } = render(<App agent={agent} store={store} sessionId={sessionId} />)
		await waitUntilExit()
	} finally {
		process.stdout.write("\x1B[?25h")
	}
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

function Spinner() {
	const [frame, setFrame] = useState(0)

	useEffect(() => {
		const timer = setInterval(() => {
			setFrame((f) => (f + 1) % SPINNER_FRAMES.length)
		}, 80)
		return () => clearInterval(timer)
	}, [])

	return <Text color="yellow">{SPINNER_FRAMES[frame]}</Text>
}

function Cursor() {
	const [visible, setVisible] = useState(true)
	useEffect(() => {
		const timer = setInterval(() => setVisible((v) => !v), 530)
		return () => clearInterval(timer)
	}, [])
	return <Text color="green">{visible ? "│" : " "}</Text>
}

function App({
	agent: initialAgent,
	store,
	sessionId,
}: {
	agent: Agent
	store: SessionStore
	sessionId: string
}) {
	const [agent, _setAgent] = useState(initialAgent)
	const [msgs, setMsgs] = useState<Msg[]>(initialAgent.messages)
	const [stream, setStream] = useState("")
	const [thinkStream, setThinkStream] = useState("")
	const [busy, setBusy] = useState(false)
	const [input, setInput] = useState("")
	const [status, setStatus] = useState("")
	const [usage, setUsage] = useState<{ in: number; out: number }>({
		in: 0,
		out: 0,
	})
	const [selCmdIdx, setSelCmdIdx] = useState(0)
	const [mode, setMode] = useState<PromptMode>({ type: "chat" })
	const resolveRef = useRef<((v: unknown) => void) | null>(null)
	const history = useRef<string[]>([])
	const hIdx = useRef(-1)
	const abortCtrl = useRef<AbortController | null>(null)
	const [updateInfo, setUpdateInfo] = useState<{
		current: string
		latest: string
	} | null>(null)

	useEffect(() => {
		const check = async () => {
			const info = await checkForUpdate()
			if (info?.hasUpdate) {
				setUpdateInfo({ current: info.current, latest: info.latest })
			}
		}
		check()
	}, [])

	const isTypingCmd = input.startsWith("/") && !input.includes(" ")
	const suggestions = isTypingCmd
		? COMMANDS.filter(
				(c) =>
					c.name.startsWith(input.slice(1).toLowerCase()) ||
					c.aliases?.some((a) => a.startsWith(input.slice(1).toLowerCase())),
			)
		: []

	const prompts: Prompts = {
		select: useCallback(
			(config) =>
				new Promise((resolve) => {
					resolveRef.current = resolve as (v: unknown) => void
					setMode({ type: "select", ...config })
				}),
			[],
		),
		password: useCallback(
			(config) =>
				new Promise((resolve) => {
					resolveRef.current = resolve as (v: unknown) => void
					setMode({ type: "password", ...config })
				}),
			[],
		),
		confirm: useCallback(
			(config) =>
				new Promise((resolve) => {
					resolveRef.current = resolve as (v: unknown) => void
					setMode({ type: "confirm", ...config })
				}),
			[],
		),
	}

	function resolvePrompt(value: unknown) {
		const fn = resolveRef.current
		resolveRef.current = null
		setMode({ type: "chat" })
		fn?.(value)
	}

	function commitMsg(msg: Msg) {
		setMsgs((prev) => [...prev, msg])
		agent.setMessages([...agent.messages, msg])
		store.append(sessionId, msg)
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset selection on input change
	useEffect(() => {
		setSelCmdIdx(0)
	}, [input])

	useInput((ch, key) => {
		if (mode.type !== "chat") return

		if (key.escape) {
			if (abortCtrl.current) {
				abortCtrl.current.abort()
				abortCtrl.current = null
			}
			return
		}
		if (key.upArrow) {
			if (isTypingCmd && suggestions.length > 0) {
				setSelCmdIdx((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1))
				return
			}
			if (history.current.length > 0) {
				hIdx.current = Math.min(hIdx.current + 1, history.current.length - 1)
				setInput(history.current[hIdx.current] ?? "")
			}
			return
		}
		if (key.downArrow) {
			if (isTypingCmd && suggestions.length > 0) {
				setSelCmdIdx((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0))
				return
			}
			hIdx.current = Math.max(hIdx.current - 1, -1)
			setInput(hIdx.current >= 0 ? (history.current[hIdx.current] ?? "") : "")
			return
		}
		if (key.tab) {
			if (isTypingCmd && suggestions.length > 0) {
				const match = suggestions[selCmdIdx]
				if (match) {
					setInput(`/${match.name} `)
				}
			}
			return
		}
		if (!key.return) {
			setInput((prev) => {
				if (key.backspace || key.delete) return prev.slice(0, -1)
				return prev + (ch || "")
			})
			return
		}

		if (busy) return

		let line = input.trim()
		if (!line) return

		if (isTypingCmd && suggestions.length > 0) {
			const match = suggestions[selCmdIdx]
			if (match) {
				line = `/${match.name}`
			}
		}

		setInput("")
		history.current.unshift(line)
		hIdx.current = -1

		if (line.startsWith("/")) {
			dispatch(line, agent, store, sessionId, prompts).then((r) => {
				if (r) {
					commitMsg({
						role: "assistant",
						content: [{ type: "text", text: r }],
						model: "system",
						provider: "system",
						usage: { in: 0, out: 0 },
						stop: "stop",
						ts: Date.now(),
					})
				}
			})
			return
		}

		// Record user message before starting the stream
		const userMsg: Msg = { role: "user", content: line, ts: Date.now() }
		commitMsg(userMsg)

		abortCtrl.current = new AbortController()
		const eventStream = agent.prompt(line, abortCtrl.current.signal)

		runEventLoop(eventStream)
	})

	async function runEventLoop(eventStream: ReturnType<Agent["prompt"]>) {
		try {
			for await (const ev of eventStream) {
				switch (ev.type) {
					case "start":
						setBusy(true)
						setStream("")
						setThinkStream("")
						setStatus("")
						break
					case "text_delta":
						if (ev.text) setStream((prev) => prev + ev.text)
						break
					case "thinking_delta":
						if (ev.text) setThinkStream((prev) => prev + ev.text)
						break
					case "assistant_msg":
						commitMsg(ev.msg)
						setTimeout(() => {
							setStream("")
							setThinkStream("")
						}, 0)
						break
					case "tool_call":
						setStatus(chalk.dim(`⏳ ${ev.call.name}…`))
						break
					case "tool_result":
						commitMsg(ev.result)
						setStatus(
							ev.result.isError
								? chalk.red(`✗ ${ev.result.tool}`)
								: chalk.green(`✓ ${ev.result.tool}`),
						)
						break
					case "turn_end":
						setStatus("")
						break
					case "usage":
						if (ev.usage) setUsage(ev.usage)
				}
			}
		} catch (err) {
			const errMsg: Msg = {
				role: "assistant",
				model: "system",
				provider: "system",
				content: [{ type: "text", text: chalk.red(`Error: ${(err as Error).message}`) }],
				usage: { in: 0, out: 0 },
				stop: "error",
				ts: Date.now(),
			}
			commitMsg(errMsg)
		} finally {
			abortCtrl.current = null
			setBusy(false)
			setStream("")
			setThinkStream("")
			setStatus("")
		}
	}

	if (mode.type === "select") {
		return (
			<SelectPrompt
				message={mode.message}
				options={mode.options}
				header={mode.header}
				onSelect={resolvePrompt}
			/>
		)
	}
	if (mode.type === "password") {
		return (
			<PasswordPrompt message={mode.message} validate={mode.validate} onSubmit={resolvePrompt} />
		)
	}
	if (mode.type === "confirm") {
		return <ConfirmPrompt message={mode.message} onConfirm={resolvePrompt} />
	}

	const visibleMsgs = msgs.filter(hasMeaningfulContent)
	const isLiveActive = !!(stream || thinkStream || busy)

	return (
		<Box flexDirection="column" paddingX={1}>
			{/* Messages - pushed to scrollback as they finish */}
			<Static items={visibleMsgs}>
				{(m, i) => <Message key={`${m.ts}-${i}`} msg={m} isFirst={i === 0} />}
			</Static>

			{/* Live Area (Streaming, active tool calls, working indicator) */}
			{isLiveActive && (
				<Box flexDirection="column" marginTop={visibleMsgs.length > 0 ? 1 : 0}>
					{thinkStream && (
						<Text dimColor italic>
							{thinkStream}
						</Text>
					)}
					{stream && (
						<Box flexDirection="row">
							<Box flexGrow={1} flexShrink={1}>
								<Text>
									{formatMarkdown(stream)}
									{!input && <Cursor />}
								</Text>
							</Box>
						</Box>
					)}
					{busy && !stream && (
						<Box flexDirection="row">
							<Box marginRight={1}>
								<Spinner />
							</Box>
							<Text dimColor>{status ? status.replace("⏳ ", "") : chalk.yellow("working…")}</Text>
						</Box>
					)}
				</Box>
			)}

			{/* Input & Footer (Live) */}
			<Box flexDirection="column" marginTop={visibleMsgs.length > 0 || isLiveActive ? 1 : 0}>
				{updateInfo && (
					<Box
						borderStyle="round"
						borderColor="yellow"
						paddingX={1}
						marginBottom={1}
						flexDirection="column"
					>
						<Text color="yellow" bold>
							⬆ Update Available (v{updateInfo.current} → v{updateInfo.latest})
						</Text>
						<Text dimColor>
							Run <Text color="cyan">/update</Text> or <Text color="cyan">nova update</Text> to
							upgrade.
						</Text>
					</Box>
				)}
				<Box flexDirection="row">
					<Box flexShrink={0} marginRight={1}>
						<Text bold color="green">
							{">"}
						</Text>
					</Box>
					<Box flexGrow={1} flexShrink={1}>
						<Text>
							{input}
							<Cursor />
						</Text>
					</Box>
				</Box>

				{/* Dynamic Status / Info Line */}
				<Box justifyContent="space-between">
					<Box>
						{suggestions.length > 0 ? (
							<Box flexDirection="column" marginLeft={2}>
								{suggestions.map((s, i) => (
									<Box key={s.name}>
										<Text
											color={i === selCmdIdx ? "black" : "yellow"}
											backgroundColor={i === selCmdIdx ? "yellow" : undefined}
										>
											/{s.name.padEnd(10)}
										</Text>
										<Text dimColor> {s.desc}</Text>
									</Box>
								))}
							</Box>
						) : (
							<Text dimColor>Enter to send · /help for commands</Text>
						)}
					</Box>

					<Box>
						<Text dimColor>{formatTokenUsage(usage.in, agent.model.contextWindow)}</Text>
						<Text dimColor> │ </Text>
						<Text dimColor>{agent.model.id}</Text>
						{busy && <Text dimColor> │ Esc to stop</Text>}
					</Box>
				</Box>
			</Box>
		</Box>
	)
}

function fmtK(n: number): string {
	const k = n / 1000
	return k >= 100 ? `${Math.round(k)}K` : `${k.toFixed(1)}K`
}

function formatTokenUsage(used: number, contextWindow: number): string {
	if (used === 0) return `0/${fmtK(contextWindow)}`
	const pct = Math.round((used / contextWindow) * 100)
	return `${fmtK(used)}/${fmtK(contextWindow)} (${pct}%)`
}

const TOOL_STYLE: Record<string, string> = {
	read: "blue",
	write: "magenta",
	edit: "yellow",
	bash: "cyan",
	glob: "green",
	find: "green",
	grep: "green",
	tree: "green",
}

function hasMeaningfulContent(msg: Msg): boolean {
	if (msg.role === "user") return true
	if (msg.role === "tool_result") return true
	if (msg.role === "assistant") {
		if (msg.model === "system") return true
		return msg.content.some((c) => {
			if (c.type === "thinking") return c.text.trim().length > 0
			if (c.type === "text") return c.text.trim().length > 0
			return false
		})
	}
	return false
}

function Message({ msg, isFirst }: { msg: Msg; isFirst: boolean }) {
	if (msg.role === "user") {
		return (
			<Box marginTop={isFirst ? 0 : 1} flexDirection="row">
				<Box flexShrink={0} marginRight={1}>
					<Text bold color="green">
						{">"}
					</Text>
				</Box>
				<Box flexGrow={1} flexShrink={1}>
					<Text>
						{typeof msg.content === "string"
							? msg.content
							: msg.content.map((c) => (c.type === "text" ? c.text : "")).join("")}
					</Text>
				</Box>
			</Box>
		)
	}

	if (msg.role === "assistant") {
		if (msg.model === "system") {
			return (
				<Box flexDirection="column" marginTop={0}>
					{msg.content.map((c, i) =>
						// biome-ignore lint/suspicious/noArrayIndexKey: stable turn content
						c.type === "text" ? <Text key={i}>{formatMarkdown(c.text)}</Text> : null,
					)}
				</Box>
			)
		}

		const hasVisibleContent = msg.content.some((c) => c.type === "text" || c.type === "thinking")
		if (!hasVisibleContent) return null

		return (
			<Box flexDirection="column" marginTop={0}>
				{msg.content.map((c, i) => {
					if (c.type === "thinking") {
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: stable turn content
							<Text key={i} dimColor italic>
								{c.text}
							</Text>
						)
					}
					if (c.type === "text") {
						// biome-ignore lint/suspicious/noArrayIndexKey: stable turn content
						return <Text key={i}>{formatMarkdown(c.text)}</Text>
					}
					return null
				})}
			</Box>
		)
	}

	if (msg.role === "tool_result") {
		const args = msg.args ? formatToolArgs(msg.args, true) : ""

		const resText = msg.content
			.map((c) => (c.type === "text" ? c.text : ""))
			.join("")
			.trim()

		const isRead = msg.tool === "read"
		const lineCount = isRead ? resText.split("\n").length : 0
		const color = TOOL_STYLE[msg.tool] || "white"

		return (
			<Box flexDirection="row">
				<Text color={msg.isError ? "red" : "green"}>{msg.isError ? "✗" : "✓"} </Text>
				<Text color={color} bold>
					{msg.tool}
				</Text>
				{args && <Text> {args}</Text>}
				{isRead && !msg.isError && <Text dimColor> ({lineCount} lines)</Text>}
				{msg.isError && resText && <Text color="red"> {resText.slice(0, 80)}</Text>}
			</Box>
		)
	}
	return null
}
