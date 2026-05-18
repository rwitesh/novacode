/**
 * Push-based async event stream.
 * Used to stream agent events to consumers (TUI, print mode, etc).
 */
export class EventStream<T, R> {
	#events: T[] = []
	#done = false
	#result?: R
	#resolve?: (value: T) => void
	#doneResolve?: (value: R) => void
	#abort = false

	push(event: T): void {
		if (this.#abort) return
		if (this.#resolve) {
			const resolve = this.#resolve
			this.#resolve = undefined
			resolve(event)
		} else {
			this.#events.push(event)
		}
	}

	finish(result: R): void {
		this.#done = true
		this.#result = result
		// Drain any pending events first via waking up the iterator
		if (this.#resolve) {
			// Wake up with undefined, the loop will see done=true
			this.#resolve(undefined as T)
		}
		if (this.#doneResolve) {
			this.#doneResolve(result)
		}
	}

	abort(): void {
		this.#abort = true
		this.#done = true
		if (this.#resolve) {
			this.#resolve(undefined as T)
		}
		if (this.#doneResolve) {
			this.#doneResolve(undefined as R)
		}
	}

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
			if (item !== undefined && this.#events.length === 0) {
				yield item
			} else if (this.#events.length > 0) {
				yield this.#events.shift() as T
			}
		}
	}

	get result(): R | undefined {
		return this.#result
	}

	get isDone(): boolean {
		return this.#done
	}
}
