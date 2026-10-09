import { Box, Static, useWindowSize } from "ink"
import type { TimelineEvent } from "../types.ts"
import { EventRenderer } from "./message.tsx"

export function Conversation({
	committedEvents,
	liveEvents,
}: {
	committedEvents: TimelineEvent[]
	liveEvents: TimelineEvent[]
}) {
	const { columns } = useWindowSize()
	const width = columns ?? 80

	return (
		<Box flexDirection="column" flexGrow={1}>
			<Static items={committedEvents} style={{ width }}>
				{(event) => <EventRenderer key={event.id} event={event} />}
			</Static>
			<Box flexDirection="column" flexShrink={1} overflowY="hidden" justifyContent="flex-end">
				<Box flexDirection="column" flexShrink={0}>
					{liveEvents.map((event) => (
						<EventRenderer key={event.id} event={event} />
					))}
				</Box>
			</Box>
		</Box>
	)
}
