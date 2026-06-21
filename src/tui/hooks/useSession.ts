import type { ModelMessage } from "ai"
import { useCallback, useEffect, useRef, useState } from "react"
import type { Agent } from "../../agent/agent.ts"
import { loadAuth } from "../../config/store.ts"
import type { SessionStore } from "../../db/sessionStore.ts"
import { getModel, getProvider } from "../../models/lookup.ts"

export function useSession(
	agent: Agent,
	store: SessionStore,
	initialSessionId: string,
	initialHistory: ModelMessage[],
) {
	const [sessionId, setSessionId] = useState(initialSessionId)
	const [messages, setMessages] = useState<ModelMessage[]>(initialHistory)
	const [outputTokens, setOutputTokens] = useState(0)
	const systemPromptShown = useRef(initialHistory.length > 0)

	useEffect(() => {
		store.get(initialSessionId).then((s) => {
			if (s) setOutputTokens(s.outputTokens)
		})
	}, [store, initialSessionId])

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

	const commitDelta = useCallback(
		async (delta: ModelMessage[]) => {
			for (const msg of delta) {
				await store.append(sessionId, msg)
			}

			setMessages((prev) => [...prev, ...delta])
			agent.appendMessages(delta)

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

	const switchSession = useCallback(
		async (newSessionId: string) => {
			const s = await store.get(newSessionId)
			if (!s) return

			const provider = getProvider(s.provider)
			const model = getModel(s.provider, s.model)
			if (provider && model) {
				const auth = await loadAuth()
				const apiKey = auth.apiKeys[s.provider] || ""
				agent.updateConfig({ provider: provider.id, model, apiKey })
			}

			const activeMsgs = await store.messages(newSessionId)
			const fullHistory = await store.history(newSessionId)
			agent.setMessages(activeMsgs)
			setMessages(fullHistory)
			setSessionId(newSessionId)

			if (model) setOutputTokens(s.outputTokens)
		},
		[agent, store],
	)

	const newSession = useCallback(async () => {
		const m = agent.model
		const session = await store.create(process.cwd(), m.id, m.provider)
		agent.setMessages([])
		setMessages([])
		setSessionId(session.id)
		setOutputTokens(0)
	}, [agent, store])

	return {
		sessionId,
		messages,
		outputTokens,
		systemPromptShown,
		setOutputTokens,
		commitMsg,
		commitDelta,
		switchSession,
		newSession,
	}
}
