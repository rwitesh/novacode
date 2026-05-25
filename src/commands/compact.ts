import chalk from "chalk"
import type { Agent } from "../agent/agent.ts"
import { compact as runCompact } from "../session/compact.ts"
import type { SessionStore } from "../session/store.ts"

export async function handleCompact(
	agent: Agent,
	store: SessionStore,
	sessionId: string,
): Promise<string> {
	const res = await runCompact(
		store,
		sessionId,
		agent.messages,
		agent.model,
		agent.apiKey,
		agent.baseUrl,
	)

	if (res.compacted) {
		const msgs = await store.messages(sessionId)
		agent.setMessages(msgs)
		const pct = Math.round(((res.tokensBefore - res.tokensAfter) / res.tokensBefore) * 100)
		return chalk.green(`✓ Compacted (${pct}% reduction)`)
	}

	if (res.tokensBefore < 500) {
		return chalk.yellow("Context is too small to benefit from compaction.")
	}

	return chalk.yellow("Context is small enough, no compaction needed.")
}
