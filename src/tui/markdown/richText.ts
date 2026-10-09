import chalk from "chalk"

export function formatRichText(text: string): string {
	return text.replace(
		/`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|(?<!\w)_([^_]+)_(?!\w)|\[([^\]]+)\]\(([^)]+)\)/g,
		(
			_match,
			code: string | undefined,
			bold: string | undefined,
			boldAlt: string | undefined,
			italic: string | undefined,
			italicAlt: string | undefined,
			label: string | undefined,
			url: string | undefined,
		) => {
			if (code !== undefined) return chalk.yellow(code)
			const strong = bold ?? boldAlt
			if (strong !== undefined) return chalk.bold(formatRichText(strong))
			const emphasis = italic ?? italicAlt
			if (emphasis !== undefined) return chalk.italic(formatRichText(emphasis))
			return `${chalk.blue(formatRichText(label ?? ""))} ${chalk.dim(`(${url})`)}`
		},
	)
}
