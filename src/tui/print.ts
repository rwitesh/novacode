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
		}
		if (event.type === "tool_call") {
			process.stderr.write(`[tool: ${event.call.name}]\n`)
		}
	}

	if (output) {
		process.stdout.write(output)
		if (!output.endsWith("\n")) process.stdout.write("\n")
	}

	return stream.result
}
