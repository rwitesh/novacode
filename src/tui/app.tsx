import chalk from "chalk"
import { Box, render, Static, Text, useInput } from "ink"
import { useCallback, useEffect, useRef, useState } from "react"
import type { Agent } from "../agent/agent.ts"
import { COMMANDS, dispatch } from "../commands/index.ts"
import type { SessionStore } from "../session/store.ts"
import type { Msg, Prompts } from "../types.ts"
import { checkForUpdate, getCurrentVersion } from "../update.ts"
import { Cursor, LiveArea } from "./components/liveArea.tsx"
import { hasMeaningfulContent, Message } from "./components/message.tsx"
import { StatusBar } from "./components/statusBar.tsx"
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

function App({
	agent,
	store,
	sessionId,
}: {
	agent: Agent
	store: SessionStore
	sessionId: string
}) {
	const [msgs, setMsgs] = useState<Msg[]>(agent.messages)
	const [stream, setStream] = useState("")
	const [thinkStream, setThinkStream] = useState("")
	const [busy, setBusy] = useState(false)
	const [input, setInput] = useState("")
	const [status, setStatus] = useState("")
	const [usage, setUsage] = useState<{ in: number; out: number }>({ in: 0, out: 0 })
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
		store.append(sessionId, msg).catch((err) => {
			console.error("Error appending message to session store:", err)
		})
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
						setStream("")
						setThinkStream("")

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
			<Static items={visibleMsgs}>
				{(m, i) => <Message key={`${m.ts}-${i}`} msg={m} isFirst={i === 0} />}
			</Static>

			<LiveArea
				stream={stream}
				thinkStream={thinkStream}
				busy={busy}
				status={status}
				hasMessages={visibleMsgs.length > 0}
			/>

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

				<StatusBar
					model={agent.model}
					usage={usage}
					busy={busy}
					suggestions={suggestions}
					selCmdIdx={selCmdIdx}
				/>
			</Box>
		</Box>
	)
}
