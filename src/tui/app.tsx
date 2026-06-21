import type { ModelMessage } from "ai"
import { Box, render, useApp, useInput, useWindowSize } from "ink"
import { useEffect, useMemo, useRef, useState } from "react"
import type { Agent } from "../agent/agent.ts"
import { COMMANDS, dispatch } from "../commands/index.ts"
import type { SessionStore } from "../db/sessionStore.ts"
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
import { Composer } from "./components/composer.tsx"
import { Conversation } from "./components/conversation.tsx"
import { StatusBar } from "./components/statusBar.tsx"
import { deriveEventsFromMessages } from "./deriveEvents.ts"
import { useScrollManager } from "./hooks/useScrollManager.ts"
import { useSession } from "./hooks/useSession.ts"
import { useTip } from "./hooks/useTip.ts"
import { useTurnRunner } from "./hooks/useTurnRunner.ts"
import { PromptOverlay } from "./prompts.tsx"
import { ThemeProvider, useTheme } from "./theme/index.tsx"
import type { PromptMode, TimelineEvent } from "./types.ts"

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

function buildSessionInfo(
	version: string,
	skills: Skill[],
	hasAgentsMd: boolean,
	permissionMode: PermissionMode,
): string {
	const lines: string[] = [`${version}`]
	if (hasAgentsMd) lines.push(`  AGENTS.md detected`)
	lines.push(`  permission: ${permissionMode}`)
	if (skills.length > 0) {
		const groups = groupSkills(skills)
		const names = groups.map((g) => {
			const name = g[0]!.name
			return g.length > 1 ? `${name} (duplicate)` : name
		})
		lines.push(`  skills: ${names.join(", ")}`)
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

	const scroll = useScrollManager()
	const session = useSession(agent, store, initialSessionId, initialHistory)
	const turn = useTurnRunner(
		agent,
		store,
		session.sessionId,
		session.setOutputTokens,
		session.commitMsg,
		session.commitDelta,
	)
	const tip = useTip()

	const [permissionMode, setPermissionMode] = useState<PermissionMode>(policy.mode)
	const [updateInfo, setUpdateInfo] = useState<{
		hasUpdate: boolean
		current: string
		latest: string
	} | null>(null)

	const [input, setInput] = useState("")
	const [selCmdIdx, setSelCmdIdx] = useState(0)
	const [promptSelectedIdx, setPromptSelectedIdx] = useState(0)
	const [mode, setMode] = useState<PromptMode>({ type: "chat" })
	const resolveRef = useRef<((v: unknown) => void) | null>(null)
	const history = useRef<string[]>([])
	const hIdx = useRef(-1)

	const { exit } = useApp()
	const lastExitPress = useRef<{ key: "C"; ts: number } | null>(null)
	const [exitConfirmKey, setExitConfirmKey] = useState<"C" | null>(null)

	useEffect(() => {
		checkForUpdate().then((info) => {
			if (info?.hasUpdate) {
				setUpdateInfo({ hasUpdate: true, current: info.current, latest: info.latest })
			}
		})
	}, [])

	const usage = useMemo<Usage>(() => {
		const inTokens = session.systemPromptShown.current
			? estimateActiveInputTokens(agent, agent.messages)
			: 0
		return { in: inTokens, out: session.outputTokens }
	}, [agent, session.outputTokens, session.systemPromptShown])

	const prompts: Prompts = useMemo(
		() => ({
			select: (config) =>
				new Promise<string | null>((resolve) => {
					resolveRef.current = resolve as (v: unknown) => void
					setMode({ type: "select", ...config })
				}),
			searchSelect: (config) =>
				new Promise<string | null>((resolve) => {
					resolveRef.current = resolve as (v: unknown) => void
					setMode({ type: "searchSelect", ...config })
				}),
			password: (config) =>
				new Promise<string | null>((resolve) => {
					resolveRef.current = resolve as (v: unknown) => void
					setMode({ type: "password", ...config })
				}),
			confirm: (config) =>
				new Promise<boolean | null>((resolve) => {
					resolveRef.current = resolve as (v: unknown) => void
					setMode({ type: "confirm", ...config })
				}),
		}),
		[],
	)

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
		session.commitMsg({
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
		if (turn.thinking) return { label: "Thinking...", color: theme.palette.warning }
		if (turn.activeTools.length > 0)
			return {
				label: `Running ${turn.activeTools.length} tool${turn.activeTools.length > 1 ? "s" : ""}...`,
				color: theme.palette.primary,
			}
		if (turn.bufferedStream) return { label: "Responding...", color: theme.palette.primary }
		if (turn.busy) return { label: "Working...", color: theme.palette.warning }
		return { label: "Ready", color: theme.palette.success }
	}, [
		exitConfirmKey,
		mode.type,
		turn.thinking,
		turn.activeTools,
		turn.bufferedStream,
		turn.busy,
		theme,
	])

	const completedEvents = useMemo<TimelineEvent[]>(() => {
		const events: TimelineEvent[] = []
		const info = buildSessionInfo(version, skills, hasAgentsMd, permissionMode)
		events.push({ id: "session-started", type: "SessionStarted", content: info })
		if (updateInfo?.hasUpdate) {
			events.push({
				id: "update-available",
				type: "UpdateAvailable",
				current: updateInfo.current,
				latest: updateInfo.latest,
			})
		}
		events.push(...deriveEventsFromMessages(session.messages))
		return events
	}, [session.messages, version, skills, hasAgentsMd, updateInfo, permissionMode])

	const activeEvents = useMemo<TimelineEvent[]>(() => {
		const events: TimelineEvent[] = []

		if (turn.thinking) {
			events.push({ id: "active-thinking", type: "Thinking" })
		}

		if (turn.bufferedStream) {
			events.push({
				id: "active-text",
				type: "AssistantMessage",
				content: turn.bufferedStream,
			})
		}

		for (const t of turn.activeTools) {
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

		if (
			turn.busy &&
			!turn.thinking &&
			!turn.bufferedStream &&
			turn.activeTools.length === 0 &&
			mode.type === "chat"
		) {
			events.push({ id: "active-working", type: "Thinking" })
		}

		return events
	}, [turn.thinking, turn.bufferedStream, turn.activeTools, turn.busy, mode.type])

	const allEvents = useMemo<TimelineEvent[]>(
		() => [...completedEvents, ...activeEvents],
		[completedEvents, activeEvents],
	)

	useInput((ch, key) => {
		if (key.ctrl && (ch === "c" || ch === "d")) {
			if (turn.busy) {
				if (ch === "c") turn.abort()
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
			if (turn.busy) {
				turn.abort()
			} else if (input) {
				setInput("")
			}
			return
		}

		if (key.pageUp) {
			scroll.scrollBy(Math.max(1, (scroll.heights.viewport || terminalRows) - 1))
			return
		}
		if (key.pageDown) {
			scroll.scrollBy(-Math.max(1, (scroll.heights.viewport || terminalRows) - 1))
			return
		}
		if (key.home) {
			scroll.scrollToTop()
			return
		}
		if (key.end) {
			scroll.scrollToBottom()
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
				if (match) setInput(`/${match.name} `)
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

		if (turn.busy) return

		let line = input.trim()
		if (!line) return

		if (isTypingCmd && suggestions.length > 0) {
			const match = suggestions[selCmdIdx]
			if (match) line = `/${match.name}`
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
				turn.setBusy(true)
			}
			dispatch(
				line,
				agent,
				store,
				session.sessionId,
				prompts,
				exit,
				session.switchSession,
				session.newSession,
				skills,
			).then((r) => {
				turn.setBusy(false)
				if (r) {
					session.commitMsg({ role: "assistant", content: r })
				}
			})
			return
		}

		const userMsg: ModelMessage = { role: "user", content: line }
		session.commitMsg(userMsg)

		const ctrl = new AbortController()
		void turn.run(ctrl)
	})

	return (
		<Box flexDirection="column" width="100%" height={terminalRows}>
			<Conversation
				events={allEvents}
				scrollOffset={scroll.scrollOffset}
				onLayout={scroll.onLayout}
			/>
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
			/>
		</Box>
	)
}
