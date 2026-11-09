// lane.ts: pure rules about one lane that drive.ts and gc.ts share. Today's lead tooling, run on our
// own laptop; it is not product.

/** The lane's backup branch: `<branch>-wip`, and a branch that already ends in -wip as it is. */
export const wipOf = (branch: string): string => `${branch.replace(/(-wip)+$/, "")}-wip`;

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
