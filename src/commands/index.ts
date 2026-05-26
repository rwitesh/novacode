import chalk from "chalk"
import type { Agent } from "../agent/agent.ts"
import type { SessionStore } from "../session/store.ts"
import type { Cmd, Prompts, Skill } from "../types.ts"
import { checkForUpdate, runUpdate } from "../update.ts"
import { formatRelativeTime } from "../util.ts"
import { handleCompact } from "./compact.ts"
import { handleModels } from "./models.ts"
import { handleProviders } from "./providers.ts"

export const COMMANDS: Cmd[] = [
	{ name: "models", desc: "Switch model", aliases: ["model"] },
	{ name: "providers", desc: "Manage providers", aliases: ["prov", "config", "cfg"] },
	{ name: "compact", desc: "Compact context" },
	{ name: "sessions", desc: "List and switch sessions" },
	{ name: "resume", desc: "Resume previous session" },
	{ name: "update", desc: "Update novacode" },
	{ name: "skills", desc: "List available skills" },
	{ name: "help", desc: "Show help" },
	{ name: "clear", desc: "Clear screen & start new session", aliases: ["new"] },
	{ name: "quit", desc: "Exit (Ctrl+D)", aliases: ["exit"] },
]

const HELP = `
${chalk.bold("Commands:")}
${COMMANDS.map((c) => `  /${c.name.padEnd(12)} ${c.desc}`).join("\n")}

${chalk.bold("CLI:")}
  nova update                   Update to latest version
  nova -s ls                    List sessions
  nova -s <id> / --sessions     Resume sessions by ID
  nova -r / --resume            Resume last sessions
  nova -s rm <id>               Delete specific sessions
  nova -s rm --all              Delete all sessions

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
	onExit?: () => void,
	onSwitchSession?: (sessionId: string) => Promise<void>,
	onNewSession?: () => Promise<void>,
	skills: Skill[] = [],
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
			{
				const { result, newSessionId } = await handleCompact(agent, store, sessionId)
				if (newSessionId && onSwitchSession) await onSwitchSession(newSessionId)
				return result
			}
		case "skills":
			return handleSkills(skills)
		case "sessions": {
			if (!store || !prompts || !onSwitchSession)
				return chalk.red("Session switching not available")
			const sessions = await store.list(50)
			if (sessions.length === 0) return chalk.yellow("No sessions found.")
			const options = sessions.map((s, idx) => {
				const relTime = formatRelativeTime(s.updated)
				let label = s.title ? `"${s.title}"` : `Session: ${s.id}`
				if (s.id === sessionId) {
					label = s.title ? `Current: "${s.title}"` : "Current Session"
				}
				return {
					value: s.id,
					label: `${idx + 1}. ${label}`,
					hint: relTime,
				}
			})
			const footer = [
				chalk.bold("\nCLI Sessions Shortcuts:"),
				`  ${chalk.cyan("nova -r")} / ${chalk.cyan("--resume")}            Resume last sessions`,
				`  ${chalk.cyan("nova -s <id>")} / ${chalk.cyan("--sessions <id>")}  Resume specific sessions by ID`,
				`  ${chalk.cyan("nova -s ls [limit]")}                  List last sessions (default: 10)`,
				`  ${chalk.cyan("nova -s rm <id>")}                     Delete specific sessions`,
				`  ${chalk.cyan("nova -s rm --all")}                    Delete all sessions`,
			].join("\n")

			const selectedId = await prompts.select({
				message: "Select a session to load:",
				options,
				footer,
			})
			if (selectedId) {
				await onSwitchSession(selectedId)
				const selectedSession = sessions.find((s) => s.id === selectedId)
				const displayName = selectedSession?.title
					? `${selectedSession.title} (id: ${selectedId})`
					: selectedId
				return chalk.green(`✓ Switched to session: ${displayName}`)
			}
			return chalk.yellow("Session selection cancelled.")
		}
		case "resume":
			return "Use `nova --resume` from the CLI to resume your last session."
		case "update":
			return handleUpdate()
		case "help":
			return HELP
		case "clear":
		case "new":
			console.clear()
			if (onNewSession) await onNewSession()
			return ""
		case "quit":
			if (onExit) {
				onExit()
			} else {
				process.exit(0)
			}
			return null
		case "exit":
			if (onExit) {
				onExit()
			} else {
				process.exit(0)
			}
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

function handleSkills(skills: Skill[]): string {
	if (skills.length === 0) {
		return `${chalk.yellow("No skills found.")}\n\nSkill directories scanned:\n  ~/.agents/skills/\n  ~/.novacode/skills/\n  .agents/skills/\n  .novacode/skills/`
	}

	const globalSkills = skills.filter((s) => s.source === "global")
	const projectSkills = skills.filter((s) => s.source === "project")

	let out = `${chalk.bold("Available Skills:")}\n`

	if (globalSkills.length > 0) {
		out += `\n${chalk.cyan("Global:")}\n`
		for (const s of globalSkills) {
			out += `  ${chalk.green(s.name)} — ${s.description}\n`
			out += `    ${chalk.dim(s.path)}\n`
		}
	}

	if (projectSkills.length > 0) {
		out += `\n${chalk.cyan("Project:")}\n`
		for (const s of projectSkills) {
			out += `  ${chalk.green(s.name)} — ${s.description}\n`
			out += `    ${chalk.dim(s.path)}\n`
		}
	}

	out += chalk.dim("\nSkills are auto-loaded by the agent when relevant to your task.")
	return out
}
