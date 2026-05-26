import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { SessionStore } from "../src/session/store.ts"

async function createTempStore() {
	const dir = await mkdtemp(join(tmpdir(), "novacode-benchmark-"))
	const dbPath = join(dir, "state.db")
	const db = new DatabaseSync(dbPath)
	db.exec("PRAGMA journal_mode = WAL")
	db.exec(`
		CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY, cwd TEXT NOT NULL, model TEXT NOT NULL, provider TEXT NOT NULL,
			title TEXT, parent_session_id TEXT, end_reason TEXT, created INTEGER NOT NULL,
			updated INTEGER NOT NULL, input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
			message_count INTEGER DEFAULT 0
		);
		CREATE TABLE IF NOT EXISTS messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
			seq INTEGER NOT NULL, role TEXT NOT NULL, content TEXT, tool_call_id TEXT, tool_name TEXT,
			tool_args TEXT, model TEXT, provider TEXT, usage_input INTEGER DEFAULT 0, usage_output INTEGER DEFAULT 0,
			stop_reason TEXT, is_error INTEGER DEFAULT 0, ts INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated DESC);
		CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);
	`)
	const store = new SessionStore(db)
	return { dir, store, db }
}

async function run() {
	const { dir, store, db } = await createTempStore()
	try {
		const numSessions = 1000
		console.log(`\nGenerating ${numSessions} sessions...`)

		for (let i = 0; i < numSessions; i++) {
			await store.create("/test/dir", "test-model", "test-provider")
		}
		console.log(`Successfully generated ${numSessions} sessions. Running benchmarks...`)

		// Benchmark store.list()
		const startList = performance.now()
		const list = await store.list(10)
		const durationList = performance.now() - startList

		console.log(`⚡ store.list(10) took ${durationList.toFixed(2)}ms for ${numSessions} sessions.`)
		if (list.length !== 10) {
			throw new Error(`Expected list to have 10 sessions, got ${list.length}`)
		}
		if (durationList >= 100) {
			throw new Error(`store.list took too long: ${durationList.toFixed(2)}ms`)
		}

		// Benchmark store.prune()
		const startPrune = performance.now()
		await store.prune()
		const durationPrune = performance.now() - startPrune

		console.log(`⚡ store.prune() took ${durationPrune.toFixed(2)}ms for ${numSessions} sessions.`)
		if (durationPrune >= 100) {
			throw new Error(`store.prune took too long: ${durationPrune.toFixed(2)}ms`)
		}

		console.log("✓ Benchmark completed successfully and validated within performance limits!\n")
	} finally {
		db.close()
		await rm(dir, { recursive: true, force: true })
	}
}

run().catch((err) => {
	console.error("Benchmark failed:", err)
	process.exit(1)
})
