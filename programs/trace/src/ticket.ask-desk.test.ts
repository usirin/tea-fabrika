import {blindDraw, sealAsk} from "@kampus/pipeline/tickets/ask";
import {Entry} from "@kampus/pipeline/tickets/ticket";
import {Effect, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {
	AGENT,
	DRAFT,
	FILED,
	NOW,
	OWNER,
	TOOK,
	TRACE,
	policyFor,
	type Sealed,
} from "../../../fixtures/ask-desk/cases.ts";
import {lanesOf} from "./ticket.ts";

const seal: (draft: unknown, policy: {seed: number}) => Effect.Effect<Sealed, unknown> = sealAsk;
describe("ask desk P22: trace reads the shared answer meaning", () => {
	it("ends the saved wait at the answer and shows the resolved rec pick and writer", async () => {
		const ask = await Effect.runPromise(seal(DRAFT, policyFor(DRAFT.ask, false, blindDraw)));
		const facts = [
			FILED,
			{type: "started", run: "r-plan-8", stage: "plan", task: null, log: null, trace: TRACE},
			{
				type: "ended",
				run: "r-plan-8",
				stage: "plan",
				outcome: {kind: "done", part: false},
				usd: 0,
				input: 0,
				output: 0,
				turns: 1,
			},
			{...ask, trace: TRACE},
			{
				type: "answered",
				format: 1,
				ask: ask.ask,
				answer: {_tag: "rec"},
				saw: ask.saw,
				via: {_tag: "window", took: TOOK},
			},
		];
		const timeline = facts.map((fact, i) =>
			Schema.decodeUnknownSync(Entry)({
				pos: i + 1,
				ticket: 117,
				by: i === 0 || fact.type === "answered" ? OWNER : AGENT,
				at: NOW + i * 1000,
				fact,
			}),
		);
		const lane = lanesOf(timeline, NOW + 50_000, Infinity)[0];
		expect(lane?.rows.filter((r) => r.kind === "wait")).toEqual([
			{
				kind: "wait",
				ask: ask.ask,
				what: DRAFT.what,
				from: NOW + 3000,
				to: NOW + 4000,
				pick: "approve",
				by: "owner",
			},
		]);
		expect(lane?.open).toBe(false);
	});
});
