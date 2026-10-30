import {
	Ledger,
	memoryStorage,
	offer,
	type PayloadOf,
	start,
	streams,
	type Word,
	type Writer,
} from "@kampus/fabrika";
import {memoryService} from "@kampus/fabrika/memory";
import {Jev} from "@kampus/pipeline/services";
import {Effect, Layer, Option, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {Author, pullRequestsOf, tracker} from "./index.ts";
import {type Shown, shownOf} from "./machine.ts";

/** One value told to one of the tracker's inputs, by its name. */
type Inputs = (typeof tracker)["inputs"];
type Say = <K extends keyof Inputs & string>(
	input: K,
	value: PayloadOf<Inputs[K]>,
) => Effect.Effect<Word>;

// The duplicate hint end to end, on a ledger in memory and a scripted Jev: a filing that lands
// asks Jev about the open tickets the cheap filter keeps, a hint at the floor goes on the new
// ticket as code's fact, and a person's accept or dismiss is a fact of its own. Nothing closes.

const OWNER: Writer = {kind: "user", id: "owner"};

/** A Jev that says yes, as sure as `yes` says, to any `existing` ticket whose text holds a key. */
const scriptedJev = (yes: Readonly<Record<string, number>>, asked: string[] = []) =>
	Layer.succeed(Jev, {
		call: (request) =>
			Effect.sync(() => {
				const state = request.state as {readonly existing: string};
				asked.push(state.existing);
				const hit = Object.entries(yes).find(([key]) => state.existing.includes(key));
				return {
					status: 200,
					body: {
						model: request.model,
						answers: {answer: {type: "noul", noul: hit?.[1] ?? 0.05}},
						usage: {input_tokens: 100, output_tokens: 1},
					},
				};
			}),
	});

const session = (
	ledger: Ledger["Service"],
	jev: Layer.Layer<Jev> | null,
	author: Writer = OWNER,
	id = "tracker:test",
) =>
	Effect.gen(function* () {
		const started = yield* start(tracker, {}, {}, {id, storage: memoryStorage()});
		if (started.kind !== "running") return yield* Effect.die("the tracker did not start");
		const {run} = started;
		const say: Say = (input, value): Effect.Effect<Word> => offer(run, input, value);
		const until = (ok: (shown: Shown) => boolean) =>
			run.machines.tickets.changes.pipe(
				Stream.filter((s) => s !== null),
				Stream.map(shownOf),
				Stream.filter(ok),
				Stream.runHead,
				Effect.map(Option.getOrThrow),
			);
		return {run, say, until};
	}).pipe(
		Effect.provide(
			Layer.mergeAll(
				Layer.succeed(Ledger, ledger),
				Layer.succeed(Author, author),
				pullRequestsOf([]),
				...(jev === null ? [] : [jev]),
			),
		),
	);

const hintsOf = (s: Shown) =>
	s.page.kind === "ticket" && s.page.opened !== null ? s.page.opened.duplicates : [];

/** Three open tickets, then a fourth that repeats the first in other words. */
const fileFour = (say: Say) =>
	Effect.gen(function* () {
		yield* say("file", {title: "Login fails on Safari", body: "The login button spins."});
		yield* say("file", {title: "Docs typo in the README", body: ""});
		yield* say("file", {title: "Dark mode for the settings page", body: ""});
		yield* say("file", {title: "Cannot log in from Safari", body: "Login spins forever."});
	});

describe("the duplicate hint", () => {
	it("puts a hint at the floor on the new ticket, as code's fact, and asks only what the filter kept", async () => {
		const ledger = memoryService();
		const asked: string[] = [];
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const {say, until} = yield* session(ledger, scriptedJev({"Login fails": 0.91}, asked));
				yield* until((s) => s.ready);
				yield* fileFour(say);
				yield* say("query", {ticket: 4});
				const page = yield* until((s) => hintsOf(s).length > 0);
				yield* say("quit", null);
				const rows = yield* ledger.readStream(streams("tracker/ticket/4").inbox);
				return {
					hints: hintsOf(page),
					rows: rows.map((r) => [r.kind, r.writer, JSON.parse(r.data)]),
				};
			}).pipe(Effect.scoped),
		);
		expect(seen.hints).toEqual([
			{of: 1, title: "Login fails on Safari", state: "open", yes: 0.91, says: null},
		]);
		expect(seen.rows).toEqual([
			[
				"filed",
				"user:owner",
				{type: "filed", title: "Cannot log in from Safari", body: "Login spins forever."},
			],
			[
				"maybe_duplicate",
				"agent:duplicates for:owner",
				{type: "maybe_duplicate", of: 1, yes: 0.91},
			],
		]);
		// Ticket 4 shares "safari" and "login" with #1 only, so Jev read #1 for it and nothing else.
		// The earlier filings read what each shared a word with: #3 "the settings page" with none.
		expect(asked.filter((t) => t.startsWith("Login fails"))).toHaveLength(1);
		expect(asked.some((t) => t.startsWith("Docs typo"))).toBe(false);
	});

	it("leaves no hint under the floor", async () => {
		const ledger = memoryService();
		const hints = await Effect.runPromise(
			Effect.gen(function* () {
				const {say, until, run} = yield* session(ledger, scriptedJev({"Login fails": 0.69}));
				yield* until((s) => s.ready);
				yield* fileFour(say);
				yield* say("quit", null);
				// Quit waits for the hints still out, so once it ends Jev has answered.
				yield* run.ended;
				return yield* ledger.readStream(streams("tracker/ticket/4").inbox);
			}).pipe(Effect.scoped),
		);
		expect(hints.map((r) => r.kind)).toEqual(["filed"]);
	});

	it("with no Jev given asks nothing and writes no hint", async () => {
		const ledger = memoryService();
		const rows = await Effect.runPromise(
			Effect.gen(function* () {
				const {say, until, run} = yield* session(ledger, null);
				yield* until((s) => s.ready);
				yield* fileFour(say);
				yield* say("quit", null);
				yield* run.ended;
				return yield* ledger.readStream(streams("tracker/ticket/4").inbox);
			}).pipe(Effect.scoped),
		);
		expect(rows.map((r) => r.kind)).toEqual(["filed"]);
	});

	it("a Jev that fails leaves no hint and says why, and the filing stands", async () => {
		const ledger = memoryService();
		const failing = Layer.succeed(Jev, {
			call: () => Effect.fail({_tag: "jev_call_failed" as const, cause: "no network"}),
		});
		const shown = await Effect.runPromise(
			Effect.gen(function* () {
				const {say, until} = yield* session(ledger, failing);
				yield* until((s) => s.ready);
				yield* fileFour(say);
				return yield* until((s) => s.problems.some((p) => p.includes("#4")));
			}).pipe(Effect.scoped),
		);
		expect(shown.problems.filter((p) => p.includes("#4"))).toEqual([
			"no duplicate hint on #4: Jev did not answer",
		]);
	});

	it("accept and dismiss are a person's facts; the newest word counts, and nothing closes", async () => {
		const ledger = memoryService();
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const {say, until} = yield* session(ledger, scriptedJev({"Login fails": 0.91}));
				yield* until((s) => s.ready);
				yield* fileFour(say);
				yield* say("query", {ticket: 4});
				yield* until((s) => hintsOf(s).length > 0);
				yield* say("rate_duplicate", {ticket: 4, of: 1, says: "accept"});
				yield* until((s) => hintsOf(s)[0]?.says === "accept");
				yield* say("rate_duplicate", {ticket: 4, of: 1, says: "dismiss"});
				const page = yield* until((s) => hintsOf(s)[0]?.says === "dismiss");
				const states =
					page.page.kind === "ticket" ? page.page.opened?.ticket.state : "not a ticket page";
				const rows = yield* ledger.readStream(streams("tracker/ticket/4").inbox);
				return {states, rows: rows.map((r) => [r.kind, r.writer])};
			}).pipe(Effect.scoped),
		);
		expect(seen.states).toBe("open");
		expect(seen.rows).toEqual([
			["filed", "user:owner"],
			["maybe_duplicate", "agent:duplicates for:owner"],
			["duplicate_rated", "user:owner"],
			["duplicate_rated", "user:owner"],
		]);
	});

	it("a tracker that writes as an agent may not accept or dismiss a hint", async () => {
		const ledger = memoryService();
		const agent: Writer = {kind: "agent", id: "triage", for: "owner"};
		const failed = await Effect.runPromise(
			Effect.gen(function* () {
				const {say, until} = yield* session(ledger, scriptedJev({"Login fails": 0.91}), agent);
				yield* until((s) => s.ready);
				yield* fileFour(say);
				yield* say("rate_duplicate", {ticket: 4, of: 1, says: "accept"});
				return (yield* until((s) => s.failed !== null)).failed;
			}).pipe(Effect.scoped),
		);
		expect(failed?.why).toBe(
			"only a person writes duplicate_rated, and this tracker writes as agent triage",
		);
	});
});
