import chalk from "chalk"
import type { Agent } from "../agent/agent.ts"
import { compact as runCompact } from "../session/compact.ts"
import type { SessionStore } from "../session/store.ts"

export async function handleCompact(
	agent: Agent,
	store: SessionStore,
	sessionId: string,
): Promise<{ result: string; newSessionId?: string }> {
	const res = await runCompact(
		store,
		sessionId,
		agent.messages,
		agent.model,
		agent.apiKey,
		agent.baseUrl,
		process.cwd(),
	)

	if (res.compacted) {
		const msgs = await store.messages(res.newSessionId ?? sessionId)
		agent.setMessages(msgs)
		const pct = Math.round(((res.tokensBefore - res.tokensAfter) / res.tokensBefore) * 100)
		return {
			result: chalk.green(`✓ Compacted (${pct}% reduction)`),
			newSessionId: res.newSessionId,
		}
	}

	return { result: chalk.yellow("Context is small enough, no compaction needed.") }
}
