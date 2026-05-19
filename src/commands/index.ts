import chalk from "chalk"
import type { Agent } from "../agent/agent.ts"
import type { SessionStore } from "../session/store.ts"
import { handleCompact } from "./compact.ts"
import { handleConfig } from "./config.ts"
import { handleModels } from "./models.ts"

const HELP = `
${chalk.bold("Commands:")}
  /models [id]    Switch model
  /config         Manage providers
  /compact        Compact context
  /help           This help
  /clear          Clear screen
  /quit           Exit (Ctrl+D)

${chalk.dim("Keys:")}
  Esc             Abort
  ↑ / ↓           History
`

export async function dispatch(
	input: string,
	agent: Agent,
	store?: SessionStore,
	sessionId?: string,
): Promise<string | null> {
	const [cmd, ...rest] = input.slice(1).split(" ")
	const args = rest.join(" ")

	switch (cmd) {
		case "models":
		case "model":
			return handleModels(args, agent)
		case "config":
		case "cfg":
			return handleConfig(agent)
		case "compact":
			if (!store || !sessionId) return chalk.red("Session store not available")
			return handleCompact(agent, store, sessionId)
		case "help":
			return HELP
		case "clear":
			console.clear()
			return ""
		case "quit":
			process.exit(0)
			return null
		case "exit":
			process.exit(0)
			return null
		default:
			return chalk.yellow(`Unknown: /${cmd}. Type /help`)
	}
}
