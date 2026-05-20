import type { Tool } from "../types.ts"
import { editTool, readTool, writeTool } from "./fs.ts"
import { gitTool } from "./git.ts"
import { globTool, grepTool, lsTool, treeTool } from "./search.ts"
import { bashTool } from "./shell.ts"
import { webFetchTool, webSearchTool } from "./web.ts"

export function getAllTools(cwd: string): Tool[] {
	return [
		readTool(cwd),
		writeTool(cwd),
		editTool(cwd),
		bashTool(cwd),
		globTool(cwd),
		grepTool(cwd),
		lsTool(cwd),
		treeTool(cwd),
		gitTool(cwd),
		webSearchTool(),
		webFetchTool(),
	]
}

export function getDefaultTools(cwd: string): Tool[] {
	return [
		readTool(cwd),
		writeTool(cwd),
		editTool(cwd),
		bashTool(cwd),
		webSearchTool(),
		webFetchTool(),
	]
}
