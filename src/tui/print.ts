import chalk from "chalk"
import type { Agent } from "../agent/agent.ts"
import type { Msg } from "../types.ts"

const TOOL_STYLE: Record<string, (s: string) => string> = {
	read: (s) => chalk.bgBlue.bold.white(` ${s} `),
	write: (s) => chalk.bgMagenta.bold.white(` ${s} `),
	edit: (s) => chalk.bgYellow.bold.black(` ${s} `),
	bash: (s) => chalk.bgCyan.bold.black(` ${s} `),
	glob: (s) => chalk.bgGreen.bold.black(` ${s} `),
	find: (s) => chalk.bgGreen.bold.black(` ${s} `),
	grep: (s) => chalk.bgGreen.bold.black(` ${s} `),
}

function stylizeTool(name: string): string {
	const stylize = TOOL_STYLE[name] || ((s) => chalk.bgWhite.bold.black(` ${s} `))
	return stylize(name)
}

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
			process.stderr.write(`\n⏳ ${stylizeTool(event.call.name)}…\n`)
		}
		if (event.type === "tool_result") {
			const status = event.result.isError ? chalk.red("✗") : chalk.green("✓")
			process.stderr.write(`${status} ${stylizeTool(event.result.tool)}\n`)
		}
	}

	if (output && !output.endsWith("\n")) {
		process.stdout.write("\n")
	}

	return stream.result
}
