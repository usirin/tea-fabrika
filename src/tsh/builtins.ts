import {Effect} from "effect";
import {listing} from "../program/program.ts";
import type {Part} from "./check.ts";
import {copyRows} from "./copies.ts";
import {readValue, shapeLines, typeOf} from "./decode.ts";
import {didYouMean} from "./did-you-mean.ts";
import {reattach, type Shell, waitForJob} from "./execute.ts";
import type {Named, Statement} from "./grammar.ts";
import {type Job, jobNamed} from "./jobs.ts";
import type {Entry} from "./programs.ts";

// tsh's built-ins: the words that work on tsh itself, not on a program. They
// read the job table (the `jobs` machine's state) and act through the
// starter's handles this tsh holds for the runs it started.
//
//   jobs                    each job: its number, running or detached, its line,
//                           and under it each copy's status line (./copies.ts)
//   ps                      each program run: its run id, program, job and state
//   tell %1 pr <value>...   tell a job's first program (or the run named by id) an input
//   close %1 pr             close that input, like stdin's end
//   stop %1                 stop the job with the starter's stop; a detached one is dropped
//   attach %1 [&]           a job from an earlier tsh: start it again under its run ids;
//                           one from this tsh: wait for it here
//   programs                what can be started, by name
//   <program> --describe    (not a built-in: a part of a command) the program's declaration
//   help, exit [status]

type BuiltinStatement = Extract<Statement, {readonly kind: "builtin"}>;
export interface Said {
	readonly status: number;
	/** `exit` was said: tsh reads no more lines. */
	readonly exit: boolean;
}

const ok: Said = {status: 0, exit: false};
const failed = (status = 1): Said => ({status, exit: false});

export const HELP = [
	"tsh runs tea programs. A line is statements parted by ; or &.",
	"  <program> --flag value input=value       run it here: wait, print what it sends",
	"  a ... | b ...                            a's output into b's input, by their shapes",
	"  ... &                                    a job: the prompt comes back",
	"  --flag $(a ...)  input=$(a ...)          a's values, typed, into the line",
	"  >output <input                           name the output or input a pipe or $( ) takes",
	"  <program> --describe [name]              its flags, inputs, outputs and machines; or one whole",
	"  jobs | ps | programs | help | exit [status]",
	"  tell %n <input> <value>... | close %n <input> | stop %n | attach %n [&]",
	"Values are read as text first, then as JSON. Ctrl-C stops what runs here; Ctrl-D leaves.",
].join("\n");

/** How each kind of part is written on a line. */
const written: Readonly<Record<Part["kind"], (name: string) => string>> = {
	flag: (n) => `--${n}`,
	input: (n) => `${n}=`,
	output: (n) => `>${n}`,
};

/**
 * The lines `--describe` prints: a program's man page, from its declaration,
 * each shape in a few words. `parts`: the ones named after `--describe`, each
 * shown whole, one field a line.
 */
export function describe(entry: Entry, parts: readonly Part[] | null = null): readonly string[] {
	const page = listing(entry.program);
	const declared = {flag: page.flags, input: page.inputs, output: page.outputs};
	if (parts !== null)
		return parts.flatMap((part) => {
			const one = declared[part.kind].find((d) => d.name === part.name);
			return one === undefined
				? []
				: [
						`${written[part.kind](part.name)}  (${part.kind} of ${page.name})  ${one.description}`,
						...shapeLines(one.schema, "  "),
					];
		});
	const rows = (title: string, kind: Part["kind"]) =>
		declared[kind].length === 0
			? [`${title}: none`]
			: [
					`${title}:`,
					...declared[kind].map(
						(d) => `  ${written[kind](d.name)}  ${typeOf(d.schema)}  ${d.description}`,
					),
				];
	return [
		`${page.name}: ${page.description}`,
		...rows("flags", "flag"),
		...rows("inputs", "input"),
		...rows("outputs", "output"),
		`machines: ${page.machines.length === 0 ? "none" : page.machines.join(", ")}`,
		...(page.status.length === 0
			? []
			: [`status lines: ${page.status.join(", ")} (one per copy, under the job in jobs)`]),
		`${page.name} --describe <name> shows one flag, input or output whole.`,
	];
}

/** The job a built-in's first word names, or why none. */
function named(shell: Shell, word: Named | undefined, verb: string): Job | string {
	if (word === undefined) return `${verb} needs a job: %n, or a run id`;
	const job = jobNamed(shell.table.getState(), word.name);
	if (job === undefined) {
		const known = shell.table
			.getState()
			.jobs.flatMap((j) => [`%${j.n}`, ...j.stages.map((s) => s.run)]);
		const guess = didYouMean(word.name, known);
		return `no job ${word.name}${guess === undefined ? "" : `. Did you mean ${guess}?`}`;
	}
	return job;
}

