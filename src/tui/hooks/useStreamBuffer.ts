import { useCallback, useRef, useState } from "react"
import { StreamingMarkdownRenderer } from "../markdown/index.ts"

const FLUSH_MS = 16

/**
 * Hook that manages a streaming text buffer with frame-rate-limited flushes
 * and incremental markdown rendering.
 *
 * - `append(text)`: add a text delta (called from the event loop)
 * - `bufferedStream`: the current rendered text (updated at ~60fps)
 * - `reset()`: clear all state for a new turn
 *
 * Internally, deltas accumulate in a raw buffer. A 16ms timer flushes
 * the buffer into state, triggering a React re-render. This prevents
 * per-delta renders while keeping the stream smooth.
 */
export function useStreamBuffer(): {
	bufferedStream: string
	append: (text: string) => void
	reset: () => void
} {
	const [bufferedStream, setBufferedStream] = useState("")
	const rawBuf = useRef("")
	const renderer = useRef(new StreamingMarkdownRenderer())
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const dirty = useRef(false)

	const flush = useCallback(() => {
		timer.current = null
		if (!dirty.current) return
		dirty.current = false
		const raw = rawBuf.current
		const rendered = renderer.current.update(raw)
		setBufferedStream(rendered)
	}, [])

	const append = useCallback(
		(text: string) => {
			rawBuf.current += text
			dirty.current = true
			if (!timer.current) {
				timer.current = setTimeout(flush, FLUSH_MS)
			}
		},
		[flush],
	)

	const reset = useCallback(() => {
		if (timer.current) {
			clearTimeout(timer.current)
			timer.current = null
		}
		rawBuf.current = ""
		dirty.current = false
		renderer.current.reset()
		setBufferedStream("")
	}, [])

	return { bufferedStream, append, reset }
}
