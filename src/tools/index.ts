import type { ToolSet } from "ai"
import { editTool, readTool, writeTool } from "./fs.ts"
import { gitTool } from "./git.ts"
import { globTool, grepTool, lsTool, treeTool } from "./search.ts"
import { bashTool } from "./shell.ts"
import { webFetchTool, webSearchTool } from "./web.ts"

// Keys are the tool names the model sees and that PolicyEngine classifies on.
export function getAllTools(cwd: string): ToolSet {
	return {
		read: readTool(cwd),
		write: writeTool(cwd),
		edit: editTool(cwd),
		bash: bashTool(cwd),
		glob: globTool(cwd),
		grep: grepTool(cwd),
		ls: lsTool(cwd),
		tree: treeTool(cwd),
		git: gitTool(cwd),
		web_search: webSearchTool(),
		web_fetch: webFetchTool(),
	}
}
