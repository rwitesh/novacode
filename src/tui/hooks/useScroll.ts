import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Hook that manages terminal scroll offset and viewport/content dimensions.
 *
 * NOTE: In this terminal UI, `scrollOffset` represents the distance (in rows)
 * scrolled UP from the bottom of the list. Thus:
 * - `scrollOffset === 0` means the viewport is scrolled all the way to the bottom.
 * - `scrollOffset === maxOffset` means the viewport is scrolled to the very top.
 * This convention simplifies auto-scroll-to-bottom behavior as content grows.
 */
export function useScroll() {
	const [scrollOffset, setScrollOffset] = useState(0)
	const [heights, setHeights] = useState({ viewport: 0, content: 0 })
	const [userScrolled, setUserScrolled] = useState(false)
	const prevMaxOffset = useRef(0)

	const maxOffset = Math.max(0, heights.content - heights.viewport)

	// Adjusts the scroll offset when content size changes (e.g. streaming responses).
	useEffect(() => {
		const delta = maxOffset - prevMaxOffset.current
		prevMaxOffset.current = maxOffset

		// If maximum offset shrank or remained the same, keep offset within bounds.
		if (delta <= 0) {
			setScrollOffset((prev) => Math.min(prev, maxOffset))
			return
		}

		// If the user hasn't explicitly scrolled up, automatically stick/scroll to the bottom.
		if (!userScrolled) {
			setScrollOffset(0)
		} else {
			// If the user scrolled up, adjust scroll offset to lock the viewport position relative
			// to the items the user was looking at before new lines arrived.
			setScrollOffset((prev) => Math.min(maxOffset, prev + delta))
		}
	}, [maxOffset, userScrolled])

	const scrollBy = useCallback(
		(deltaRows: number) => {
			setUserScrolled(true)
			setScrollOffset((prev) => Math.min(maxOffset, Math.max(0, prev + deltaRows)))
		},
		[maxOffset],
	)

	const scrollToBottom = useCallback(() => {
		setUserScrolled(false)
		setScrollOffset(0)
	}, [])

	const scrollToTop = useCallback(() => {
		setUserScrolled(true)
		setScrollOffset(maxOffset)
	}, [maxOffset])

	const onLayout = useCallback((h: { viewport: number; content: number }) => {
		setHeights(h)
	}, [])

	return { scrollOffset, heights, scrollBy, scrollToBottom, scrollToTop, onLayout }
}
