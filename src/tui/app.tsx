import chalk from "chalk"
import { Box, render, Text, useInput } from "ink"
import { useRef, useState } from "react"
import type { Agent } from "../agent/agent.ts"
import { dispatch } from "../commands/index.ts"
import type { SessionStore } from "../session/store.ts"
import type { Msg } from "../types.ts"

export async function interactive(
	agent: Agent,
	store: SessionStore,
	sessionId: string,
): Promise<void> {
	render(<App agent={agent} store={store} sessionId={sessionId} />)
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
	const [busy, setBusy] = useState(false)
	const [input, setInput] = useState("")
	const [status, setStatus] = useState("")
	const history = useRef<string[]>([])
	const hIdx = useRef(-1)
	const abortCtrl = useRef<AbortController | null>(null)

	useInput((ch, key) => {
		if (key.escape) {
			if (abortCtrl.current) {
				abortCtrl.current.abort()
				abortCtrl.current = null
			}
			return
		}
		if (key.upArrow) {
			if (history.current.length > 0) {
				hIdx.current = Math.min(hIdx.current + 1, history.current.length - 1)
				setInput(history.current[hIdx.current] ?? "")
			}
			return
		}
		if (key.downArrow) {
			hIdx.current = Math.max(hIdx.current - 1, -1)
			setInput(hIdx.current >= 0 ? (history.current[hIdx.current] ?? "") : "")
			return
		}
		if (!key.return) {
			setInput((prev) => {
				if (key.backspace || key.delete) return prev.slice(0, -1)
				return prev + ch
			})
			return
		}

		const line = input.trim()
		if (!line) return
		setInput("")
		history.current.unshift(line)
		hIdx.current = -1

		if (line.startsWith("/")) {
			// Slash commands
			dispatch(line, agent, store, sessionId).then((r) => {
				if (r) {
					setMsgs((prev) => [
						...prev,
						{
							role: "assistant",
							content: [{ type: "text", text: r }],
							model: "system",
							provider: "system",
							usage: { in: 0, out: 0, total: 0 },
							stop: "stop",
							ts: Date.now(),
						},
					])
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
						setStatus("")
						break
					case "text_delta":
						if (ev.text) setStream((prev) => prev + ev.text)
						break
					case "turn_end":
						if (ev.msg) {
							setStream("")
							setMsgs((prev) => [...prev, ev.msg, ...ev.results])
							// Store assistant msg then its results to preserve causal order
							store.append(sessionId, ev.msg)
							for (const r of ev.results) {
								store.append(sessionId, r)
							}
						}
						setStatus("")
						break
					case "tool_call":
						setStatus(chalk.dim(`⏳ ${ev.call.name}…`))
						break
					case "tool_result":
						setStatus(
							ev.result.isError
								? chalk.red(`✗ ${ev.result.tool}`)
								: chalk.green(`✓ ${ev.result.tool}`),
						)
						// UI updated, store will be updated at turn_end
						break
					case "done":
						setBusy(false)
						break
				}
			}
			abortCtrl.current = null
			setBusy(false)
		})().catch((err) => {
			setStream((prev) => prev + chalk.red(`\nError: ${err.message}`))
			setBusy(false)
		})

		// Record user msg immediately
		const userMsg: Msg = { role: "user", content: line, ts: Date.now() }
		setMsgs((prev) => [...prev, userMsg])
		store.append(sessionId, userMsg)
	})

	return (
		<Box flexDirection="column" padding={1}>
			{/* Header */}
			<Box marginBottom={1}>
				<Text bold color="cyan">
					⚡ novacode
				</Text>
				<Text dimColor> │ {agent.model.id}</Text>
				<Text dimColor> │ {busy ? chalk.yellow("working…") : chalk.green("ready")}</Text>
			</Box>

			{/* Messages */}
			{msgs.map((m, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: stable order
				<Message key={`${m.ts}-${i}`} msg={m} />
			))}

			{/* Streaming */}
			{stream && (
				<Box flexDirection="column">
					<Text color="magenta">{stream}</Text>
					<Text dimColor>▎</Text>
				</Box>
			)}

			{/* Status */}
			{status && (
				<Box>
					<Text>{status}</Text>
				</Box>
			)}

			{/* Input */}
			<Box marginTop={1}>
				<Text bold color="green">
					{"> "}{" "}
				</Text>
				<Text>{input}</Text>
				<Text dimColor>▎</Text>
			</Box>

			{/* Footer */}
			<Box>
				<Text dimColor>{busy ? "Esc stop" : "Enter send · /help commands"}</Text>
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
