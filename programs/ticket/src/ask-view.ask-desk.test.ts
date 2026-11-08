import {type Asked, blindDraw, sealAsk} from "@kampus/pipeline/tickets/ask";
import {Entry, fold, type Ticket} from "@kampus/pipeline/tickets/ticket";
import {AskActions, AskView} from "@tea-fabrika/tracker/ask-window";
import {Effect, Schema} from "effect";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";
import {
	AGENT,
	DRAFT,
	FILED,
	HEAD,
	NOW,
	OWNER,
	policyFor,
} from "../../../fixtures/ask-desk/cases.ts";
import {pageOf, type Shown} from "./view.ts";
import {TicketWindow} from "./window.tsx";

// Today's version. Round 4 of the ask desk's tests, from the review's and the shots' fix lists
// (askdesk-review.md): what the markup of the shared ask view and the ticket's turn card must hold.
// Drawn on Node with no browser, as window.from.test.ts draws the window. How each thing looks
// is the shots' job; these read the markup only.

const sealed = (draft: unknown = DRAFT) =>
	Effect.runPromise(sealAsk(draft, policyFor(DRAFT.ask, false, blindDraw)));

/** The actions a window gives the ask view: keys as the default table has them, nothing sent. */
const ACTIONS: AskActions = {
	openLane: () => {},
	command: () => undefined,
	answer: () => Effect.succeed(null),
	later: () => {},
	keys: {rec: ["y"], not: ["n"], picks: ["o"], later: ["h"]},
	blocked: () => false,
};
const view = (ask: Asked) =>
	renderToStaticMarkup(
		createElement(
			AskActions.Provider,
			{value: ACTIONS},
			createElement(AskView, {ticket: 117, ask}),
		),
	);

/** Markup with its tags taken out and its spaces made one. */
const textOf = (markup: string): string =>
	markup
		.replaceAll("<!-- -->", "")
		.replaceAll(/<[^>]*>/g, " ")
		.replaceAll("&quot;", '"')
		.replaceAll("&#x27;", "'")
		.replaceAll(/\s+/g, " ")
		.trim();

/** The element that opens at `start` in `markup`, to its own closing tag. */
const elementAt = (markup: string, start: number): string => {
	const tag = /^<([a-z0-9]+)/.exec(markup.slice(start))?.[1];
	if (tag === undefined) throw new Error("no element there");
	let depth = 0;
	const re = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, "g");
	re.lastIndex = start;
	for (let m = re.exec(markup); m !== null; m = re.exec(markup)) {
		if (m[2] === "/") continue;
		depth += m[1] === "/" ? -1 : 1;
		if (depth === 0) return markup.slice(start, re.lastIndex);
	}
	throw new Error(`no end for <${tag}>`);
};
const firstOf = (markup: string, open: RegExp): string => {
	const at = markup.search(open);
	if (at < 0) throw new Error(`no ${open} in the markup`);
	return elementAt(markup, at);
};

describe("ask desk review 10: the toolbar is one tab stop", () => {
	it("one control in the toolbar takes Tab, the rest roam by arrow keys", async () => {
		const toolbar = firstOf(view(await sealed()), /<div[^>]*role="toolbar"/);
		const container = /^<div[^>]*>/.exec(toolbar)?.[0] ?? "";
		const inner = toolbar.slice(container.length);
		const tabbable = [...inner.matchAll(/<(button|a|input|textarea|select)\b[^>]*>/g)].filter(
			([tag]) => !/tabindex="-1"/.test(tag) && !/\bdisabled=""/.test(tag),
		);
		const stops = tabbable.length + (/tabindex="0"/.test(container) ? 1 : 0);
		expect(stops).toBe(1);
	});
});

describe("ask desk review 11: Later is a button in the ask view", () => {
	it("the shared ask view has a Later button, in the ticket and the tracker alike", async () => {
		const markup = view(await sealed());
		const buttons = [...markup.matchAll(/<button\b[\s\S]*?<\/button>/g)].map(([b]) => textOf(b));
		expect(buttons.some((b) => /^Later\b/.test(b))).toBe(true);
	});
});

const CHANGE = {
	_tag: "change",
	head: HEAD,
	diff: "--- a/src/slug.ts\n+++ b/src/slug.ts\n-export const slug = (t: string) => t\n+export const slug = (t: string) => t.trim().toLowerCase()",
	checks: [{name: "ci", state: "passed"}],
	review: {met: 4, of: 4, title: "Read names in one form"},
	rules: [{path: "rules/slug.md", text: "A slug is lower case."}],
	text: "One finding was let through.",
};

