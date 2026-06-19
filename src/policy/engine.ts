/**
 * Deterministic tool-safety policy engine.
 *
 * This is the single hard boundary between model-generated actions and their
 * side effects. Prompt wording is NOT a security control — only this engine
 * (wired through LoopOpts.beforeTool) decides what actually runs.
 */

import { basename, resolve, sep } from "node:path"
import type {
	ApprovalRequest,
	PermissionMode,
	PolicyApprover,
	PolicyCall,
	ToolRisk,
} from "../types.ts"

// .env.example / .env.sample / .env.template are safe to read (templates only)
const ENV_TEMPLATE_OK = new Set([".env.example", ".env.sample", ".env.template"])

const ENV_SECRET_RE = /^\.env(\..*)?$/i

const SECRET_BASENAMES = new Set([
	".env",
	".npmrc",
	".pypirc",
	".netrc",
	".git-credentials",
	"credentials",
	"credentials.json",
	"id_rsa",
	"id_dsa",
	"id_ecdsa",
	"id_ed25519",
	".htpasswd",
])

const SECRET_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx", ".keystore", ".jks", ".kdbx"])

const SECRET_DIR_SEGMENTS = new Set([".ssh", ".aws", ".gnupg", "secrets", ".secrets"])

export function isSecretFile(absPath: string): boolean {
	const base = basename(absPath).toLowerCase()
	if (!base) return false

	if (ENV_SECRET_RE.test(base)) return !ENV_TEMPLATE_OK.has(base)
	if (SECRET_BASENAMES.has(base)) return true

	const dot = base.lastIndexOf(".")
	if (dot > 0 && SECRET_EXTENSIONS.has(base.slice(dot))) return true

	const parts = absPath.toLowerCase().split(sep)
	return parts.some((p) => SECRET_DIR_SEGMENTS.has(p))
}

export function classifyRisk(call: PolicyCall): ToolRisk {
	switch (call.name) {
		case "read":
		case "ls":
		case "glob":
		case "grep":
		case "tree":
			return "safe"
		case "write":
		case "edit":
			return "write"
		case "git": {
			const action = (call.args.action as string) ?? ""
			return action === "add" || action === "commit" ? "write" : "safe"
		}
		case "bash":
			return "execution"
		case "web_search":
		case "web_fetch":
			return "network"
		default:
			return "execution"
	}
}

export function summarizeCall(call: PolicyCall): string {
	const a = call.args
	switch (call.name) {
		case "bash":
			return String(a.command ?? "")
		case "read":
			return `read ${a.path ?? ""}`
		case "write":
			return `write ${a.path ?? ""}`
		case "edit":
			return `edit ${a.path ?? ""}`
		case "git":
			return `git ${a.action ?? ""} ${((a.args as string[]) ?? []).join(" ")}`.trim()
		case "web_fetch":
			return `fetch ${a.url ?? ""}`
		case "web_search":
			return `search "${a.query ?? ""}"`
		case "glob":
			return `glob ${a.pattern ?? ""}`
		case "grep":
			return `grep "${a.pattern ?? ""}"${a.path ? ` in ${a.path}` : ""}`
		case "ls":
			return `ls ${a.path ?? ""}`
		case "tree":
			return `tree ${a.path ?? ""}`
		default:
			return call.name
	}
}

// Heuristic: flags shell commands that appear to read secret files (not a block,
// only surfaces a warning on the approval prompt).
export function bashSecretHint(command: string): string {
	if (!command) return ""
	const hits: string[] = []
	if (/(^|[^.a-z])\.env($|[^.a-z])/i.test(command)) hits.push(".env")
	for (const name of SECRET_BASENAMES) {
		if (name !== ".env" && command.includes(name)) hits.push(name)
	}
	for (const ext of SECRET_EXTENSIONS) {
		if (command.includes(ext)) {
			hits.push(`*${ext}`)
			break
		}
	}
	return hits.length ? `⚠ command may read secret file (${hits.join(", ")})` : ""
}

export class PolicyEngine {
	#mode: PermissionMode
	#cwd: string
	#approver: PolicyApprover | null = null

	constructor(mode: PermissionMode, cwd: string) {
		this.#mode = mode
		this.#cwd = cwd
	}

	get mode(): PermissionMode {
		return this.#mode
	}

	setMode(mode: PermissionMode): void {
		this.#mode = mode
	}

	setApprover(approver: PolicyApprover | null): void {
		this.#approver = approver
	}

	async check(call: PolicyCall): Promise<{ allow: boolean; reason?: string }> {
		// Unrestricted mode: trust everything. Best-practice guidance still lives
		// in the system prompt, but there is no deterministic gate here.
		if (this.#mode === "unrestricted") return { allow: true }

		// Restricted mode: secrets are never readable, even with approval.
		const secret = this.#detectSecretAccess(call)
		if (secret) {
			return {
				allow: false,
				reason: `Blocked: "${secret}" is a secret file and cannot be read in restricted mode.`,
			}
		}

		// Safe read-only operations do not need approval.
		if (classifyRisk(call) === "safe") return { allow: true }

		if (!this.#approver) {
			return {
				allow: false,
				reason:
					"Blocked: restricted mode requires interactive approval, but no approver is connected.",
			}
		}

		const summary = summarizeCall(call)
		const req: ApprovalRequest = {
			tool: call.name,
			risk: classifyRisk(call),
			summary,
			warning: call.name === "bash" ? bashSecretHint(summary) : undefined,
		}
		const allowed = await this.#approver.request(req)
		return allowed
			? { allow: true }
			: { allow: false, reason: `Denied: ${call.name} was not approved by the user.` }
	}

	#detectSecretAccess(call: PolicyCall): string | null {
		// read targets a single file directly; grep with an explicit file path too.
		if (call.name !== "read" && call.name !== "grep") return null
		const p = call.args.path
		if (typeof p !== "string" || !p.trim()) return null
		const abs = resolve(this.#cwd, p)
		return isSecretFile(abs) ? p : null
	}
}
