import {realpathSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {isAbsolute, join, relative, resolve} from "node:path";
import {refusal} from "../../shell-guard.ts";

// The builder's holds that are plain functions: its check on one tool call,
// its tool list, the temp folders it may write and the login files it may not
// read. Kept apart from ./builder.ts, which starts the Agent SDK, so a process
// that only checks a call (./check-hook.ts, run once per tool call) loads
// nothing else: about 50 ms a start instead of about 300.

const inside = (folder: string, path: string) => {
	const rel = relative(folder, path);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

const READS = new Set(["Read", "Grep", "Glob"]);

/** Commands that talk to GitHub or the network, or that would let a command out of the sandbox. Refused by name. */
const TALKS =
	/(^|[\s;&|(`])(gh|curl|wget|ssh|scp|nc|npm\s+publish|pnpm\s+publish|git\s+(push|remote|fetch|pull|clone|config|credential))\b/;

/**
 * The builder's own rule, beside the shared Check: a read stays in the copy
 * and the temp folders, a command that talks to GitHub or the network is
 * refused by name, and no command may ask to leave the sandbox.
 */
export function builderRefusal(
	tree: string,
	temp: readonly string[],
	tool: string,
	input: Readonly<Record<string, unknown>>,
): string | null {
	const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);
	if (READS.has(tool)) {
		const asked = [text(input.file_path), text(input.path)].flatMap((p) =>
			p === null ? [] : [resolve(tree, p)],
		);
		const outside = asked.find((p) => !inside(tree, p) && !temp.some((t) => inside(t, p)));
		return outside === undefined
			? null
			: `${outside} is outside your working copy. Read only inside ${tree}.`;
	}
	if (tool !== "Bash") return null;
	if (input.dangerouslyDisableSandbox === true)
		return "Every command runs in the sandbox here. Run it without asking to leave it.";
	const command = text(input.command) ?? "";
	if (TALKS.test(command))
		return "This run has no network and no account. Do not call GitHub, push, fetch or reach the network: code commits, pushes and opens the pull request after you, from your form.";
	return null;
}

/**
 * The builder's whole check on one tool call: the shared Check
 * (src/shell-guard.ts), then the builder's own rule above. The reason to
 * refuse, or `null`. The SDK path runs the two as its PreToolUse hooks
 * (`builderOptions`, ./builder.ts); the ACP path runs this as a command hook
 * (./check-hook.ts) and on each permission ask (./builder-acp.ts). One
 * function, so the paths cannot drift.
 */
export const builderCheck =
	(tree: string, temp: readonly string[]) =>
	(tool: string, input: Readonly<Record<string, unknown>>): string | null =>
		refusal({tree, alsoWritable: [...temp]}, tool, input) ??
		builderRefusal(tree, temp, tool, input);

/** One line of the check hook's log (./check-hook.ts): the tool, and why it was refused, `null` for an allow. Never the call's input. */
export interface Checked {
	readonly tool: string;
	readonly why: string | null;
}

/** The temp folders, by their real paths: on some systems the one named is a link. */
export const temps = (): readonly string[] => {
	const real = (p: string) => {
		// A folder that is not there is left out; nothing is guessed about it.
		try {
			return [realpathSync(p)];
		} catch {
			return [];
		}
	};
	return [...new Set([...real(tmpdir()), ...real("/tmp")])];
};

/** The files a login lives in, under the home folder. The sandbox makes them unreadable to every command. */
const LOGIN_FILES = [".git-credentials", ".config/gh", ".ssh", ".netrc", ".npmrc", ".aws"];
export const loginFiles = () => LOGIN_FILES.map((file) => join(homedir(), file));

/** The builder's tools: the whole list it has, and the only ones it may use. */
export const TOOLS: readonly string[] = ["Read", "Grep", "Glob", "Edit", "Write", "Bash"];
