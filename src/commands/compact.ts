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
		const saved = res.tokensBefore - res.tokensAfter
		const pct = Math.round((saved / res.tokensBefore) * 100)
		return chalk.green(
			`✓ Compacted ~${res.tokensBefore.toLocaleString()} → ~${res.tokensAfter.toLocaleString()} tokens` +
				chalk.dim(` (~${saved.toLocaleString()} saved, ${pct}% reduction)`),
		)
	}

	if (res.tokensBefore < 500) {
		return chalk.yellow("Context is too small to benefit from compaction.")
	}

	return chalk.yellow("Context is small enough, no compaction needed.")
}
