import {Effect} from "effect";
import {type Job, jobNamed} from "../host/jobs.ts";
import {writerOf} from "../host/writer.ts";
import type {TableView} from "../program/person.ts";
import {copyRows, fullRows} from "./copies.ts";
import {readValue} from "./decode.ts";
import {didYouMean} from "./did-you-mean.ts";
import {reattach, type Shell, stopJob, waitForJob} from "./execute.ts";
import type {Named, Statement} from "./grammar.ts";
import {columns, helpOf} from "./help.ts";
import type {Summoned} from "./summon.ts";
import {tableOf} from "./table.ts";

// tsh's built-ins: the words that work on tsh itself, not on a program. They
// read the host's job table (the `jobs` machine's state, ../host/jobs.ts),
// send it Msgs, and act through the starter's handles this tsh holds for the
// runs it started.
//
//   jobs                    each job: its number, running or detached, its line,
//                           and under it a full line with its waiting writer, and
//                           each copy's status line (./copies.ts)
//   ps                      each program run: its run id, program, job and state
//   tell %1 pr <value>...   tell a job's first program (or the run named by id) an input
//   close %1 pr             close that input, like stdin's end
//   stop %1                 stop the job with the starter's stop; a detached one is dropped
//   attach %1 [&]           a job from an earlier tsh: start it again under its run ids;
//                           one from this tsh: wait for it here
//   programs                what can be started, by name
//   help [program]          tsh's own help; or a program's, as `<program> --help` prints it (./help.ts)
//   exit [status]
//   summon <agent> [model] [effort] as <name>    start an agent under a name, in this repo, on this Mac
//   dismiss <name>          stop it, cancelling its turn first, and free the name
//   agents                  each summoned agent: its name, harness, model, effort and what it does now

type BuiltinStatement = Extract<Statement, {readonly kind: "builtin"}>;

export interface Said {
	readonly status: number;
	/** `exit` was said: tsh reads no more lines. */
	readonly exit: boolean;
}

const ok: Said = {status: 0, exit: false};
const failed = (status = 1): Said => ({status, exit: false});

const HELP = [
	"tsh runs tea programs. A line is statements parted by ; or &.",
	"  <program> --flag value input=value       run it here: wait, print what it sends",
	"  a ... | b ...                            a's output into b's input, by their shapes",
	"  ... &                                    a job: the prompt comes back",
	"  --flag $(a ...)  input=$(a ...)          a's values, typed, into the line",
	"  >output <input                           name the output or input a pipe or $( ) takes",
	"  <program> --help [name]  (or -h)         how to run it: flags, inputs, outputs; or one whole",
	"  jobs | ps | programs | help [program] | exit [status]",
	"  tell %n <input> <value>... | close %n <input> | stop %n | attach %n [&]",
	"  summon <agent> [model] [effort] as <name> | dismiss <name> | agents",
	"  @name <anything>                         tell a summoned agent, as typed: one turn, a job",
	"Values are read as text first, then as JSON. Ctrl-C stops what runs here; Ctrl-D leaves.",
].join("\n");

/** What a summoned agent runs on, in words: its harness, model and effort. */
const settingsOf = (s: Summoned): string => {
	const {typed, resolved} = s.model;
	const model =
		typed !== null && resolved !== null && typed !== resolved
			? `${typed} (${resolved})`
			: (resolved ?? typed ?? "its default model");
	return [`${s.agent} ${model}`, ...(s.effort.set === null ? [] : [s.effort.set])].join(" · ");
};

/** The summoned agents as a person reads them, as `gh pr list` lays one out. */
const AGENTS: TableView<Summoned> = {
	title: "Agents",
	note: "summoned here, in this repo, on this Mac",
	columns: [
		{header: "Name", cell: (s) => s.name},
		{header: "Runs on", cell: settingsOf, muted: true},
		{
			header: "State",
			cell: (s) =>
				s.state === "down"
					? {text: "down", tone: "warning"}
					: s.state === "asking"
						? {text: "asking you", tone: "warning"}
						: s.state,
		},
		{
			header: "Cost",
			cell: (s) => (s.cost === null ? "" : `$${s.cost.toFixed(2)}`),
			align: "right",
			muted: true,
		},
	],
	cut: "Runs on",
};

