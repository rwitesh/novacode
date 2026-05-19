import chalk from "chalk"
import { Box, render, Static, Text, useInput } from "ink"
import { useEffect, useRef, useState } from "react"
import type { Agent } from "../agent/agent.ts"
import { COMMANDS, dispatch } from "../commands/index.ts"
import type { SessionStore } from "../session/store.ts"
import type { Msg } from "../types.ts"
export async function interactive(
	agent: Agent,
	store: SessionStore,
	sessionId: string,
): Promise<void> {
	// Hide system cursor during session
	process.stdout.write("\x1B[?25l")

	try {
		const { waitUntilExit } = render(<App agent={agent} store={store} sessionId={sessionId} />)
		await waitUntilExit()
	} finally {
		// Restore system cursor on exit
		process.stdout.write("\x1B[?25h")
	}
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
	const [selCmdIdx, setSelCmdIdx] = useState(0)
	const [cmdRunning, setCmdRunning] = useState(false)
	const history = useRef<string[]>([])
	const hIdx = useRef(-1)
	const abortCtrl = useRef<AbortController | null>(null)

	const isTypingCmd = input.startsWith("/") && !input.includes(" ")
	const suggestions = isTypingCmd
		? COMMANDS.filter(
				(c) =>
					c.name.startsWith(input.slice(1).toLowerCase()) ||
					c.aliases?.some((a) => a.startsWith(input.slice(1).toLowerCase())),
			)
		: []

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset selection on input change
	useEffect(() => {
		setSelCmdIdx(0)
	}, [input])

	useEffect(() => {
		if (!cmdRunning) {
			process.stdout.write("\x1B[?25l")
		}
	}, [cmdRunning])

	useInput((ch, key) => {
		if (cmdRunning) return

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
				return prev + ch
			})
			return
		}

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
			const cmdName = line.slice(1).split(" ")[0]?.toLowerCase() ?? ""
			const isInteractive =
				["providers", "prov", "config", "cfg", "models", "model"].includes(cmdName) &&
				!line.includes(" ")

			if (isInteractive) {
				setCmdRunning(true)
				// Small delay to let Ink clear
				setTimeout(() => {
					dispatch(line, agent, store, sessionId).then((r) => {
						process.stdin.setRawMode?.(true)
						setCmdRunning(false)
						if (r) {
							setMsgs((prev) => {
								const updated: Msg[] = [
									...prev,
									{
										role: "assistant",
										content: [{ type: "text", text: r }],
										model: "system",
										provider: "system",
										usage: { in: 0, out: 0 },
										stop: "stop",
										ts: Date.now(),
									},
								]
								agent.setMessages(updated)
								return updated
							})
						}
					})
				}, 50)
				return
			}

			// Slash commands
			dispatch(line, agent, store, sessionId).then((r) => {
				if (r) {
					setMsgs((prev) => {
						const updated: Msg[] = [
							...prev,
							{
								role: "assistant",
								content: [{ type: "text", text: r }],
								model: "system",
								provider: "system",
								usage: { in: 0, out: 0 },
								stop: "stop",
								ts: Date.now(),
							},
						]

						agent.setMessages(updated)
						return updated
					})
				}
			})
			return
		}

		if (busy) return

		abortCtrl.current = new AbortController()
		const stream = agent.prompt(line, abortCtrl.current.signal)

		;(async () => {
			for await (const ev of stream) {
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
						setStream("")
						setThinkStream("")
						setMsgs((prev) => {
							const updated = [...prev, ev.msg]
							agent.setMessages(updated)
							return updated
						})
						store.append(sessionId, ev.msg)
						break
					case "tool_call":
						setStatus(chalk.dim(`⏳ ${ev.call.name}…`))
						break
					case "tool_result":
						setMsgs((prev) => {
							const updated = [...prev, ev.result]
							agent.setMessages(updated)
							return updated
						})
						store.append(sessionId, ev.result)
						setStatus(
							ev.result.isError
								? chalk.red(`✗ ${ev.result.tool}`)
								: chalk.green(`✓ ${ev.result.tool}`),
						)
						break
					case "turn_end":
						setStatus("")
						break
				}
			}
			abortCtrl.current = null
			setBusy(false)
			setStatus("")
			setStream("")
			setThinkStream("")
		})().catch((err) => {
			const errMsg: Msg = {
				role: "assistant",
				model: "system",
				provider: "system",
				content: [{ type: "text", text: chalk.red(`Error: ${err.message}`) }],
				usage: { in: 0, out: 0 },
				stop: "error",
				ts: Date.now(),
			}
			setMsgs((prev) => [...prev, errMsg])
			setBusy(false)
		})

		// Record user msg immediately
		const userMsg: Msg = { role: "user", content: line, ts: Date.now() }
		setMsgs((prev) => {
			const updated = [...prev, userMsg]
			agent.setMessages(updated)
			return updated
		})
		store.append(sessionId, userMsg)
	})

	if (cmdRunning) return null

	return (
		<Box flexDirection="column" paddingX={1} paddingTop={1}>
			{/* Header */}
			<Box>
				<Text bold color="cyan">
					⚡ novacode
				</Text>
			</Box>

			{/* Messages - pushed to scrollback as they finish */}
			<Static items={msgs}>{(m, i) => <Message key={`${m.ts}-${i}`} msg={m} />}</Static>

			{/* Streaming (Live) */}
			{(stream || thinkStream) && (
				<Box flexDirection="column" marginBottom={1}>
					<Text bold color="magenta">
						novacode
					</Text>
					{thinkStream && (
						<Text dimColor italic>
							{thinkStream}
						</Text>
					)}
					{stream && (
						<Box>
							<Text>{stream}</Text>
							{!input && <Cursor />}
						</Box>
					)}
				</Box>
			)}

			{/* Input & Footer (Live) */}
			<Box flexDirection="column">
				<Box>
					<Text bold color="green">
						{"> "}
					</Text>
					<Text>{input}</Text>
					{!busy && <Cursor />}
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
							<Text dimColor>
								{busy ? chalk.yellow("working…") : "Enter to send · /help for commands"}
							</Text>
						)}
					</Box>

					<Box>
						<Text>{status}</Text>
						<Text dimColor>
							{status ? " │ " : ""}
							{agent.model.id}
						</Text>
						{busy && <Text dimColor> │ {chalk.dim("Esc to stop")}</Text>}
					</Box>
				</Box>
			</Box>
		</Box>
	)
}

