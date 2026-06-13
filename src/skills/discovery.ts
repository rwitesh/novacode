/**
 * Skill discovery: scans configured directories for SKILL.md files,
 * parses YAML frontmatter, validates, and returns Skill objects.
 */

import { readdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import type { Skill } from "../types.ts"

const SKILL_FILE = "SKILL.md"

interface RawSkill {
	name: string
	description: string
	path: string
	source: "global" | "project"
}

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

function validateName(name: string): { valid: boolean; warning?: string } {
	if (name.length > 64)
		return { valid: false, warning: `Skill name exceeds 64 characters: "${name}"` }
	if (!NAME_RE.test(name))
		return {
			valid: false,
			warning: `Skill name contains invalid characters (use lowercase, numbers, hyphens): "${name}"`,
		}
	return { valid: true }
}

function parseFrontmatter(content: string): { name?: string; description?: string } | null {
	const match = content.match(/^---\s*\n([\s\S]*?)\n---/)
	if (!match) return null
	const yaml = match[1]!
	let name: string | undefined
	let description: string | undefined
	for (const line of yaml.split("\n")) {
		const n = line.match(/^name:\s*(.+)$/)
		if (n) name = n[1]!.trim()
		const d = line.match(/^description:\s*(.+)$/)
		if (d) description = d[1]!.trim()
	}
	if (!name) return null
	return { name, description }
}

async function readSkill(dirPath: string, source: "global" | "project"): Promise<RawSkill | null> {
	const skillPath = join(dirPath, SKILL_FILE)
	try {
		const { readFile } = await import("node:fs/promises")
		const content = await readFile(skillPath, "utf-8")
		const fm = parseFrontmatter(content)
		if (!fm?.name) return null
		if (!fm.description) {
			console.warn(`Skill missing description, skipping: ${dirPath}`)
			return null
		}
		return { name: fm.name, description: fm.description, path: dirPath, source }
	} catch {
		return null
	}
}

async function scanDirectory(dir: string, source: "global" | "project"): Promise<RawSkill[]> {
	const skills: RawSkill[] = []
	try {
		const entries = await readdir(dir, { withFileTypes: true })
		for (const entry of entries) {
			if (!entry.isDirectory()) continue
			const fullPath = join(dir, entry.name)
			const skill = await readSkill(fullPath, source)
			if (skill) skills.push(skill)
		}
	} catch {
		// Directory doesn't exist, skip
	}
	return skills
}

export async function discoverSkills(cwd: string): Promise<Skill[]> {
	// Scan project dirs first, then global; within each, .novacode before .agents.
	const dirs = [
		{ dir: resolve(cwd, ".novacode", "skills"), source: "project" as const },
		{ dir: resolve(cwd, ".agents", "skills"), source: "project" as const },
		{ dir: join(homedir(), ".novacode", "skills"), source: "global" as const },
		{ dir: join(homedir(), ".agents", "skills"), source: "global" as const },
	]

	const raw: RawSkill[] = []
	for (const { dir, source } of dirs) {
		raw.push(...(await scanDirectory(dir, source)))
	}

	// Return all skills (including duplicates); callers dedupe as needed
	const skills: Skill[] = []
	for (const s of raw) {
		const nameCheck = validateName(s.name)
		if (!nameCheck.valid) {
			console.warn(nameCheck.warning)
		}

		if (s.description.length > 1024) {
			console.warn(`Skill description exceeds 1024 characters: "${s.name}"`)
		}

		skills.push({
			name: s.name,
			description: s.description,
			path: s.path,
			source: s.source,
		})
	}

	return skills
}

// Precedence rank: lower wins. project beats global; .novacode beats .agents.
function precedence(s: Skill): number {
	const src = s.source === "project" ? 0 : 2
	const dir = s.path.includes(".novacode/skills") ? 0 : 1
	return src + dir
}

// Group skills by name, each group sorted highest-precedence (winner) first.
export function groupSkills(skills: Skill[]): Skill[][] {
	const groups = new Map<string, Skill[]>()
	for (const s of skills) {
		const arr = groups.get(s.name)
		if (arr) arr.push(s)
		else groups.set(s.name, [s])
	}
	return [...groups.values()].map((g) => g.sort((a, b) => precedence(a) - precedence(b)))
}

// One skill per name — the winner of each precedence group.
export function dedupeSkills(skills: Skill[]): Skill[] {
	return groupSkills(skills).map((g) => g[0]!)
}
