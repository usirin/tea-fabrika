import {Effect, Layer} from "effect";
import {describe, expect, it} from "vitest";
import {Jev} from "../services.ts";
import {
	type Candidate,
	candidatesOf,
	duplicateJudge,
	FLOOR,
	hintsOf,
	MAX_CANDIDATES,
	scoresOf,
	wordsOf,
} from "./duplicates.ts";

// The duplicate hint's code: the cheap filter that picks who Jev reads, and the ranking that
// turns Jev's answers into at most three hints at the floor. Jev itself is scripted here.

const open: readonly Candidate[] = [
	{number: 1, title: "Login fails on Safari", body: "The login button spins."},
	{number: 2, title: "Docs typo in the README", body: ""},
	{number: 3, title: "Dark mode for the settings page", body: ""},
	{number: 4, title: "Settings page loads slowly", body: "Takes ten seconds."},
];

describe("the cheap filter", () => {
	it("keeps the open tickets that share a word, the rarest shared words first", () => {
		const kept = candidatesOf({title: "Cannot log in from Safari", body: "Login spins."}, open);
		expect(kept.map((c) => c.number)).toEqual([1]);
	});

	it("ranks a ticket sharing a rare word above one sharing a common one", () => {
		const kept = candidatesOf({title: "Settings page: dark mode toggle", body: ""}, open);
		expect(kept.map((c) => c.number)).toEqual([3, 4]);
	});

	it("keeps none when nothing is shared, and at most the cut", () => {
		expect(candidatesOf({title: "Add a menu bar item", body: ""}, open)).toEqual([]);
		const many = Array.from({length: 50}, (_, i) => ({
			number: i + 1,
			title: `Login bug ${i}`,
			body: "",
		}));
		expect(candidatesOf({title: "Login bug", body: ""}, many)).toHaveLength(MAX_CANDIDATES);
	});

	it("reads words of four letters or more, in lower case, with common words and a plural s left out", () => {
		expect([...wordsOf("The Tickets should show Login errors, a lot")]).toEqual(["login", "error"]);
	});
});

describe("the ranking", () => {
	it("keeps the answers at the floor or above, surest first, at most three", () => {
		const scores = [
			{of: 1, yes: 0.71},
			{of: 2, yes: 0.95},
			{of: 3, yes: FLOOR},
			{of: 4, yes: FLOOR - 0.01},
			{of: 5, yes: 0.8},
		];
		expect(hintsOf(scores)).toEqual([
			{of: 2, yes: 0.95},
			{of: 5, yes: 0.8},
			{of: 1, yes: 0.71},
		]);
		expect(hintsOf([{of: 4, yes: 0.2}])).toEqual([]);
	});
});

describe("the question", () => {
	it("asks one yes or no per candidate, with each ticket's title and body as Jev's state", async () => {
		const states: unknown[] = [];
		const jev = Layer.succeed(Jev, {
			call: (request) =>
				Effect.sync(() => {
					states.push(request.state);
					return {
						status: 200,
						body: {
							model: request.model,
							answers: {answer: {type: "noul", noul: 0.5}},
							usage: {input_tokens: 1, output_tokens: 1},
						},
					};
				}),
		});
		const filed = {title: "Cannot log in from Safari", body: "Login spins."};
		const scores = await Effect.runPromise(
			scoresOf(filed, open.slice(0, 2)).pipe(Effect.provide(jev)),
		);
		expect(scores).toEqual([
			{of: 1, yes: 0.5},
			{of: 2, yes: 0.5},
		]);
		expect(states[0]).toEqual({
			new: "Cannot log in from Safari\n\nLogin spins.",
			existing: "Login fails on Safari\n\nThe login button spins.",
		});
		expect(states[1]).toEqual({
			new: "Cannot log in from Safari\n\nLogin spins.",
			existing: "Docs typo in the README",
		});
		expect(duplicateJudge.questions.answer.type).toBe("noul");
	});

	it("fails as a whole when one call fails, so no hint is ranked from part of the candidates", async () => {
		let n = 0;
		const jev = Layer.succeed(Jev, {
			call: (request) =>
				n++ === 1
					? Effect.fail({_tag: "jev_call_failed" as const, cause: "down"})
					: Effect.succeed({
							status: 200,
							body: {
								model: request.model,
								answers: {answer: {type: "noul", noul: 0.9}},
								usage: {input_tokens: 1, output_tokens: 1},
							},
						}),
		});
		const exit = await Effect.runPromiseExit(
			scoresOf({title: "Login", body: ""}, open).pipe(Effect.provide(jev)),
		);
		expect(exit._tag).toBe("Failure");
	});
});
