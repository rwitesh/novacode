/**
 * Streaming HTTP client built on native fetch.
 *
 * `streamPost()` returns a `StreamedResponse` that wraps the fetch result.
 * Providers check `.ok`, then either `.text()` the error body or iterate
 * `.events()` for SSE — the universal pattern for all LLM streaming endpoints.
 */

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
): Promise<StreamedResponse> {
	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify(body),
		signal,
	})
	if (!res.body) throw new Error(`No response body from ${url}`)
	return new StreamedResponse(res.status, res.body)
}
