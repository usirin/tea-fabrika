// lane.ts: pure rules about one lane that drive.ts and gc.ts share. Today's lead tooling, run on our
// own laptop; it is not product.

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
		if (a === null || typeof a !== "object") return [];
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

/** Whether the commits check's exit holds the step: 0 never; 1 unless it gave stuck answers and
 * every one was waived; any other exit always. */
export const checkHolds = (code: number, out: string, laneSteps: ReadonlySet<string>): boolean =>
	code !== 0 && !(code === 1 && stuckIn(out).length > 0 && laneStuck(out, laneSteps).length === 0);
