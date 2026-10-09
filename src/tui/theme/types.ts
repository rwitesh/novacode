export interface Theme {
	name: string
	colors: {
		background: string
		text: string
		muted: string
		selection: {
			text: string
			background: string
		}
		user: {
			text: string
			background: string
		}
		assistant: string
		tool: string
		reasoning: string
		error: string
		warning: string
		info: string
		success: string
	}
}
