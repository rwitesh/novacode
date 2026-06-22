import type { ModelMessage } from "ai"
import { useEffect, useMemo, useState } from "react"
import type { PermissionMode, Skill } from "../../types.ts"
import { checkForUpdate } from "../../update.ts"
import { buildSessionInfo, deriveEventsFromMessages } from "../helpers.ts"
import type { TimelineEvent } from "../types.ts"

const TIPS = [
	"Press / to open commands.",
	"Use @ to reference files.",
	"Press Esc to cancel input.",
	"Use arrow keys to navigate history.",
	"Use Tab for autocomplete.",
	"Use Shift+Tab to move backwards.",
	"Use Ctrl+C to stop execution.",
	"Scroll terminal scrollback to review history.",
	"Use /compact to shrink context when it gets long.",
	"Use /models to switch providers and models.",
	"Use /sessions to browse and resume past sessions.",
	"Use /skills to list auto-loaded agent skills.",
]

const ROTATE_MS = 8000

/**
 * Hook that constructs the unified TUI event timeline and tracks token usage.
 *
 * It aggregates completed historical events (derived from message history) and active
 * streaming/thinking/tool execution events (derived from the current agent execution turn).
 * It also manages background checks for CLI updates and cycles helpful tips.
 */
export function useTuiTimeline({
	messages,
	contextTokens,
	version,
	skills,
	hasAgentsMd,
	permissionMode,
	turn,
}: {
	messages: ModelMessage[]
	contextTokens: number
	version: string
	skills: Skill[]
	hasAgentsMd: boolean
	permissionMode: PermissionMode
	turn: {
		thinking: boolean
		bufferedStream: string
		activeTools: Array<{
			id: string
			name: string
			args: string
			status: "running" | "success" | "failure"
			error?: string
			lineCount?: number
			matchCount?: number
		}>
		busy: boolean
	}
}) {
	const [updateInfo, setUpdateInfo] = useState<{
		hasUpdate: boolean
		current: string
		latest: string
	} | null>(null)
	const [tipIdx, setTipIdx] = useState(0)

	// Fetch update information from registry on mount.
	useEffect(() => {
		async function checkUpdate() {
			try {
				const info = await checkForUpdate()
				if (info?.hasUpdate) {
					setUpdateInfo({ hasUpdate: true, current: info.current, latest: info.latest })
				}
			} catch (err) {
				console.error("Failed to check for updates:", err)
			}
		}
		void checkUpdate()
	}, [])

	// Rotate CLI tips every 8 seconds to improve discoverability of keyboard shortcuts.
	useEffect(() => {
		const id = setInterval(() => {
			setTipIdx((i) => (i + 1) % TIPS.length)
		}, ROTATE_MS)
		return () => clearInterval(id)
	}, [])

	const tip = TIPS[tipIdx]!

	// Committed history: rendered once via <Static> into terminal scrollback.
	const committedEvents = useMemo<TimelineEvent[]>(
		() => deriveEventsFromMessages(messages),
		[messages],
	)

	// Live (non-persistent) events: splash, update banner, streaming, thinking, active tools.
	const liveEvents = useMemo<TimelineEvent[]>(() => {
		const events: TimelineEvent[] = []

		if (messages.length === 0) {
			events.push({
				id: "splash",
				type: "Splash",
				content: buildSessionInfo(version, skills, hasAgentsMd, permissionMode),
				update: updateInfo?.hasUpdate
					? { current: updateInfo.current, latest: updateInfo.latest }
					: undefined,
			})
		} else if (updateInfo?.hasUpdate) {
			events.push({
				id: "update-available",
				type: "UpdateAvailable",
				current: updateInfo.current,
				latest: updateInfo.latest,
			})
		}

		if (turn.thinking) {
			events.push({ id: "active-thinking", type: "Thinking" })
		}

		if (turn.bufferedStream) {
			events.push({
				id: "active-text",
				type: "AssistantMessage",
				content: turn.bufferedStream,
			})
		}

		for (const t of turn.activeTools) {
			if (t.status === "running") {
				events.push({
					id: t.id,
					type: "ToolStarted",
					toolCallId: t.id,
					toolName: t.name,
					args: t.args,
				})
			} else if (t.status === "success") {
				events.push({
					id: t.id,
					type: "ToolCompleted",
					toolCallId: t.id,
					toolName: t.name,
					args: t.args,
					resultLineCount: t.lineCount,
					resultMatchCount: t.matchCount,
				})
			} else if (t.status === "failure") {
				events.push({
					id: t.id,
					type: "ToolFailed",
					toolCallId: t.id,
					toolName: t.name,
					args: t.args,
					error: t.error ?? "Unknown error",
				})
			}
		}

		if (turn.busy && !turn.thinking && !turn.bufferedStream) {
			events.push({ id: "active-working", type: "Thinking" })
		}

		return events
	}, [
		messages.length,
		version,
		skills,
		hasAgentsMd,
		permissionMode,
		updateInfo,
		turn.thinking,
		turn.bufferedStream,
		turn.activeTools,
		turn.busy,
	])

	return {
		committedEvents,
		liveEvents,
		contextTokens,
		tip,
	}
}