function Message({ msg }: { msg: Msg }) {
	if (msg.role === "user") {
		return (
			<Box flexDirection="column" marginBottom={1}>
				<Text bold color="cyan">
					You
				</Text>
				<Text>
					{typeof msg.content === "string"
						? msg.content
						: msg.content.map((c) => (c.type === "text" ? c.text : "")).join("")}
				</Text>
			</Box>
		)
	}
	if (msg.role === "assistant") {
		if (msg.model === "system") {
			return (
				<Box marginBottom={1}>
					{msg.content.map((c, i) =>
						// biome-ignore lint/suspicious/noArrayIndexKey: stable turn content
						c.type === "text" ? <Text key={i}>{c.text}</Text> : null,
					)}
				</Box>
			)
		}
		return (
			<Box flexDirection="column" marginBottom={1}>
				<Text bold color="magenta">
					novacode
				</Text>
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
						return <Text key={i}>{c.text}</Text>
					}
					if (c.type === "tool_call") {
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: stable turn content
							<Text key={i} color="yellow">
								🔧 {c.name}({JSON.stringify(c.args)})
							</Text>
						)
					}
					return null
				})}
			</Box>
		)
	}
	if (msg.role === "tool_result") {
		return (
			<Box marginBottom={1} paddingLeft={2}>
				<Text dimColor>
					{msg.isError ? "❌" : "✅"} {msg.tool}:{" "}
				</Text>
				<Text dimColor>
					{msg.content
						.map((c) => (c.type === "text" ? c.text : "[binary]"))
						.join("")
						.slice(0, 500)}
					{msg.content.map((c) => (c.type === "text" ? c.text : "")).join("").length > 500
						? "..."
						: ""}
				</Text>
			</Box>
		)
	}
	return null
}
