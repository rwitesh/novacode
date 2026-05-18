/*
 * Push-based async event stream.
 *
 * Producers call push()/finish(). Consumers iterate with for-await-of.
 * Backpressure is implicit: push() resolves immediately; the iterator
 * awaits the next value only when the consumer asks for it.
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
		// If a consumer is already waiting, deliver directly — skip the queue
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
		// Wake up a suspended iterator so it can see done=true and exit
		if (this.#resolve) {
			// undefined is a sentinel — the iterator loop checks done after waking
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
