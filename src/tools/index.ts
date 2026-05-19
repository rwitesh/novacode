import type { Tool } from "../types.ts"
import { editTool, readTool, writeTool } from "./fs.ts"
import { findTool, globTool, grepTool, lsTool } from "./search.ts"
import { bashTool } from "./shell.ts"

export function getAllTools(cwd: string): Tool[] {
	return [
		readTool(cwd),
		writeTool(cwd),
		editTool(cwd),
		bashTool(cwd),
		findTool(cwd),
		globTool(cwd),
		grepTool(cwd),
		lsTool(cwd),
	]
}

export function getDefaultTools(cwd: string): Tool[] {
	return [readTool(cwd), writeTool(cwd), editTool(cwd), bashTool(cwd)]
}
