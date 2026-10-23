import {realpathSync} from "node:fs";
import {basename, dirname, isAbsolute, join, relative, resolve} from "node:path";
import {refusal} from "@kampus/fabrika/agents/sandbox";

// The builder's own check on one tool call, as a plain function. Kept apart
// from ./builder.ts, which starts the Agent SDK, so a process that only checks
// a call (./check-hook.ts, run once per tool call) loads nothing else: about
// 50 ms a start instead of about 300. Its subpath, `/agents/sandbox`, loads
// no Agent SDK either.
//
// The rest of what was this file, the sandbox the builder runs inside (its
// tool list, its folders, its environment), is fabrika's since experiment
// 114: `acp --agent claude` runs inside the same one.

const inside = (folder: string, path: string) => {
	const rel = relative(folder, path);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/** A path with its links followed, as far as it is there: `/copy/out/x` where `out` links elsewhere is that elsewhere's `x`. */
const realOf = (path: string): string => {
	const parent = dirname(path);
	try {
		return realpathSync(path);
	} catch {
		return parent === path ? path : join(realOf(parent), basename(path));
	}
};

/** The part of a glob before its first wildcard, as a folder: `/a/b/*.ts` is `/a/b`. */
const fixedPart = (pattern: string): string => {
	const wild = pattern.search(/[*?[{]/);
	return wild === -1 ? pattern : dirname(`${pattern.slice(0, wild)}x`);
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
		const pattern = tool === "Glob" ? text(input.pattern) : null;
		// A Glob's pattern can leave the folder on its own: `/elsewhere/**`, `~/x`,
		// or `..`, which after a `**` that matched nothing climbs one more than it shows.
		if (pattern !== null && (pattern.startsWith("~") || pattern.split(/[\\/]/).includes("..")))
			return `The pattern ${pattern} leaves your working copy. Glob only inside ${tree}, without ".." or "~".`;
		const asked = [
			text(input.file_path),
			text(input.path),
			pattern !== null && isAbsolute(pattern) ? fixedPart(pattern) : null,
		].flatMap((p) => (p === null ? [] : [resolve(tree, p)]));
		// A link is followed: the builder's commands can make one in the copy that points out of it.
		const homes = [tree, realOf(tree), ...temp];
		const outside = asked
			.flatMap((p) => [p, realOf(p)])
			.find((p) => !homes.some((home) => inside(home, p)));
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
 * The builder's whole check on one tool call: the shared Check (fabrika's
 * `refusal`, `@kampus/fabrika/agents/sandbox`), then the builder's own rule
 * above. The reason to refuse, or `null`. The SDK path runs the two as its
 * PreToolUse hooks (`builderOptions`, ./builder.ts); the ACP path runs this
 * as a command hook (./check-hook.ts) and on each permission ask
 * (./builder-acp.ts). One function, so the paths cannot drift.
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
