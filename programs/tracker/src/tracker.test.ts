import {Ledger, memoryStorage, offer, readInput, start, streams, type Word} from "@kampus/fabrika";
import {memoryService} from "@kampus/fabrika/memory";
import {Effect, Layer, Option, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {Author, type Do, type Pull, pullsOf, tracker} from "./index.ts";
import {type Shown, shownOf} from "./machine.ts";

// The tracker with no window, on a ledger in memory: told what a window would send, it writes
// facts, and shows them back. A second run on the same ledger finds them all, as the app does
// after a restart. Its pull requests are a fixed list.

const PULL: Pull = {
	repo: "https://github.com/example/app",
	number: 7,
	title: "Fix the login loop",
	url: "https://github.com/example/app/pull/7",
	draft: false,
	at: 0,
};

const services = (ledger: Ledger["Service"]) =>
	Layer.mergeAll(
		Layer.succeed(Ledger, ledger),
		Layer.succeed(Author, {kind: "user", id: "owner"}),
		pullsOf([PULL]),
	);

/** One run of the tracker on `ledger`, with a way to tell it and to wait for a view. */
const session = (ledger: Ledger["Service"], id = "tracker:test") =>
	Effect.gen(function* () {
		const started = yield* start(tracker, {}, {}, {id, storage: memoryStorage()});
		if (started.kind !== "running") return yield* Effect.die("the tracker did not start");
		const {run} = started;
		/** Offered, as the app does: it waits for room, and never drops what a person did. */
		const say = (d: Do): Effect.Effect<Word> => offer(run, "do", d);
		const until = (ok: (shown: Shown) => boolean) =>
			run.machines.tickets.changes.pipe(
				Stream.filter((s) => s !== null),
				Stream.map(shownOf),
				Stream.filter(ok),
				Stream.runHead,
				Effect.map(Option.getOrThrow),
			);
		return {run, say, until};
	}).pipe(Effect.provide(services(ledger)));

const listed = (shown: Shown) =>
	shown.page.kind === "list" ? shown.page.tickets.map((t) => [t.number, t.title, t.state]) : [];

describe("the tracker", () => {
	it("files, comments and closes, and a second run on the same ledger finds it all", async () => {
		const ledger = memoryService();
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const first = yield* Effect.gen(function* () {
					const {run, say, until} = yield* session(ledger);
					yield* until((s) => s.ready);
					// The list hides closed tickets until it is asked to show them.
					yield* say({kind: "show", show: "all"});
					yield* say({kind: "file", title: "Login fails", body: "On main."});
					yield* say({kind: "file", title: "Docs typo", body: ""});
					yield* say({kind: "comment", ticket: 1, body: "Seen it too."});
					yield* say({kind: "close", ticket: 2});
					// The close is the last write asked for: once it is read back, they all are.
					const shown = yield* until((s) =>
						listed(s).some(([n, , state]) => n === 2 && state === "closed"),
					);
					yield* say({kind: "quit"});
					return {list: listed(shown), ended: (yield* run.ended).kind};
				}).pipe(Effect.scoped);

				// Started again: nothing was kept but the ledger.
				const again = yield* Effect.gen(function* () {
					const {say, until} = yield* session(ledger, "tracker:again");
					yield* say({kind: "show", show: "all"});
					const list = listed(yield* until((s) => s.ready && s.filter.show === "all"));
					yield* say({kind: "open", ticket: 1});
					const page = (yield* until((s) => s.page.kind === "ticket")).page;
					return {list, page};
				}).pipe(Effect.scoped);

				const rows = yield* ledger.readStream(streams("tracker/ticket/1").inbox);
				return {first, again, rows};
			}),
		);
		expect(seen.first).toEqual({
			list: [
				[2, "Docs typo", "closed"],
				[1, "Login fails", "open"],
			],
			ended: "ended",
		});
		expect(seen.again.list).toEqual(seen.first.list);
		const ticket = seen.again.page.kind === "ticket" ? seen.again.page.ticket : null;
		expect(ticket?.timeline.map((e) => [e.by, e.fact])).toEqual([
			[
				{kind: "user", id: "owner"},
				{type: "filed", title: "Login fails", body: "On main."},
			],
			[
				{kind: "user", id: "owner"},
				{type: "commented", body: "Seen it too."},
			],
		]);
		// On the ledger: one fact per row, its kind the fact's type, its writer the author's text.
		expect(seen.rows.map((r) => [r.kind, r.writer])).toEqual([
			["filed", "user:owner"],
			["commented", "user:owner"],
		]);
	});

	it("shows a fact written from elsewhere, such as an agent's comment, once the poll sees it", async () => {
		const ledger = memoryService();
		const by = await Effect.runPromise(
			Effect.gen(function* () {
				const {say, until} = yield* session(ledger);
				yield* until((s) => s.ready);
				yield* say({kind: "file", title: "Login fails", body: ""});
				yield* until((s) => listed(s).length === 1);
				yield* ledger.send(streams("tracker/ticket/1").inbox, "from-an-agent", {
					kind: "commented",
					writer: "agent:review",
					data: {type: "commented", body: "Found the cause."},
				});
				yield* say({kind: "open", ticket: 1});
				const page = (yield* until(
					(s) => s.page.kind === "ticket" && (s.page.ticket?.timeline.length ?? 0) === 2,
				)).page;
				return page.kind === "ticket" ? page.ticket?.timeline.at(-1)?.by : null;
			}).pipe(Effect.scoped),
		);
		expect(by).toEqual({kind: "agent", id: "review"});
	});

	it("files the next number past one taken already", async () => {
		const ledger = memoryService();
		const list = await Effect.runPromise(
			Effect.gen(function* () {
				// Someone registered #1 and never filed it: a write that died half way.
				yield* ledger.register("tracker/ticket/1", "user:owner");
				const {say, until} = yield* session(ledger);
				yield* until((s) => s.ready);
				yield* say({kind: "file", title: "Login fails", body: ""});
				return listed(yield* until((s) => listed(s).length === 1));
			}).pipe(Effect.scoped),
		);
		expect(list).toEqual([[2, "Login fails", "open"]]);
	});

	it("hides closed tickets at first, finds by title, and lists the open pull requests beside them", async () => {
		const ledger = memoryService();
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const {say, until} = yield* session(ledger);
				yield* until((s) => s.ready);
				yield* say({kind: "file", title: "Login fails", body: ""});
				yield* say({kind: "file", title: "Docs typo", body: ""});
				yield* say({kind: "close", ticket: 2});
				const open = yield* until(
					(s) => s.page.kind === "list" && s.page.counts.closed === 1 && s.github.read,
				);
				yield* say({kind: "find", text: "  LOGIN "});
				const found = yield* until((s) => s.filter.find === "  LOGIN ");
				yield* say({kind: "show", show: "closed"});
				const closed = yield* until((s) => s.filter.show === "closed");
				const pullsOn = (s: Shown) => (s.page.kind === "list" ? s.page.pulls : []);
				return {
					open: [listed(open), pullsOn(open).map((p) => p.number)],
					found: [listed(found), pullsOn(found).map((p) => p.number)],
					closed: [listed(closed), pullsOn(closed).map((p) => p.number)],
				};
			}).pipe(Effect.scoped),
		);
		expect(seen).toEqual({
			open: [[[1, "Login fails", "open"]], [7]],
			found: [[[1, "Login fails", "open"]], [7]],
			closed: [[], []],
		});
	});

	it("reads what its window sends, and refuses a blank title or an empty comment", () => {
		expect(readInput(tracker, {type: "do", value: {kind: "close", ticket: 3}}).kind).toBe("read");
		expect(readInput(tracker, {type: "do", value: {kind: "file", title: " ", body: ""}}).kind).toBe(
			"refused",
		);
		expect(
			readInput(tracker, {type: "do", value: {kind: "comment", ticket: 1, body: "\n"}}).kind,
		).toBe("refused");
		expect(readInput(tracker, {type: "do", value: {kind: "open", ticket: 0}}).kind).toBe("refused");
		expect(readInput(tracker, {type: "do", value: {kind: "show", show: "all"}}).kind).toBe("read");
		expect(readInput(tracker, {type: "do", value: {kind: "show", show: "done"}}).kind).toBe(
			"refused",
		);
		expect(
			readInput(tracker, {type: "do", value: {kind: "find", text: "x".repeat(257)}}).kind,
		).toBe("refused");
	});
});
