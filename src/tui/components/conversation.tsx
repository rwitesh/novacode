import { Box, useBoxMetrics } from "ink"
import { useEffect, useRef } from "react"
import type { TimelineEvent } from "../types.ts"
import { EventRenderer } from "./message.tsx"

export function Conversation({
	events,
	scrollOffset,
	onLayout,
}: {
	events: TimelineEvent[]
	scrollOffset: number
	onLayout?: (metrics: { viewport: number; content: number }) => void
}) {
	const viewportRef = useRef(null)
	const contentRef = useRef(null)
	const viewportMetrics = useBoxMetrics(viewportRef)
	const contentMetrics = useBoxMetrics(contentRef)

	useEffect(() => {
		onLayout?.({
			viewport: viewportMetrics.height,
			content: contentMetrics.height,
		})
	}, [viewportMetrics.height, contentMetrics.height, onLayout])

	const maxOffset = Math.max(0, contentMetrics.height - viewportMetrics.height)
	const top = scrollOffset - maxOffset

	return (
		<Box ref={viewportRef} flexGrow={1} flexDirection="column" overflow="hidden">
			<Box ref={contentRef} flexDirection="column" position="relative" top={top}>
				{events.map((event) => (
					<EventRenderer key={event.id} event={event} />
				))}
			</Box>
		</Box>
	)
}
