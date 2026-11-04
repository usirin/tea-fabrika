import {read} from "./parse.ts";
import type {Declared} from "./register.ts";
import {type Run, type Spelling, spellingOf} from "./spelling.ts";

// The long list for the law: lines built from the programs' own parts, not written by hand.
// Every program alone and with each part named; every flag of every program, with values near
// the edge of its spelling; every pair of programs, with each output and input named; every
// three in a row; and the grammar's own edges. `why` is what the run-time reader answers.
//
//   generate(programs)
//   // [{line: "asks", why: "ok"}, {line: "asks >ticket", why: "ok"}, ...]
//
// ./write-generated.ts writes it to ./generated.ts, where the compiler reads every line as a
// literal; ./agree.test.ts fails when that file is stale.

/** The values a number flag most often gets wrong, tried on every spelled flag, whole and inside each run. */
export const EDGES = ["0", "1", "1.5", "-1", "1e3", "0x10", "01", "99999999999999999999", ""];

/** Characters to try where a run expects others: a digit, letters, signs, and two outside ASCII. */
const STRANGERS = ["0", "a", "Z", "_", "-", ".", "+", "é", "😀"];

const at0 = (s: string): string => s.slice(0, 1);
const last = (s: string): string => s.slice(-1);

/** One value per piece, each run as short as it can be. */
const shortest = (spelling: Spelling): string[] =>
	spelling.map((p) => (typeof p === "string" ? p : at0(p.first)));

/** The same, with run `i` spelled `text` instead. */
const swap = (spelling: Spelling, i: number, text: string): string =>
	shortest(spelling)
		.map((s, j) => (j === i ? text : s))
		.join("");

/** Values at and just past the edge of each piece, plus the edge list whole and inside each run. */
export const nearby = (spelling: Spelling): string[] => {
	const out: string[] = [shortest(spelling).join(""), ...EDGES];
	const longest = spelling.map((p) =>
		typeof p === "string" ? p : at0(p.first) + last(p.of).repeat(p.most - 1),
	);
	out.push(longest.join(""));
	spelling.forEach((piece, i) => {
		if (typeof piece === "string") {
			out.push(swap(spelling, i, ""), swap(spelling, i, piece.toUpperCase()));
			return;
		}
		const run: Run = piece;
		const full = at0(run.first) + last(run.of).repeat(run.most - 1);
		out.push(
			swap(spelling, i, `${full}${last(run.of)}`),
			swap(spelling, i, full),
			swap(spelling, i, ""),
			...STRANGERS.filter((c) => !run.first.includes(c)).map((c) => swap(spelling, i, c)),
			...STRANGERS.filter((c) => !run.of.includes(c)).map((c) =>
				swap(spelling, i, at0(run.first) + c),
			),
			...EDGES.map((e) => swap(spelling, i, e)),
		);
	});
	return out;
};

const keys = (table: Readonly<Record<string, unknown>>): string[] => Object.keys(table).sort();

/** Every line, once, in a fixed order. */
export const generate = (
	programs: Readonly<Record<string, Declared>>,
): readonly {readonly line: string; readonly why: string}[] => {
	const names = keys(programs);
	const lines: string[] = [];
	const add = (...more: string[]) => lines.push(...more);
	const all = names.flatMap((n) => {
		const p = programs[n];
		return p === undefined ? [] : [p];
	});
	const takes = (line: string) => read(line, programs)._tag === "line";

	// The grammar's own edges.
	add("", "nope", "&", "|", ">ticket", "--ticket 1");
	for (const p of all) {
		add(`${p.name} |`, `| ${p.name}`, `${p.name} | | ${p.name}`, `${p.name} &`, `& ${p.name}`);
		add(`${p.name} & ${p.name}`, `${p.name} & &`, `nope | ${p.name}`, `${p.name} | nope`);
		add(`${p.name} 117`, `${p.name} --nope 1`, `${p.name} >nope`, `${p.name} <nope`);
	}

	// Each program alone, with each part named, and named twice.
	for (const p of all) {
		add(p.name);
		for (const o of keys(p.outputs)) add(`${p.name} >${o}`, `${p.name} >${o} >${o}`);
		for (const i of keys(p.inputs)) {
			add(`${p.name} <${i}`, `${p.name} <${i} <${i}`);
			for (const o of keys(p.outputs)) add(`${p.name} >${o} <${i}`, `${p.name} <${i} >${o}`);
		}
	}

	// Every flag of every program: each value two ways, alone and in a pipe; given twice; with no
	// value; and on each program that does not have it.
	for (const p of all) {
		const into = all.find((q) => takes(`${p.name} | ${q.name}`));
		const from = all.find((q) => takes(`${q.name} | ${p.name}`));
		for (const f of keys(p.flags)) {
			const part = p.flags[f];
			const spelling = part === undefined ? undefined : spellingOf(part.schema.ast);
			const values = spelling === undefined ? ["x"] : nearby(spelling);
			const good = values.find((v) => takes(`${p.name} --${f} ${v}`)) ?? "x";
			add(`${p.name} --${f}`, `${p.name} --${f} ${good} --${f} ${good}`);
			for (const v of values) {
				add(`${p.name} --${f} ${v}`, `${p.name} --${f}=${v}`);
				if (into !== undefined) add(`${p.name} --${f} ${v} | ${into.name}`);
				if (from !== undefined) add(`${from.name} | ${p.name} --${f}=${v}`);
			}
			for (const q of all) if (!Object.hasOwn(q.flags, f)) add(`${q.name} --${f} ${good}`);
		}
	}

	// Every pair, with each output on the left and each input on the right named or not; bare
	// pairs also with no spaces and as a job.
	for (const l of all)
		for (const r of all) {
			add(`${l.name}|${r.name}`, `${l.name} | ${r.name} &`);
			for (const left of [l.name, ...keys(l.outputs).map((o) => `${l.name} >${o}`)])
				for (const right of [r.name, ...keys(r.inputs).map((i) => `${r.name} <${i}`)])
					add(`${left} | ${right}`);
		}

	// Every three in a row.
	for (const a of names) for (const b of names) for (const c of names) add(`${a} | ${b} | ${c}`);

	return [...new Set(lines)].map((line) => {
		const got = read(line, programs);
		return {line, why: got._tag === "line" ? "ok" : got.why};
	});
};
