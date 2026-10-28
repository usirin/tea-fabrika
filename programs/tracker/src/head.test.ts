import {type Entry, type Fact, fold} from "@kampus/pipeline/tickets/ticket";
import {describe, expect, it} from "vitest";
import {HOUR, headOf, lineOf} from "./head.ts";
import {rowsOf} from "./rows.ts";

// One lane on one ticket, fact by fact, as the note's sketch draws it: the top line after each
// step, and the rows it shows. Nothing runs lanes yet, so the facts are written here.

const owner = {kind: "user", id: "owner"} as const;
const agent = (id: string) => ({kind: "agent", id, for: "owner"}) as const;
const MINUTE = 60_000;

/** A ticket from its facts, one minute apart, through the real fold. */
const ticketOf = (...facts: readonly (readonly [Entry["by"], Fact])[]) => {
	const entries = facts.map(
		([by, fact], i): Entry => ({pos: i + 1, ticket: 3, by, at: i * MINUTE, fact}),
	);
	const {tickets, problems} = fold([], entries);
	expect(problems).toEqual([]);
	return tickets[0]?.timeline ?? [];
};
const lineAt = (timeline: readonly Entry[], now: number) =>
	lineOf(headOf(timeline, now), (at) => `${at / MINUTE}m`);

const filed: readonly [Entry["by"], Fact] = [
	owner,
	{type: "filed", title: "Login fails", body: "On main."},
];
const started: readonly [Entry["by"], Fact] = [
	agent("build"),
	{type: "started", run: "r-1", stage: "build", task: "t-1", log: null},
];
const ended = (
	outcome: Extract<Fact, {type: "ended"}>["outcome"],
): readonly [Entry["by"], Fact] => [
	agent("build"),
	{
		type: "ended",
		run: "r-1",
		stage: "build",
		outcome,
		usd: 0.41,
		input: 12_000,
		output: 3_000,
		turns: 14,
	},
];
const asked: readonly [Entry["by"], Fact] = [
	agent("plan"),
	{type: "asked", ask: "a-1", what: "approve plan v2", picks: ["approve", "change one line", "no"]},
];
const answered: readonly [Entry["by"], Fact] = [
	owner,
	{type: "answered", ask: "a-1", pick: "approve", note: ""},
];
const merged: readonly [Entry["by"], Fact] = [
	agent("watcher"),
	{
		type: "pr",
		url: "https://github.com/o/r/pull/12",
		state: "merged",
		head: "a1b2c3d",
		checks: [{name: "lint", status: "completed", conclusion: "success"}],
	},
];

describe("the top line", () => {
	it("says next: triage on a ticket just filed, and idle once an hour goes by with no fact", () => {
		const t = ticketOf(filed);
		expect(lineAt(t, 5 * MINUTE)).toBe("next: triage");
		expect(lineAt(t, HOUR + 1)).toBe("idle since 0m");
	});

	it("says what runs, and a run wins over idle however long it goes", () => {
		const t = ticketOf(filed, started);
		expect(lineAt(t, 2 * MINUTE)).toBe("build running, task t-1");
		expect(lineAt(t, 5 * HOUR)).toBe("build running, task t-1");
	});

	it("says next from the last run's send, and stuck when the run answered stuck", () => {
		expect(
			lineAt(ticketOf(filed, started, ended({kind: "send", to: "review", why: "built"})), 0),
		).toBe("next: review");
		expect(lineAt(ticketOf(filed, started, ended({kind: "stuck", why: "read_failed"})), 0)).toBe(
			"stuck: read failed",
		);
	});

	it("says the open ask over everything still going, and two asks by their count", () => {
		const t = ticketOf(filed, asked, started);
		expect(lineAt(t, 5 * HOUR)).toBe("waits on you: approve plan v2");
		const two = ticketOf(filed, asked, [
			agent("triage"),
			{type: "asked", ask: "a-2", what: "is it a duplicate of #2?", picks: ["yes", "no"]},
		]);
		expect(lineAt(two, 0)).toBe("waits on you: 2 asks");
	});

	it("keeps an ask open through a comment that says yes: only an answer closes it", () => {
		const t = ticketOf(filed, asked, [owner, {type: "commented", body: "approve"}]);
		expect(lineAt(t, 0)).toBe("waits on you: approve plan v2");
		expect(lineAt(ticketOf(filed, asked, answered), 0)).toBe("next: triage");
	});

	it("never says done for an agent's done: only a merge, or a person's close once answered", () => {
		const said = ticketOf(filed, started, ended({kind: "done", part: false}));
		expect(lineAt(said, 0)).toBe("next: not named");
		expect(lineAt(ticketOf(filed, started, merged), 0)).toBe("done: PR #12 merged");
		expect(lineAt(ticketOf(filed, asked, answered, [owner, {type: "closed"}]), 0)).toBe(
			"done: closed after your answer",
		);
	});

	it("says closed, not done, for a close with nothing merged and nothing answered, and names who", () => {
		expect(lineAt(ticketOf(filed, [owner, {type: "closed"}]), 0)).toBe("closed by owner");
		expect(lineAt(ticketOf(filed, [agent("triage"), {type: "closed"}]), 0)).toBe(
			"closed by agent triage",
		);
		// An open ask on a closed ticket waits on nobody.
		expect(lineAt(ticketOf(filed, asked, [owner, {type: "closed"}]), 0)).toBe("closed by owner");
	});

	it("is open again after a reopen, with the old pull request still on the timeline", () => {
		const t = ticketOf(filed, merged, [owner, {type: "reopened"}]);
		expect(lineAt(t, 0)).toBe("next: triage");
		expect(t.some((e) => e.fact.type === "pr")).toBe(true);
	});
});

describe("the rows", () => {
	it("say each fact in a few words, the outcome in the pipeline's words", () => {
		const t = ticketOf(
			filed,
			asked,
			answered,
			started,
			ended({kind: "send", to: "review", why: "built"}),
			[agent("plan"), {type: "planned", version: 2, tasks: ["t-1", "t-2", "t-3"]}],
			[
				agent("build"),
				{
					type: "pushed",
					head: "a1b2c3d4",
					commits: [
						{sha: "f00ba12", title: "Add a test"},
						{sha: "a1b2c3d4", title: "Fix login redirect"},
					],
				},
			],
			[agent("review"), {type: "reviewed", head: "a1b2c3d4", met: 2, of: 3, findings: ["f-12"]}],
			[
				agent("watcher"),
				{
					type: "pr",
					url: "https://github.com/o/r/pull/12",
					state: "open",
					head: "a1b2c3d4",
					checks: [
						{name: "lint", status: "completed", conclusion: "failure"},
						{name: "test", status: "in_progress", conclusion: null},
					],
				},
			],
			[owner, {type: "rated", finding: "f-12", says: "noise"}],
		);
		expect(rowsOf(t).map((r) => [r.text, r.more])).toEqual([
			["filed it", ""],
			["asks you: approve plan v2", "approve / change one line / no"],
			['answered "approve plan v2": approve', ""],
			["build started, task t-1", ""],
			["build: sent to review: built", "$0.41, 14 turns"],
			["plan v2", "3 tasks"],
			["2 commits", "a1b2c3d Fix login redirect"],
			["review at a1b2c3d: 2 of 3 met", "1 finding"],
			["PR #12 open", "checks failed (lint)"],
			["rated finding f-12: noise", ""],
		]);
		expect(rowsOf(t)[0]?.body).toBe("On main.");
	});
});
