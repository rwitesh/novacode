import { rm, stat } from "node:fs/promises"
import { createInterface } from "node:readline"
import chalk from "chalk"
import { getNovaDir } from "../config/store.ts"
import { closeDb, resetDb } from "../db/client.ts"
import type { Prompts } from "../types.ts"

export async function handleCliReset(): Promise<void> {
	const novaDir = getNovaDir()

	try {
		await stat(novaDir)
	} catch {
		console.log(chalk.yellow("No nova data found. Nothing to reset."))
		return
	}

	console.log(
		chalk.bold("This will delete all nova data (API keys, config, sessions, and global skills)."),
	)

	const confirmed = await askYesNo("Continue? (y/N): ")
	if (!confirmed) {
		console.log(chalk.yellow("Reset cancelled."))
		return
	}

	closeDb()
	resetDb()

	try {
		await rm(novaDir, { recursive: true, force: true })
	} catch (e) {
		console.error(chalk.red(`Failed to delete ${novaDir}: ${(e as Error).message}`))
		process.exit(1)
	}

	console.log(
		chalk.green("✓ Nova reset complete.") +
			"\n  Run " +
			chalk.bold.cyan("nova") +
			" to start fresh with onboarding.",
	)
}

export async function handleInteractiveReset(
	prompts?: Prompts,
	onExit?: () => void,
): Promise<string> {
	const novaDir = getNovaDir()

	try {
		await stat(novaDir)
	} catch {
		return chalk.yellow("No nova data found. Nothing to reset.")
	}

	if (!prompts) {
		return chalk.red("Reset is only available in interactive mode. Use /reset.")
	}

	const confirmed = await prompts.confirm({
		message: "Delete all nova data? This removes API keys, config, sessions, and global skills.",
	})

	if (!confirmed) {
		return chalk.yellow("Reset cancelled.")
	}

	closeDb()
	resetDb()

	try {
		await rm(novaDir, { recursive: true, force: true })
	} catch (e) {
		return chalk.red(`Failed to delete ${novaDir}: ${(e as Error).message}`)
	}

	const result =
		chalk.green("✓ Nova reset complete.") +
		"\n  Run " +
		chalk.bold.cyan("nova") +
		" to start fresh with onboarding."

	if (onExit) {
		process.stdout.write(`${result}\n`)
		onExit()
		return null as unknown as string
	}

	return result
}

function askYesNo(question: string): Promise<boolean> {
	const rl = createInterface({ input: process.stdin, output: process.stderr })
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close()
			resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes")
		})
	})
}
