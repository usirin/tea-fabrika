// Do the ship machine's seven outcomes cover how today's shipper runs really
// ended? This reads the same lane logs as experiment 53, takes the line that
// ended each stay in `ship`, and maps it onto a `ShipOutcome` kind with the
// table in `src/stages/ship/recorded.ts`. An ending that fits no outcome, or
// fits two, is counted as unmapped with its reason.
//
// Run with `LANES=<path to a .fabrika folder> node experiments/55-ship-outcomes-on-recorded-runs.ts`.
// No Jev, no model, no key, no network: files only, and it writes nothing but
// `results/ship-outcomes-on-recorded-runs.json` (counts, no raw lines).
import {existsSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {compileLane, isPark, parseLog, type Step, walk} from "../src/lane-log.ts";
import {partsOf} from "../src/stages/outcome.ts";
import {endingOf, outcomeOf, type RecordedEnding} from "../src/stages/ship/recorded.ts";

const DATA = process.env.LANES;
if (DATA === undefined || DATA === "") {
	console.error("LANES is not set: point it at a repo's .fabrika folder");
	process.exit(1);
}

class Tally {
	readonly counts = new Map<string, number>();
	add(key: string): void {
		this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
	}
	get total(): number {
		return [...this.counts.values()].reduce((a, b) => a + b, 0);
	}
	rows(): [string, number][] {
		return [...this.counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	}
	json(): Record<string, number> {
		return Object.fromEntries(this.rows());
	}
}
const pct = (n: number, of: number) => (of === 0 ? "" : `${((100 * n) / of).toFixed(1)}%`);
function table(
	title: string,
	head: readonly string[],
	rows: readonly (readonly (string | number)[])[],
): void {
	console.log(`\n${title}\n`);
	console.log(`| ${head.join(" | ")} |`);
	console.log(`|${head.map(() => "---").join("|")}|`);
	for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}

// ---------------------------------------------------------------- the lanes

// The same set as experiment 53: one issue's lane, every line of which folds.
const lanes: (readonly Step[])[] = [];
for (const root of ["lanes", "lanes-archived"]) {
	const dir = join(DATA, root);
	if (!existsSync(dir)) continue;
	for (const name of readdirSync(dir).sort()) {
		const folder = join(dir, name);
		if (!existsSync(join(folder, "workflow.json")) || !existsSync(join(folder, "events.jsonl")))
			continue;
		const compiled = compileLane(JSON.parse(readFileSync(join(folder, "workflow.json"), "utf8")));
		if (compiled === null || compiled.id !== "coder") continue;
		const walked = walk(
			compiled,
			parseLog(readFileSync(join(folder, "events.jsonl"), "utf8")).entries,
		);
		const steps = Object.values(walked.steps);
		if (steps.some((list) => list.some((s) => s.noCell))) continue;
		lanes.push(steps[0] ?? []);
	}
}

// ---------------------------------------------------------------- endings onto outcomes

const label = (e: RecordedEnding): string =>
	e.ending === "parked" || e.ending === "lap"
		? `${e.ending} (${e.cause ?? "no cause"})`
		: e.ending === "board_ended"
			? `board_ended (${e.how})`
			: e.ending === "other"
				? `other (${e.event})`
				: e.ending;

const endings = new Tally();
const kinds = new Tally();
const whys = new Tally();
const unmapped = new Tally();
const rows = new Map<string, string>();
const sentBackTo = new Tally();
for (const steps of lanes) {
	for (const step of steps) {
		const ending = endingOf(step);
		if (ending === null) continue;
		const mapped = outcomeOf(ending);
		endings.add(label(ending));
		if (mapped.mapped) {
			// Since 2026-10-11 an outcome is counted by its name (docs/direction/outcome-names.md). The counts are the same.
			const name = mapped.name ?? `send:${mapped.to} (why not on the line)`;
			kinds.add(name);
			if (name.startsWith("send:builder"))
				whys.add(mapped.name === null ? "the line does not say" : (partsOf(mapped.name).why ?? ""));
			rows.set(label(ending), name);
		} else {
			const why =
				mapped.reason === "fits_two" ? `fits_two (${mapped.names.join(" or ")})` : mapped.reason;
			unmapped.add(why);
			rows.set(label(ending), `unmapped: ${why}`);
		}
		if (ending.ending === "sent_back") sentBackTo.add(step.to);
	}
}
const runs = endings.total;
const mappedRuns = kinds.total;

console.log(
	`single lanes read: ${lanes.length}; shipper runs (stays in \`ship\` that ended): ${runs}`,
);
table(
	"Each recorded ending, and the outcome it stands for",
	["Ending in the log", "Runs", "Share", "Outcome"],
	endings.rows().map(([k, v]) => [k, v, pct(v, runs), rows.get(k) ?? ""]),
);
table(
	`Runs per outcome (${mappedRuns} mapped, ${runs - mappedRuns} unmapped)`,
	["Outcome", "Runs", "Share of all runs"],
	[
		...kinds.rows().map(([k, v]) => [k, v, pct(v, runs)]),
		...unmapped.rows().map(([k, v]) => [`unmapped: ${k}`, v, pct(v, runs)]),
	],
);
console.log(
	`\nsend:builder, by why: ${whys
		.rows()
		.map(([k, v]) => `${k} ${v}`)
		.join(", ")}`,
);
console.log(
	`where a "sent back" landed: ${sentBackTo
		.rows()
		.map(([k, v]) => `${k} ${v}`)
		.join(", ")}`,
);

// ---------------------------------------------------------------- after "queued"

// The ship machine does not end at "queued": it waits. What the queue did next, per shipper run that ended there.
const afterQueued = new Tally();
for (const steps of lanes) {
	steps.forEach((step, i) => {
		if (endingOf(step)?.ending !== "queued") return;
		const left = steps.slice(i + 1).find((s) => s.to !== "ship:queued");
		afterQueued.add(
			left === undefined
				? "nothing: the log ends in the queue"
				: left.entry.event === "DONE"
					? left.to === "shipped"
						? "merged"
						: "merged, issue left open"
					: left.entry.event === "FAIL"
						? `FAIL out of the queue, to ${left.to}`
						: left.entry.event === "LAP"
							? `lap (${left.entry.cause ?? "no cause"}), to ${left.to}`
							: left.entry.event === "WIP"
								? "waited past the budget, parked"
								: left.entry.event === "BLOCKED"
									? `parked (${left.entry.cause ?? "no cause"})`
									: `ended by the board (${left.entry.event})`,
		);
	});
}
table(
	`After "queued" (${afterQueued.total} runs): what left the merge queue`,
	["Next", "Runs"],
	afterQueued.rows(),
);

// ---------------------------------------------------------------- after a park for a branch behind main

/** What followed a `head-behind-base` park: the unpark, and then how that stay in ship ended. */
const afterBehind = new Tally();
const behindFrom = new Tally();
const unparkFields = new Tally();
for (const steps of lanes) {
	steps.forEach((step, i) => {
		if (step.entry.event !== "BLOCKED" || step.entry.cause !== "head-behind-base") return;
		behindFrom.add(step.from);
		// The next line that moves the task. A `CLEARED` moves nothing.
		const at = steps.findIndex((s, j) => j > i && s.to !== s.from);
		const next = steps[at];
		if (next === undefined) return afterBehind.add("nothing: still parked when the data ends");
		if (next.entry.event !== "UNBLOCKED")
			return afterBehind.add(`ended while parked, by the board (${next.entry.event})`);
		for (const key of Object.keys(next.entry.raw))
			if (!["task", "event", "at"].includes(key)) unparkFields.add(key);
		if (next.to !== "ship") return afterBehind.add(`unparked back to ${next.to}`);
		// After the unpark: the first step that takes the task out of ship and its queue.
		const left = steps.slice(at + 1).find((s) => s.to !== "ship" && s.to !== "ship:queued");
		afterBehind.add(
			left === undefined
				? "unparked, then nothing: the log ends in ship"
				: left.to === "shipped"
					? "unparked, then merged"
					: left.entry.event === "DONE"
						? "unparked, then merged with the issue left open"
						: left.entry.event === "LAP"
							? `unparked, then back to the builder: a lap (${left.entry.cause ?? "no cause"})`
							: left.entry.event === "FAIL"
								? "unparked, then back to the builder: sent back for repair"
								: isPark(left.to)
									? `unparked, then parked again (${left.entry.cause ?? "no cause"})`
									: `unparked, then ended by the board (${left.entry.event})`,
		);
	});
}
table(
	`After a park on head-behind-base (${afterBehind.total} parks; parked out of: ${behindFrom
		.rows()
		.map(([k, v]) => `${k} ${v}`)
		.join(", ")})`,
	["Next", "Parks"],
	afterBehind.rows(),
);
console.log(
	`\nfields on the unpark lines: ${unparkFields
		.rows()
		.map(([k, v]) => `${k} ${v}`)
		.join(", ")}`,
);

writeFileSync(
	new URL("./results/ship-outcomes-on-recorded-runs.json", import.meta.url),
	`${JSON.stringify({singleLanes: lanes.length, shipperRuns: runs, endings: endings.json(), outcomeKinds: kinds.json(), backToBuilderWhy: whys.json(), unmapped: unmapped.json(), sentBackTo: sentBackTo.json(), afterQueued: afterQueued.json(), afterHeadBehindBase: afterBehind.json()}, null, 2)}\n`,
);
