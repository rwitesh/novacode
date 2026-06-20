import type { ToolResultOutput } from "@ai-sdk/provider-utils"
import type { ModelMessage } from "ai"
import chalk from "chalk"
import { Box, render, Static, Text, useApp, useInput } from "ink"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Agent } from "../agent/agent.ts"
import { trimMessages } from "../agent/trim.ts"
import { COMMANDS, dispatch } from "../commands/index.ts"
import { generateSessionTitle } from "../compact.ts"
import { loadAuth } from "../config/store.ts"
import { summarizeToolOutput } from "../content.ts"
import type { SessionStore } from "../db/sessionStore.ts"
import { formatToolArgs } from "../format.ts"
import { getModel, getProvider } from "../models/lookup.ts"
import type { PolicyEngine } from "../policy/engine.ts"
import { groupSkills } from "../skills/index.ts"
import { estimateTokens } from "../tokens.ts"
import type {
	ApprovalRequest,
	PermissionMode,
	PolicyApprover,
	Prompts,
	Skill,
	Usage,
} from "../types.ts"
import { checkForUpdate, getCurrentVersion } from "../update.ts"
import { Cursor } from "./components/liveArea.tsx"
import { deriveEventsFromMessages, EventRenderer } from "./components/message.tsx"
import { StatusBar } from "./components/statusBar.tsx"
import { useStreamBuffer } from "./hooks/useStreamBuffer.ts"
import { useTip } from "./hooks/useTip.ts"
import {
	ApprovalPrompt,
	ConfirmPrompt,
	PasswordPrompt,
	SearchSelectPrompt,
	SelectPrompt,
} from "./prompts.tsx"
import type { ActiveTool, PromptMode, TimelineEvent } from "./types.ts"

export async function interactive(
	agent: Agent,
	store: SessionStore,
	sessionId: string,
	skills: Skill[] = [],
	hasAgentsMd = false,
	policy: PolicyEngine,
): Promise<void> {
	process.stdout.write("\x1B[?25l")
	const version = await getCurrentVersion()
	process.stdout.write(`${chalk.cyan.bold("⚡ novacode")} ${chalk.gray(`v${version}`)}\n`)
	process.stdout.write(
		`${chalk.dim("  mode:")}    ${policy.mode === "restricted" ? chalk.yellow("restricted") : chalk.green("unrestricted")}\n`,
	)
	if (hasAgentsMd) {
		process.stdout.write(`${chalk.dim("  context:")} ${chalk.cyan("AGENTS.md")}\n`)
	}
	if (skills.length > 0) {
		const skillNames = groupSkills(skills)
			.map((g) =>
				g.length > 1
					? `${chalk.cyan(g[0]!.name)} ${chalk.yellow("(duplicate)")}`
					: chalk.cyan(g[0]!.name),
			)
			.join(", ")
		process.stdout.write(`${chalk.dim("  skills:")}  ${skillNames}\n`)
	}

	const initialHistory: ModelMessage[] = await store.history(sessionId)

	try {
		const { waitUntilExit } = render(
			<App
				agent={agent}
				store={store}
				sessionId={sessionId}
				skills={skills}
				initialHistory={initialHistory}
				policy={policy}
			/>,
			{ exitOnCtrlC: false },
		)
		await waitUntilExit()
	} finally {
		process.stdout.write("\x1B[?25h")
		await store.prune()
	}
}

function estimateActiveInputTokens(agent: Agent, messages: ModelMessage[]): number {
	const systemTokens = estimateTokens(agent.system)
	const maxInputTokens = agent.model.contextWindow - systemTokens - 4096
	const trimmed = trimMessages(messages, maxInputTokens)
	return estimateTokens(trimmed)
}

