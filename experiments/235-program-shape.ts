// Experiment 235: do the three program shapes step the same? next/ only.
// Each shape's ticket program is loaded by the merged `stepper`, the same inputs go in, and every
// step's answer is compared as JSON. No model, no network, no key, $0. About 1 s.
//
//   See experiments/README.md for the command: it is bundled first, since plain node cannot strip
//   the parameter properties in next/'s code.
import {Result} from "effect";
import {stepper} from "../next/packages/libfabrika/src/index.ts";
import {ticket as one} from "./235-program-shape/shape-1-today.ts";
import {ticket as two} from "./235-program-shape/shape-2-values.ts";
import {ticket as three} from "./235-program-shape/shape-3-records.ts";

const page = {number: 7, title: "Fix the pipe", body: "Every line ...", state: "open", asks: []};
const read = {type: "ticket_read", ticket: 7};

/** A door envelope's id has this shape; the number after it counts the process's inputs. */
const PROCESS = "in-process_0123456789abcdefghjkmnpqrs";

// Fresh inputs as the door hands them on: each with its envelope id as `parent`.
const fresh = [
	{type: "show", ticket: 7, parent: `${PROCESS}-1`},
	{type: "comment", ticket: 7, body: "Skip part 2.", asks: "changes", parent: `${PROCESS}-2`},
	{type: "close", ticket: 3, parent: `${PROCESS}-3`},
	{
		type: "answer",
		ticket: 7,
		ask: "a-1",
		pick: "approve",
		note: "",
		saw: {title: "t", body: "b"},
		parent: `${PROCESS}-4`,
	},
	{type: "nope", parent: `${PROCESS}-5`},
];
// Saved letters: a Cmd's answers, folded as they were accepted.
const saved = [
	{type: "ticket_read_ok", cmd: read, value: page, at: 1},
	{type: "write_err", cmd: {type: "write"}, error: {_tag: "spent"}, at: 2},
];

const run = (declared: unknown) => {
	const loaded = stepper(declared);
	if (Result.isFailure(loaded)) throw loaded.failure;
	const s = loaded.success;
	const steps: unknown[] = [];
	const boot = s.init(null);
	if (boot._tag !== "stepped") throw new Error("boot refused");
	steps.push(boot);
	let model = boot.model;
	for (const msg of fresh) {
		const step = s.step(model, msg);
		steps.push(step);
		if (step._tag === "stepped") model = step.model;
	}
	for (const msg of saved) {
		const step = s.fold(model, msg);
		steps.push(step);
		if (step._tag === "stepped") model = step.model;
	}
	const p = s.program;
	const doors = Object.fromEntries(
		Object.entries(p.inputs).map(([k, v]) => [k, v._tag === "write" ? v.personOnly : "read"]),
	);
	const writes = Object.fromEntries(Object.entries(p.writes).map(([k, v]) => [k, v.personOnly]));
	return {steps, doors, writes, outputs: Object.keys(p.outputs), v: p.state.v};
};

const shapes = {one: run(one), two: run(two.declared), three: run(three.declared)};
/** JSON with its keys sorted, so two shapes that build one object in another order still match. */
const canon = (u: unknown): string =>
	JSON.stringify(u, (_key, value: unknown) =>
		typeof value === "object" && value !== null && !Array.isArray(value)
			? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
			: value,
	);
const same = (a: unknown, b: unknown) => canon(a) === canon(b);
const report = {
	steps: shapes.one.steps.map((step, i) => ({
		step,
		two: same(step, shapes.two.steps[i]),
		three: same(step, shapes.three.steps[i]),
	})),
	doors: {
		one: shapes.one.doors,
		two: same(shapes.one.doors, shapes.two.doors),
		three: same(shapes.one.doors, shapes.three.doors),
	},
	writes: {
		one: shapes.one.writes,
		two: same(shapes.one.writes, shapes.two.writes),
		three: same(shapes.one.writes, shapes.three.writes),
	},
	outputs: {one: shapes.one.outputs, two: shapes.two.outputs, three: shapes.three.outputs},
	v: [shapes.one.v, shapes.two.v, shapes.three.v],
};
console.log(JSON.stringify(report, null, 1));
const all =
	report.steps.every((s) => s.two && s.three) &&
	report.doors.two &&
	report.doors.three &&
	report.writes.two &&
	report.writes.three;
console.log(all ? "all three step the same" : "THEY DIFFER");
if (!all) process.exitCode = 1;
