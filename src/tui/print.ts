import type { Agent } from "../agent/agent.ts"
import type { Msg } from "../types.ts"

export async function runPrintMode(
	agent: Agent,
	prompt: string,
	signal?: AbortSignal,
): Promise<Msg[] | undefined> {
	const stream = agent.prompt(prompt, signal)
	let output = ""

	for await (const event of stream) {
		if (signal?.aborted) break
		if (event.type === "text_delta") {
			output += event.text
			process.stdout.write(event.text)
		}
		if (event.type === "tool_call") {
			process.stderr.write(`\n[tool: ${event.call.name}]\n`)
		}
		if (event.type === "tool_result") {
			const status = event.result.isError ? "✗" : "✓"
			process.stderr.write(`[${status} ${event.result.tool}]\n`)
		}
	}

	if (output && !output.endsWith("\n")) {
		process.stdout.write("\n")
	}

	return stream.result
}
