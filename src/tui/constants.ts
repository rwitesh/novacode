/**
 * TUI-specific static constants and configuration styles.
 */

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export const TOOL_STYLE: Record<string, string> = {
	read: "blue",
	write: "magenta",
	edit: "yellow",
	bash: "cyan",
	glob: "green",
	find: "green",
	grep: "green",
	tree: "green",
}

export const TERMINATION_PHRASES = [
	"Terminated by user",
	"Aborted by user",
	"Execution stopped",
	"Interrupted by user",
	"Agent halted",
	"Stopped by user",
]
