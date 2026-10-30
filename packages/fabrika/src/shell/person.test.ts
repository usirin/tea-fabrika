import {Effect, Layer, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {HostJobs, openJobs} from "../host/host-jobs.ts";
import {EMPTY} from "../host/jobs.ts";
import {ear} from "../program/ear.ts";
import {listed} from "../program/listed.ts";
import {defineProgram, start, tell} from "../program/program.ts";
import {flag, output} from "../program/shape.ts";
import {memoryStorage} from "../program/storage.ts";
import {complete} from "./complete.ts";
import {helpOf} from "./help.ts";
import {Programs, programList} from "./programs.ts";
import {type Printed, type Ready, tsh} from "./shell.ts";
import {SMALL} from "./small.ts";
import type {Table} from "./table.ts";

// What tsh prints for a person, by an output's `person` form: a table, a line, or nothing; and
// what a pipe and `--json` get all the same, the values whole.

const Row = Schema.Struct({n: Schema.Int, title: Schema.String});

/** `--to` rows, newest first, shown as a table; then the list as one text, for a pipe only. */
const list = defineProgram({
	name: "list",
	description: "Rows, then the list as text.",
	flags: {to: flag(Schema.Int, "How many rows.")},
	inputs: {},
	outputs: {
		row: output(Row, "One row.", {
			person: {
				table: {
					title: "Rows",
					columns: [
						{header: "#", cell: (r) => String(r.n), align: "right", muted: true},
						{header: "Title", cell: (r) => r.title},
					],
					cut: "Title",
				},
			},
		}),
		text: output(Schema.String, "The list as text.", {person: "none"}),
	},
	main: ({flags, send}) =>
		Effect.gen(function* () {
			const rows = Array.from({length: flags.to}, (_, i) => ({n: flags.to - i, title: `row ${i}`}));
			for (const row of rows) yield* send("row", row);
			yield* send("text", rows.map((r) => r.title).join(", "));
		}),
});

/** One value, as one line a person reads; and a second output with no person form. */
const one = defineProgram({
	name: "one",
	description: "A pair, as a line.",
	inputs: {},
	outputs: {
		pair: output(Row, "The pair.", {person: {line: (r) => `${r.n} is ${r.title}`}}),
		count: output(Schema.Int, "A count."),
	},
	main: ({send}) => Effect.andThen(send("pair", {n: 7, title: "seven"}), send("count", 1)),
});

const PROGRAMS = programList([...SMALL, listed(list, Layer.empty), listed(one, Layer.empty)]);

const session = (show: "short" | "json") =>
	Effect.gen(function* () {
		const printed = ear<Printed>();
		const tables = ear<Table>();
		const ready = ear<Ready>();
		const storage = memoryStorage();
		const started = yield* start(
			tsh,
			{show},
			{printed: printed.hear, table: tables.hear, ready: ready.hear},
			{id: `tsh:person-${show}`, storage},
		).pipe(
			Effect.provideService(Programs, PROGRAMS),
			Effect.provideService(HostJobs, yield* openJobs(storage)),
		);
		if (started.kind !== "running") return yield* Effect.die("tsh did not start");
		let told = 0;
		return (text: string) =>
			Effect.gen(function* () {
				const [p, t] = [printed.values.length, tables.values.length];
				expect(yield* tell(started.run, "line", text)).toBe("queued");
				told += 1;
				yield* ready.upTo(told);
				const said = printed.values.slice(p);
				return {
					out: said.filter((s) => s.to === "out").map((s) => s.text),
					err: said.filter((s) => s.to === "err").map((s) => s.text),
					tables: tables.values.slice(t),
				};
			});
	});

/** A tsh that shows values `show`, and what `use` does with its lines. */
const run = <A, E>(
	show: "short" | "json",
	use: (line: Effect.Success<ReturnType<typeof session>>) => Effect.Effect<A, E>,
) =>
	Effect.runPromise(
		Effect.gen(function* () {
			return yield* use(yield* session(show));
		}).pipe(Effect.scoped),
	);

describe("tsh prints for a person", () => {
	it("a table once the run has ended, with no output's name, and not the text meant for a pipe", async () => {
		const seen = await run("short", (line) => line("list --to 3"));
		expect(seen.out).toEqual([]);
		expect(seen.tables).toEqual([
			{
				title: "Rows",
				note: null,
				total: 3,
				columns: [
					{header: "#", align: "right"},
					{header: "TITLE", align: "left"},
				],
				cut: 1,
				rows: [3, 2, 1].map((n, i) => [
					{text: String(n), tone: "muted"},
					{text: `row ${i}`, tone: "plain"},
				]),
				hints: [],
			},
		]);
	});

	it("one screen of rows, then `--all` for every row", async () => {
		const seen = await run("short", (line) =>
			Effect.all([line("list --to 25"), line("list --to 25 --all")], {concurrency: 1}),
		);
		expect(seen.map((s) => s.tables[0]?.rows.length)).toEqual([20, 25]);
		expect(seen[0]?.tables[0]?.hints).toEqual([{line: "list --to 25 --all", for: "for every row"}]);
	});

	it("refuses `--all` on a program with no table", async () => {
		const seen = await run("short", (line) => line("one --all"));
		expect(seen.err.join("\n")).toContain(
			"--all shows every row of a table, and one prints no table",
		);
	});

	it("a line with no output's name, and an output with no person form as before", async () => {
		const seen = await run("short", (line) => line("one"));
		expect(seen.out).toEqual(["7 is seven", "count 1"]);
	});

	it("nothing of its own when a pipe takes another output: the person asked for that one", async () => {
		const seen = await run("short", (line) => line("list --to 2 | upper"));
		expect(seen.tables).toEqual([]);
		// upper has no person form: its value, short, by its program's name, as on any pipe line.
		expect(seen.out).toEqual(["upper ROW 0, ROW 1"]);
	});

	it("the values whole into a `$( )`", async () => {
		const seen = await run("short", (line) => line("say --text $(list --to 2 >text)"));
		expect(seen.out).toEqual(["row 0, row 1"]);
	});
});

describe("tsh --json", () => {
	it("prints every value whole, by its output's name, as it did before any person form", async () => {
		const seen = await run("json", (line) =>
			Effect.all([line("list --to 2"), line("one")], {concurrency: 1}),
		);
		expect(seen[0]?.tables).toEqual([]);
		expect(seen[0]?.out).toEqual([
			'row {"n":2,"title":"row 0"}',
			'row {"n":1,"title":"row 1"}',
			"text row 0, row 1",
		]);
		expect(seen[1]?.out).toEqual(['pair {"n":7,"title":"seven"}', "count 1"]);
	});
});

describe("--all, as a person finds it", () => {
	it("is offered by Tab on a program with a table, once, and on no other", () => {
		const offered = (line: string) => complete(line, PROGRAMS, EMPTY).candidates;
		expect(offered("list --")).toContain("--all");
		expect(offered("list --all --")).not.toContain("--all");
		expect(offered("one --")).not.toContain("--all");
		// It takes no value: after it come the other flags.
		expect(offered("list --all ")).toContain("--to");
	});

	it("is in the help of a program with a table, beside --help", () => {
		const help = (name: string) => {
			const entry = PROGRAMS.get(name);
			if (entry === undefined) throw new Error(`no ${name} in the list`);
			return helpOf(entry);
		};
		expect(help("list")).toContainEqual(
			expect.stringMatching(/^ {2}--all +Every row of its table, not one screen of them\.$/),
		);
		expect(help("one").join("\n")).not.toContain("--all");
	});
});
