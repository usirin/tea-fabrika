import {Schema} from "effect";
import {describe, expect, it} from "vitest";
import {shapeOf} from "../program/shape.ts";
import {describe as describeEntry} from "./builtins.ts";
import {type Checked, check} from "./check.ts";
import {readValue, shapeLines, typeOf} from "./decode.ts";
import {programsOf} from "./fabrika-list.ts";
import {parse} from "./grammar.ts";

// A parsed line checked against the program list, before anything runs:
// every name, every value and every pipe. The list is the one the launcher
// makes, ship and review included; checking never calls GitHub.

const list = programsOf({});

const checked = (line: string): Checked => {
	const parsed = parse(line);
	if (parsed.kind !== "parsed") throw new Error(`parse refused: ${parsed.why}`);
	const [first] = parsed.statements;
	if (first?.kind !== "run") throw new Error("not a run");
	return check(first.pipeline, list, line);
};
const refusal = (line: string) => {
	const c = checked(line);
	if (c.kind !== "refused") throw new Error(`not refused: ${line}`);
	return c;
};
const PR = "https://github.com/example/repo/pull/7";
const REVIEW = "review-scripted --rubrics r --model opus --effort medium --budget 1";

describe("check: the user's job", () => {
	it("passes review | ship and wires review's passed into ship's pr, every value read in its own shape", () => {
		const c = checked(`${REVIEW} pr=${PR} | ship --mode read`);
		if (c.kind !== "line") throw new Error(c.kind);
		const [review, ship] = c.line.stages;
		expect(review.wire).toEqual({output: "passed", input: "pr"});
		expect(ship?.fed).toBe("pr");
		expect(review.flags.find((f) => f.name === "budget")?.source).toEqual({
			kind: "value",
			value: 1,
		});
		expect(review.told).toEqual([{name: "pr", source: {kind: "value", value: PR}}]);
	});

	it("refuses a pipe that does not fit before anything runs, at the |, with both sides' shapes", () => {
		const r = refusal("seq --to 3 | upper");
		expect(r.at).toBe(11);
		expect(r.why).toBe(
			"does not fit: seq's outputs (n: integer) fit no input of upper (text: string). Nothing was started",
		);
		expect(refusal("seq --to 2 | ship --mode read").why).toContain("fit no input of ship");
	});

	it("refuses ship's write mode as a value that does not fit: tsh has no write side to give it", () => {
		const r = refusal(`ship --mode write pr=${PR}`);
		expect(r.why).toContain('--mode does not take "write"');
		expect(r.at).toBe(12);
	});
});

describe("check: names and values", () => {
	it.each([
		["shp --mode read", 0, "no program named shp", "ship", 127],
		["sqe --to 3", 0, "no program named sqe", "seq", 127],
		["ship --mdoe read", 5, "ship has no flag --mdoe", "--mode", 2],
		["ship --mode red", 12, '--mode does not take "red"', "read", 2],
		[`ship --mode read pt=${PR}`, 17, "ship has no input named pt", "pr", 2],
		["ship pr=x --mode read", 8, 'pr does not take "x": not a pull request url', undefined, 2],
		["seq", 3, "seq needs --to: The last number it sends.", undefined, 2],
		["seq --to 1 --to 2", 11, "--to is given twice", undefined, 2],
		["seq --to -1", 9, '--to does not take "-1"', undefined, 2],
		["double n=$(seq --to 2) | double n=1", 32, "n is fed by the pipe", undefined, 2],
		["seq --to 2 >m | double", 11, "seq has no output named m", "n", 2],
		["seq --to 2 >n", 11, ">n names the output a pipe or a $( ) takes", undefined, 2],
		["double <n", 7, "<n names the input a pipe feeds", undefined, 2],
		["ship --mode read --describe", 17, "--describe stands alone", undefined, 2],
		["ship --describe >fond", 16, "ship has no flag, input or output named >fond", ">found", 2],
	])("refuses %j at %i: %s", (line, at, why, guess, status) => {
		const r = refusal(line);
		expect(r.at).toBe(at);
		expect(r.why).toContain(why);
		expect(r.didYouMean).toBe(guess);
		expect(r.status).toBe(status);
	});

	it("checks a $( ) like a pipe: its last output must fit the flag or input it gives", () => {
		const c = checked("double n=$(seq --to 2 | double)");
		expect(c.kind === "line" && c.line.stages[0].told[0]?.source.kind).toBe("sub");
		expect(refusal("seq --to $(say --text 3)").why).toContain(
			"no output of say (said: string) fits --to (integer >= 0)",
		);
	});

	it("names the part a --describe asks for", () => {
		const c = checked("double --describe n");
		expect(c.kind === "describe" && c.parts).toEqual([
			{kind: "input", name: "n"},
			{kind: "output", name: "n"},
		]);
	});
});

describe("values", () => {
	const of = shapeOf;

	it("are read as text first, then as JSON, and the shape decides", () => {
		expect(readValue(of(Schema.String), "2")).toEqual({kind: "value", value: "2"});
		expect(readValue(of(Schema.Int), "2")).toEqual({kind: "value", value: 2});
		expect(readValue(of(Schema.Struct({id: Schema.String})), '{"id":"a"}')).toEqual({
			kind: "value",
			value: {id: "a"},
		});
		expect(readValue(of(Schema.Boolean), "true")).toEqual({kind: "value", value: true});
	});

	it("that fit neither way are refused in the schema's words, with a guess among its choices", () => {
		const r = readValue(of(Schema.Literals(["low", "medium", "high"])), "meduim");
		expect(r).toMatchObject({kind: "refused", didYouMean: "medium"});
		expect(readValue(of(Schema.Int), "x").kind).toBe("refused");
	});
});