/** The run of a job a built-in acts on: the one named by its run id, or the job's first. */
const runIn = (job: Job, word: string) => job.stages.find((st) => st.run === word) ?? job.stages[0];

/** Run one built-in. `typed`: the whole line it is on, as typed. */
export const runBuiltin = (
	shell: Shell,
	st: BuiltinStatement,
	typed: string,
): Effect.Effect<Said> =>
	Effect.gen(function* () {
		const [first, second, ...rest] = st.args;
		const refuse = (why: string, status = 2): Said => {
			shell.print("err", `tsh: ${why}`);
			return failed(status);
		};
		switch (st.name) {
			case "help":
				for (const line of HELP.split("\n")) shell.print("out", line);
				return ok;
			case "programs":
				for (const [name, entry] of shell.list)
					shell.print("out", `${name}  ${entry.program.description}`);
				return ok;
			case "jobs":
				for (const job of shell.table.getState().jobs) {
					shell.print("out", `[${job.n}] ${job.state.padEnd(8)}  ${job.text}`);
					for (const row of copyRows(job, shell.live)) shell.print("out", row);
				}
				return ok;
			case "ps":
				shell.print("out", "RUN                       PROGRAM    JOB  STATE");
				for (const job of shell.table.getState().jobs)
					for (const stage of job.stages)
						shell.print(
							"out",
							`${stage.run.padEnd(25)} ${stage.program.padEnd(10)} %${String(job.n).padEnd(3)} ${job.state === "detached" ? "detached" : stage.ended ? "ended" : "running"}`,
						);
				return ok;
			case "exit": {
				const status = first === undefined ? 0 : Number(first.name);
				if (!Number.isInteger(status) || status < 0 || status > 255)
					return refuse(`exit takes a status from 0 to 255, not ${first?.name}`);
				return {status, exit: true};
			}
			case "tell":
			case "close": {
				const job = named(shell, first, st.name);
				if (typeof job === "string") return refuse(job);
				const stage = runIn(job, first?.name ?? "");
				const running = shell.live.get(stage.run);
				if (job.state === "detached" || running === undefined)
					return refuse(
						`%${job.n} is detached: it ran in an earlier tsh. Start it again with attach %${job.n} &`,
						1,
					);
				const inputs = Object.keys(running.run.program.inputs);
				if (second === undefined) return refuse(`${st.name} needs an input: ${inputs.join(", ")}`);
				if (!inputs.includes(second.name)) {
					const guess = didYouMean(second.name, inputs);
					return refuse(
						`${stage.program} has no input named ${second.name}${guess === undefined ? "" : `. Did you mean ${guess}?`}`,
					);
				}
				if (st.name === "close") {
					if (rest.length > 0) return refuse("close takes a job and an input, nothing more");
					running.close(second.name);
					return ok;
				}
				if (rest.length === 0) return refuse(`tell needs a value for ${second.name}`);
				const shape = running.run.program.inputs[second.name].shape;
				const values: unknown[] = [];
				for (const word of rest) {
					const read = readValue(shape, word.name);
					if (read.kind === "refused")
						return refuse(
							`${second.name} does not take ${JSON.stringify(word.name)}: ${read.why}${read.didYouMean === undefined ? "" : `. Did you mean ${read.didYouMean}?`}`,
						);
					values.push(read.value);
				}
				for (const value of values) {
					const word = running.run.tell(second.name, value);
					if (word !== "queued") return refuse(`${stage.program} said ${word}`, 1);
				}
				return ok;
			}
			case "stop": {
				const job = named(shell, first, "stop");
				if (typeof job === "string") return refuse(job);
				if (job.state === "detached") {
					yield* shell.table.dispatch({type: "dropped", n: job.n}).pipe(Effect.ignore);
					shell.print("err", `[${job.n}] dropped  ${job.text}`);
					return ok;
				}
				yield* Effect.forEach(
					job.stages.flatMap((s) => {
						const r = shell.live.get(s.run);
						return r === undefined ? [] : [r.stop];
					}),
					(stop) => stop,
					{concurrency: "unbounded"},
				);
				return ok;
			}
			case "attach": {
				const job = named(shell, first, "attach");
				if (typeof job === "string") return refuse(job);
				if (job.state === "detached")
					return {status: yield* reattach(shell, job, st.background, typed), exit: false};
				if (st.background) {
					shell.print("err", `[${job.n}] is already running here`);
					return ok;
				}
				return {status: yield* waitForJob(shell, job), exit: false};
			}
		}
	});
