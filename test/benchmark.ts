import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SessionStore } from "../src/session/store.ts"

async function createTempStore() {
	const path = await mkdtemp(join(tmpdir(), "novacode-benchmark-"))
	const store = new SessionStore(path)
	return { path, store }
}

async function run() {
	const { path, store } = await createTempStore()
	try {
		const numSessions = 1000
		console.log(`\nGenerating ${numSessions} mock sessions...`)

		// Generate 1000 sessions concurrently to save time
		const promises = Array.from({ length: numSessions }).map(async (_, i) => {
			const id = `${(Date.now() - i * 1000).toString(36)}-${crypto.randomUUID().slice(0, 8)}`
			const sessionDir = join(path, id)
			await mkdir(sessionDir, { recursive: true })

			const sessionData = {
				id,
				cwd: "/test/dir",
				model: "test-model",
				provider: "test-provider",
				title: `Session ${i}`,
				created: Date.now() - i * 1000,
				updated: Date.now() - i * 1000,
			}
			await writeFile(join(sessionDir, "metadata.json"), JSON.stringify(sessionData, null, 2))
		})

		await Promise.all(promises)
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
		await store.prune(10)
		const durationPrune = performance.now() - startPrune

		console.log(
			`⚡ store.prune(10) took ${durationPrune.toFixed(2)}ms for ${numSessions} sessions.`,
		)
		if (durationPrune >= 100) {
			throw new Error(`store.prune took too long: ${durationPrune.toFixed(2)}ms`)
		}

		console.log("✓ Benchmark completed successfully and validated within performance limits!\n")
	} finally {
		await rm(path, { recursive: true, force: true })
	}
}

run().catch((err) => {
	console.error("Benchmark failed:", err)
	process.exit(1)
})
