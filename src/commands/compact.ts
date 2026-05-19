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
		// Update agent messages
		const msgs = store.messages(sessionId)
		agent.setMessages(msgs)
		return chalk.green(`✓ Context compacted (${res.msgsRemoved} messages removed)`)
	}

	return chalk.yellow("Context is small enough, no compaction needed.")
}