describe("--describe", () => {
	const lines = (name: string) => {
		const entry = list.get(name);
		if (entry === undefined) throw new Error(name);
		return describeEntry(entry);
	};

	it("prints every shape in a few words: no line of ship's or review's page is a wall", () => {
		for (const name of ["ship", "review-scripted"]) {
			const page = lines(name);
			for (const line of page) expect(line.length, line).toBeLessThan(260);
			expect(page.join("\n")).toContain("machines:");
		}
		expect(lines("ship").find((l) => l.includes(">outcome"))).toContain("{pr, outcome, name}");
	});

	it("prints one part whole, one field a line", () => {
		const entry = list.get("ship");
		if (entry === undefined) throw new Error("ship");
		const whole = describeEntry(entry, [{kind: "output", name: "outcome"}]);
		expect(whole[0]).toContain(">outcome  (output of ship)");
		expect(whole).toContain('        cleanup: "done" | "failed" | "not_run"');
		expect(whole.length).toBeGreaterThan(20);
	});

	it("short forms cut long lists and name a union by its tag", () => {
		const json = list.get("ship")?.program.outputs.outcome.shape.json ?? {};
		expect(typeOf(json)).toBe("{pr, outcome, name}");
		const outcome = (json.properties as Record<string, Record<string, unknown>>).outcome;
		expect(typeOf(outcome)).toBe("one of 7 by kind: done, send, ask, … (5 kinds)");
		expect(typeOf({type: "integer", minimum: 0})).toBe("integer >= 0");
		expect(shapeLines({type: "object", properties: {}})).toEqual(["{}"]);
	});
});

describe("check: build and operate write to the sandbox alone", () => {
	// Listed only when the launcher is given a folder to work in. Checking a line still calls nothing.
	const writing = programsOf({TSH_WORK: "work"});
	const refusedIn = (line: string) => {
		const parsed = parse(line);
		if (parsed.kind !== "parsed") throw new Error(`parse refused: ${parsed.why}`);
		const [first] = parsed.statements;
		if (first?.kind !== "run") throw new Error("not a run");
		const c = check(first.pipeline, writing, line);
		if (c.kind !== "refused") throw new Error(`not refused: ${line}`);
		return c;
	};
	const OPERATE =
		"operate --rubrics r --model opus --effort medium --budget 1 --rounds 2 --ship write";

	it.each([
		[`${OPERATE} ticket=https://github.com/kamp-us/demlik/issues/670`],
		[
			"build --model opus --effort medium --budget 1 ticket=https://github.com/kamp-us/demlik/issues/670",
		],
		[`${OPERATE} ticket=https://github.com/kamp-us/tea-fabrika-sandbox-x/issues/1`],
	])("a ticket outside the sandbox is refused before anything starts: %s", (line) => {
		const r = refusedIn(line);
		expect(r.why).toContain("not a ticket in the sandbox");
		expect(r.status).toBe(2);
	});

	it("a sandbox ticket passes", () => {
		const parsed = parse(
			`${OPERATE} ticket=https://github.com/kamp-us/tea-fabrika-sandbox/issues/1`,
		);
		if (parsed.kind !== "parsed" || parsed.statements[0]?.kind !== "run") throw new Error("parse");
		expect(check(parsed.statements[0].pipeline, writing, "x").kind).toBe("line");
	});

	const SHIP_SANDBOX = "ship-sandbox --mode write";
	it.each([
		[`${SHIP_SANDBOX} pr=https://github.com/kamp-us/demlik/pull/691`],
		["ship-sandbox --mode read pr=https://github.com/kamp-us/demlik/pull/691"],
		[`${SHIP_SANDBOX} pr=https://github.com/kamp-us/tea-fabrika-sandbox-x/pull/4`],
		[
			`${SHIP_SANDBOX} pr=https://github.com/kamp-us/tea-fabrika-sandbox/pull/4?https://github.com/kamp-us/demlik/pull/1`,
		],
		[`${SHIP_SANDBOX} ask='{"id":"a","pr":"https://github.com/kamp-us/demlik/pull/691"}'`],
	])(
		"ship-sandbox refuses a pull request outside the sandbox before anything starts: %s",
		(line) => {
			const r = refusedIn(line);
			expect(r.why).toContain("not a pull request in the sandbox");
			expect(r.status).toBe(2);
		},
	);

	it("ship-sandbox takes a sandbox pull request in write mode", () => {
		const parsed = parse(
			`${SHIP_SANDBOX} pr=https://github.com/kamp-us/tea-fabrika-sandbox/pull/4`,
		);
		if (parsed.kind !== "parsed" || parsed.statements[0]?.kind !== "run") throw new Error("parse");
		expect(check(parsed.statements[0].pipeline, writing, "x").kind).toBe("line");
	});

	it("plain ship stays read only with a folder to work in", () => {
		const r = refusedIn(
			"ship --mode write pr=https://github.com/kamp-us/tea-fabrika-sandbox/pull/4",
		);
		expect(r.status).toBe(2);
	});

	it("without a folder to work in, none is listed", () => {
		expect(refusal("operate --describe").why).toContain("no program named operate");
		expect(refusal("build --describe").why).toContain("no program named build");
		expect(refusal("ship-sandbox --describe").why).toContain("no program named ship-sandbox");
	});
});
