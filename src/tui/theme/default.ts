import type { Theme } from "./types.ts"

export const defaultTheme: Theme = {
	name: "default",
	colors: {
		background: "#171717",
		text: "#e5e5e5",
		muted: "#a3a3a3",
		selection: {
			text: "#171717",
			background: "#60a5fa",
		},
		user: {
			text: "#e5e5e5",
			background: "#243447",
		},
		assistant: "#e5e5e5",
		tool: "#60a5fa",
		reasoning: "#facc15",
		error: "#f87171",
		warning: "#facc15",
		info: "#60a5fa",
		success: "#4ade80",
	},
}
