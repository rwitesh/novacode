import chalk from "chalk"
import type { Agent } from "../agent/agent.ts"
import { loadConfig, saveConfig } from "../config/store.ts"
import { getEfforts } from "../llm/stream.ts"
import type { Effort, Prompts } from "../types.ts"

export async function handleEffort(args: string, agent: Agent, prompts?: Prompts): Promise<string> {
	if (!agent.model.supportsThinking)
		return chalk.yellow(`${agent.model.id} does not support effort control.`)

	const efforts = getEfforts(agent.model.provider)
	if (efforts.length === 0)
		return chalk.yellow(`${agent.model.provider} does not support effort control.`)

	const requested = args.trim().toLowerCase() as Effort
	if (requested) {
		if (!efforts.includes(requested))
			return chalk.yellow(`"${requested}" is not valid. Options: ${efforts.join(", ")}`)
		return await apply(agent, requested)
	}

	if (!prompts) return chalk.red("Prompts not available in this context")

	const pick = await prompts.select({
		message: `Reasoning effort (${agent.model.provider})`,
		options: efforts.map((e) => ({
			value: e,
			label: `${e === agent.effort ? chalk.green("●") : "○"} ${e}`,
		})),
	})
	if (!pick) return ""

	return await apply(agent, pick as Effort)
}

async function apply(agent: Agent, effort: Effort): Promise<string> {
	agent.setEffort(effort)
	const config = await loadConfig()
	config.effort = effort
	await saveConfig(config)
	return chalk.green(`✓ Effort set to ${effort}`)
}
