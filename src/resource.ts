/**
 * Resource loader: discovers skills, loads AGENTS.md context, and exposes
 * a single load() call that returns everything the agent needs at startup.
 */

import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { discoverSkills } from "./skills/discovery.ts"
import type { Skill } from "./types.ts"

export interface Resources {
	skills: Skill[]
	agentsMd: string | null
}

export async function loadResources(cwd: string): Promise<Resources> {
	const [skills, agentsMd] = await Promise.all([discoverSkills(cwd), readAgentsMd(cwd)])
	return { skills, agentsMd }
}

async function readAgentsMd(cwd: string): Promise<string | null> {
	try {
		return await readFile(join(cwd, "AGENTS.md"), "utf-8")
	} catch {
		return null
	}
}
