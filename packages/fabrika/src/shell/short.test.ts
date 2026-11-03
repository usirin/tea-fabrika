import {describe, expect, it} from "vitest";
import {showOf} from "./launch.ts";
import {shortOf, shown} from "./short.ts";

const pr = "https://github.com/example/repo/pull/597";
const head = "9eb6b52c75d64b555547780717bd43a2460bb658";

describe("a value as tsh prints it", () => {
	it("is short for a person, and the JSON whole for a script", () => {
		const row = {n: "170", at: 1793382842000};
		expect(shown(row, "short")).toBe("n 170  at 1793382842000");
		expect(shown(row, "json")).toBe(JSON.stringify(row));
		expect(shown("a\nb", "json")).toBe("a\nb");
	});
});

describe("a value as one short line", () => {
	it("prints a text, a number and a list as they are, in one line", () => {
		expect(shortOf("hello")).toBe("hello");
		expect(shortOf("two\nlines")).toBe("two");
		expect(shortOf(6)).toBe("6");
		expect(shortOf(null)).toBe("null");
		expect(shortOf([1, 2, 3])).toBe("a list of 3: 1, 2, 3");
	});

	it("puts what a value is about first: a pull request as #n, then its name", () => {
		expect(shortOf({pr, outcome: {kind: "skip", why: "draft"}, name: "skip:draft", head})).toBe(
			"#597  skip:draft  head 9eb6b52c75d6…",
		);
	});

	it("shows a review verdict short: counts for lists, nothing for null, false or an empty list", () => {
		const verdict = {
			pr,
			outcome: {kind: "done", part: false, head},
			name: "done",
			head,
			replay: false,
			criteria: [{n: 1}, {n: 2}, {n: 3}],
			verdicts: [{}, {}],
			left: [],
			ran: null,
			runs: 0,
		};
		expect(shortOf(verdict)).toBe("#597  done  head 9eb6b52c75d6…  criteria 3  verdicts 2  runs 0");
	});

	it("shows a record inside by its short words, and a tagged one by its tag", () => {
		const found = {
			pr,
			facts: {head, state: "open", ours: true, checks: "green", mergeable: "clean", comments: []},
			outcome: null,
			name: null,
			wouldSend: {type: "ship_enqueue", pr, head, intent: `ship/${pr}/enqueue/${head}`},
			wouldWaitFor: null,
		};
		expect(shortOf(found)).toBe("#597  facts (open, green, clean)  wouldSend ship_enqueue");
	});

	it("never runs past its width", () => {
		const long = {
			pr,
			body: "word ".repeat(100),
			title: "x".repeat(200),
			a: 1,
			b: 2,
			c: 3,
			d: 4,
			e: 5,
		};
		const line = shortOf(long, 40);
		expect(line.length).toBeLessThanOrEqual(40);
		expect(line.endsWith("…")).toBe(true);
	});

	it("--json prints the value whole, for a script; a text stays a text", () => {
		const value = {pr, name: "done"};
		expect(shown(value, "json")).toBe(JSON.stringify(value));
		expect(shown("hello", "json")).toBe("hello");
		expect(showOf(["--json", "-c", "seq --to 1"])).toEqual({
			show: "json",
			rest: ["-c", "seq --to 1"],
		});
		expect(showOf(["-c", "seq --to 1"])).toEqual({show: "short", rest: ["-c", "seq --to 1"]});
	});
});
