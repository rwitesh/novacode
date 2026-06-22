import type { ModelMessage } from "ai"
import { Box, render, useApp, useWindowSize } from "ink"
import { useMemo, useState } from "react"
import type { Agent } from "../agent/agent.ts"
import type { SessionStore } from "../db/sessionStore.ts"
import type { PolicyEngine } from "../policy/engine.ts"
import type { PermissionMode, Skill } from "../types.ts"
import { getCurrentVersion } from "../update.ts"
import { Composer } from "./components/composer.tsx"
import { Conversation } from "./components/conversation.tsx"
import { StatusBar } from "./components/statusBar.tsx"
import { useAgentTurn } from "./hooks/useAgentTurn.ts"
import { useInputHandler } from "./hooks/useInputHandler.ts"
import { usePrompts } from "./hooks/usePrompts.ts"
import { useScroll } from "./hooks/useScroll.ts"
import { useSession } from "./hooks/useSession.ts"
import { useTuiTimeline } from "./hooks/useTuiTimeline.ts"
import { PromptOverlay } from "./prompts.tsx"
import { ThemeProvider, useTheme } from "./theme/index.tsx"

export async function interactive(
	agent: Agent,
	store: SessionStore,
	sessionId: string,
	skills: Skill[] = [],
	hasAgentsMd = false,
	policy: PolicyEngine,
): Promise<void> {
	process.stdout.write("\x1B[?25l")
	const version = await getCurrentVersion()
	const initialHistory: ModelMessage[] = await store.history(sessionId)

	if (process.stdout.isTTY) {
		process.stdout.write("\x1b[2J\x1b[3J\x1b[H")
	}

	try {
		const { waitUntilExit } = render(
			<ThemeProvider>
				<App
					agent={agent}
					store={store}
					sessionId={sessionId}
					skills={skills}
					initialHistory={initialHistory}
					policy={policy}
					version={version}
					hasAgentsMd={hasAgentsMd}
				/>
			</ThemeProvider>,
			{ exitOnCtrlC: false },
		)
		await waitUntilExit()
	} finally {
		process.stdout.write("\x1B[?25h")
		await store.prune()
	}
}

function App({
	agent,
	store,
	sessionId: initialSessionId,
	skills,
	initialHistory,
	policy,
	version,
	hasAgentsMd,
}: {
	agent: Agent
	store: SessionStore
	sessionId: string
	skills: Skill[]
	initialHistory: ModelMessage[]
	policy: PolicyEngine
	version: string
	hasAgentsMd: boolean
}) {
	const theme = useTheme()
	const { rows } = useWindowSize()
	const terminalRows = rows || 24

	const scroll = useScroll()
	const session = useSession(agent, store, initialSessionId, initialHistory)
	const turn = useAgentTurn(
		agent,
		store,
		session.sessionId,
		session.setContextTokens,
		session.commitMsg,
		session.commitDelta,
	)

	const [permissionMode, setPermissionMode] = useState<PermissionMode>(policy.mode)

	// Abstracted TUI business logic hooks
	const { mode, prompts, resolvePrompt } = usePrompts(policy)
	const { events, contextTokens, tip } = useTuiTimeline({
		messages: session.messages,
		contextTokens: session.contextTokens,
		version,
		skills,
		hasAgentsMd,
		permissionMode,
		turn,
	})

	const handlePermissionSwitch = async () => {
		const picked = await prompts.select({
			message: "Permission mode",
			options: [
				{
					value: "restricted",
					label: "Restricted — ask permission before each action",
					hint: permissionMode === "restricted" ? "current" : undefined,
				},
				{
					value: "unrestricted",
					label: "Unrestricted — run without approval (may be dangerous)",
					hint: permissionMode === "unrestricted" ? "current" : undefined,
				},
			],
		})
		if (picked !== "restricted" && picked !== "unrestricted") return
		policy.setMode(picked)
		setPermissionMode(picked)
		session.commitMsg({
			role: "assistant",
			content: `✓ Permission mode set to ${picked}.`,
		})
	}

	const { exit } = useApp()

	const { input, suggestions, selCmdIdx, exitConfirmKey } = useInputHandler({
		agent,
		store,
		session,
		turn,
		prompts,
		mode,
		exit,
		handlePermissionSwitch,
		terminalRows,
		scroll,
		skills,
	})

	const activity = useMemo(() => {
		if (exitConfirmKey === "C")
			return { label: "Press Ctrl+C again to exit", color: theme.palette.warning }
		if (mode.type === "searchSelect") return { label: "Filtering...", color: theme.palette.primary }
		if (mode.type !== "chat") return { label: "Waiting for input", color: theme.palette.muted }
		return { label: "/help", color: theme.palette.muted }
	}, [exitConfirmKey, mode.type, theme])

	const composerSuggestions = mode.type === "chat" ? suggestions : []

	return (
		<Box flexDirection="column" width="100%" height={terminalRows}>
			<Conversation events={events} scrollOffset={scroll.scrollOffset} onLayout={scroll.onLayout} />
			{mode.type !== "chat" && <PromptOverlay mode={mode} onResolve={resolvePrompt} />}
			<Composer input={input} suggestions={composerSuggestions} selCmdIdx={selCmdIdx} />
			<StatusBar
				activity={activity.label}
				activityColor={activity.color}
				model={agent.model}
				contextTokens={contextTokens}
				tip={tip}
			/>
		</Box>
	)
}
