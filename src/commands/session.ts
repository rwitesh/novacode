import { getSessionStore } from "../session/store.ts"

export async function handleSessionCommand(args: string[]): Promise<void> {
	const store = getSessionStore()
	const [subcommand, id] = args

	if (subcommand === "list" || subcommand === "ls") {
		const sessions = store.list()
		if (sessions.length === 0) {
			console.log("No sessions found.")
			return
		}

		console.log("ID".padEnd(25), "MODEL".padEnd(20), "UPDATED")
		console.log("-".repeat(70))
		for (const s of sessions) {
			const date = new Date(s.updated).toLocaleString()
			console.log(s.id.padEnd(25), s.model.padEnd(20), date)
		}
		return
	}

	if (subcommand === "delete" || subcommand === "rm") {
		if (!id) {
			console.error("Usage: novacode session delete <id>")
			process.exit(1)
		}
		const success = store.delete(id)
		if (success) {
			console.log(`Deleted session: ${id}`)
		} else {
			console.error(`Session not found: ${id}`)
			process.exit(1)
		}
		return
	}

	console.error("Unknown session subcommand. Use 'list' or 'delete'.")
	process.exit(1)
}
