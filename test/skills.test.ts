import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { buildSystemPrompt } from "../src/agent/prompt.ts"
import { dedupeSkills, discoverSkills, groupSkills } from "../src/skills/discovery.ts"
import { getAllTools } from "../src/tools/index.ts"
import type { Skill } from "../src/types.ts"

type Dir = ".novacode" | ".agents"

function mk(name: string, source: "global" | "project", dir: Dir): Skill {
	const base = source === "project" ? "/proj" : "/home/u"
	return { name, description: `${name} skill`, path: `${base}/${dir}/skills/${name}`, source }
}

describe("skill precedence", () => {
	it("project beats global", () => {
		const skills = [mk("a", "global", ".novacode"), mk("a", "project", ".agents")]
		expect(dedupeSkills(skills)[0]!.source).toBe("project")
	})

	it(".novacode beats .agents within project", () => {
		const skills = [mk("a", "project", ".agents"), mk("a", "project", ".novacode")]
		expect(dedupeSkills(skills)[0]!.path).toContain(".novacode")
	})

	it(".novacode beats .agents within global", () => {
		const skills = [mk("a", "global", ".agents"), mk("a", "global", ".novacode")]
		expect(dedupeSkills(skills)[0]!.path).toContain(".novacode")
	})

	it("precedence is order-independent", () => {
		const ordered = [
			mk("a", "project", ".novacode"),
			mk("a", "project", ".agents"),
			mk("a", "global", ".novacode"),
			mk("a", "global", ".agents"),
		]
		const winner = dedupeSkills([...ordered].reverse())[0]!
		expect(winner).toEqual(dedupeSkills(ordered)[0])
		expect(winner.source).toBe("project")
		expect(winner.path).toContain(".novacode")
	})

	it("keeps exactly one skill per name", () => {
		const skills = [
			mk("a", "project", ".novacode"),
			mk("a", "global", ".agents"),
			mk("b", "global", ".agents"),
		]
		expect(
			dedupeSkills(skills)
				.map((s) => s.name)
				.sort(),
		).toEqual(["a", "b"])
	})
})

describe("skill grouping", () => {
	it("groups every occurrence, winner first loser last", () => {
		const skills = [
			mk("a", "global", ".agents"),
			mk("a", "project", ".agents"),
			mk("a", "global", ".novacode"),
			mk("a", "project", ".novacode"),
		]
		const [group] = groupSkills(skills)
		expect(group).toHaveLength(4)
		expect(group![0]!.source).toBe("project")
		expect(group![0]!.path).toContain(".novacode")
		expect(group![3]!.source).toBe("global")
		expect(group![3]!.path).toContain(".agents")
	})

	it("keeps distinct names in first-seen order", () => {
		const skills = [mk("z", "project", ".novacode"), mk("a", "project", ".novacode")]
		expect(groupSkills(skills).map((g) => g[0]!.name)).toEqual(["z", "a"])
	})
})

describe("system prompt uses the prioritized skill", () => {
	it("renders only the winner when a name is duplicated", () => {
		const winner = mk("deploy", "project", ".novacode")
		const loser = mk("deploy", "global", ".agents")
		const prompt = buildSystemPrompt("/tmp", getAllTools("/tmp"), dedupeSkills([loser, winner]))
		expect(prompt).toContain(winner.path)
		expect(prompt).not.toContain(loser.path)
	})
})

describe("discoverSkills (project dirs)", () => {
	let cwd: string

	beforeEach(async () => {
		cwd = await mkdtemp(join(tmpdir(), "nova-skills-"))
	})

	afterEach(async () => {
		await rm(cwd, { recursive: true, force: true })
	})

	it("scans both project dirs and dedupes to .novacode", async () => {
		const name = "prec-discover-test-9f2a"
		await mkdir(join(cwd, ".novacode", "skills", name), { recursive: true })
		await mkdir(join(cwd, ".agents", "skills", name), { recursive: true })
		await writeFile(
			join(cwd, ".novacode", "skills", name, "SKILL.md"),
			`---\nname: ${name}\ndescription: nova copy\n---\n`,
		)
		await writeFile(
			join(cwd, ".agents", "skills", name, "SKILL.md"),
			`---\nname: ${name}\ndescription: agents copy\n---\n`,
		)

		const found = (await discoverSkills(cwd)).filter((s) => s.name === name)
		expect(found).toHaveLength(2)
		expect(dedupeSkills(found)[0]!.path).toContain(".novacode")
	})
})
