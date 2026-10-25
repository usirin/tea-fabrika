import {describe, expect, it} from "vitest";
import {cannotOf, firstOf, readRun, shows, testsOf} from "./checked.ts";
import {isTestWriterName, TEST_WRITER_NAMES} from "./outcome.ts";
import {GOOD, P1, P2, pid} from "./scripted.ts";

const at = {version: 1, head: "c1"};
const tests = testsOf(GOOD.answers);
const run = (p1: "red" | "green", p2: "red" | "green") =>
	readRun(
		[P1, P2],
		tests,
		[
			{property: pid("p1"), result: p1},
			{property: pid("p2"), result: p2},
		],
		at,
	);

describe("the run on the base, read with Controls", () => {
	it("writes one `checked` fact per test, and no surprise when each is as the plan says", () => {
		expect(run("red", "green")).toEqual({
			read: true,
			checked: [
				{fact: "checked", property: "p1", version: 1, head: "c1", tool: "test", result: "red"},
				{fact: "checked", property: "p2", version: 1, head: "c1", tool: "test", result: "green"},
			],
			found: [],
		});
	});

	it("a new Property green on the base is `already_passes`; an existing one red is `fails_on_base`", () => {
		expect(run("green", "green")).toMatchObject({found: [{property: "p1", for: "already_passes"}]});
		expect(run("red", "red")).toMatchObject({found: [{property: "p2", for: "fails_on_base"}]});
		expect(run("green", "red")).toMatchObject({
			found: [
				{property: "p1", for: "already_passes"},
				{property: "p2", for: "fails_on_base"},
			],
		});
	});

	it("names every test the run said nothing for, and never guesses its result", () => {
		expect(readRun([P1, P2], tests, [{property: pid("p2"), result: "green"}], at)).toEqual({
			read: false,
			missing: ["p1"],
		});
	});

	it("names the first surprise in a fixed order: a bug today, a weak test, then no test", () => {
		expect(firstOf([])).toBeNull();
		expect(
			firstOf([
				{property: pid("p3"), for: "cannot_test"},
				{property: pid("p1"), for: "already_passes"},
				{property: pid("p2"), for: "fails_on_base"},
			]),
		).toBe("fails_on_base");
		expect(cannotOf([{property: pid("p3"), kind: "cannot", why: "no hook"}])).toEqual([
			{property: "p3", for: "cannot_test"},
		]);
	});

	it("counts a write as done only when the read shows every fact, at the same version and commit", () => {
		const done = run("red", "green");
		if (!done.read) throw new Error("read");
		expect(shows(done.checked, done.checked)).toBe(true);
		expect(shows(done.checked.slice(1), done.checked)).toBe(false);
		expect(
			shows(
				done.checked.map((c) => ({...c, version: 2})),
				done.checked,
			),
		).toBe(false);
	});

	it("spells its outcomes by the one grammar", () => {
		expect(TEST_WRITER_NAMES).toContain("ask:owner:already_passes");
		expect(TEST_WRITER_NAMES).toContain("ask:owner:fails_on_base");
		expect(TEST_WRITER_NAMES).toContain("ask:owner:cannot_test");
		expect(isTestWriterName("stuck:unchecked")).toBe(true);
		expect(isTestWriterName("send:builder:checks_red")).toBe(false);
	});
});
