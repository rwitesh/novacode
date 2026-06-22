import type { ModelMessage } from "ai"
import { useCallback, useEffect, useState } from "react"
import type { Agent } from "../../agent/agent.ts"
import { loadAuth } from "../../config/store.ts"
import type { SessionStore } from "../../db/sessionStore.ts"
import { getModel, getProvider } from "../../models/lookup.ts"

/**
 * Hook that manages the state of the active workspace session and history.
 *
 * It bridges state between the local React tree (so updates render instantly), the stateful
 * Agent instance (which handles model interactions), and the persistent SQLite database store
 * (restoring history on resume and saving new message lines).
 */
export function useSession(
	agent: Agent,
	store: SessionStore,
	initialSessionId: string,
	initialHistory: ModelMessage[],
) {
	const [sessionId, setSessionId] = useState(initialSessionId)
	const [messages, setMessages] = useState<ModelMessage[]>(initialHistory)
	const [contextTokens, setContextTokens] = useState(0)
	// Ephemeral UI-only affordances (slash-command output, settings confirmations).
	// Never persisted to the store nor fed to the model — not part of the session record.
	const [notices, setNotices] = useState<string[]>([])

	useEffect(() => {
		async function fetchSession() {
			try {
				const s = await store.get(initialSessionId)
				if (s) setContextTokens(s.contextTokens)
			} catch (err) {
				console.error("Failed to load initial session context size:", err)
			}
		}
		void fetchSession()
	}, [store, initialSessionId])

	// Commits a single message (e.g. user input query or assistant turn output).
	const commitMsg = useCallback(
		(msg: ModelMessage) => {
			setMessages((prev) => [...prev, msg])
			agent.appendMessages([msg])
			store.append(sessionId, msg).catch((err) => {
				console.error("Error appending message to session store:", err)
			})
		},
		[agent, store, sessionId],
	)

	// Shows a transient UI notice (e.g. slash-command output, settings confirmation).
	// Updates only React state for rendering — never reaches agent.messages or the store.
	const addNotice = useCallback((text: string) => {
		setNotices((prev) => [...prev, text])
	}, [])

	const clearNotices = useCallback(() => setNotices([]), [])

	// Commits a block of delta messages (e.g. generated during assistant stream/thinking/tools).
	const commitDelta = useCallback(
		async (delta: ModelMessage[]) => {
			for (const msg of delta) {
				await store.append(sessionId, msg)
			}

			setMessages((prev) => [...prev, ...delta])
			agent.appendMessages(delta)

			// Scan the committed parts to update active tools state (pruning completed tools).
			const committedToolCallIds = new Set<string>()
			for (const msg of delta) {
				if (msg.role === "assistant" && Array.isArray(msg.content)) {
					for (const part of msg.content) {
						if (part.type === "tool-call") committedToolCallIds.add(part.toolCallId)
					}
				}
				if (msg.role === "tool" && Array.isArray(msg.content)) {
					for (const part of msg.content) {
						if (part.type === "tool-result") committedToolCallIds.add(part.toolCallId)
					}
				}
			}

			const committedText = delta.some(
				(msg) =>
					msg.role === "assistant" &&
					(typeof msg.content === "string"
						? msg.content.trim().length > 0
						: msg.content.some((part) => part.type === "text" && part.text.trim().length > 0)),
			)

			return { committedToolCallIds, committedText }
		},
		[agent, store, sessionId],
	)

	// Switches the active workspace session and loads its full historical lineage.
	const switchSession = useCallback(
		async (newSessionId: string) => {
			const s = await store.get(newSessionId)
			if (!s) return

			// Adjust model config to match the stored session settings.
			const provider = getProvider(s.provider)
			const model = getModel(s.provider, s.model)
			if (provider && model) {
				const auth = await loadAuth()
				const apiKey = auth.apiKeys[s.provider] || ""
				agent.updateConfig({ provider: provider.id, model, apiKey })
			}

			const activeMsgs = await store.messages(newSessionId)
			const fullHistory = await store.history(newSessionId)

			// Clear screen so <Static> remounts cleanly with the new session's history.
			if (process.stdout.isTTY) {
				process.stdout.write("\x1b[2J\x1b[3J\x1b[H")
			}

			agent.setMessages(activeMsgs)
			setMessages(fullHistory)
			setSessionId(newSessionId)
			setNotices([])

			if (model) setContextTokens(s.contextTokens)
		},
		[agent, store],
	)

	// Initializes a clean workspace session.
	const newSession = useCallback(async () => {
		const m = agent.model
		const session = await store.create(process.cwd(), m.id, m.provider)

		// Clear screen so <Static> remounts cleanly with no prior history.
		if (process.stdout.isTTY) {
			process.stdout.write("\x1b[2J\x1b[3J\x1b[H")
		}

		agent.setMessages([])
		setMessages([])
		setSessionId(session.id)
		setContextTokens(0)
		setNotices([])
	}, [agent, store])

	return {
		sessionId,
		messages,
		contextTokens,
		setContextTokens,
		commitMsg,
		commitDelta,
		switchSession,
		newSession,
		notices,
		addNotice,
		clearNotices,
	}
}
