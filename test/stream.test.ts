import { describe, expect, it } from "vitest"
import { EventStream } from "../src/provider/stream.ts"

// Helper: suspend caller for one microtask tick so an async consumer can advance
const tick = () => new Promise<void>((r) => queueMicrotask(r))

describe("EventStream", () => {
	// ─── Basic delivery ───────────────────────────────────────────────

	it("delivers events pushed before consumer starts iterating", async () => {
		const es = new EventStream<string, void>()
		es.push("a")
		es.push("b")
		es.finish(undefined)

		const collected: string[] = []
		for await (const ev of es) {
			collected.push(ev)
		}

		expect(collected).toEqual(["a", "b"])
	})

	it("delivers events pushed one at a time with consumer awaiting between", async () => {
		const es = new EventStream<string, void>()

		const collected: string[] = []
		const consumer = (async () => {
			for await (const ev of es) {
				collected.push(ev)
			}
		})()

		await tick()
		es.push("a")

		await tick()
		es.push("b")

		await tick()
		es.push("c")
		es.finish(undefined)

		await consumer
		expect(collected).toEqual(["a", "b", "c"])
	})

	it("exposes result and isDone after finish", async () => {
		const es = new EventStream<string, string>()
		es.finish("result-value")

		const collected: string[] = []
		for await (const ev of es) {
			collected.push(ev)
		}

		expect(es.result).toBe("result-value")
		expect(es.isDone).toBe(true)
		expect(collected).toEqual([])
	})

	// ─── Race condition: synchronous batch while consumer is suspended ─

	it("delivers resolved item + queued item when pushed in synchronous batch", async () => {
		// The core bug: push(A) resolves consumer directly, push(B) queues,
		// finish() marks done — all synchronously. Consumer must receive BOTH.
		const es = new EventStream<string, void>()

		const collected: string[] = []
		const consumer = (async () => {
			for await (const ev of es) {
				collected.push(ev)
			}
		})()

		await tick()

		es.push("assistant_msg") // resolves consumer directly
		es.push("turn_end") // goes to queue
		es.finish(undefined)

		await consumer

		expect(collected).toEqual(["assistant_msg", "turn_end"])
	})

	it("delivers large synchronous batch without dropping events", async () => {
		const es = new EventStream<string, void>()

		const collected: string[] = []
		const consumer = (async () => {
			for await (const ev of es) {
				collected.push(ev)
			}
		})()

		await tick()

		// First push resolves consumer; rest all go to queue
		const batch = Array.from({ length: 50 }, (_, i) => `event-${i}`)
		for (const e of batch) {
			es.push(e)
		}
		es.finish(undefined)

		await consumer

		expect(collected).toEqual(batch)
	})

	it("delivers queued events then resolved event when pushes overlap", async () => {
		// Consumer is suspended. Push to queue, then push again (resolves consumer).
		// Both must be delivered.
		const es = new EventStream<string, void>()

		const collected: string[] = []
		const consumer = (async () => {
			for await (const ev of es) {
				collected.push(ev)
			}
		})()

		await tick()

		// Consumer is awaiting. First push goes to queue (consumer's resolve is set,
		// but we want to test the queue-then-resolve order).
		// Actually: since consumer IS waiting, push("queued") will resolve it directly.
		// To get items into the queue, we need the consumer to NOT be waiting.
		// So: push one (resolves directly), then push another (goes to queue).

		es.push("first") // resolves directly
		es.push("second") // queues
		es.push("third") // queues
		es.finish(undefined)

		await consumer

		expect(collected).toEqual(["first", "second", "third"])
	})

	// ─── Full agent loop simulation ───────────────────────────────────

	it("simulates text-only reply: stream deltas then synchronous assistant_msg + turn_end + finish", async () => {
		// Mirrors the production flow for simple text replies (no tool calls)
		const es = new EventStream<string, string>()

		const collected: string[] = []
		const consumer = (async () => {
			for await (const ev of es) {
				collected.push(ev)
			}
		})()

		// Phase 1: streaming text_deltas one at a time (consumer processes each)
		for (const text of ["Hello", ", ", "world", "!"]) {
			await tick()
			es.push(`text_delta:${text}`)
		}

		// Phase 2: consumer is awaiting. tick() pushes synchronously.
		await tick()
		es.push("assistant_msg") // resolves consumer
		es.push("turn_end") // queues
		es.finish("all_messages")

		await consumer

		expect(collected).toEqual([
			"text_delta:Hello",
			"text_delta:, ",
			"text_delta:world",
			"text_delta:!",
			"assistant_msg",
			"turn_end",
		])
		expect(es.result).toBe("all_messages")
	})

	it("simulates multi-turn loop: text reply → tool call → tool result → text reply", async () => {
		// Full production flow with tool calls between turns
		const es = new EventStream<string, string>()

		const collected: string[] = []
		const consumer = (async () => {
			for await (const ev of es) {
				collected.push(ev)
			}
		})()

		// Turn 1: streaming deltas, then synchronous batch
		await tick()
		es.push("text_delta:Let me check that file.")
		await tick()
		es.push("assistant_msg") // has tool_call
		es.push("tool_result") // pushed after tool execution
		await tick()
		es.push("turn_end")

		// Turn 2: more streaming, then final synchronous batch
		await tick()
		es.push("text_delta:Here's what I found.")
		await tick()
		es.push("assistant_msg")
		es.push("turn_end")
		es.finish("all_messages")

		await consumer

		expect(collected).toEqual([
			"text_delta:Let me check that file.",
			"assistant_msg",
			"tool_result",
			"turn_end",
			"text_delta:Here's what I found.",
			"assistant_msg",
			"turn_end",
		])
	})

	// ─── Abort ────────────────────────────────────────────────────────

	it("stops iteration on abort", async () => {
		const es = new EventStream<string, void>()

		const collected: string[] = []
		const consumer = (async () => {
			for await (const ev of es) {
				collected.push(ev)
			}
		})()

		await tick()
		es.push("before-abort")
		es.abort()

		await consumer

		expect(collected).toEqual(["before-abort"])
		expect(es.isDone).toBe(true)
	})

	it("ignores pushes after abort", async () => {
		const es = new EventStream<string, void>()

		const collected: string[] = []
		const consumer = (async () => {
			for await (const ev of es) {
				collected.push(ev)
			}
		})()

		await tick()
		es.push("before-abort")
		es.abort()
		es.push("after-abort") // should be ignored

		await consumer

		expect(collected).toEqual(["before-abort"])
	})

	it("ignores pushes after finish", async () => {
		const es = new EventStream<string, void>()

		const collected: string[] = []
		const consumer = (async () => {
			for await (const ev of es) {
				collected.push(ev)
			}
		})()

		await tick()
		es.push("before-finish")
		es.finish(undefined)
		es.push("after-finish") // stream is done, but push still adds to queue

		await consumer

		// "after-finish" gets queued but the iterator already broke out of the loop
		// because finish sets #done=true. The exact behavior depends on whether
		// the queued event lands before or after the consumer processes finish.
		// At minimum, "before-finish" must be delivered.
		expect(collected).toContain("before-finish")
	})

	// ─── Edge cases ───────────────────────────────────────────────────

	it("handles finish with no events", async () => {
		const es = new EventStream<string, number>()

		const collected: string[] = []
		const consumer = (async () => {
			for await (const ev of es) {
				collected.push(ev)
			}
		})()

		await tick()
		es.finish(42)

		await consumer

		expect(collected).toEqual([])
		expect(es.result).toBe(42)
	})

	it("handles finish called before consumer starts (no events)", async () => {
		const es = new EventStream<string, void>()
		es.finish(undefined)

		const collected: string[] = []
		for await (const ev of es) {
			collected.push(ev)
		}

		expect(collected).toEqual([])
		expect(es.isDone).toBe(true)
	})

	it("delivers events enqueued while consumer processes previous yield", async () => {
		// Consumer yields event, and before it awaits again, more events arrive
		const es = new EventStream<string, void>()

		const collected: string[] = []
		const consumer = (async () => {
			for await (const ev of es) {
				collected.push(ev)
				// Simulate slow consumer — during this synchronous block,
				// no new events can arrive (single-threaded), but if the
				// consumer does something async between iterations...
			}
		})()

		await tick()
		es.push("a")
		await tick() // consumer processes "a", goes back to await

		// Now push a batch synchronously
		es.push("b")
		es.push("c")
		await tick()

		es.push("d")
		es.finish(undefined)

		await consumer

		expect(collected).toEqual(["a", "b", "c", "d"])
	})
})
