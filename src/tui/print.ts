import type { Agent } from "../agent/agent.ts"

export async function runPrintMode(agent: Agent, prompt: string): Promise<void> {
	const stream = agent.prompt(prompt)
	let output = ""

	for await (const event of stream) {
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
}
