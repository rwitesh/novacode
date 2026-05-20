import chalk from "chalk"
import type { Agent } from "../agent/agent.ts"
import type { Msg } from "../types.ts"
import { formatToolArgs } from "../util.ts"

const TOOL_STYLE: Record<string, (s: string) => string> = {
	read: (s) => chalk.blue.bold(s),
	write: (s) => chalk.magenta.bold(s),
	edit: (s) => chalk.yellow.bold(s),
	bash: (s) => chalk.cyan.bold(s),
	glob: (s) => chalk.green.bold(s),
	find: (s) => chalk.green.bold(s),
	grep: (s) => chalk.green.bold(s),
}

function stylizeTool(name: string): string {
	const stylize = TOOL_STYLE[name] || ((s) => chalk.white.bold(s))
	return stylize(name)
}

export async function runPrintMode(
	agent: Agent,
	prompt: string,
	signal?: AbortSignal,
): Promise<Msg[] | undefined> {
	const stream = agent.prompt(prompt, signal)
	let output = ""
	let lastEventWasTool = false

	for await (const event of stream) {
		if (signal?.aborted) break
		if (event.type === "text_delta") {
			output += event.text
			process.stdout.write(event.text)
			lastEventWasTool = false
		}
		if (event.type === "tool_call") {
			const argsObj = event.call.args
			const argsStr = argsObj ? ` ${formatToolArgs(argsObj, true)}` : ""
			if (!lastEventWasTool) {
				process.stderr.write("\n")
			}
			process.stderr.write(`⏳ ${stylizeTool(event.call.name)}${argsStr}… `)
			lastEventWasTool = true
		}
		if (event.type === "tool_result") {
			const status = event.result.isError ? chalk.red("✗") : chalk.green("✓")
			const argsObj = event.result.args
			const argsStr = argsObj ? ` ${formatToolArgs(argsObj, true)}` : ""
			process.stderr.write(`\r${status} ${stylizeTool(event.result.tool)}${argsStr}\x1B[K\n`)
		}
	}

	if (output && !output.endsWith("\n")) {
		process.stdout.write("\n")
	}

	return stream.result
}
