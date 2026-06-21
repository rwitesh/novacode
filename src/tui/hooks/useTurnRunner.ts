import type { ToolResultOutput } from "@ai-sdk/provider-utils"
import type { ModelMessage } from "ai"
import { useCallback, useRef, useState } from "react"
import type { Agent } from "../../agent/agent.ts"
import { generateSessionTitle } from "../../compact.ts"
import { summarizeToolOutput } from "../../content.ts"
import type { SessionStore } from "../../db/sessionStore.ts"
import { formatToolArgs } from "../../format.ts"
import type { ActiveTool } from "../types.ts"
import { useStreamBuffer } from "./useStreamBuffer.ts"

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

export function useTurnRunner(
	agent: Agent,
	store: SessionStore,
	sessionId: string,
	setOutputTokens: (updater: (prev: number) => number) => void,
	commitMsg: (msg: ModelMessage) => void,
	commitDelta: (
		delta: ModelMessage[],
	) => Promise<{ committedToolCallIds: Set<string>; committedText: boolean }>,
) {
	const [busy, setBusy] = useState(false)
	const [thinking, setThinking] = useState(false)
	const [activeTools, setActiveTools] = useState<ActiveTool[]>([])
	const abortRef = useRef<AbortController | null>(null)
	const committedRef = useRef(0)
	const { bufferedStream, append: appendStream, reset: resetStream } = useStreamBuffer()

	const abort = useCallback(() => {
		abortRef.current?.abort()
		abortRef.current = null
	}, [])

	const run = useCallback(
		async (ctrl: AbortController) => {
			const signal = ctrl.signal
			abortRef.current = ctrl
			setBusy(true)
			resetStream()
			setThinking(false)
			setActiveTools([])
			committedRef.current = 0
			let streamError: unknown

			try {
				const result = await agent.prompt(signal, async (event) => {
					const u = event.usage
					if (u) {
						setOutputTokens((prev) => prev + (u.outputTokens ?? 0))
						await store.addUsage(sessionId, u.inputTokens ?? 0, u.outputTokens ?? 0)
					}
					if (event.response?.messages?.length) {
						const delta = event.response.messages.slice(committedRef.current)
						if (delta.length === 0) return
						committedRef.current = event.response.messages.length

						const { committedToolCallIds, committedText } = await commitDelta(delta)

						if (committedToolCallIds.size > 0) {
							setActiveTools((prev) => prev.filter((t) => !committedToolCallIds.has(t.id)))
						}
						if (committedText) resetStream()
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
									{ id: part.toolCallId, name: part.toolName, args, status: "running" as const },
								]
							})
							break
						}
						case "tool-result": {
							const { text, isError } = summarizeToolOutput(part.output as ToolResultOutput)
							setActiveTools((prev) =>
								prev.map((t) => {
									if (t.id !== part.toolCallId) return t
									if (isError) {
										return { ...t, status: "failure" as const, error: text }
									}
									let lineCount: number | undefined
									let matchCount: number | undefined
									if (t.name === "read") lineCount = text.split("\n").length
									else if (t.name === "grep") matchCount = text.split("\n").filter(Boolean).length
									return { ...t, status: "success" as const, lineCount, matchCount }
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
				const finalDelta = resp.messages.slice(committedRef.current)
				if (finalDelta.length > 0) await commitDelta(finalDelta)

				store
					.get(sessionId)
					.then((s) => {
						if (s && !s.title && agent.messages.length >= 2) {
							generateSessionTitle(agent.messages, agent.model, agent.apiKey)
								.then((title) => {
									if (title) store.setTitle(sessionId, title).catch(() => {})
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
				abortRef.current = null
				setBusy(false)
				resetStream()
				setThinking(false)
				setActiveTools([])
			}
		},
		[agent, store, sessionId, setOutputTokens, commitMsg, commitDelta, appendStream, resetStream],
	)

	return { busy, thinking, activeTools, bufferedStream, run, abort, setBusy }
}
