import type { ModelMessage } from "ai"
import { useInput } from "ink"
import { useEffect, useMemo, useRef, useState } from "react"
import type { Agent } from "../../agent/agent.ts"
import { COMMANDS, dispatch } from "../../commands/index.ts"
import type { SessionStore } from "../../db/sessionStore.ts"
import type { Prompts, Skill } from "../../types.ts"
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
		commitMsg: (msg: ModelMessage) => void
		switchSession: (id: string) => Promise<void>
		newSession: () => Promise<void>
		addNotice: (text: string) => void
		clearNotices: () => void
	}
	turn: {
		busy: boolean
		setBusy: (b: boolean) => void
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
			if (turn.busy) {
				if (ch === "c") turn.abort()
				return
			}
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
				setTimeout(() => {
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
			if (turn.busy) {
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
				if (key.backspace || key.delete) return prev.slice(0, -1)
				return prev + (ch || "")
			})
			return
		}

		// Do not process text submissions if the agent turn loop is actively running.
		if (turn.busy) return

		let line = input.trim()
		if (!line) return

		// Complete typed suggestions on enter.
		if (isTypingCmd && suggestions.length > 0) {
			const match = suggestions[selCmdIdx]
			if (match) line = `/${match.name}`
		}

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

			if (matchedCmd?.name === "permission") {
				void handlePermissionSwitch()
				return
			}

			const runDispatch = async () => {
				if (line === "/compact") {
					turn.setBusy(true)
				}
				try {
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
					turn.setBusy(false)
				}
			}
			void runDispatch()
			return
		}

		// Standard prompt query submission to LLM.
		const userMsg: ModelMessage = { role: "user", content: line }
		session.clearNotices()
		session.commitMsg(userMsg)

		const ctrl = new AbortController()
		void turn.run(ctrl)
	})

	return {
		input,
		setInput,
		suggestions,
		selCmdIdx,
		exitConfirmKey,
	}
}
