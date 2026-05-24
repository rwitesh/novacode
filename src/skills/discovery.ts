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
	const globalDirs = [join(homedir(), ".agents", "skills"), join(homedir(), ".novacode", "skills")]
	const projectDirs = [resolve(cwd, ".agents", "skills"), resolve(cwd, ".novacode", "skills")]

	const raw: RawSkill[] = []

	for (const dir of globalDirs) {
		raw.push(...(await scanDirectory(dir, "global")))
	}
	for (const dir of projectDirs) {
		raw.push(...(await scanDirectory(dir, "project")))
	}

	// Deduplicate by name, keep first found
	const seen = new Set<string>()
	const skills: Skill[] = []

	for (const s of raw) {
		const nameCheck = validateName(s.name)
		if (!nameCheck.valid) {
			console.warn(nameCheck.warning)
		}

		if (seen.has(s.name)) {
			console.warn(`Duplicate skill name "${s.name}", keeping first occurrence`)
			continue
		}
		seen.add(s.name)

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
