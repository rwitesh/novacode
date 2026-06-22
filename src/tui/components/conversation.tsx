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
			{liveEvents.map((event) => (
				<EventRenderer key={event.id} event={event} />
			))}
		</Box>
	)
}
