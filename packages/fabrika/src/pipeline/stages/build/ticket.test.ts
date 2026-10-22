import {Effect} from "effect";
import {describe, expect, it} from "vitest";
import type {Gh} from "../../code-host-github.ts";
import {criterionId} from "../../ids.ts";
import {buildGate, openOf, readTicket, type Ticket, ticketOf} from "./ticket.ts";

describe("reading a ticket", () => {
	const rule = "A change that touches a package's published surface also needs a changeset.";
	const answer = (claudeMd: unknown, agentsMd: unknown) =>
		JSON.stringify({
			data: {
				repository: {
					claudeMd,
					agentsMd,
					issue: {state: "OPEN", title: "t", body: "b"},
					pullRequests: {nodes: []},
				},
			},
		});
	const read = (text: string) => {
		const calls: (readonly string[])[] = [];
		const gh: Gh = (args) => {
			calls.push(args);
			return Effect.succeed(text);
		};
		return {
			ticket: Effect.runPromise(readTicket(gh)("https://github.com/acme/widgets/issues/7", 7)),
			calls,
		};
	};

	it("reads the repository's own rules, CLAUDE.md and AGENTS.md, from the branch its pull requests go into", async () => {
		const {ticket, calls} = read(answer({text: rule}, {text: "Run the checks."}));
		expect((await ticket).rules).toEqual([
			{file: "CLAUDE.md", text: rule},
			{file: "AGENTS.md", text: "Run the checks."},
		]);
		expect(calls[0]).toContain("claudeMd=main:CLAUDE.md");
		expect(calls[0]).toContain("agentsMd=main:AGENTS.md");
	});

	it("a repository with neither file has no rules, and the read does not fail", async () => {
		expect((await read(answer(null, null)).ticket).rules).toEqual([]);
	});
});

describe("a ticket's url", () => {
	it("names its repository and number, for any repository", () => {
		expect(ticketOf("https://github.com/acme/widgets.js/issues/670")).toEqual({
			owner: "acme",
			name: "widgets.js",
			number: 670,
		});
		expect(ticketOf("https://github.com/acme/widgets/pull/670")).toBeNull();
	});
});

// The build gate: pure, so each case is one ticket.

const ticket: Ticket = {
	url: "https://github.com/kamp-us/tea-fabrika-sandbox/issues/1",
	number: 1,
	state: "open",
	title: "t",
	body: "b",
	plan: "approved",
	criteria: [{id: criterionId("c1"), version: 1, text: "it works", checked: false, evidence: null}],
	prs: [],
	rules: [],
};

describe("the build gate", () => {
	it("an open ticket whose plan is approved, with criteria, goes, and hands them on", () => {
		expect(buildGate(ticket)).toEqual({answer: "go", criteria: ticket.criteria});
	});

	it.each([
		["closed", {state: "closed" as const}, {kind: "skip", why: "closed"}],
		[
			"merged already",
			{prs: [{url: "u", state: "merged" as const, head: "h"}]},
			{kind: "skip", why: "merged"},
		],
		["with no criteria", {criteria: []}, {kind: "stuck", why: "no_criteria"}],
		// Some boxes carry an id and some do not, or one id is there twice: no id is sure.
		[
			"whose criteria cannot be told apart",
			{criteria: null},
			{kind: "stuck", why: "criteria_unknown"},
		],
	])("a ticket %s stops", (_, change, outcome) => {
		expect(buildGate({...ticket, ...change})).toEqual({answer: "stop", outcome});
	});

	describe("by its plan on the ledger, the one thing that lets it be built", () => {
		it.each([
			["a plan not approved", "not_approved", {kind: "skip", why: "not_ready"}],
			["no plan", "none", {kind: "skip", why: "not_ready"}],
			// The ledger could not be read: never taken for approved.
			["a ledger that could not be read", "unknown", {kind: "stuck", why: "read_failed"}],
		] as const)("%s stops it", (_, plan, outcome) => {
			expect(buildGate({...ticket, plan})).toEqual({answer: "stop", outcome});
		});

		it("a ticket read with no plan state is stuck, never built", () => {
			const {plan: _, ...unread} = ticket;
			expect(buildGate(unread)).toEqual({
				answer: "stop",
				outcome: {kind: "stuck", why: "read_failed"},
			});
		});
	});

	it("the open pull request from the branch is found; a closed one is not", () => {
		const open = {url: "u2", state: "open" as const, head: "h2"};
		expect(openOf({...ticket, prs: [{url: "u1", state: "closed", head: "h1"}, open]})).toEqual(
			open,
		);
		expect(openOf({...ticket, prs: [{url: "u1", state: "closed", head: "h1"}]})).toBeNull();
	});
});
