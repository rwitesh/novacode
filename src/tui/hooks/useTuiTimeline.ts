import type { ModelMessage } from "ai"
import { useEffect, useMemo, useState } from "react"
import type { Agent } from "../../agent/agent.ts"
import type { PermissionMode, Skill, Usage } from "../../types.ts"
import { checkForUpdate } from "../../update.ts"
import {
	buildSessionInfo,
	deriveEventsFromMessages,
	estimateActiveInputTokens,
} from "../helpers.ts"
import type { TimelineEvent } from "../types.ts"

const TIPS = [
	"Press / to open commands.",
	"Use @ to reference files.",
	"Press Esc to cancel input.",
	"Use arrow keys to navigate history.",
	"Use Tab for autocomplete.",
	"Use Shift+Tab to move backwards.",
	"Use Ctrl+C to stop execution.",
	"Press Page Up / Page Down to scroll history.",
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
	agent,
	messages,
	systemPromptShown,
	outputTokens,
	version,
	skills,
	hasAgentsMd,
	permissionMode,
	turn,
}: {
	agent: Agent
	messages: ModelMessage[]
	systemPromptShown: React.MutableRefObject<boolean>
	outputTokens: number
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

	// Estimates the current session token usage (inputs + outputs).
	const usage = useMemo<Usage>(() => {
		const inTokens = systemPromptShown.current
			? estimateActiveInputTokens(agent, agent.messages)
			: 0
		return { in: inTokens, out: outputTokens }
	}, [agent, outputTokens, systemPromptShown])

	// Processes historical messages and maps them to complete timeline items.
	const completedEvents = useMemo<TimelineEvent[]>(() => {
		const events: TimelineEvent[] = []
		const hasMessages = messages.length > 0

		if (!hasMessages) {
			const info = buildSessionInfo(version, skills, hasAgentsMd, permissionMode)
			events.push({
				id: "splash",
				type: "Splash",
				content: info,
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

		events.push(...deriveEventsFromMessages(messages))
		return events
	}, [messages, version, skills, hasAgentsMd, updateInfo, permissionMode])

	// Computes dynamic active events (like thinking indicator or running tools) for the current turn.
	const activeEvents = useMemo<TimelineEvent[]>(() => {
		const events: TimelineEvent[] = []

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
	}, [turn.thinking, turn.bufferedStream, turn.activeTools, turn.busy])

	const allEvents = useMemo<TimelineEvent[]>(
		() => [...completedEvents, ...activeEvents],
		[completedEvents, activeEvents],
	)

	return {
		events: allEvents,
		usage,
		tip,
	}
}
