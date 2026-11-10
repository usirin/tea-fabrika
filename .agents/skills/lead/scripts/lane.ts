// lane.ts: pure rules about one lane that drive.ts and gc.ts share. Today's lead tooling, run on our
// own laptop; it is not product.

import {dirname, matchesGlob} from "node:path";

/** The lane's backup branch: `<branch>-wip`, and a branch that already ends in -wip as it is. */
export const wipOf = (branch: string): string => `${branch.replace(/(-wip)+$/, "")}-wip`;

/**
 * Where a step with no --from starts: the newest pushed tip, the branch's or its -wip backup's,
 * unless the saved head has moved past it (a step accepted but not yet pushed). A lead commit (a
 * merge of main, a lockfile commit) is pushed to the backup outside drive, so the backup's tip is
 * how drive learns it (layers, 2026-11-09: the saved mutation head was taken over the lead merge).
 * `pushed` lists the tips that exist; `isAncestor(a, b)` says whether b holds a.
 */
export const startHead = (
	pushed: readonly string[],
	saved: string | undefined,
	isAncestor: (a: string, b: string) => boolean,
): string | undefined => {
	const newest = pushed.find((p) => pushed.every((q) => isAncestor(q, p))) ?? pushed[0];
	return newest && !(saved && isAncestor(newest, saved)) ? newest : saved;
};

/**
 * The lane's root: where its base left main, so a step's commits check reads every earlier step's
 * link from here. `fresh` is the merge base of main and the step's base. After a catch-up merges a
 * newer main in, `fresh` moves past the saved root, and main's own squash commits would then sit in
 * the saved root's range and read as unsigned (ci375 tests6, ticket 391). So `fresh` wins whenever
 * it holds the saved root. A saved root the base holds and `fresh` does not is kept; any other saved
 * root came from a step off the lane, and `fresh` is found again.
 */
export const laneRoot = (
	saved: string | undefined,
	fresh: string,
	base: string,
	isAncestor: (a: string, b: string) => boolean,
): string => (saved && !isAncestor(saved, fresh) && isAncestor(saved, base) ? saved : fresh);

/** The step a git note names, or none when it does not read. */
export const stepOf = (note: string): string[] => {
	let n: unknown;

	try {
		n = JSON.parse(note);
	} catch {
		return [];
	}

	const step = n !== null && typeof n === "object" ? (n as {step?: unknown}).step : undefined;
	return typeof step === "string" ? [step] : [];
};

const stuckIn = (out: string) =>
	out.split("\n").flatMap((line) => {
		let a: unknown;

		try {
			a = JSON.parse(line);
		} catch {
			return [];
		}

		if (a === null || typeof a !== "object") {
			return [];
		}

		const {_tag, why, step} = a as {_tag?: unknown; why?: unknown; step?: unknown};
		return _tag === "stuck" ? [{line, why, step}] : [];
	});

/**
 * The commits check's stuck answers that hold the step back. A stale link counts only for a step
 * the lane itself has signed: a step it has not reached yet (lead, before catch-up) may hold a newer
 * link from an older pull request on the same ticket, and CI judges that on the pull request
 * (themes tests, 2026-11-09: PR 565's lead link on ticket 343). Lines that are not answers are left
 * to the caller, which reads the exit code too.
 */
export const laneStuck = (out: string, laneSteps: ReadonlySet<string>): string[] =>
	stuckIn(out)
		.filter(
			({why, step}) =>
				!(why === "stale_link" && !(typeof step === "string" && laneSteps.has(step))),
		)
		.map((a) => a.line);

/**
 * Each stuck answer that holds the step, as `<rule> <commit> [step <s>] [paths]`: the rule
 * (stale_link, broken_chain, unsigned_commit, ...) and the commit, so the lead can send the step to
 * the right place (ticket 429: 18 fetches on 2026-11-09 said only "commits check failed").
 */