describe("ask desk review 9 and shot S5: evidence is drawn as text", () => {
	it.each([
		["plan", DRAFT.evidence],
		["change", CHANGE],
		["other", {_tag: "other", text: "The build stopped and needs your call."}],
	])("%s evidence reads as words, with no JSON and no tag", async (_, evidence) => {
		const markup = view(await sealed({...DRAFT, evidence}));
		const drawn = textOf(firstOf(markup, /<div class="ask-evidence"/));
		expect(drawn).not.toMatch(/_tag/);
		expect(drawn).not.toMatch(/[{}]|"\w+":/);
		expect(markup).not.toMatch(/<pre\b[^>]*>\s*\{/);
	});
	it("plan evidence names the summary, each question and its lean", async () => {
		const drawn = textOf(firstOf(view(await sealed()), /<div class="ask-evidence"/));
		const {plan} = DRAFT.evidence;
		expect(drawn).toContain(plan.summary);
		for (const q of plan.questions as readonly {ask: string; lean: string}[]) {
			expect(drawn).toContain(q.ask);
			expect(drawn).toContain(q.lean);
		}
	});
	it("change evidence names the checks, the rule files and the words beside the change", async () => {
		const drawn = textOf(
			firstOf(view(await sealed({...DRAFT, evidence: CHANGE})), /<div class="ask-evidence"/),
		);
		expect(drawn).toContain("ci");
		expect(drawn).toContain("rules/slug.md");
		expect(drawn).toContain("A slug is lower case.");
		expect(drawn).toContain(CHANGE.text);
		expect(drawn).toContain("t.trim().toLowerCase()");
	});
});

describe("shot S8: no machine ids in what the person reads", () => {
	it("the ask view never shows the ask's id", async () => {
		const ask = await sealed();
		expect(textOf(view(ask))).not.toContain(ask.ask);
	});
});

// ---- the ticket's own window

const ticketOf = (facts: readonly unknown[]): Ticket => {
	const entries = facts.map((fact, i) =>
		Schema.decodeUnknownSync(Entry)({
			pos: i + 1,
			ticket: 117,
			by: i === 0 ? OWNER : AGENT,
			at: NOW - 60_000 + i,
			fact,
		}),
	);
	const [ticket] = fold([], entries).tickets;
	if (ticket === undefined) throw new Error("the fold made no ticket");
	return ticket;
};
const drawn = (ticket: Ticket): string => {
	const shown: Shown = {
		ready: true,
		number: ticket.number,
		page: pageOf(ticket, NOW, [ticket]),
		saving: [],
		failed: null,
		unreachable: null,
		now: NOW,
	};
	return renderToStaticMarkup(
		createElement(
			AskActions.Provider,
			{value: ACTIONS},
			createElement(TicketWindow, {view: shown, send: () => {}}),
		),
	);
};
const RUNNING = {type: "started", run: "r-build-121", stage: "build", task: null, log: null};
const MERGED = {
	type: "pr",
	url: "https://github.com/fixture/project/pull/1",
	state: "merged",
	head: HEAD,
	checks: [],
};
const turnOf = (markup: string) => firstOf(markup, /<section[^>]*aria-label="Whose turn"/);

describe("ask desk review 6: one status region, always there, outside the ask view", () => {
	it.each([
		["waits on an ask", async () => [FILED, await sealed()]],
		["runs", async () => [FILED, RUNNING]],
		["is done", async () => [FILED, MERGED]],
	])("the ticket's window holds a polite status region when it %s", async (_, facts) => {
		const markup = drawn(ticketOf(await facts()));
		const ask = markup.search(/<section class="ask-view"/);
		const outside = ask < 0 ? markup : markup.replace(elementAt(markup, ask), "");
		expect(outside).toMatch(/<[a-z]+\b[^>]*role="status"/);
		const status = firstOf(outside, /<[a-z]+\b[^>]*role="status"/);
		expect(status).not.toMatch(/aria-live="(off|assertive)"/);
	});
});

describe("shot S8: the running card names no run id", () => {
	it("says the step that runs and since when, never r-build-121", () => {
		const turn = textOf(turnOf(drawn(ticketOf([FILED, RUNNING]))));
		expect(turn).not.toContain("r-build-121");
		expect(turn).not.toMatch(/\br-[a-z_]+-\d+\b/);
	});
});

describe("shot S9: the done card draws its check once", () => {
	it("one check mark, beside the word Done", () => {
		const turn = turnOf(drawn(ticketOf([FILED, MERGED])));
		const marks = (textOf(turn).match(/✓/g) ?? []).length + (turn.match(/<svg\b/g) ?? []).length;
		expect(marks).toBe(1);
		expect(textOf(turn)).toContain("Done");
	});
});
