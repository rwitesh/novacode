import chalk from "chalk"

export function formatRichText(text: string): string {
	let formatted = text
	formatted = formatted.replace(/`([^`]+)`/g, (_, code) => chalk.yellow(code))
	formatted = formatted.replace(/\*\*([^*]+)\*\*/g, (_, bold) => chalk.bold(bold))
	formatted = formatted.replace(/__([^_]+)__/, (_, bold) => chalk.bold(bold))
	formatted = formatted.replace(/\*([^*]+)\*/g, (_, italic) => chalk.italic(italic))
	formatted = formatted.replace(/_([^_]+)_/g, (_, italic) => chalk.italic(italic))
	formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
		return `${chalk.blue(label)} ${chalk.dim(`(${url})`)}`
	})
	return formatted
}