export const heldRules = (out: string, laneSteps: ReadonlySet<string>): string[] =>
	laneStuck(out, laneSteps).map((line) => {
		const a = JSON.parse(line) as {why?: unknown; sha?: unknown; step?: unknown; paths?: unknown};
		const paths = Array.isArray(a.paths) ? a.paths.slice(0, 3).map(String) : [];
		return [
			typeof a.why === "string" ? a.why : "stuck",
			typeof a.sha === "string" ? a.sha.slice(0, 8) : "",
			typeof a.step === "string" ? `step ${a.step}` : "",
			...paths,
		]
			.filter(Boolean)
			.join(" ");
	});

/** Whether the commits check's exit holds the step: 0 never; 1 unless it gave stuck answers and
 * every one was waived; any other exit always. */
export const checkHolds = (code: number, out: string, laneSteps: ReadonlySet<string>): boolean =>
	code !== 0 && !(code === 1 && stuckIn(out).length > 0 && laneStuck(out, laneSteps).length === 0);

/** The `packages:` globs of a pnpm-workspace.yaml: the block's `- glob` lines, comments dropped. */
export const workspaceGlobs = (yaml: string): string[] => {
	const lines = yaml.split("\n");
	const start = lines.findIndex((l) => /^packages:\s*(#.*)?$/.test(l));

	if (start < 0) {
		return [];
	}

	const globs: string[] = [];

	for (const line of lines.slice(start + 1)) {
		if (/^\s*(#.*)?$/.test(line)) {
			continue;
		}

		const m = /^\s+-\s+['"]?([^'"#\s]+)['"]?\s*(#.*)?$/.exec(line);

		if (m === null) {
			break;
		}

		globs.push(m[1] ?? "");
	}

	return globs;
};

/** Whether a folder is a workspace package: the root, or one the globs take and no `!` glob drops. */
const member = (dir: string, globs: readonly string[]) =>
	dir === "." ||
	(globs.some((g) => !g.startsWith("!") && matchesGlob(dir, g)) &&
		!globs.some((g) => g.startsWith("!") && matchesGlob(dir, g.slice(1))));

/** The package.json fields pnpm-lock.yaml follows. Scripts, exports and the rest do not move it. */
const LOCKED = [
	"name",
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
	"peerDependenciesMeta",
	"dependenciesMeta",
	"pnpm",
] as const;

/** Keys sorted all the way down, so a reorder is not a change. */
const canon = (v: unknown): string =>
	Array.isArray(v)
		? `[${v.map(canon).join(",")}]`
		: v !== null && typeof v === "object"
			? `{${Object.keys(v)
					.toSorted()
					.map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`)
					.join(",")}}`
			: JSON.stringify(v);

const lockedPart = (text: string): string | null => {
	try {
		const json: unknown = JSON.parse(text);

		if (json === null || typeof json !== "object") {
			return null;
		}

		return canon(LOCKED.map((k) => (json as Record<string, unknown>)[k] ?? null));
	} catch {
		return null;
	}
};

/** One manifest a step's commits touched, as the base and the head hold it (`null`: absent). */
export type Manifest = {
	readonly path: string;
	readonly before: string | null;
	readonly after: string | null;
};

/**
 * The manifests a step changed in a way pnpm-lock.yaml must follow, when the step left the lockfile
 * alone. A box has no network, so it cannot refresh the lockfile, and without it nothing installs
 * or type-checks: themes build2 (ticket 343, ticket 385) added a dependency, and the lane looped
 * build -> tests -> build. Changed: pnpm-workspace.yaml in any way; a workspace package.json
 * added, removed, unreadable, or with a different locked field. A package.json outside the
 * workspace (a fixture's) has no lockfile entry and never counts.
 */
export const lockfileBehind = (
	changed: readonly Manifest[],
	globs: readonly string[],
	lockTouched: boolean,
): string[] =>
	lockTouched
		? []
		: changed
				.filter(({path, before, after}) => {
					if (before === after) {
						return false;
					}

					if (path === "pnpm-workspace.yaml") {
						return true;
					}

					if (path !== "package.json" && !path.endsWith("/package.json")) {
						return false;
					}

					if (!member(dirname(path), globs)) {
						return false;
					}

					if (before === null || after === null) {
						return true;
					}

					const was = lockedPart(before);
					const is = lockedPart(after);
					return was === null || is === null || was !== is;
				})
				.map((m) => m.path);
