// Experiment 104c: plan's real runs, 20 a kill point, read against 20 unkilled controls. The exact
// test and the rule written before the runs (104-stages-on-tea-host.md, "104c"). Pure: runs in,
// numbers and a verdict out.

/** One plan run as 104c reads it. */
export interface PlanRun {
	/** `control`, or the kill point. */
	readonly point: string;
	/** The kill fired: a killed run whose kill never fired is left out. */
	readonly faulted: boolean;
	/** The outcome's name, or `none` when the run ended with no outcome. */
	readonly name: string;
	readonly tasks: number | null;
	readonly questions: number | null;
	/** Agent turns the ledger held. */
	readonly holds: number;
}

const logFact = (() => {
	const memo = [0];
	return (n: number): number => {
		for (let i = memo.length; i <= n; i++) memo.push((memo[i - 1] ?? 0) + Math.log(i));
		return memo[n] ?? 0;
	};
})();
const logChoose = (n: number, k: number) => logFact(n) - logFact(k) - logFact(n - k);

/**
 * Fisher's exact test on a 2 x k table (Freeman-Halton's extension past 2 x 2), two-sided: the sum
 * of the probabilities, under fixed margins, of every table no more likely than the one seen.
 * `a` and `b` are the two rows' counts per column, in the same column order.
 */
export const fisherExact = (a: readonly number[], b: readonly number[]): number => {
	const pairs = a.map((x, i) => [x, x + (b[i] ?? 0)] as const).filter(([, c]) => c > 0);
	const cols = pairs.map(([, c]) => c);
	const kept = pairs.map(([x]) => x);
	const n1 = kept.reduce((s, x) => s + x, 0);
	const total = cols.reduce((s, x) => s + x, 0);
	if (cols.length < 2 || n1 === 0 || n1 === total) return 1;
	const denom = logChoose(total, n1);
	const logP = (xs: readonly number[]) =>
		xs.reduce((s, x, i) => s + logChoose(cols[i] ?? 0, x), 0) - denom;
	const seen = logP(kept);
	let p = 0;
	const walk = (i: number, left: number, xs: number[]) => {
		if (i === cols.length - 1) {
			if (left > (cols[i] ?? 0)) return;
			const lp = logP([...xs, left]);
			if (lp <= seen + 1e-7) p += Math.exp(lp);
			return;
		}
		const rest = cols.slice(i + 1).reduce((s, x) => s + x, 0);
		for (let x = Math.max(0, left - rest); x <= Math.min(cols[i] ?? 0, left); x++)
			walk(i + 1, left - x, [...xs, x]);
	};
	walk(0, n1, []);
	return Math.min(1, p);
};

/** Counts per category, over a fixed column order. */
const countsOf = (values: readonly string[], columns: readonly string[]) =>
	columns.map((c) => values.filter((v) => v === c).length);

const shapeOf = (r: PlanRun) => `tasks=${r.tasks ?? "none"} questions=${r.questions ?? "none"}`;

const mode = (values: readonly string[]) => {
	const counts = new Map<string, number>();
	for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
	return [...counts].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
};

/** One comparison, killed runs against the controls: counts, p, and the shape share. */
const compare = (label: string, killed: readonly PlanRun[], controls: readonly PlanRun[]) => {
	const outcomes = [...new Set([...controls, ...killed].map((r) => r.name))].sort();
	const shapes = [...new Set([...controls, ...killed].map(shapeOf))].sort();
	const controlShape = mode(controls.map(shapeOf));
	const share = (rs: readonly PlanRun[]) =>
		rs.length === 0 ? 0 : rs.filter((r) => shapeOf(r) === controlShape).length / rs.length;
	return {
		label,
		n: {killed: killed.length, control: controls.length},
		outcomes: {
			columns: outcomes,
			killed: countsOf(
				killed.map((r) => r.name),
				outcomes,
			),
			control: countsOf(
				controls.map((r) => r.name),
				outcomes,
			),
			p: fisherExact(
				countsOf(
					killed.map((r) => r.name),
					outcomes,
				),
				countsOf(
					controls.map((r) => r.name),
					outcomes,
				),
			),
		},
		shapes: {
			columns: shapes,
			killed: countsOf(killed.map(shapeOf), shapes),
			control: countsOf(controls.map(shapeOf), shapes),
			p: fisherExact(
				countsOf(killed.map(shapeOf), shapes),
				countsOf(controls.map(shapeOf), shapes),
			),
			controlMode: controlShape,
			killedShare: share(killed),
			controlShare: share(controls),
		},
		wastedMax: Math.max(
			0,
			...killed.map((r) => r.holds - Math.max(...controls.map((c) => c.holds))),
		),
	};
};
export type Comparison = ReturnType<typeof compare>;

/** The rule, as written before the runs. */
export const ALPHA = 0.05;
export const SHAPE_SHARE = 0.95;
export const SHAPE_SLACK = 0.1;

const holds = (c: Comparison) => {
	const failed: string[] = [];
	if (c.outcomes.p < ALPHA)
		failed.push(`${c.label}: outcomes differ, p ${c.outcomes.p.toFixed(4)}`);
	if (c.shapes.p < ALPHA)
		failed.push(`${c.label}: tasks and questions differ, p ${c.shapes.p.toFixed(4)}`);
	const floor =
		c.shapes.controlShare >= SHAPE_SHARE ? SHAPE_SHARE : c.shapes.controlShare - SHAPE_SLACK;
	if (c.label !== "pooled" && c.shapes.killedShare < floor)
		failed.push(
			`${c.label}: ${(c.shapes.killedShare * 100).toFixed(0)}% of killed runs have the controls' tasks and questions, under ${(floor * 100).toFixed(0)}%`,
		);
	if (c.label !== "pooled" && c.wastedMax > 1)
		failed.push(`${c.label}: ${c.wastedMax} wasted turns in one takeover`);
	return failed;
};

/** Every kill point and the pool against the controls, and the verdict the rule gives. */
export const analyse = (runs: readonly PlanRun[]) => {
	const controls = runs.filter((r) => r.point === "control");
	const killed = runs.filter((r) => r.point !== "control" && r.faulted);
	const points = [...new Set(killed.map((r) => r.point))].sort();
	const comparisons = [
		...points.map((p) =>
			compare(
				p,
				killed.filter((r) => r.point === p),
				controls,
			),
		),
		compare("pooled", killed, controls),
	];
	const failed = comparisons.flatMap(holds);
	const outcomeChanged = comparisons.some((c) => c.outcomes.p < ALPHA || c.shapes.p < ALPHA);
	return {
		comparisons,
		notFired: runs.filter((r) => r.point !== "control" && !r.faulted).length,
		failed,
		verdict: outcomeChanged
			? ("changes outcome" as const)
			: failed.length > 0
				? ("outcome same, rule not met" as const)
				: ("harmless" as const),
	};
};