/** The job a built-in's first word names, or why none. */
function named(shell: Shell, word: Named | undefined, verb: string): Job | string {
	if (word === undefined) {
		return `${verb} needs a job: %n, or a run id`;
	}

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
		/** Only a person summons, dismisses or talks: an agent's tsh never starts a paid run. */
		const person = writerOf(shell.by ?? "")?.kind === "user";

		switch (st.name) {
			case "summon": {
				if (!person) {
					return refuse("only a person summons an agent");
				}

				const as = st.args.findIndex((a) => a.name === "as");
				const agent = first?.name;
				const name = st.args[as + 1]?.name;

				if (agent === undefined || as < 1 || name === undefined) {
					return refuse(
						"summon takes an agent and a name: summon <agent> [model] [effort] as <name>",
					);
				}

				const settings = st.args.slice(1, as).map((a) => a.name);
				const [on, place, ...more] = st.args.slice(as + 2);

				if (on?.name === "on") {
					return refuse(
						`${name} would run on this Mac: summon starts agents here only, so leave out on ${place?.name ?? "<place>"}`,
					);
				}

				if (on !== undefined || more.length > 0) {
					return refuse(`summon ends with its name: nothing after as ${name}`);
				}

				if (settings.length > 2) {
					return refuse(
						`summon takes at most two settings, a model then an effort, not ${settings.join(" ")}`,
					);
				}

				const made = yield* shell.summons
					.summon({agent, settings, name, by: shell.by ?? ""})
					.pipe(Effect.result);

				if (made._tag === "Failure") {
					return refuse(made.failure.why, 1);
				}

				shell.print(
					"out",
					`  ${made.success.name} · ${settingsOf(made.success)} · in this repo, on this Mac · ready`,
				);
				return ok;
			}
			case "dismiss": {
				if (!person) {
					return refuse("only a person dismisses an agent");
				}

				if (first === undefined || second !== undefined) {
					return refuse("dismiss takes one name: dismiss <name>");
				}

				const gone = yield* shell.summons.dismiss(first.name, shell.by ?? "").pipe(Effect.result);

				if (gone._tag === "Failure") {
					return refuse(gone.failure.why, 1);
				}

				const {cut} = gone.success;
				shell.print(
					"out",
					`  ${first.name} dismissed${cut === null ? "" : `: its turn ${cut} was cancelled first`}`,
				);
				return ok;
			}
			case "agents": {
				if (first !== undefined) {
					return refuse("agents takes no words");
				}

				const all = yield* shell.summons.list;

				if (all.length === 0) {
					shell.print("out", "No agent is summoned. summon <agent> as <name> starts one.");
					return ok;
				}

				shell.printTable(tableOf(AGENTS, all, {all: true, typed: "agents"}));
				return ok;
			}
			case "help": {
				if (first === undefined) {
					for (const line of HELP.split("\n")) {
						shell.print("out", line);
					}

					return ok;
				}

				if (second !== undefined) {
					return refuse(
						`help takes one program. For one of its parts: ${first.name} --help ${second.name}`,
					);
				}

				const entry = shell.list.get(first.name);

				if (entry === undefined) {
					const guess = didYouMean(first.name, [...shell.list.keys()]);
					return refuse(
						`no program named ${first.name}${guess === undefined ? "" : `. Did you mean ${guess}?`}`,
						127,
					);
				}

				for (const line of helpOf(entry, shell.list)) {
					shell.print("out", line);
				}

				return ok;
			}
			case "programs": {
				const rows = [...shell.list].map(([name, entry]) => ({
					name,
					shape: "",
					text: entry.program.description,
				}));

				for (const row of columns(rows)) {
					shell.print("out", row.slice(2));
				}

				shell.print("out", "");
				shell.print("out", "<program> --help shows how to run one.");
				return ok;
			}
			case "jobs":
				for (const job of shell.table.getState().jobs) {
					shell.print("out", `[${job.n}] ${job.state.padEnd(8)}  ${job.text}`);

					for (const row of fullRows(job, shell.live)) {
						shell.print("out", row);
					}

					for (const row of copyRows(job, shell.live)) {
						shell.print("out", row);
					}
				}

				return ok;
			case "ps":
				shell.print("out", "RUN                       PROGRAM    JOB  STATE");

				for (const job of shell.table.getState().jobs) {
					for (const stage of job.stages) {
						shell.print(
							"out",
							`${stage.run.padEnd(25)} ${stage.program.padEnd(10)} %${String(job.n).padEnd(3)} ${job.state === "detached" ? "detached" : stage.ended ? "ended" : "running"}`,
						);
					}
				}

				return ok;
			case "exit": {
				const status = first === undefined ? 0 : Number(first.name);

				if (!Number.isInteger(status) || status < 0 || status > 255) {
					return refuse(`exit takes a status from 0 to 255, not ${first?.name}`);
				}

				return {status, exit: true};
			}
			case "tell":
			case "close": {
				const job = named(shell, first, st.name);

				if (typeof job === "string") {
					return refuse(job);
				}

				const stage = runIn(job, first?.name ?? "");
				const running = shell.live.get(stage.run);

				if (job.state === "detached" || running === undefined) {
					return refuse(
						`%${job.n} is detached: it ran in an earlier tsh. Start it again with attach %${job.n} &`,
						1,
					);
				}

				const inputs = Object.keys(running.run.program.inputs);

				if (second === undefined) {
					return refuse(`${st.name} needs an input: ${inputs.join(", ")}`);
				}

				if (!inputs.includes(second.name)) {
					const guess = didYouMean(second.name, inputs);
					return refuse(
						`${stage.program} has no input named ${second.name}${guess === undefined ? "" : `. Did you mean ${guess}?`}`,
					);
				}

				if (st.name === "close") {
					if (rest.length > 0) {
						return refuse("close takes a job and an input, nothing more");
					}

					running.close(second.name);
					return ok;
				}

				if (rest.length === 0) {
					return refuse(`tell needs a value for ${second.name}`);
				}

				const shape = running.run.program.inputs[second.name].shape;
				const values: unknown[] = [];

				for (const word of rest) {
					const read = readValue(shape, word.name);

					if (read.kind === "refused") {
						return refuse(
							`${second.name} does not take ${JSON.stringify(word.name)}: ${read.why}${read.didYouMean === undefined ? "" : `. Did you mean ${read.didYouMean}?`}`,
						);
					}

					values.push(read.value);
				}

				for (const value of values) {
					const word = yield* running.run
						.tell(second.name, value)
						.pipe(
							Effect.catchTag("MailboxFull", (full) =>
								Effect.succeed(`full: ${full.capacity} values it has not read`),
							),
						);

					if (word !== "queued") {
						return refuse(`${stage.program} said ${word}`, 1);
					}
				}

				return ok;
			}
			case "stop": {
				const job = named(shell, first, "stop");

				if (typeof job === "string") {
					return refuse(job);
				}

				// Only a person's tsh may stop any job (tracker 185b). Any other tsh, an agent's or one
				// whose writer does not read as a person, stops only its own writer's: the `stop` tool,
				// with its why, is how an agent stops anyone else's. It fails closed (tracker 219): a job
				// with no writer kept is a person's from before jobs kept one. Refused before any stop is
				// asked, so the record keeps no stopper.
				const mine = shell.by ?? null;

				if (writerOf(mine ?? "")?.kind !== "user" && job.by !== mine) {
					return refuse(
						job.by === null
							? `%${job.n} has no writer kept: the stop tool asks why`
							: `%${job.n} is ${job.by}'s: the stop tool asks why`,
					);
				}

				yield* stopJob(shell, job);
				return ok;
			}
			case "attach": {
				const job = named(shell, first, "attach");

				if (typeof job === "string") {
					return refuse(job);
				}

				if (job.state === "detached") {
					return {status: yield* reattach(shell, job, st.background, typed), exit: false};
				}

				if (st.background) {
					shell.print("err", `[${job.n}] is already running here`);
					return ok;
				}

				return {status: yield* waitForJob(shell, job), exit: false};
			}
		}
	});
