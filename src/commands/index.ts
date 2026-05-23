import chalk from "chalk"
import type { Agent } from "../agent/agent.ts"
import type { SessionStore } from "../session/store.ts"
import type { Cmd, Prompts } from "../types.ts"
import { checkForUpdate, runUpdate } from "../update.ts"
import { handleCompact } from "./compact.ts"
import { handleModels } from "./models.ts"
import { handleProviders } from "./providers.ts"

export const COMMANDS: Cmd[] = [
	{ name: "models", desc: "Switch model", aliases: ["model"] },
	{ name: "providers", desc: "Manage providers", aliases: ["prov", "config", "cfg"] },
	{ name: "compact", desc: "Compact context" },
	{ name: "resume", desc: "Resume previous session" },
	{ name: "update", desc: "Update novacode" },
	{ name: "help", desc: "Show help" },
	{ name: "clear", desc: "Clear screen" },
	{ name: "quit", desc: "Exit (Ctrl+D)", aliases: ["exit"] },
]

const HELP = `
${chalk.bold("Commands:")}
${COMMANDS.map((c) => `  /${c.name.padEnd(12)} ${c.desc}`).join("\n")}

${chalk.bold("CLI:")}
  nova update        Update to latest version
  nova --session ls  List sessions

${chalk.dim("Keys:")}
  Esc             Abort
  ↑ / ↓           History
`

export async function dispatch(
	input: string,
	agent: Agent,
	store?: SessionStore,
	sessionId?: string,
	prompts?: Prompts,
): Promise<string | null> {
	const [cmd, ...rest] = input.slice(1).split(" ")
	const args = rest.join(" ")

	switch (cmd) {
		case "models":
		case "model":
			return handleModels(args, agent, prompts)
		case "providers":
		case "prov":
		case "config":
		case "cfg":
			return handleProviders(agent, prompts)
		case "compact":
			if (!store || !sessionId) return chalk.red("Session store not available")
			return handleCompact(agent, store, sessionId)
		case "resume":
			return "Use `nova --resume` from the CLI to resume your last session."
		case "update":
			return handleUpdate()
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

async function handleUpdate(): Promise<string> {
	const info = await checkForUpdate()
	if (!info) return chalk.yellow("Could not check for updates.")
	if (!info.hasUpdate) return chalk.green(`✓ Already up to date (v${info.current})`)

	console.log(chalk.yellow(`\n⚡ Updating novacode to v${info.latest}...`))
	const success = await runUpdate(true)
	if (success) {
		return chalk.green(
			`✓ Successfully updated to v${info.latest}! Please restart nova to apply changes.`,
		)
	}
	return chalk.red("✗ Update failed. Please try running 'nova update' manually in your terminal.")
}
