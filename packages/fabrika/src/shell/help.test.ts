import {Effect, Layer, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {HostJobs, openJobs} from "../host/host-jobs.ts";
import {ear} from "../program/ear.ts";
import {listed} from "../program/listed.ts";
import {defineProgram, start, tell} from "../program/program.ts";
import {flag, input} from "../program/shape.ts";
import {memoryStorage} from "../program/storage.ts";
import {columns, helpOf} from "./help.ts";
import {Programs, programList} from "./programs.ts";
import {type Printed, type Ready, tsh} from "./shell.ts";
import {SMALL} from "./small.ts";

// `<program> --help`: a usage line first, then what the program does, then a
// headed section each for flags, inputs and outputs in aligned columns, pipes
// that fit, and machines last. The whole page of two small programs, as a
// person reads it.

const list = programList(SMALL);
const page = (name: string) => {
	const entry = list.get(name);
	if (entry === undefined) throw new Error(name);
	return helpOf(entry, list);
};

/** Each line typed into one tsh, and everything it printed. */
const typed = (...lines: readonly string[]) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const storage = memoryStorage();
			const printed = ear<Printed>();
			const ready = ear<Ready>();
			const jobs = yield* openJobs(storage);
			const started = yield* start(
				tsh,
				{show: "short"},
				{printed: printed.hear, ready: ready.hear},
				{id: "tsh:help", storage},
			).pipe(Effect.provideService(Programs, list), Effect.provideService(HostJobs, jobs));
			if (started.kind !== "running") return yield* Effect.die("tsh did not start");
			const statuses: (number | undefined)[] = [];
			for (const [i, line] of lines.entries()) {
				expect(yield* tell(started.run, "line", line)).toBe("queued");
				statuses.push((yield* ready.upTo(i + 1))[i]?.status);
			}
			return {statuses, said: printed.values.map((p) => p.text)};
		}).pipe(Effect.scoped),
	);

describe("--help: the page", () => {
	it("double: usage, what it does, its parts, the pipes that fit", () => {
		expect(page("double")).toEqual([
			"Usage: double [n=N]",
			"       ... | double",
			"       double | ...",
			"",
			"Doubles each number it is told, and ends when its input closes.",
			"",
			"Flags:",
			"  --help  This help (or -h). One part whole: --help n",
			"",
			"Inputs: told on the line as name=value, or fed by a pipe",
			"  n=  integer  A number to double.",
			"",
			"Outputs: printed, or sent into a pipe (>name picks one)",
			"  >n  integer  The number, doubled.",
			"",
			"Example pipes:",
			"  seq --to TO | double",
			"  tally | double",
			"  double | tally",
		]);
	});

	it("seq: a flag it must be given is in the usage, unbracketed, with its value's word", () => {
		expect(page("seq").slice(0, 2)).toEqual(["Usage: seq --to TO", "       seq --to TO | ..."]);
		expect(page("seq")).toContain("  --to    integer >= 0  The last number it sends.");
	});

	it("a shape too wide for the column puts its text under it, and the other rows keep theirs", () => {
		expect(
			columns([
				{name: "a=", shape: "string", text: "Short."},
				{name: "b=", shape: "{one: string, two: string, three: string}", text: "Long."},
			]),
		).toEqual([
			"  a=  string  Short.",
			"  b=  {one: string, two: string, three: string}",
			"              Long.",
		]);
	});
});

describe("--help: in tsh", () => {
	it("help <program> prints what <program> --help does, and programs points at it", async () => {
		const seen = await typed("help seq", "seq --help", "programs");
		const [, , programs] = seen.statuses;
		expect(seen.statuses).toEqual([0, 0, programs]);
		const seq = page("seq");
		expect(seen.said.slice(0, seq.length)).toEqual(seq);
		expect(seen.said.slice(seq.length, 2 * seq.length)).toEqual(seq);
		expect(seen.said.at(-1)).toBe("<program> --help shows how to run one.");
	});

	it("a program with a flag named help is refused when the list is made", () => {
		const helped = defineProgram({
			name: "helped",
			description: "Has its own --help.",
			flags: {help: flag(Schema.String, "Its own help.")},
			inputs: {n: input(Schema.Number, "A number.")},
			outputs: {},
			main: () => Effect.void,
		});
		expect(() => programList([listed(helped, Layer.empty)])).toThrow(
			"helped cannot have a flag named help",
		);
	});
});
