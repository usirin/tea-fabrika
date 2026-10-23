import {splitPiece} from "./blocks.ts";
import type {Judged, Problem, Ran, Removed} from "./judge.ts";

// What a person reads: the list of promises, each one in full, and the gate's
// answer (experiment 117). Pure text from what `judge.ts` made.

/** A commit in 7 hex, and anything else (a ref name) as it is. */
const short = (commit: string) => (/^[0-9a-f]{40}$/.test(commit) ? commit.slice(0, 7) : commit);

/** One problem, in a few words, for the list. */
function brief(p: Problem): string {
	switch (p.why) {
		case "gone":
			return `points at code that is gone: ${p.pieces.join(", ")}`;
		case "stale":
			return `covered code changed since ${short(p.commit)}`;
		case "red":
			return "the check broke";
		case "not_caught":
			return "the planted break was not caught";
		case "no_verdict":
			return `the ${p.which} gave no verdict`;
	}
}

/** The list a person reads first: one line per promise. */
export function listText(all: readonly Judged[]): string {
	const width = Math.max(...all.map((j) => j.id.length), 2);
	const rows = all.map((j) => {
		const state = j.green ? "green" : "red  ";
		const why = j.green ? "" : `  (${j.problems.map(brief).join("; ")})`;
		return `  ${state}  ${j.id.padEnd(width)}  ${j.entry.tool.padEnd(8)}  confirmed at ${short(j.entry.confirmed.commit)}${why}`;
	});
	return [`Promises: ${all.length}, ${all.filter((j) => j.green).length} green`, "", ...rows].join(
		"\n",
	);
}

const indent = (lines: readonly string[], by: string) => lines.map((l) => `${by}${l}`);

function ranText(label: string, ran: Ran, caughtWord: string, heldWord: string): string[] {
	if (ran.kind === "none") return [`${label}gave no verdict: ${ran.why}`];
	const v = ran.verdict;
	const head = `${label}${v.held ? heldWord : caughtWord}: "${v.checked}", ${v.bound} (${ran.ms} ms)`;
	return v.path.length === 0 ? [head] : [head, ...indent(v.path, "           ")];
}

/** What to do about one problem: the next step, in words. */
function fix(id: string, p: Problem): readonly string[] {
	switch (p.why) {
		case "gone":
			return [
				`The record names ${p.pieces.join(", ")}, and the code has no such block.`,
				"Point the record at where the code went, then confirm it again. That is an exam change.",
			];
		case "stale": {
			const files = [...new Set(p.pieces.map((x) => splitPiece(x).file))];
			return [
				`Changed since it was confirmed at ${short(p.commit)}:`,
				...indent(p.pieces, "  "),
				`Look: git diff ${short(p.commit)} -- ${files.join(" ")}`,
				"Read the promise against the new code. If it still says what the code does,",
				`run: pnpm promises confirm ${id}`,
				"If it does not, change the check first: that is an exam change, for the owner.",
			];
		}
		case "red":
			return [
				`The promise broke at this head${p.verdict.why === null ? "" : `: ${p.verdict.why}`}.`,
				"This is a finding. Fix the code, or report it. Never loosen the check to pass.",
			];
		case "not_caught":
			return [
				"The planted break ran and the check still held: the check cannot fail.",
				"Make the check catch it again. Removing the plant is not a fix.",
			];
		case "no_verdict":
			return [`The ${p.which} command did not answer: ${p.detail}`];
	}
}

/** One promise in full. */
export function detailText(j: Judged): string {
	const e = j.entry;
	return [
		`${j.id}: ${j.green ? "green" : "red"}`,
		`  promise  ${e.promise}`,
		`  harm     ${e.harm}`,
		`  tool     ${e.tool}: ${e.check}`,
		...ranText("  check    ", j.check, "BROKE", "held"),
		`  plant    ${e.plant.name}: ${e.plant.what}`,
		...ranText("           ", j.plant, "caught", "NOT CAUGHT, still held"),
		`  covers   ${e.covers.join("\n           ")}`,
		`  exam     ${e.exam.join("\n           ")}`,
		`  confirmed at ${e.confirmed.commit}`,
		...j.problems.flatMap((p) => indent(fix(j.id, p), "  ! ")),
	].join("\n");
}

/** The gate's whole answer. */
export function gateText(
	all: readonly Judged[],
	removed: readonly Removed[],
	base: string | null,
): string {
	const failed = all.filter((j) => !j.green);
	const exam = [
		...all.flatMap((j) => j.exam.map((what) => `${j.id}: ${what}`)),
		...removed.map((r) => `${r.id}: removed ("${r.promise}")`),
	];
	const lines = [
		`Gate: ${all.length} promises${base === null ? ", no base given: exam changes not looked for" : `, against ${short(base)}`}`,
		...all.map((j) => {
			const tag = j.green ? "ok  " : "FAIL";
			const what = j.green
				? `in step, check held, plant caught${j.moved ? ", confirmed again in this change" : ""}`
				: j.problems.map(brief).join("; ");
			return `  ${tag} ${j.id}: ${what}`;
		}),
		"",
		...failed.flatMap((j) => [...j.problems.flatMap((p) => indent(fix(j.id, p), "  ")), ""]),
		exam.length === 0
			? "Exam changes for the owner: none"
			: ["Exam changes for the owner (the owner says yes to these, never the builder):"]
					.concat(indent(exam, "  - "))
					.join("\n"),
		failed.length === 0 ? "Gate: pass" : `Gate: FAIL, ${failed.length} of ${all.length} promises`,
	];
	return lines.join("\n");
}
