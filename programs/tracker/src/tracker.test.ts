import {
	Ledger,
	memoryStorage,
	offer,
	readInput,
	start,
	streams,
	type Word,
	type Writer,
} from "@kampus/fabrika";
import {memoryService} from "@kampus/fabrika/memory";
import {Tickets, ticketsOnLedger} from "@kampus/pipeline/tickets/tickets";
import {hashOf} from "@kampus/pipeline/tickets/yes";
import {Effect, Layer, Option, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {lineOf} from "./head.ts";
import {Author, type Do, type PullRequest, pullRequestsOf, tracker} from "./index.ts";
import {type Shown, shownOf} from "./machine.ts";

// The tracker with no window, on a ledger in memory: told what a window would send, it writes
// facts, and shows them back. A second run on the same ledger finds them all, as the app does
// after a restart. Its pull requests are a fixed list.

const PR: PullRequest = {
	repo: "https://github.com/example/app",
	number: 7,
	title: "Fix the login loop",
	url: "https://github.com/example/app/pull/7",
	draft: false,
	at: 0,
};

const OWNER: Writer = {kind: "user", id: "owner"};

/** Ticket 1's text, as its page shows it to the person who answers. */
const saw = {title: "Login fails", body: ""};

const services = (ledger: Ledger["Service"], author: Writer) =>
	Layer.mergeAll(
		Layer.succeed(Ledger, ledger),
		Layer.succeed(Author, author),
		pullRequestsOf([PR]),
	);

/** One run of the tracker on `ledger`, as `author`, with a way to tell it and to wait for a view. */
const session = (ledger: Ledger["Service"], id = "tracker:test", author: Writer = OWNER) =>
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
	}).pipe(Effect.provide(services(ledger, author)));

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
		const ticket = seen.again.page.kind === "ticket" ? seen.again.page.opened?.ticket : null;
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
					(s) => s.page.kind === "ticket" && (s.page.opened?.ticket.timeline.length ?? 0) === 2,
				)).page;
				return page.kind === "ticket" ? page.opened?.ticket.timeline.at(-1)?.by : null;
			}).pipe(Effect.scoped),
		);
		expect(by).toEqual({kind: "agent", id: "review"});
	});

	it("says triage running once a pipeline program writes started through `Tickets`", async () => {
		const ledger = memoryService();
		const lane: Writer = {kind: "agent", id: "lane", for: "owner"};
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const {say, until} = yield* session(ledger);
				yield* until((s) => s.ready);
				yield* say({kind: "file", title: "Login fails", body: ""});
				yield* until((s) => listed(s).length === 1);
				// The pipeline's side: no tracker code, only the service a lane writes through.
				yield* Effect.gen(function* () {
					const tickets = yield* Tickets;
					yield* tickets.write(1, "r-1/started", {
						type: "started",
						run: "r-1",
						stage: "triage",
						task: null,
						log: null,
					});
				}).pipe(
					Effect.provide(ticketsOnLedger(lane)),
					Effect.provide(Layer.succeed(Ledger, ledger)),
				);
				const shown = yield* until(
					(s) => s.page.kind === "list" && s.page.tickets[0]?.head._tag === "running",
				);
				const head = shown.page.kind === "list" ? shown.page.tickets[0]?.head : undefined;
				return head === undefined ? null : lineOf(head, String);
			}).pipe(Effect.scoped),
		);
		expect(seen).toBe("triage running");
	});

	/** A stage's ask on ticket 1, written to the ledger as a lane would. */
	const ask = (ledger: Ledger["Service"]) =>
		ledger.send(streams("tracker/ticket/1").inbox, "ask-a-1", {
			kind: "asked",
			writer: "agent:plan for:owner",
			data: {type: "asked", ask: "a-1", what: "approve plan v2", picks: ["approve", "no"]},
		});
	const opened = (s: Shown) => (s.page.kind === "ticket" ? s.page.opened : null);

	it("shows an open ask with its box; a comment leaves it open, and a click answers it", async () => {
		const ledger = memoryService();
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const {say, until} = yield* session(ledger);
				yield* until((s) => s.ready);
				yield* say({kind: "file", title: "Login fails", body: ""});
				yield* until((s) => listed(s).length === 1);
				yield* ask(ledger);
				yield* say({kind: "open", ticket: 1});
				const asking = yield* until((s) => (opened(s)?.asks.length ?? 0) === 1);
				yield* say({kind: "comment", ticket: 1, body: "approve"});
				const commented = yield* until((s) => (opened(s)?.ticket.timeline.length ?? 0) === 3);
				yield* say({kind: "answer", ticket: 1, ask: "a-1", pick: "approve", note: "Go.", saw});
				const answered = yield* until((s) => (opened(s)?.ticket.timeline.length ?? 0) === 4);
				const rows = yield* ledger.read(0, 50, "tracker/ticket/1/inbox");
				return {
					asking: [opened(asking)?.head._tag, opened(asking)?.asks.map((a) => a.picks)],
					commented: [opened(commented)?.head._tag, opened(commented)?.asks.length],
					answered: [opened(answered)?.head._tag, opened(answered)?.asks.length],
					last: [rows.at(-1)?.kind, rows.at(-1)?.writer],
					text: JSON.parse(rows.at(-1)?.data ?? "{}").text,
					hash: yield* hashOf(saw),
				};
			}).pipe(Effect.scoped),
		);
		expect(seen).toMatchObject({
			asking: ["asks", [["approve", "no"]]],
			commented: ["asks", 1],
			answered: ["next", 0],
			last: ["answered", "user:owner"],
		});
		// The answer names the text it saw, as a hash.
		expect(seen.text).toBe(seen.hash);
	});

	it("refuses an answer from a tracker that writes as an agent, and writes nothing", async () => {
		const ledger = memoryService();
		const agent: Writer = {kind: "agent", id: "plan", for: "owner"};
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const {say, until} = yield* session(ledger, "tracker:agent", agent);
				yield* until((s) => s.ready);
				yield* say({kind: "file", title: "Login fails", body: ""});
				yield* until((s) => listed(s).length === 1);
				yield* ask(ledger);
				yield* say({kind: "answer", ticket: 1, ask: "a-1", pick: "approve", note: "", saw});
				const failed = (yield* until((s) => s.failed !== null)).failed;
				const rows = yield* ledger.read(0, 50, "tracker/ticket/1/inbox");
				return {why: failed?.why, kinds: rows.map((r) => r.kind)};
			}).pipe(Effect.scoped),
		);
		expect(seen.why).toMatch(/only a person writes answered/);
		expect(seen.kinds).toEqual(["filed", "asked"]);
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
				const prsOn = (s: Shown) => (s.page.kind === "list" ? s.page.pullRequests : []);
				return {
					open: [listed(open), prsOn(open).map((pr) => pr.number)],
					found: [listed(found), prsOn(found).map((pr) => pr.number)],
					closed: [listed(closed), prsOn(closed).map((pr) => pr.number)],
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
		const answer = {kind: "answer", ticket: 1, ask: "a-1", pick: "approve", note: "", saw};
		expect(readInput(tracker, {type: "do", value: answer}).kind).toBe("read");
		expect(readInput(tracker, {type: "do", value: {...answer, pick: " "}}).kind).toBe("refused");
		// An answer names the text it saw, or it is no answer.
		const {saw: _, ...blind} = answer;
		expect(readInput(tracker, {type: "do", value: blind}).kind).toBe("refused");
		const changes = {kind: "comment", ticket: 1, body: "Skip part 2.", asks: "changes"};
		expect(readInput(tracker, {type: "do", value: changes}).kind).toBe("read");
		expect(readInput(tracker, {type: "do", value: {...changes, asks: "merge"}}).kind).toBe(
			"refused",
		);
	});
});
