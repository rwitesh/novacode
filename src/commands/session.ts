import type { SessionStore } from "../session/store.ts"
import { formatRelativeTime } from "../util.ts"

export async function handleSessionCommand(
	store: SessionStore,
	args: string[],
	opts: { limit?: number; all?: boolean } = {},
): Promise<void> {
	const [subcommand, id] = args

	if (subcommand === "list" || subcommand === "ls") {
		const limit = opts.limit ?? 10
		const sessions = await store.list(limit)
		if (sessions.length === 0) {
			console.log("No sessions found.")
			return
		}

		console.log("ID".padEnd(25), "TITLE / UPDATED")
		console.log("-".repeat(60))
		for (const s of sessions) {
			const relTime = formatRelativeTime(s.updated)
			const titleOrUpdated = s.title ? `"${s.title}" (${relTime})` : relTime
			console.log(s.id.padEnd(25), titleOrUpdated)
		}
		return
	}

	if (subcommand === "delete" || subcommand === "rm") {
		if (opts.all) {
			await store.deleteAll()
			console.log("All sessions deleted.")
			return
		}

		if (!id) {
			console.error("Usage: nova --session rm <id> or --session rm --all")
			process.exit(1)
		}
		const success = await store.delete(id)
		if (success) {
			console.log(`Deleted session: ${id}`)
		} else {
			console.error(`Session not found: ${id}`)
			process.exit(1)
		}
		return
	}

	console.error("Unknown session subcommand.")
	process.exit(1)
}
