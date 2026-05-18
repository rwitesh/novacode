import type { Tool } from "../types.ts"
import { bashTool, editTool, readTool, writeTool } from "./fs.ts"

export function getDefaultTools(cwd: string): Tool[] {
	return [readTool(cwd), writeTool(cwd), editTool(cwd), bashTool(cwd)]
}
