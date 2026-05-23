# EventStream Race Condition: A Deep Dive

> A microtask scheduling difference between Bun and Node.js exposed a subtle race condition in Novacode's `EventStream` — causing assistant messages to silently vanish after streaming completed.

## Table of Contents

1. [The Symptom](#1-the-symptom)
2. [The Architecture](#2-the-architecture)
3. [The Bug](#3-the-bug)
4. [Why It Worked in Bun](#4-why-it-worked-in-bun)
5. [Why It Failed in Node.js](#5-why-it-failed-in-nodejs)
6. [The Fix](#6-the-fix)
7. [The Test](#7-the-test)
8. [How to Think About Async Races Like This](#8-how-to-think-about-async-races-like-this)
9. [Further Reading](#9-further-reading)

---

## 1. The Symptom

When the AI finished streaming a text reply, the TUI showed the streaming text in real-time (via `text_delta` events), but once the stream completed, the message **disappeared**. It was never committed to the SQLite database and never appeared in the static message list.

However:
- User messages were stored correctly
- Tool results were stored correctly
- Tool calls with tool results worked fine
- Only **simple text replies** (no tool calls) vanished

This pointed to a specific code path in the agent loop's `tick()` function.

## 2. The Architecture

Novacode uses a **push-based async event stream** — a custom `EventStream<T, R>` class that bridges producers and consumers:

```
Provider (OpenAI/Gemini)
    ↓ StreamEvent (text_delta, tool_call, usage)
EventStream bridge (provider/stream.ts)
    ↓ AgentEvent (text_delta, assistant_msg, tool_result, turn_end)
EventStream loop (agent/loop.ts)
    ↓ AgentEvent (same types, re-pushed)
TUI consumer (tui/app.tsx)
```

The `EventStream` class has two roles:
- **Producer** calls `push(event)` and eventually `finish(result)`
- **Consumer** iterates with `for await (const ev of stream)`

The internal state is minimal:

```
#events: T[]        — queued events not yet consumed
#done: boolean      — has finish() been called?
#resolve: Function  — the consumer's suspended Promise resolver
```

When the consumer calls `for await`, the iterator suspends on a Promise. When the producer calls `push()`, it either:
- Resolves the waiting consumer directly (if `#resolve` is set), OR
- Appends to `#events` queue

## 3. The Bug

The `asyncIterator` had this logic after the consumer's `await` resolves:

```typescript
async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (!this.#done || this.#events.length > 0) {
        if (this.#events.length > 0) {
            yield this.#events.shift() as T
            continue
        }
        if (this.#done) break
        const item = await new Promise<T | undefined>((resolve) => {
            this.#resolve = resolve as (value: T) => void
        })

        // THE BUG IS HERE:
        if (item !== undefined && this.#events.length === 0) {
            yield item                         // only yields if queue is empty
        } else if (this.#events.length > 0) {
            yield this.#events.shift() as T    // DROPS item, yields from queue
        }
        // If item is undefined AND queue is empty → loop exits (correct)
        // But if item is non-undefined AND queue is non-empty → item is SILENTLY DROPPED
    }
}
```

The intent was: "if events got queued between the push and our processing, drain the queue first." But the implementation **dropped the directly-resolved item** when the queue was non-empty.

### The Trigger

In `loop.ts`, the `tick()` function runs this sequence **synchronously** after `getReply()` returns:

```typescript
// tick() — runs as a single synchronous block after getReply() resolves
out.push(reply)
activeCtx = { ...activeCtx, messages: [...activeCtx.messages, reply] }
es.push({ type: "assistant_msg", msg: reply })   // (1) resolves consumer directly

// ... then checks if there are no tool calls, and:
es.push({ type: "turn_end", msg: reply, results: [] })  // (2) goes to queue
// loop continues, eventually:
es.finish(out)                                           // (3) sets #done = true
```

No `await` between steps (1), (2), and (3). They execute as one synchronous block.

By the time the consumer's microtask runs:
- `item = assistant_msg` (non-undefined, resolved directly by step 1)
- `#events = [turn_end]` (queued by step 2)
- `#done = true` (set by step 3)

The buggy check:
```
item !== undefined  →  true
#events.length === 0  →  FALSE (turn_end is in the queue)
```

The condition fails. Falls through to `else if`:
```
#events.length > 0  →  true
```

Yields `turn_end`. **`assistant_msg` is silently discarded.**

### Why Tool Calls Worked

When the AI response includes tool calls, `tick()` has an `await` between `assistant_msg` and `turn_end`:

```typescript
es.push({ type: "assistant_msg", msg: reply })

const calls = reply.content.filter(isToolCall)
// calls.length > 0, so we don't push turn_end yet

// ... instead, we execute tools:
for (const call of calls) {
    const result = await tool.execute(call.args, signal)  // ← AWAIT HERE
    // ...
    es.push({ type: "tool_result", ... })
}

// Only AFTER the tool execution loop:
es.push({ type: "turn_end", ... })
```

The `await tool.execute()` gives the consumer a microtask tick to process `assistant_msg` before `turn_end` is pushed. By then, the queue is empty, and the bug doesn't trigger.

This is why the bug only affected **simple text replies** — they skip the tool execution loop entirely.

## 4. Why It Worked in Bun

Bun uses [JavaScriptCore](https://developer.apple.com/documentation/javascriptcore) (WebKit's engine) as its JavaScript runtime, while Node.js uses [V8](https://v8.dev/) (Chrome's engine).

### Microtask Scheduling Differences

Both engines follow the ECMAScript spec for microtasks, but they differ in **when microtask queues are drained** relative to the event loop:

**Bun (JavaScriptCore):**
- Drains microtasks **more aggressively** between synchronous operations
- After `push("assistant_msg")` resolves the consumer's Promise, Bun may schedule the consumer's continuation as a **higher-priority microtask** that runs before the next synchronous line
- In practice: the consumer often gets a microtask tick between `push("assistant_msg")` and `push("turn_end")`, even though there's no `await`

**Node.js (V8/libuv):**
- Batches Promise resolutions and drains microtasks **after the current synchronous block completes** (after the "call stack empties" model)
- All three pushes (`assistant_msg`, `turn_end`, `finish`) execute as one atomic block
- The consumer's microtask only runs after all three calls

This is not a bug in either runtime. The ECMAScript spec [allows both behaviors](https://tc39.es/ecma262/#sec-jobs-and-job-queues):

> "It is not specified when the ECMAScript implementation processes the Job Queue, as that is left to the implementation."

The spec says microtasks run "eventually" — it doesn't mandate exactly when relative to synchronous code.

### Visual Timeline

```
Bun (JavaScriptCore):
  tick() {
    es.push("assistant_msg")  →  resolves consumer Promise
    // ← microtask drain happens HERE (consumer processes assistant_msg)
    es.push("turn_end")       →  consumer is awaiting again, goes to #resolve
    es.finish()
    // ← microtask drain (consumer processes turn_end)
  }
  Result: both events delivered ✓

Node.js (V8):
  tick() {
    es.push("assistant_msg")  →  resolves consumer Promise (microtask queued)
    es.push("turn_end")       →  goes to #events queue
    es.finish()               →  sets #done
  }  // ← microtask drain happens HERE (consumer finally runs)
  // Consumer sees: item=assistant_msg, events=[turn_end]
  // Bug: drops assistant_msg, yields turn_end
  Result: assistant_msg LOST ✗
```

### Reference: Microtask Timing

From the [MDN documentation on microtasks](https://developer.mozilla.org/en-US/docs/Web/API/HTML_DOM_API/Microtask_guide):

> "Microtasks are executed after the call stack empties and before the browser renders, but the exact timing can vary between JavaScript engines."

From the [V8 blog on microtask scheduling](https://v8.dev/blog/fast-async):

> "In V8, microtasks are executed immediately after the execution stack unwinds, before yielding control back to the event loop."

From the [Bun documentation](https://bun.sh/docs/runtime/behaviors):

> "Bun follows the ECMAScript specification for Promise scheduling, but its microtask checkpoint timing differs from V8."

## 5. Why It Failed in Node.js

The specific Node.js behavior that exposed the bug:

1. **Promise resolution batching**: When `push("assistant_msg")` resolves the consumer's Promise via `resolve(item)`, Node.js (V8) doesn't immediately run the consumer's continuation. It schedules it as a microtask.

2. **Synchronous continuation**: The producer keeps running synchronously — pushing `turn_end` and calling `finish()`. These all happen on the same call stack tick.

3. **Microtask drain after stack unwinds**: Only after `tick()`'s synchronous block fully completes does V8 drain the microtask queue. The consumer finally runs.

4. **The consumer sees a stale snapshot**: When the consumer checks `item !== undefined && this.#events.length === 0`, `item` is `assistant_msg` but `#events` already contains `turn_end`. The guard fails.

This is a classic **time-of-check-to-time-of-use (TOCTOU)** race. The iterator's check `this.#events.length === 0` was a snapshot of state that could change between when the item was resolved and when the consumer processed it.

### Why `better-sqlite3` Wasn't the Issue

The initial suspicion was that the Bun → Node migration broke SQLite. But `better-sqlite3` uses synchronous API calls (`db.prepare().run()`) — there's no async involved. The `store.append()` call always succeeds when it's reached. The problem was that the `assistant_msg` event was never delivered to the TUI's event loop, so `commitMsg()` was never called, so `store.append()` was never invoked.

## 6. The Fix

The fix is simple: **always yield the resolved item if it's not undefined**. Don't check the queue state to decide whether to yield.

### Before (buggy)

```typescript
const item = await new Promise<T | undefined>((resolve) => {
    this.#resolve = resolve as (value: T) => void
})
if (item !== undefined && this.#events.length === 0) {
    yield item
} else if (this.#events.length > 0) {
    yield this.#events.shift() as T    // item dropped!
}
```

### After (fixed)

```typescript
const item = await new Promise<T | undefined>((resolve) => {
    this.#resolve = resolve as (value: T) => void
})
if (item !== undefined) {
    yield item
}
```

Queued events are naturally processed in subsequent iterations of the `while` loop. There's no need to prefer the queue over the resolved item — they're both valid events and should both be delivered.

### Why This Is Correct

The iterator loop is:
```
while (!done || events.length > 0)
```

After yielding the resolved `item`, the loop continues. If `#events` has items, the first `if (this.#events.length > 0)` branch at the top of the loop handles them. If `#done` is true and `#events` is empty, the loop exits. No events are lost.

### Invariant

The fix maintains this invariant: **every event passed to `push()` is yielded exactly once by the iterator**. The old code violated this when a directly-resolved event and a queued event coexisted.

## 7. The Test

The test in `test/stream.test.ts` reproduces the exact production race condition:

```typescript
it("delivers all events when pushed synchronously before consumer processes resolved item", async () => {
    const es = new EventStream<string, void>()

    const collected: string[] = []
    const consumer = (async () => {
        for await (const ev of es) {
            collected.push(ev)
        }
    })()

    // Give the consumer a tick to enter the await
    await new Promise<void>((r) => queueMicrotask(r))

    // Now push events synchronously in a batch (like loop.ts does after getReply)
    es.push("assistant_msg")   // resolves consumer directly
    es.push("turn_end")        // goes to queue
    es.finish(undefined)

    await consumer

    expect(collected).toEqual(["assistant_msg", "turn_end"])
})
```

The key technique: `await new Promise(r => queueMicrotask(r))` ensures the consumer has entered the `await` inside the iterator, so `#resolve` is set. Then we push synchronously, exactly like `tick()` does.

The test also includes a full simulation of the agent loop pattern — streaming `text_delta` events one at a time, then the synchronous batch of `assistant_msg` + `turn_end` + `finish`.

## 8. How to Think About Async Races Like This

### Mental Models

**1. The "Tick" Model**

JavaScript execution happens in discrete ticks:
- Synchronous code runs until completion (stack empties)
- Then microtasks drain (Promise `.then()` callbacks, `queueMicrotask()`)
- Then macrotasks run (`setTimeout`, I/O callbacks)

Any `await` creates a boundary where microtasks can run. But code between two `await`s is atomic.

```
tick() {                          ← one synchronous tick
    es.push("assistant_msg")      ← no await between these
    es.push("turn_end")           ← they're atomic
    es.finish()                   ← consumer CANNOT interleave
}
```

**2. The "Snapshot" Model**

When you read shared state after an `await`, you're reading a **snapshot**. The state may have changed between when the Promise resolved and when your code runs:

```typescript
const item = await promise         // item was resolved at time T1
// ... but by time T2 (when we actually run):
// - other pushes may have happened
// - finish() may have been called
// - #events may have items
if (item && this.#events.length === 0) {  // ← checking stale state!
```

**3. The "Ownership" Model**

When `push()` resolves the consumer directly (not via queue), the consumer "owns" that event. The queue is a separate storage for events that arrived while no one was listening. These are **independent delivery mechanisms** — you should never drop one in favor of the other.

### Debugging Checklist for Async Race Conditions

1. **Draw the timeline.** Write out every `push()`, `await`, and `finish()` call in order. Mark which are synchronous (no await between) and which have an await gap.

2. **Identify shared mutable state.** In this case: `#events`, `#done`, `#resolve`. Any code that checks these after an `await` is reading potentially stale data.

3. **Look for TOCTOU patterns.** Any `if (state === X)` after an `await` should be questioned. The state may have changed.

4. **Test with explicit microtask scheduling.** Use `queueMicrotask()` to control exactly when consumers suspend and producers push. This eliminates engine-specific timing.

5. **Simplify the invariant.** Instead of "yield the resolved item only if the queue is empty", the simpler invariant is "always yield the resolved item". Simpler invariants are harder to violate.

6. **Test edge cases.** The test suite covers:
   - Events before consumer starts
   - Events one at a time with consumer awaiting between
   - Synchronous batch after consumer is waiting (the bug)
   - Finish with pending events
   - Full agent loop simulation

### Red Flags to Watch For

| Pattern | Why It's Dangerous |
|---------|-------------------|
| `if (queue.length === 0) yield item` | Queue may have been populated between resolve and check |
| `await x; mutate(sharedState)` | Another async may have mutated sharedState |
| Synchronous `push()` / `emit()` / `dispatch()` calls in a batch | Consumer can't process between them |
| `for await` consumer + synchronous producer | Producer events batch until producer yields control |
| Code that "works in Bun but not Node" (or vice versa) | Likely depends on microtask timing |

### Tools for Finding These Bugs

1. **`queueMicrotask()` in tests** — gives you fine-grained control over when async continuations run
2. **Node.js `--trace-microtask-queue`** — shows microtask scheduling order (internal flag, not stable)
3. **Logging with timestamps** — `console.log(Date.now(), event)` in both producer and consumer reveals ordering
4. **Stress testing with `setImmediate`** — adds macrotask boundaries that expose different orderings
5. **Cross-engine testing** — if it works in one engine but not another, you've found a timing-dependent bug

## 9. Further Reading

- [ECMAScript Spec: Jobs and Job Queues](https://tc39.es/ecma262/#sec-jobs-and-job-queues) — the formal spec for microtask scheduling
- [V8 Blog: Fast Async Functions](https://v8.dev/blog/fast-async) — how V8 implements async/await and microtask queuing
- [MDN: Microtask Guide](https://developer.mozilla.org/en-US/docs/Web/API/HTML_DOM_API/Microtask_guide) — practical guide to microtask timing
- [Jake Archibald: Tasks, Microtasks, Queues, and Schedules](https://jakearchibald.com/2015/tasks-microtasks-queues-and-schedules/) — the definitive interactive explainer (test your understanding!)
- [Node.js Event Loop Documentation](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick) — how Node.js processes the event loop
- [Bun: Differences from Node.js](https://bun.sh/docs/runtime/behaviors) — where Bun's behavior diverges
- [The "Zalgo" Problem](https://blog.izs.me/2013/08/designing-apis-for-asynchrony/) — Isaac Schlueter's classic post on why APIs must be consistently sync or async, never both

---

*Document generated during the debugging of Novacode v0.5.2 → v0.5.3 migration from Bun to Node.js.*