function App({
	agent,
	store,
	sessionId: initialSessionId,
	skills,
	initialHistory,
	policy,
}: {
	agent: Agent
	store: SessionStore
	sessionId: string
	skills: Skill[]
	initialHistory: ModelMessage[]
	policy: PolicyEngine
}) {
	const [currSessionId, setCurrSessionId] = useState(initialSessionId)
	const [msgs, setMsgs] = useState<ModelMessage[]>(initialHistory)

	const [thinking, setThinking] = useState(false)
	const [busy, setBusy] = useState(false)
	const [input, setInput] = useState("")
	const [status, setStatus] = useState("")

	const [activeTools, setActiveTools] = useState<ActiveTool[]>([])
	const [outputTokens, setOutputTokens] = useState(0)

	// biome-ignore lint/correctness/useExhaustiveDependencies: reactively run on msgs change to sync with agent.messages changes
	const usage = useMemo<Usage>(() => {
		return {
			in: estimateActiveInputTokens(agent, agent.messages),
			out: outputTokens,
		}
	}, [agent, msgs, outputTokens])

	const handleSwitchSession = useCallback(
		async (newSessionId: string) => {
			const s = await store.get(newSessionId)
			if (!s) return

			const provider = getProvider(s.provider)
			const model = getModel(s.provider, s.model)
			if (provider && model) {
				const auth = await loadAuth()
				const apiKey = auth.apiKeys[s.provider] || ""
				agent.updateConfig({
					provider: provider.id,
					model,
					apiKey,
				})
			}

			const activeMsgs = await store.messages(newSessionId)
			const fullHistory = await store.history(newSessionId)
			agent.setMessages(activeMsgs)
			setMsgs(fullHistory)
			setCurrSessionId(newSessionId)

			if (model) {
				setOutputTokens(s.outputTokens)
			}
		},
		[store, agent],
	)

	const handleNewSession = useCallback(async () => {
		const m = agent.model
		const session = await store.create(process.cwd(), m.id, m.provider)
		agent.setMessages([])
		setMsgs([])
		setCurrSessionId(session.id)

		setOutputTokens(0)
	}, [store, agent])

	useEffect(() => {
		store.get(initialSessionId).then((s) => {
			if (s) {
				setOutputTokens(s.outputTokens)
			}
		})
	}, [store, initialSessionId])
	const [selCmdIdx, setSelCmdIdx] = useState(0)
	const [mode, setMode] = useState<PromptMode>({ type: "chat" })
	const [permissionMode, setPermissionMode] = useState<PermissionMode>(policy.mode)
	const resolveRef = useRef<((v: unknown) => void) | null>(null)
	const history = useRef<string[]>([])
	const hIdx = useRef(-1)
	const abortCtrl = useRef<AbortController | null>(null)
	const committed = useRef(0)
	const [updateInfo, setUpdateInfo] = useState<{
		current: string
		latest: string
	} | null>(null)
	const { exit } = useApp()
	const lastExitPress = useRef<{ key: "C"; ts: number } | null>(null)
	const [exitConfirmKey, setExitConfirmKey] = useState<"C" | null>(null)

	const { bufferedStream, append: appendStream, reset: resetStream } = useStreamBuffer()
	const tip = useTip(busy)

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
		searchSelect: useCallback(
			(config) =>
				new Promise((resolve) => {
					resolveRef.current = resolve as (v: unknown) => void
					setMode({ type: "searchSelect", ...config })
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

	const approver: PolicyApprover = useMemo(
		() => ({
			request: (req: ApprovalRequest) =>
				new Promise<boolean>((resolve) => {
					resolveRef.current = (v: unknown) => resolve(v === true)
					setMode({ type: "approval", req })
				}),
		}),
		[],
	)

	useEffect(() => {
		policy.setApprover(approver)
		return () => policy.setApprover(null)
	}, [policy, approver])

	function resolvePrompt(value: unknown) {
		const fn = resolveRef.current
		resolveRef.current = null
		setMode({ type: "chat" })
		fn?.(value)
	}

	function commitMsg(msg: ModelMessage) {
		setMsgs((prev) => [...prev, msg])
		agent.appendMessages([msg])
		store.append(currSessionId, msg).catch((err) => {
			console.error("Error appending message to session store:", err)
		})
	}

	async function commitDelta(messages: ModelMessage[]) {
		const delta = messages.slice(committed.current)
		if (delta.length === 0) return
		committed.current = messages.length

		for (const msg of delta) {
			await store.append(currSessionId, msg)
		}

		setMsgs((prev) => [...prev, ...delta])
		agent.appendMessages(delta)

		const committedToolCallIds = new Set<string>()
		for (const msg of delta) {
			if (msg.role === "assistant" && Array.isArray(msg.content)) {
				for (const part of msg.content) {
					if (part.type === "tool-call") {
						committedToolCallIds.add(part.toolCallId)
					}
				}
			}
			if (msg.role === "tool" && Array.isArray(msg.content)) {
				for (const part of msg.content) {
					if (part.type === "tool-result") {
						committedToolCallIds.add(part.toolCallId)
					}
				}
			}
		}

		if (committedToolCallIds.size > 0) {
			setActiveTools((prev) => prev.filter((t) => !committedToolCallIds.has(t.id)))
		}

		const committedText = delta.some(
			(msg) =>
				msg.role === "assistant" &&
				(typeof msg.content === "string"
					? msg.content.trim().length > 0
					: msg.content.some((part) => part.type === "text" && part.text.trim().length > 0)),
		)
		if (committedText) {
			resetStream()
		}
	}

	async function handlePermissionSwitch() {
		const picked = await prompts.select({
			message: "Permission mode",
			options: [
				{
					value: "restricted",
					label: "Restricted — ask permission before each action",
					hint: permissionMode === "restricted" ? "current" : undefined,
				},
				{
					value: "unrestricted",
					label: "Unrestricted — run without approval (may be dangerous)",
					hint: permissionMode === "unrestricted" ? "current" : undefined,
				},
			],
		})
		if (picked !== "restricted" && picked !== "unrestricted") return
		policy.setMode(picked)
		setPermissionMode(picked)
		commitMsg({
			role: "assistant",
			content: chalk.green(`✓ Permission mode set to ${picked}.`),
		})
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset selection on input change
	useEffect(() => {
		setSelCmdIdx(0)
	}, [input])

	useInput((ch, key) => {
		if (key.ctrl && (ch === "c" || ch === "d")) {
			if (busy) {
				if (ch === "c") {
					if (abortCtrl.current) {
						abortCtrl.current.abort()
						abortCtrl.current = null
					}
				}
				return
			}

			if (ch === "d") {
				exit()
				return
			}

			const now = Date.now()
			if (
				lastExitPress.current &&
				lastExitPress.current.key === "C" &&
				now - lastExitPress.current.ts < 2000
			) {
				exit()
			} else {
				lastExitPress.current = { key: "C", ts: now }
				setExitConfirmKey("C")
				setTimeout(() => {
					if (lastExitPress.current?.key === "C" && Date.now() - lastExitPress.current.ts >= 2000) {
						lastExitPress.current = null
						setExitConfirmKey(null)
					}
				}, 2000)
			}
			return
		}

		if (mode.type !== "chat") return

		if (key.escape) {
			if (abortCtrl.current) {
				abortCtrl.current.abort()
				abortCtrl.current = null
			} else if (input) {
				setInput("")
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
			const cmdParts = line.slice(1).split(" ")
			const cmdName = cmdParts[0]?.toLowerCase()
			const matchedCmd = COMMANDS.find(
				(c) => c.name === cmdName || c.aliases?.includes(cmdName ?? ""),
			)

			if (matchedCmd?.name === "permission") {
				void handlePermissionSwitch()
				return
			}
			if (line === "/compact") {
				setBusy(true)
				setStatus("Compacting...")
			}
			dispatch(
				line,
				agent,
				store,
				currSessionId,
				prompts,
				exit,
				handleSwitchSession,
				handleNewSession,
				skills,
			).then((r) => {
				setBusy(false)
				setStatus("")
				if (r) {
					commitMsg({ role: "assistant", content: r })
				}
			})
			return
		}

		const userMsg: ModelMessage = { role: "user", content: line }
		commitMsg(userMsg)

		abortCtrl.current = new AbortController()
		void runTurn(abortCtrl.current.signal)
	})

	async function runTurn(signal: AbortSignal) {
		setBusy(true)
		resetStream()
		setThinking(false)
		setStatus("")
		setActiveTools([])
		committed.current = 0

		try {
			const result = await agent.prompt(signal, async (event) => {
				const u = event.usage
				if (u) {
					setOutputTokens((prev) => prev + (u.outputTokens ?? 0))
					await store.addUsage(currSessionId, u.inputTokens ?? 0, u.outputTokens ?? 0)
				}
				if (event.response?.messages?.length) {
					await commitDelta(event.response.messages)
				}
			})

			for await (const part of result.fullStream) {
				switch (part.type) {
					case "text-delta":
						if (part.text) {
							setThinking(false)
							setStatus("")
							appendStream(part.text)
						}
						break
					case "reasoning-delta":
						setThinking(true)
						setStatus("")
						break
					case "tool-call": {
						setThinking(false)
						setStatus("")
						const formattedArgs = formatToolArgs(part.input as Record<string, unknown>, true)
						setActiveTools((prev) => {
							if (prev.some((t) => t.id === part.toolCallId)) return prev
							return [
								...prev,
								{
									id: part.toolCallId,
									name: part.toolName,
									args: formattedArgs,
									status: "running" as const,
								},
							]
						})
						break
					}
					case "tool-result": {
						const { text, isError } = summarizeToolOutput(part.output as ToolResultOutput)
						setActiveTools((prev) =>
							prev.map((t) => {
								if (t.id === part.toolCallId) {
									if (isError) {
										return {
											...t,
											status: "failure" as const,
											error: text,
										}
									} else {
										let lineCount: number | undefined
										let matchCount: number | undefined
										if (t.name === "read") {
											lineCount = text.split("\n").length
										} else if (t.name === "grep") {
											matchCount = text.split("\n").filter(Boolean).length
										}
										return {
											...t,
											status: "success" as const,
											lineCount,
											matchCount,
										}
									}
								}
								return t
							}),
						)
						break
					}
					case "error":
						setStatus(chalk.red(`Error: ${part.error}`))
						break
				}
			}

			const resp = await result.response
			await commitDelta(resp.messages)

			setStatus("")
			store
				.get(currSessionId)
				.then((s) => {
					if (s && !s.title && agent.messages.length >= 2) {
						generateSessionTitle(agent.messages, agent.model, agent.apiKey)
							.then((title) => {
								if (title) store.setTitle(currSessionId, title).catch(() => {})
							})
							.catch(() => {})
					}
				})
				.catch(() => {})
		} catch (err) {
			if (signal.aborted) {
				commitMsg({ role: "assistant", content: chalk.gray("(aborted)") })
			} else {
				commitMsg({ role: "assistant", content: chalk.red(`Error: ${(err as Error).message}`) })
			}
		} finally {
			abortCtrl.current = null
			setBusy(false)
			resetStream()
			setThinking(false)
			setStatus("")
			setActiveTools([])
		}
	}

	const completedEvents = useMemo(() => deriveEventsFromMessages(msgs), [msgs])

	const activeEvents = useMemo(() => {
		const events: TimelineEvent[] = []

		if (thinking) {
			events.push({
				id: "active-thinking",
				type: "Thinking",
			})
		}

		if (bufferedStream) {
			events.push({
				id: "active-text",
				type: "AssistantMessage",
				content: bufferedStream,
			})
		}

		for (const t of activeTools) {
			if (t.status === "running") {
				events.push({
					id: t.id,
					type: "ToolStarted",
					toolCallId: t.id,
					toolName: t.name,
					args: t.args,
				})
			} else if (t.status === "success") {
				events.push({
					id: t.id,
					type: "ToolCompleted",
					toolCallId: t.id,
					toolName: t.name,
					args: t.args,
					resultLineCount: t.lineCount,
					resultMatchCount: t.matchCount,
				})
			} else if (t.status === "failure") {
				events.push({
					id: t.id,
					type: "ToolFailed",
					toolCallId: t.id,
					toolName: t.name,
					args: t.args,
					error: t.error ?? "Unknown error",
				})
			}
		}

		if (status) {
			events.push({
				id: "active-status",
				type: "SystemMessage",
				content: status,
			})
		}

		if (busy && !thinking && mode.type === "chat") {
			events.push({
				id: "active-working",
				type: "Thinking",
			})
		}

		return events
	}, [thinking, busy, bufferedStream, activeTools, status, mode.type])

	return (
		<Box flexDirection="column" paddingX={1} width="100%">
			<Static key={currSessionId} items={completedEvents}>
				{(e, i) => <EventRenderer key={e.id} event={e} isFirst={i === 0} />}
			</Static>

			{activeEvents.map((e) => (
				<EventRenderer key={e.id} event={e} />
			))}

			{(mode.type === "select" ||
				mode.type === "searchSelect" ||
				mode.type === "password" ||
				mode.type === "confirm" ||
				mode.type === "approval") && (
				<Box
					flexDirection="column"
					marginTop={completedEvents.length > 0 || activeEvents.length > 0 ? 1 : 0}
				>
					{mode.type === "select" && (
						<SelectPrompt
							message={mode.message}
							options={mode.options}
							header={mode.header}
							footer={mode.footer}
							onSelect={resolvePrompt}
						/>
					)}
					{mode.type === "searchSelect" && (
						<SearchSelectPrompt
							message={mode.message}
							options={mode.options}
							header={mode.header}
							footer={mode.footer}
							onSelect={resolvePrompt}
						/>
					)}
					{mode.type === "password" && (
						<PasswordPrompt
							message={mode.message}
							validate={mode.validate}
							onSubmit={resolvePrompt}
						/>
					)}
					{mode.type === "confirm" && (
						<ConfirmPrompt message={mode.message} onConfirm={resolvePrompt} />
					)}
					{mode.type === "approval" && <ApprovalPrompt req={mode.req} onResolve={resolvePrompt} />}
				</Box>
			)}

			{mode.type === "chat" && (
				<Box
					flexDirection="column"
					marginTop={completedEvents.length > 0 || activeEvents.length > 0 ? 1 : 0}
				>
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

					<Box
						flexDirection="column"
						borderStyle="single"
						borderTop
						borderBottom
						borderColor="green"
						borderLeft={false}
						borderRight={false}
						paddingTop={0}
						paddingBottom={0}
						marginBottom={0}
					>
						<Box flexDirection="row">
							<Box flexShrink={0} marginRight={1}>
								<Text bold color="greenBright">
									{"❯"}
								</Text>
							</Box>
							<Box flexGrow={1} flexShrink={1}>
								<Text>
									{input}
									<Cursor />
								</Text>
							</Box>
						</Box>
					</Box>

					<StatusBar
						model={agent.model}
						usage={usage}
						busy={busy}
						suggestions={suggestions}
						selCmdIdx={selCmdIdx}
						exitConfirmKey={exitConfirmKey}
						tip={tip}
						permissionMode={permissionMode}
					/>
				</Box>
			)}
		</Box>
	)
}
