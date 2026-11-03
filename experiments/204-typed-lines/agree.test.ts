import {describe, expect, expectTypeOf, it} from "vitest";
import {cases} from "./cases.ts";
import type {Answer} from "./line.ts";
import {read} from "./parse.ts";
import {asks} from "./programs/asks.ts";
import {probe} from "./programs/probe.ts";
import {ticket} from "./programs/ticket.ts";
import {tracker} from "./programs/tracker.ts";

// Two checkers, one grammar. The desk's list of programs is the only place all of them meet.
const programs = {asks, ticket, tracker, probe};

type Case = {readonly line: string; readonly why: string; readonly gap?: string};
/** What the compiler says of each line. */
type Typed<T extends readonly Case[]> = {[K in keyof T]: Answer<T[K]["line"]>};
/** What it should say: the run-time answer, or "ok" where the check is out of the type's sight. */
type Expected<T extends readonly Case[]> = {
	[K in keyof T]: T[K] extends {readonly gap: string} ? "ok" : T[K]["why"];
};

describe("a line, read twice", () => {
	it("the compiler gives the run-time answer on every line but the gaps", () => {
		expectTypeOf<Typed<typeof cases>>().toEqualTypeOf<Expected<typeof cases>>();
	});

	it.each(cases)("$line", (c) => {
		const got = read(c.line, programs);
		expect(got._tag === "line" ? "ok" : got.why).toBe(c.why);
	});

	it("never refuses what the run-time check takes: every gap is a run-time refusal", () => {
		const gaps = cases.filter((c) => "gap" in c);
		expect(gaps.length).toBe(3);
		for (const c of gaps) expect(read(c.line, programs)._tag).toBe("refused");
	});

	it("wires a line it takes", () => {
		expect(read("asks --ask a-approve-8 | ticket &", programs)).toEqual({
			_tag: "line",
			job: true,
			stages: [
				{program: "asks", flags: {ask: "a-approve-8"}, wire: {output: "ticket", input: "ticket"}},
				{program: "ticket", flags: {}, wire: null},
			],
		});
	});
});
