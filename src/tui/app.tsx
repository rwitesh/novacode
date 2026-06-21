import type { ToolResultOutput } from "@ai-sdk/provider-utils"
import type { ModelMessage } from "ai"
import { Box, render, useApp, useInput, useWindowSize } from "ink"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Agent } from "../agent/agent.ts"
import { COMMANDS, dispatch } from "../commands/index.ts"
import { generateSessionTitle } from "../compact.ts"
import { loadAuth } from "../config/store.ts"
import { summarizeToolOutput } from "../content.ts"
import type { SessionStore } from "../db/sessionStore.ts"
import { formatToolArgs } from "../format.ts"
import { getModel, getProvider } from "../models/lookup.ts"
import type { PolicyEngine } from "../policy/engine.ts"
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
import { Composer } from "./components/composer.tsx"
import { Conversation } from "./components/conversation.tsx"
import { deriveEventsFromMessages } from "./components/message.tsx"
import { StatusBar } from "./components/statusBar.tsx"
import { useStreamBuffer } from "./hooks/useStreamBuffer.ts"
import { useTip } from "./hooks/useTip.ts"
import { PromptOverlay } from "./prompts.tsx"
import { ThemeProvider, useTheme } from "./theme/index.tsx"
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
	const initialHistory: ModelMessage[] = await store.history(sessionId)

	if (process.stdout.isTTY) {
		process.stdout.write("\x1b[2J\x1b[3J\x1b[H")
	}

	try {
		const { waitUntilExit } = render(
			<ThemeProvider>
				<App
					agent={agent}
					store={store}
					sessionId={sessionId}
					skills={skills}
					initialHistory={initialHistory}
					policy={policy}
					version={version}
					hasAgentsMd={hasAgentsMd}
				/>
			</ThemeProvider>,
			{ exitOnCtrlC: false },
		)
		await waitUntilExit()
	} finally {
		process.stdout.write("\x1B[?25h")
		await store.prune()
	}
}

function estimateActiveInputTokens(agent: Agent, messages: ModelMessage[]): number {
	return estimateTokens(agent.system) + estimateTokens(messages)
}

function errorMessage(err: unknown): string {
	if (err instanceof Error) {
		const last = "lastError" in err ? (err as { lastError: unknown }).lastError : null
		if (last instanceof Error) return errorMessage(last)
		const body = (err as { responseBody?: string }).responseBody
		if (body) {
			try {
				const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string }
				return parsed.error?.message ?? parsed.message ?? err.message
			} catch {}
		}
		return err.message
	}
	return String(err)
}

function buildSessionInfo(
	version: string,
	skills: Skill[],
	hasAgentsMd: boolean,
	updateInfo: { hasUpdate: boolean; current: string; latest: string } | null,
): string {
	const lines: string[] = [`NovaCode v${version}`]
	if (hasAgentsMd) lines.push("✓ AGENTS.md detected")
	if (skills.length > 0) lines.push(`✓ ${skills.length} skills loaded`)
	if (updateInfo?.hasUpdate) {
		lines.push(`✓ Update available (v${updateInfo.current} → v${updateInfo.latest})`)
	}
	return lines.join("\n")
}

