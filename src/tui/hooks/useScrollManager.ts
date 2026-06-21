import { useCallback, useEffect, useRef, useState } from "react"

export function useScrollManager() {
	const [scrollOffset, setScrollOffset] = useState(0)
	const [heights, setHeights] = useState({ viewport: 0, content: 0 })
	const [userScrolled, setUserScrolled] = useState(false)
	const prevMaxOffset = useRef(0)

	const maxOffset = Math.max(0, heights.content - heights.viewport)

	useEffect(() => {
		const delta = maxOffset - prevMaxOffset.current
		prevMaxOffset.current = maxOffset
		if (delta <= 0) {
			setScrollOffset((prev) => Math.min(prev, maxOffset))
			return
		}
		if (!userScrolled) {
			setScrollOffset(0)
		} else {
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
