import {describe, expect, it} from "vitest";
import {SHIP_NAMES} from "../ship/outcome.ts";
import {back, EXAM_MERGE_SENDS, fresh, type Move, once, run} from "./routes.ts";

// Today's version. A ship refusal at `exam_merge` goes to the step that can fix it, never to
// `stuck:sent_back` (self-fix PR 10, Part 3). The rows are typed over ship's own names, so a send with
// no route does not compile; this law reads them at run time, so a row deleted behind a cast is
// caught too. These are the first rows of PR 11's `ROUTES`, in its `Move` shape.

/** Every `send` ship can end with, read off ship's own union: a new one joins by being there. */
const SHIP_SENDS = SHIP_NAMES.filter((name) => name.startsWith("send:"));

/** What breaks the law in a table of rows: a ship send with no row. */
const unrouted = (table: Readonly<Record<string, Move | undefined>>): readonly string[] =>
	SHIP_SENDS.filter((name) => table[name] === undefined);

describe("the exam_merge rows", () => {
	it("are the plan's: code first for what code can fix, the exam writer for what it must rewrite", () => {
		expect(EXAM_MERGE_SENDS).toEqual({
			"send:reviewer:no_review": run("exam_review"),
			"send:builder:checks_red": run("exam_review"),
			"send:builder:behind": fresh("exam_review"),
			"send:builder:review_failed": back("exam", "findings"),
			"send:builder:conflicts": back("exam", "files"),
			"send:builder:bot_comment": back("exam", "comment"),
			"send:builder:ejected": once,
		});
	});

	it("route every send ship can end with", () => {
		expect(SHIP_SENDS.length).toBeGreaterThan(0);
		expect(unrouted(EXAM_MERGE_SENDS)).toEqual([]);
	});

	it("that law catches its plant: the bot_comment row deleted behind a cast", () => {
		const planted: Record<string, Move | undefined> = {...EXAM_MERGE_SENDS};
		delete planted["send:builder:bot_comment"];
		expect(unrouted(planted)).toEqual(["send:builder:bot_comment"]);
	});

	it("never ask a person: each send at exam_merge is fixable (193's classes)", () => {
		for (const move of Object.values(EXAM_MERGE_SENDS))
			expect(JSON.stringify(move)).not.toMatch(/ask|stuck/);
	});
});