function App({
	agent,
	store,
	sessionId: initialSessionId,
	skills,
	initialHistory,
	policy,
	version,
	hasAgentsMd,
}: {
	agent: Agent
	store: SessionStore
	sessionId: string
	skills: Skill[]
	initialHistory: ModelMessage[]
	policy: PolicyEngine
	version: string
	hasAgentsMd: boolean
}) {
	const theme = useTheme()
	const { rows } = useWindowSize()
	const terminalRows = rows || 24

	const [currSessionId, setCurrSessionId] = useState(initialSessionId)
	const [msgs, setMsgs] = useState<ModelMessage[]>(initialHistory)

	const [thinking, setThinking] = useState(false)
	const [busy, setBusy] = useState(false)
	const [input, setInput] = useState("")

	const [activeTools, setActiveTools] = useState<ActiveTool[]>([])
	const [outputTokens, setOutputTokens] = useState(0)

	const [selCmdIdx, setSelCmdIdx] = useState(0)
	const [promptSelectedIdx, setPromptSelectedIdx] = useState(0)
	const [mode, setMode] = useState<PromptMode>({ type: "chat" })
	const [permissionMode, setPermissionMode] = useState<PermissionMode>(policy.mode)
	const resolveRef = useRef<((v: unknown) => void) | null>(null)
	const history = useRef<string[]>([])
	const hIdx = useRef(-1)
	const abortCtrl = useRef<AbortController | null>(null)
	const committed = useRef(0)
	const [updateInfo, setUpdateInfo] = useState<{
		hasUpdate: boolean
		current: string
		latest: string
	} | null>(null)
	const { exit } = useApp()
	const lastExitPress = useRef<{ key: "C"; ts: number } | null>(null)
	const [exitConfirmKey, setExitConfirmKey] = useState<"C" | null>(null)

	const { bufferedStream, append: appendStream, reset: resetStream } = useStreamBuffer()
	const tip = useTip()

	const [scrollOffset, setScrollOffset] = useState(0)
	const [heights, setHeights] = useState({ viewport: 0, content: 0 })
	const [userScrolled, setUserScrolled] = useState(false)
	const lastMaxOffset = useRef(0)
	const maxOffset = Math.max(0, heights.content - heights.viewport)

	useEffect(() => {
		setScrollOffset((prev) => Math.min(prev, maxOffset))
	}, [maxOffset])

	useEffect(() => {
		const delta = maxOffset - lastMaxOffset.current
		if (delta > 0) {
			if (!userScrolled) {
				setScrollOffset(0)
			} else {
				setScrollOffset((prev) => Math.min(maxOffset, prev + delta))
			}
		}
		lastMaxOffset.current = maxOffset
	}, [maxOffset, userScrolled])

	function scrollBy(deltaRows: number) {
		setUserScrolled(true)
		setScrollOffset((prev) => Math.min(maxOffset, Math.max(0, prev + deltaRows)))
	}

	function scrollToBottom() {
		setUserScrolled(false)
		setScrollOffset(0)
	}

	function scrollToTop() {
		setUserScrolled(true)
		setScrollOffset(maxOffset)
	}

	useEffect(() => {
		const check = async () => {
			const info = await checkForUpdate()
			if (info?.hasUpdate) {
				setUpdateInfo({ hasUpdate: true, current: info.current, latest: info.latest })
			}
		}
		check()
	}, [])

	useEffect(() => {
		store.get(initialSessionId).then((s) => {
			if (s) {
				setOutputTokens(s.outputTokens)
			}
		})
	}, [store, initialSessionId])

	const usage = useMemo<Usage>(() => {
		return {
			in: estimateActiveInputTokens(agent, agent.messages),
			out: outputTokens,
		}
	}, [agent, outputTokens])

	async function handleSwitchSession(newSessionId: string) {
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
		scrollToBottom()

		if (model) {
			setOutputTokens(s.outputTokens)
		}
	}

	async function handleNewSession() {
		const m = agent.model
		const session = await store.create(process.cwd(), m.id, m.provider)
		agent.setMessages([])
		setMsgs([])
		setCurrSessionId(session.id)
		setOutputTokens(0)
		scrollToBottom()
	}

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
			content: `✓ Permission mode set to ${picked}.`,
		})
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset selection on input change
	useEffect(() => {
		setSelCmdIdx(0)
	}, [input])

	const isTypingCmd = input.startsWith("/") && !input.includes(" ")
	const suggestions = useMemo(
		() =>
			isTypingCmd
				? COMMANDS.filter(
						(c) =>
							c.name.startsWith(input.slice(1).toLowerCase()) ||
							c.aliases?.some((a) => a.startsWith(input.slice(1).toLowerCase())),
					)
				: [],
		[input, isTypingCmd],
	)

	const searchFilteredOptions = useMemo(() => {
		if (mode.type !== "searchSelect") return []
		const q = input.trim().toLowerCase()
		if (!q) return mode.options
		return mode.options.filter((o) => o.label.toLowerCase().includes(q))
	}, [input, mode])

	const composerSuggestions = mode.type === "chat" ? suggestions : []

	const activity = useMemo(() => {
		if (exitConfirmKey === "C")
			return { label: "Press Ctrl+C again to exit", color: theme.palette.warning }
		if (mode.type === "searchSelect") return { label: "Filtering...", color: theme.palette.primary }
		if (mode.type !== "chat") return { label: "Waiting for input", color: theme.palette.muted }
		if (thinking) return { label: "Thinking...", color: theme.palette.warning }
		if (activeTools.length > 0)
			return {
				label: `Running ${activeTools.length} tool${activeTools.length > 1 ? "s" : ""}...`,
				color: theme.palette.primary,
			}
		if (bufferedStream) return { label: "Responding...", color: theme.palette.primary }
		if (busy) return { label: "Working...", color: theme.palette.warning }
		return { label: "Ready", color: theme.palette.success }
	}, [exitConfirmKey, mode.type, thinking, activeTools, bufferedStream, busy, theme])

	const completedEvents = useMemo<TimelineEvent[]>(() => {
		const info = buildSessionInfo(version, skills, hasAgentsMd, updateInfo)
		const events = deriveEventsFromMessages(msgs)
		return [{ id: "session-started", type: "SessionStarted", content: info }, ...events]
	}, [msgs, version, skills, hasAgentsMd, updateInfo])

	const activeEvents = useMemo<TimelineEvent[]>(() => {
		const events: TimelineEvent[] = []

		if (thinking) {
			events.push({ id: "active-thinking", type: "Thinking" })
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

		if (busy && !thinking && !bufferedStream && activeTools.length === 0 && mode.type === "chat") {
			events.push({ id: "active-working", type: "Thinking" })
		}

		return events
	}, [thinking, bufferedStream, activeTools, busy, mode.type])

	const allEvents = useMemo<TimelineEvent[]>(
		() => [...completedEvents, ...activeEvents],
		[completedEvents, activeEvents],
	)

	useInput((ch, key) => {
		if (key.ctrl && (ch === "c" || ch === "d")) {
			if (busy) {
				if (ch === "c" && abortCtrl.current) {
					abortCtrl.current.abort()
					abortCtrl.current = null
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

		if (mode.type === "searchSelect") {
			if (key.escape) {
				resolvePrompt(null)
				setInput("")
				return
			}
			if (key.return) {
				if (searchFilteredOptions.length > 0) {
					resolvePrompt(searchFilteredOptions[promptSelectedIdx]?.value ?? null)
					setInput("")
				}
				return
			}
			if (key.upArrow) {
				setPromptSelectedIdx((prev) =>
					searchFilteredOptions.length === 0
						? 0
						: (prev - 1 + searchFilteredOptions.length) % searchFilteredOptions.length,
				)
				return
			}
			if (key.downArrow) {
				setPromptSelectedIdx((prev) =>
					searchFilteredOptions.length === 0 ? 0 : (prev + 1) % searchFilteredOptions.length,
				)
				return
			}
			if (key.backspace || key.delete) {
				setInput((prev) => prev.slice(0, -1))
				setPromptSelectedIdx(0)
				return
			}
			if (ch && !key.ctrl && !key.meta && ch.trim()) {
				setInput((prev) => prev + ch)
				setPromptSelectedIdx(0)
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

		if (key.pageUp) {
			scrollBy(Math.max(1, (heights.viewport || terminalRows) - 1))
			return
		}
		if (key.pageDown) {
			scrollBy(-Math.max(1, (heights.viewport || terminalRows) - 1))
			return
		}
		if (key.home) {
			scrollToTop()
			return
		}
		if (key.end) {
			scrollToBottom()
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
		setActiveTools([])
		committed.current = 0
		let streamError: unknown

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
							appendStream(part.text)
						}
						break
					case "reasoning-delta":
						setThinking(true)
						break
					case "tool-call": {
						setThinking(false)
						const args = formatToolArgs(part.input as Record<string, unknown>, false)
						setActiveTools((prev) => {
							if (prev.some((t) => t.id === part.toolCallId)) return prev
							return [
								...prev,
								{
									id: part.toolCallId,
									name: part.toolName,
									args,
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
									}
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
								return t
							}),
						)
						break
					}
					case "error":
						streamError = part.error
						break
				}
			}

			const resp = await result.response
			await commitDelta(resp.messages)

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
				commitMsg({ role: "assistant", content: "(aborted)" })
			} else {
				commitMsg({
					role: "assistant",
					content: `Error: ${errorMessage(streamError ?? err)}`,
				})
			}
		} finally {
			abortCtrl.current = null
			setBusy(false)
			resetStream()
			setThinking(false)
			setActiveTools([])
		}
	}

	return (
		<Box flexDirection="column" width="100%" height={terminalRows}>
			<Conversation events={allEvents} scrollOffset={scrollOffset} onLayout={setHeights} />
			{mode.type !== "chat" && (
				<PromptOverlay
					mode={mode}
					searchQuery={input}
					searchSelectedIdx={promptSelectedIdx}
					onResolve={resolvePrompt}
				/>
			)}
			<Composer input={input} suggestions={composerSuggestions} selCmdIdx={selCmdIdx} />
			<StatusBar
				activity={activity.label}
				activityColor={activity.color}
				model={agent.model}
				usage={usage}
				tip={tip}
				permissionMode={permissionMode}
			/>
		</Box>
	)
}
