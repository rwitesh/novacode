import type { ToolResultOutput } from "@ai-sdk/provider-utils"
import type { ModelMessage } from "ai"
import { useCallback, useRef, useState } from "react"
import type { Agent } from "../../agent/agent.ts"
import { generateSessionTitle } from "../../compact.ts"
import { summarizeToolOutput } from "../../content.ts"
import type { SessionStore } from "../../db/sessionStore.ts"
import { formatToolArgs } from "../../format.ts"
import { StreamingMarkdownRenderer } from "../markdown/index.ts"
import type { ActiveTool } from "../types.ts"

const FLUSH_MS = 16

/**
 * Extracts a human-readable error message from an API or execution error object.
 */
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

/**
 * Hook that manages the execution lifecycle of a single agent turn.
 *
 * It initiates the call to the agent provider, loops over the streaming response parts,
 * updates the list of active tools executing on the host machine, and records token usage
 * and generated messages in the database.
 *
 * It also encapsulates the frame-rate-limited stream buffering to smooth out rendering:
 * raw markdown updates are accumulated in a ref buffer and flushed to React state at 60fps
 * (every 16ms) to avoid choking the React layout engine during fast stream deliveries.
 */
export function useAgentTurn(
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

	// Stream buffering states & refs
	const [bufferedStream, setBufferedStream] = useState("")
	const rawBuf = useRef("")
	const renderer = useRef(new StreamingMarkdownRenderer())
	const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const dirty = useRef(false)

	// Flushes the accumulated raw string delta through the markdown renderer to state.
	const flushStream = useCallback(() => {
		flushTimer.current = null
		if (!dirty.current) return
		dirty.current = false
		const raw = rawBuf.current
		const rendered = renderer.current.update(raw)
		setBufferedStream(rendered)
	}, [])

	// Appends streaming text to the raw buffer and schedules a throttle timer.
	const appendStream = useCallback(
		(text: string) => {
			rawBuf.current += text
			dirty.current = true
			if (!flushTimer.current) {
				flushTimer.current = setTimeout(flushStream, FLUSH_MS)
			}
		},
		[flushStream],
	)

	// Resets the streaming buffer state.
	const resetStream = useCallback(() => {
		if (flushTimer.current) {
			clearTimeout(flushTimer.current)
			flushTimer.current = null
		}
		rawBuf.current = ""
		dirty.current = false
		renderer.current.reset()
		setBufferedStream("")
	}, [])

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
				// The agent.prompt call initiates the AI SDK stream loop.
				// We supply an onStepFinish handler to checkpoint generated messages
				// and database records as soon as each turn step (e.g. tool execution) completes.
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
						// Clear transient streaming text once it becomes a committed assistant message.
						if (committedText) resetStream()
					}
				})

				// Read text deltas, reasoning blocks, and tool events in real time.
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

				// Complete any uncommitted messages remaining at the end of the stream.
				const resp = await result.response
				const finalDelta = resp.messages.slice(committedRef.current)
				if (finalDelta.length > 0) await commitDelta(finalDelta)

				// Automatically generate a session title if this is the first interaction turn.
				try {
					const s = await store.get(sessionId)
					if (s && !s.title && agent.messages.length >= 2) {
						const title = await generateSessionTitle(agent.messages, agent.model, agent.apiKey)
						if (title) {
							await store.setTitle(sessionId, title)
						}
					}
				} catch (err) {
					console.error("Failed to generate or save session title:", err)
				}
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
