import type { ModelMessage } from "ai"
import { useInput } from "ink"
import { useEffect, useMemo, useRef, useState } from "react"
import type { Agent } from "../../agent/agent.ts"
import { COMMANDS, dispatch } from "../../commands/index.ts"
import type { SessionStore } from "../../db/sessionStore.ts"
import type { Prompts, Skill } from "../../types.ts"
import { deleteLastGrapheme } from "../helpers.ts"
import type { PromptMode } from "../types.ts"

/**
 * Hook that registers the Ink console input listener and manages the input composer lifecycle.
 *
 * It acts as the keyboard router for the CLI:
 * - Detects control keys to abort executing tasks or exit the application.
 * - Routes navigation keys (arrows, page up/down, home/end) to scroll controls or history lists.
 * - Handles auto-completion triggers for slash commands.
 * - Accumulates characters in the input composer.
 * - Parses and dispatches slash commands or triggers a new agent execution turn.
 */
export function useInputHandler({
	agent,
	store,
	session,
	turn,
	prompts,
	mode,
	exit,
	handlePermissionSwitch,
	skills,
}: {
	agent: Agent
	store: SessionStore
	session: {
		sessionId: string
		commitMsg: (msg: ModelMessage) => Promise<void>
		switchSession: (id: string) => Promise<void>
		newSession: () => Promise<void>
		addNotice: (text: string) => void
		clearNotices: () => void
	}
	turn: {
		busy: boolean
		run: (ctrl: AbortController) => Promise<void>
		abort: () => void
	}
	prompts: Prompts
	mode: PromptMode
	exit: () => void
	handlePermissionSwitch: () => Promise<void>
	skills: Skill[]
}) {
	const [input, setInput] = useState("")
	const [selCmdIdx, setSelCmdIdx] = useState(0)
	const [exitConfirmKey, setExitConfirmKey] = useState<"C" | null>(null)

	const lastExitPress = useRef<{ key: "C"; ts: number } | null>(null)
	const history = useRef<string[]>([])
	const hIdx = useRef(-1)
	const submitting = useRef(false)
	const submissionCtrl = useRef<AbortController | null>(null)
	const [commandBusy, setCommandBusy] = useState(false)
	const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

	useEffect(
		() => () => {
			submissionCtrl.current?.abort()
			if (exitTimer.current) clearTimeout(exitTimer.current)
		},
		[],
	)

	// Reset command suggestion selection when input query changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset selection on input change
	useEffect(() => {
		setSelCmdIdx(0)
	}, [input])

	const isTypingCmd = input.startsWith("/") && !input.includes(" ")

	// Filter suggestions based on typed command prefix.
	const suggestions = useMemo(() => {
		if (!isTypingCmd) return []
		const query = input.slice(1).toLowerCase()
		return COMMANDS.filter(
			(c) => c.name.startsWith(query) || c.aliases?.some((a) => a.startsWith(query)),
		)
	}, [input, isTypingCmd])

	useInput((ch, key) => {
		// --- 1. System Keys (Exit and Abort Control) ---
		if (key.ctrl && (ch === "c" || ch === "d")) {
			if (turn.busy || submissionCtrl.current) {
				if (ch === "c") {
					submissionCtrl.current?.abort()
					turn.abort()
				}
				return
			}
			if (submitting.current && ch === "c") turn.abort()
			if (ch === "d") {
				exit()
				return
			}

			// double-press Ctrl+C safety threshold
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
				if (exitTimer.current) clearTimeout(exitTimer.current)
				exitTimer.current = setTimeout(() => {
					if (lastExitPress.current?.key === "C" && Date.now() - lastExitPress.current.ts >= 2000) {
						lastExitPress.current = null
						setExitConfirmKey(null)
					}
				}, 2000)
			}
			return
		}

		// When a prompt modal is active (e.g. permission approval or option selection),
		// it captures inputs directly and ignores standard chat composer keys.
		if (mode.type !== "chat") return

		if (key.escape) {
			if (turn.busy || submissionCtrl.current) {
				submissionCtrl.current?.abort()
				turn.abort()
			} else if (input) {
				setInput("")
			}
			return
		}

		// --- 2. Autocomplete / Suggestions / Command History recall ---
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

		// --- 3. Text Modification & Accumulation ---
		if (!key.return) {
			setInput((prev) => {
				if (key.backspace || key.delete) return deleteLastGrapheme(prev)
				if (key.ctrl || key.meta) return prev
				return prev + (ch || "")
			})
			return
		}

		// Do not process text submissions if the agent turn loop is actively running.
		if (turn.busy || submitting.current) return

		let line = input.trim()
		if (!line) return

		// Complete typed suggestions on enter.
		if (isTypingCmd && suggestions.length > 0) {
			const match = suggestions[selCmdIdx]
			if (match) line = `/${match.name}`
		}

		submitting.current = true
		setInput("")
		history.current.unshift(line)
		hIdx.current = -1

		// --- 4. Action Dispatcher (Slash Commands vs. Prompt Submission) ---
		if (line.startsWith("/")) {
			const cmdParts = line.slice(1).split(" ")
			const cmdName = cmdParts[0]?.toLowerCase()
			const matchedCmd = COMMANDS.find(
				(c) => c.name === cmdName || c.aliases?.includes(cmdName ?? ""),
			)

			setCommandBusy(true)
			const runDispatch = async () => {
				try {
					if (matchedCmd?.name === "permission") {
						await handlePermissionSwitch()
						return
					}
					const r = await dispatch(
						line,
						agent,
						store,
						session.sessionId,
						prompts,
						exit,
						session.switchSession,
						session.newSession,
						skills,
					)
					if (r) {
						session.addNotice(r)
					}
				} catch (err) {
					console.error(`Command dispatch error for "${line}":`, err)
				} finally {
					submitting.current = false
					setCommandBusy(false)
				}
			}
			void runDispatch()
			return
		}

		// Standard prompt query submission to LLM.
		const userMsg: ModelMessage = { role: "user", content: line }
		session.clearNotices()
		const ctrl = new AbortController()
		submissionCtrl.current = ctrl
		const submit = async () => {
			try {
				await session.commitMsg(userMsg)
				if (!ctrl.signal.aborted) await turn.run(ctrl)
			} catch (err) {
				console.error("Failed to persist or run the agent turn:", err)
			} finally {
				submissionCtrl.current = null
				submitting.current = false
			}
		}
		void submit()
	})

	return {
		input,
		commandBusy,
		suggestions,
		selCmdIdx,
		exitConfirmKey,
	}
}
