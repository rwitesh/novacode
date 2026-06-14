/**
 * Streaming HTTP client built on native fetch.
 *
 * `streamPost()` returns a `StreamedResponse` that wraps the fetch result.
 * Providers check `.ok`, then either `.text()` the error body or iterate
 * `.events()` for SSE — the universal pattern for all LLM streaming endpoints.
 */

const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_BASE_DELAY_MS = 5000

function isRetryableStatus(status: number): boolean {
	return status === 408 || status === 425 || status === 429 || status >= 500
}

function abortError(signal: AbortSignal): unknown {
	return signal.reason ?? new DOMException("The operation was aborted", "AbortError")
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
	if (!signal) return new Promise((resolve) => setTimeout(resolve, ms))
	if (signal.aborted) return Promise.reject(abortError(signal))

	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			signal.removeEventListener("abort", onAbort)
			resolve()
		}, ms)
		const onAbort = () => {
			clearTimeout(timeout)
			reject(abortError(signal))
		}
		signal.addEventListener("abort", onAbort, { once: true })
	})
}

export class StreamedResponse {
	#status: number
	#stream: ReadableStream<Uint8Array>

	constructor(status: number, stream: ReadableStream<Uint8Array>) {
		this.#status = status
		this.#stream = stream
	}

	get ok(): boolean {
		return this.#status >= 200 && this.#status < 300
	}

	get status(): number {
		return this.#status
	}

	async text(): Promise<string> {
		const chunks: string[] = []
		const decoder = new TextDecoder()
		for await (const chunk of this.#stream) {
			chunks.push(decoder.decode(chunk, { stream: true }))
		}
		return chunks.join("")
	}

	async *events(): AsyncGenerator<string> {
		const decoder = new TextDecoder()
		let buffer = ""

		for await (const chunk of this.#stream) {
			buffer += decoder.decode(chunk, { stream: true })
			const lines = buffer.split("\n")
			buffer = lines.pop() ?? ""

			for (const line of lines) {
				const trimmed = line.trim()
				if (!trimmed?.startsWith("data: ")) continue
				const data = trimmed.slice(6)
				if (data === "[DONE]") continue
				yield data
			}
		}
	}
}

export async function streamPost(
	url: string,
	headers: Record<string, string>,
	body: unknown,
	signal?: AbortSignal,
	retry: {
		maxAttempts?: number
		baseDelayMs?: number
		onRetry?: (attempt: number, maxAttempts: number, delayMs: number, reason: string) => void
	} = {},
): Promise<StreamedResponse> {
	const payload = JSON.stringify(body)
	const maxAttempts = retry.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
	const baseDelayMs = retry.baseDelayMs ?? DEFAULT_BASE_DELAY_MS

	for (let attempt = 1; ; attempt++) {
		signal?.throwIfAborted()

		try {
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...headers },
				body: payload,
				signal,
			})

			if (isRetryableStatus(res.status) && attempt < maxAttempts) {
				const delayMs = baseDelayMs * 2 ** (attempt - 1)
				await res.body?.cancel()
				retry.onRetry?.(attempt, maxAttempts, delayMs, `API Error: HTTP ${res.status}`)
				await wait(delayMs, signal)
				continue
			}

			if (!res.body) throw new Error(`No response body from ${url}`)
			return new StreamedResponse(res.status, res.body)
		} catch (error) {
			if (signal?.aborted || attempt >= maxAttempts) throw error
			const delayMs = baseDelayMs * 2 ** (attempt - 1)
			const reason = error instanceof Error ? error.message : String(error)
			retry.onRetry?.(attempt, maxAttempts, delayMs, `Network Error: ${reason}`)
			await wait(delayMs, signal)
		}
	}
}
