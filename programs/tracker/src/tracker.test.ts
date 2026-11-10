import {
	Ledger,
	listed as listedProgram,
	memoryStorage,
	offer,
	type PayloadOf,
	readInput,
	start,
	Shell,
	streams,
	type Word,
	type Writer,
} from "@kampus/fabrika-old";
import {driveFor} from "@kampus/fabrika-old/mcp";
import {memoryService} from "@kampus/fabrika-old/memory";
import {hashOf} from "@kampus/pipeline/tickets/approval";
import type {CodeFact, PrFact} from "@kampus/pipeline/tickets/ticket";
import {Tickets, ticketsOnLedger, Watcher, watcherOnLedger} from "@kampus/pipeline/tickets/tickets";
import {Arbitrary, Effect, Layer, Option, Schema, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {headOf, lineOf} from "./head.ts";
import {Author, type PullRequest, pickOf, pullRequestsOf, tracker} from "./index.ts";
import {type Shown, shownOf, statusOf, type Tracker} from "./machine.ts";

/** The tracker's inputs, by name: what a test tells it. */
type Inputs = (typeof tracker)["inputs"];
type Name = keyof Inputs & string;

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
		const say = <K extends Name>(input: K, value: PayloadOf<Inputs[K]>): Effect.Effect<Word> =>
			offer(run, input, value);
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
					yield* say("query", {status: "all"});
					yield* say("file", {title: "Login fails", body: "On main."});
					yield* say("file", {title: "Docs typo", body: ""});
					yield* say("comment", {ticket: 1, body: "Seen it too."});
					yield* say("close", {ticket: 2});
					// The close is the last write asked for: once it is read back, they all are.
					const shown = yield* until((s) =>
						listed(s).some(([n, , state]) => n === 2 && state === "closed"),
					);
					yield* say("quit", null);
					return {list: listed(shown), ended: (yield* run.ended).kind};
				}).pipe(Effect.scoped);

				// Started again: nothing was kept but the ledger.
				const again = yield* Effect.gen(function* () {
					const {say, until} = yield* session(ledger, "tracker:again");
					yield* say("query", {status: "all"});
					const list = listed(yield* until((s) => s.ready && s.filter.show === "all"));
					yield* say("query", {ticket: 1});
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

	// What is told is read in the order it was told, across every input. Before a run had one
	// mailbox, each input was its own queue, and a close told right after a file, on two inputs, was
	// sometimes read first: the close failed.
	it("reads file #2 then close #2, told back to back on two inputs, in that order", async () => {
		const ledger = memoryService();
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const {run, say, until} = yield* session(ledger);
				yield* until((s) => s.ready);
				yield* say("file", {title: "Login fails", body: ""});
				yield* say("file", {title: "Docs typo", body: ""});
				yield* say("close", {ticket: 2});
				yield* say("quit", null);
				const ended = yield* run.ended;
				const rows = yield* ledger.readStream(streams("tracker/ticket/2").inbox);
				return {ended: ended.kind, kinds: rows.map((r) => r.kind)};
			}).pipe(Effect.scoped),
		);
		expect(seen).toEqual({ended: "ended", kinds: ["filed", "closed"]});
	});

	it("lands a write told right before quit", async () => {
		const ledger = memoryService();
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const {run, say} = yield* session(ledger);
				yield* say("file", {title: "Login fails", body: ""});
				yield* say("quit", null);
				const ended = yield* run.ended;
				const rows = yield* ledger.readStream(streams("tracker/ticket/1").inbox);
				return {ended: ended.kind, kinds: rows.map((r) => r.kind)};
			}).pipe(Effect.scoped),
		);
		expect(seen).toEqual({ended: "ended", kinds: ["filed"]});
	});

	it("shows a fact written from elsewhere, such as an agent's comment, once the poll sees it", async () => {
		const ledger = memoryService();
		const by = await Effect.runPromise(
			Effect.gen(function* () {
				const {say, until} = yield* session(ledger);
				yield* until((s) => s.ready);
				yield* say("file", {title: "Login fails", body: ""});
				yield* until((s) => listed(s).length === 1);
				yield* ledger.send(streams("tracker/ticket/1").inbox, "from-an-agent", {
					kind: "commented",
					writer: "agent:review",
					data: {type: "commented", body: "Found the cause."},
				});
				yield* say("query", {ticket: 1});
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
				yield* say("file", {title: "Login fails", body: ""});
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

	it("a lane cannot make a ticket done by writing the watcher's merged fact; the watcher can", async () => {
		const ledger = memoryService();
		const lane: Writer = {kind: "agent", id: "lane", for: "owner"};
		const watcher: Writer = {kind: "agent", id: "pr-watcher", for: "owner"};
		const merged: PrFact = {
			type: "pr",
			url: "https://github.com/example/app/pull/7",
			state: "merged",
			head: "abcdef1",
			checks: [],
		};
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				yield* ledger.register("tracker/ticket/1", "user:owner");
				yield* ledger.send(streams("tracker/ticket/1").inbox, "file-1", {
					kind: "filed",
					writer: "user:owner",
					data: {type: "filed", title: "Login fails", body: ""},
				});
				const tickets = yield* Tickets;
				const head = () => Effect.map(tickets.read(1), (t) => headOf(t.timeline, 0)._tag);
				const refused = yield* Effect.flip(
					// oxlint-disable-next-line fabrika/no-type-assertions -- the test plays a lane that lies to the compiler, to show the run-time check holds
					tickets.write(1, "w/1", merged as unknown as CodeFact),
				);
				const afterLane = yield* head();
				yield* (yield* Watcher).write(1, "w/1", merged);
				return {refused: refused.why, afterLane, afterWatcher: yield* head()};
			}).pipe(
				Effect.provide(Layer.mergeAll(ticketsOnLedger(lane), watcherOnLedger(watcher))),
				Effect.provide(Layer.succeed(Ledger, ledger)),
			),
		);
		expect(seen).toEqual({refused: "not_yours", afterLane: "next", afterWatcher: "done"});
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
				yield* say("file", {title: "Login fails", body: ""});
				yield* until((s) => listed(s).length === 1);
				yield* ask(ledger);
				yield* say("query", {ticket: 1});
				const asking = yield* until((s) => (opened(s)?.asks.length ?? 0) === 1);
				yield* say("comment", {ticket: 1, body: "approve"});
				const commented = yield* until((s) => (opened(s)?.ticket.timeline.length ?? 0) === 3);
				yield* say("answer", {ticket: 1, ask: "a-1", pick: "approve", note: "Go.", saw});
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
				yield* say("file", {title: "Login fails", body: ""});
				yield* until((s) => listed(s).length === 1);
				yield* ask(ledger);
				yield* say("answer", {ticket: 1, ask: "a-1", pick: "approve", note: "", saw});
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
				yield* say("file", {title: "Login fails", body: ""});
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
				yield* say("file", {title: "Login fails", body: ""});
				yield* say("file", {title: "Docs typo", body: ""});
				yield* say("close", {ticket: 2});
				const open = yield* until(
					(s) => s.page.kind === "list" && s.page.counts.closed === 1 && s.github.read,
				);
				yield* say("query", {status: "open", find: "  LOGIN "});
				const found = yield* until((s) => s.filter.find === "  LOGIN ");
				yield* say("query", {status: "closed", find: "  LOGIN "});
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

	it("sends the ticket the person picks, once a change, on its output ticket", async () => {
		const ledger = memoryService();
		const sent = await Effect.runPromise(
			Effect.gen(function* () {
				const sent: number[] = [];
				const started = yield* start(
					tracker,
					{},
					{ticket: (n) => sent.push(n)},
					{id: "tracker:picks", storage: memoryStorage()},
				);
				if (started.kind !== "running") return yield* Effect.die("the tracker did not start");
				const {run} = started;
				yield* offer(run, "file", {title: "Login fails", body: ""});
				yield* offer(run, "file", {title: "Docs typo", body: ""});
				yield* offer(run, "query", {ticket: 1});
				yield* offer(run, "query", {status: "open"});
				yield* offer(run, "query", {ticket: 1});
				yield* offer(run, "query", {status: "all"});
				yield* offer(run, "query", {ticket: 2});
				yield* offer(run, "quit", null);
				yield* started.run.ended;
				return sent;
			}).pipe(Effect.scoped, Effect.provide(services(ledger, OWNER))),
		);
		// The list in between picks nothing: 1 is still the pick, so 1 is sent once.
		expect(sent).toEqual([1, 2]);
	});

	it("reads what its window sends, and refuses a blank title or an empty comment", () => {
		const read = (type: string, value: unknown) => readInput(tracker, {type, value}).kind;
		expect(read("close", {ticket: 3})).toBe("read");
		expect(read("file", {title: " ", body: ""})).toBe("refused");
		expect(read("comment", {ticket: 1, body: "\n"})).toBe("refused");
		// A value is the command's own struct: its input already says which command it is.
		expect(read("close", {kind: "close", ticket: 3})).toBe("refused");
		expect(read("do", {kind: "close", ticket: 3})).toBe("refused");
		expect(read("query", {ticket: 0})).toBe("refused");
		expect(read("query", {status: "all"})).toBe("read");
		expect(read("query", {status: "open", find: "login"})).toBe("read");
		expect(read("query", {status: "done"})).toBe("refused");
		expect(read("query", {status: "open", find: "x".repeat(257)})).toBe("refused");
		// A query is a ticket or a filter, never both.
		expect(read("query", {ticket: 1, status: "all"})).toBe("refused");
		expect(read("quit", null)).toBe("read");
		const answer = {ticket: 1, ask: "a-1", pick: "approve", note: "", saw};
		expect(read("answer", answer)).toBe("read");
		expect(read("answer", {...answer, pick: " "})).toBe("refused");
		// An answer names the text it saw, or it is no answer.
		const {saw: _, ...blind} = answer;
		expect(read("answer", blind)).toBe("refused");
		const changes = {ticket: 1, body: "Skip part 2.", asks: "changes"};
		expect(read("comment", changes)).toBe("read");
		expect(read("comment", {...changes, asks: "merge"})).toBe("refused");
	});
});

// Areas PR 1, round 2 (from the mutation step): the area inputs driven through the program, as tsh
// and the window send them. Each lands as one fact on `tracker/areas`, and the list shows it.
describe("the tracker's areas, through its inputs", () => {
	const AREAS_INBOX = streams("tracker/areas").inbox;
	const onboarding = (s: Shown) => (s.page.kind === "list" ? s.page.onboarding : undefined);
	const lanes = ["Lane: a run hangs", "Lane tests: one is flaky", "Lane checks: red on main"];

	/** One session's ledger state, as its machine holds it, once `ok` says so. */
	const state =
		(run: {machines: {tickets: {changes: Stream.Stream<Tracker | null>}}}) =>
		(ok: (s: Tracker) => boolean) =>
			run.machines.tickets.changes.pipe(
				Stream.filter((s): s is Tracker => s !== null && ok(s)),
				Stream.runHead,
				Effect.map(Option.getOrThrow),
			);

	it("makes, renames and merges, one fact each by the person, and the onboarding goes", async () => {
		const ledger = memoryService();
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const {run, say, until} = yield* session(ledger, "tracker:areas");
				yield* until((s) => s.ready);
				for (const title of lanes) yield* say("file", {title, body: ""});
				const shown = onboarding(yield* until((s) => (onboarding(s)?.length ?? 0) > 0));
				const suggested = {_tag: "titles", word: "lane", tickets: 3} as const;
				yield* say("make_area", {name: "lane", suggested});
				yield* say("make_area", {name: "desk"});
				// The machine checks a rename against the areas it has read, so both are read back first.
				yield* state(run)((s) => s.areas.live.size === 2);
				yield* say("rename_area", {area: 1, name: "lane work"});
				yield* say("merge_area", {area: 2, into: 1});
				const done = yield* state(run)((s) => s.areas.into.size === 1);
				const rows = yield* ledger.readStream(AREAS_INBOX, 0, -1);
				return {
					shown,
					live: [...done.areas.live],
					after: onboarding(shownOf(done)),
					status: statusOf(done),
					rows: rows.map((r) => [r.kind, r.writer, JSON.parse(r.data)]),
				};
			}).pipe(Effect.scoped),
		);
		expect(seen.shown).toEqual([{_tag: "titles", word: "lane", tickets: 3}]);
		expect(seen.rows).toEqual([
			[
				"area_made",
				"user:owner",
				{_tag: "area_made", area: 1, name: "lane", suggested: seen.shown?.[0]},
			],
			["area_made", "user:owner", {_tag: "area_made", area: 2, name: "desk"}],
			["area_renamed", "user:owner", {_tag: "area_renamed", area: 1, name: "lane work"}],
			["area_merged", "user:owner", {_tag: "area_merged", area: 2, into: 1}],
		]);
		expect(seen.live).toEqual([[1, "lane work"]]);
		expect(seen.after).toBeNull();
		expect(seen.status).toBe("3 open, 0 closed; areas: lane work");
	});

	it("skips the onboarding, writes nothing, and its input is marked as writing nothing", async () => {
		const ledger = memoryService();
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const {run, say, until} = yield* session(ledger, "tracker:skip");
				yield* until((s) => s.ready);
				for (const title of lanes) yield* say("file", {title, body: ""});
				yield* until((s) => (onboarding(s)?.length ?? 0) > 0);
				yield* say("skip_onboarding", null);
				const skipped = yield* state(run)((s) => s.skipped);
				const rows = yield* ledger
					.readStream(AREAS_INBOX, 0, -1)
					.pipe(Effect.orElseSucceed(() => []));
				return {after: onboarding(shownOf(skipped)), rows: rows.length};
			}).pipe(Effect.scoped),
		);
		expect(seen.after).toBeNull();
		expect(seen.rows).toBe(0);
		expect(tracker.inputs.skip_onboarding.writes).toBe(false);
		expect(tracker.inputs.skip_onboarding.personOnly).toBe(true);
	});

	it("reads an area's inputs, and refuses a blank or too long name", () => {
		const read = (type: string, value: unknown) => readInput(tracker, {type, value}).kind;
		expect(read("make_area", {name: "lane"})).toBe("read");
		expect(
			read("make_area", {name: "fabrika", suggested: {_tag: "folder", path: "apps/fabrika"}}),
		).toBe("read");
		expect(read("make_area", {name: ""})).toBe("refused");
		expect(read("make_area", {name: " lane"})).toBe("refused");
		expect(read("make_area", {name: "x".repeat(33)})).toBe("refused");
		expect(read("rename_area", {area: 1, name: "lane work"})).toBe("read");
		expect(read("rename_area", {area: 0, name: "lane work"})).toBe("refused");
		expect(read("merge_area", {area: 2, into: 1})).toBe("read");
		expect(read("merge_area", {area: 2})).toBe("refused");
		expect(read("skip_onboarding", null)).toBe("read");
	});
});

describe("pickOf", () => {
	it("is a new ticket's query only: the same ticket again, or the list, picks nothing", () => {
		expect(pickOf({ticket: 7}, null)).toBe(7);
		expect(pickOf({ticket: 7}, 3)).toBe(7);
		expect(pickOf({ticket: 7}, 7)).toBeNull();
		expect(pickOf({status: "open"}, 7)).toBeNull();
	});
});

// An MCP call on a tracker input answers with the view its OWN input made (tracker 411). The agent's
// door, `driveFor`, runs the real tracker on a real in-memory ledger; before the fix it answered with
// the view from before the input was handled. A changed view must come from the returned call itself:
// the only reads beside it are the setup (warm-up, waiting for the first load) and the ledger rows.
//
//   tracker_query {ticket: 386}  then  tracker_query {ticket: 337}
//   // the second answer's view: page {kind: "ticket", number: 337, ...}, not 386's

const SEED = 119120;
const RUNS = 200;
const AGENT: Writer = {kind: "agent", id: "mcp", for: "owner"};

/** Each failure of a property in words, as fast-check's report: the shrunk case and what differed. */
const holds = <A, E>(arb: Arbitrary.Arbitrary<A>, body: (a: A) => Effect.Effect<void, E>) =>
	Arbitrary.checkEffect(arb, (a) => body(a).pipe(Effect.as(true)), {
		seed: SEED,
		runs: RUNS,
		concurrency: 1,
	}).pipe(
		Effect.flatMap((result) =>
			result._tag === "Passed"
				? Effect.void
				: Effect.die(Arbitrary.formatCheckFailure(result) ?? result._tag),
		),
	);
const ensure = (ok: boolean, what: string) => (ok ? Effect.void : Effect.fail(what));
const same = (what: string, actual: unknown, expected: unknown) =>
	ensure(
		JSON.stringify(actual) === JSON.stringify(expected),
		`${what}: got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`,
	);

interface Seeded {
	readonly number: number;
	readonly state: "open" | "closed";
}

/** Tickets on a fresh ledger, filed as the person: `Ticket n`, and closed where asked. */
const seeded = (tickets: readonly Seeded[]) =>
	Effect.gen(function* () {
		const ledger = memoryService();
		for (const t of [...tickets].sort((a, b) => a.number - b.number)) {
			const stream = streams(`tracker/ticket/${t.number}`).inbox;
			yield* ledger.register(`tracker/ticket/${t.number}`, "user:owner");
			yield* ledger.send(stream, `file-${t.number}`, {
				kind: "filed",
				writer: "user:owner",
				data: {type: "filed", title: `Ticket ${t.number}`, body: `Body of ${t.number}`},
			});
			if (t.state === "closed")
				yield* ledger.send(stream, `close-${t.number}`, {
					kind: "closed",
					writer: "user:owner",
					data: {type: "closed"},
				});
		}
		return ledger;
	});

/** The agent's door on the tracker over `ledger`, its run started and its first load done. */
const door = (ledger: Ledger["Service"]) =>
	Effect.gen(function* () {
		const {drive} = yield* driveFor({
			list: Shell.programList([listedProgram(tracker, services(ledger, AGENT))]),
			tiles: () => [],
		});
		// Setup, not the call under test: the first call starts the run; wait until it has read the ledger.
		yield* drive.call("tracker_query", {value: {status: "all"}});
		for (let i = 0; i < 1000; i += 1) {
			const runs = yield* drive.call("runs", {});
			const yours: unknown = runs.kind === "done" ? Reflect.get(Object(runs.data), "yours") : [];
			const view = Array.isArray(yours) ? Reflect.get(Object(yours[0]), "view") : null;
			if (Reflect.get(Object(view), "ready") === true) return drive;
			yield* Effect.sleep("2 millis");
		}
		return yield* Effect.die("the tracker never finished its first load");
	});

/** The view in a done answer, as plain data: `null` for a refusal. */
const viewOf = (answer: {readonly kind: string; readonly data?: unknown}): unknown =>
	answer.kind === "done" ? Reflect.get(Object(answer.data), "view") : null;

/** The page of a view, read loosely: the law checks its fields by name. */
const pageOf = (view: unknown): Record<string, unknown> => {
	const page: unknown = Reflect.get(Object(view), "page");
	return typeof page === "object" && page !== null ? Object(page) : {};
};
const numbersOf = (view: unknown): unknown => {
	const tickets: unknown = Reflect.get(pageOf(view), "tickets");
	return Array.isArray(tickets) ? tickets.map((t) => Reflect.get(Object(t), "number")) : tickets;
};

const Numbered = Schema.Int.check(Schema.isBetween({minimum: 1, maximum: 500}));
const Find = Schema.Literals(["", "ticket", "zzz"]);

describe("an MCP call on the tracker answers with its own input's view", () => {
	const TrackerQueries = Schema.Struct({
		numbers: Schema.Array(Numbered).check(Schema.isBetweenLength(2, 5)),
		target: Schema.Int.check(Schema.isBetween({minimum: 0, maximum: 4})),
		priorTicket: Schema.Int.check(Schema.isBetween({minimum: 0, maximum: 4})),
		prior: Schema.Literals(["ticket", "list"]),
		status: Schema.Literals(["open", "closed", "all"]),
		find: Find,
	}).pipe(Schema.check(Schema.makeFilter(({numbers}) => new Set(numbers).size >= 2)));

	it("L2: query N returns page number N and the opened ticket N, whatever query came before; a list query applies its show and find together", async () => {
		await Effect.runPromise(
			holds(Arbitrary.schema(TrackerQueries), (q) =>
				Effect.gen(function* () {
					const numbers = [...new Set(q.numbers)];
					const ledger = yield* seeded(numbers.map((number) => ({number, state: "open" as const})));
					const drive = yield* door(ledger);
					const at = (i: number) => numbers[i % numbers.length] ?? 1;
					const target = at(q.target);
					yield* drive.call("tracker_query", {
						value:
							q.prior === "ticket" ? {ticket: at(q.priorTicket)} : {status: q.status, find: q.find},
					});
					const view = viewOf(yield* drive.call("tracker_query", {value: {ticket: target}}));
					yield* same("the page", [pageOf(view).kind, pageOf(view).number], ["ticket", target]);
					const opened = Reflect.get(Object(Reflect.get(pageOf(view), "opened")), "ticket");
					yield* same("the opened ticket", Reflect.get(Object(opened), "number"), target);
					// And a list query right after: its filter and its rows are its own, both applied.
					const listView = viewOf(
						yield* drive.call("tracker_query", {value: {status: q.status, find: q.find}}),
					);
					const wanted =
						q.status === "closed" || q.find === "zzz" ? [] : numbers.toSorted((a, b) => b - a);
					yield* same("the list's filter", Reflect.get(Object(listView), "filter"), {
						show: q.status,
						find: q.find,
					});
					yield* same("the list's rows", numbersOf(listView), wanted);
				}).pipe(Effect.scoped),
			),
		);
	});

	// pinned: the reported bug. A person asked for ticket 386, then for ticket 337, and the second
	// answer was ticket 386's page, the view from before its own query was handled.
	it("pinned: ticket 386, then ticket 337, answers 337's page", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const ledger = yield* seeded([
					{number: 337, state: "open"},
					{number: 386, state: "open"},
				]);
				const drive = yield* door(ledger);
				const first = viewOf(yield* drive.call("tracker_query", {value: {ticket: 386}}));
				const second = viewOf(yield* drive.call("tracker_query", {value: {ticket: 337}}));
				return [pageOf(first).number, pageOf(second).number];
			}).pipe(Effect.scoped),
		);
		expect(seen).toEqual([386, 337]);
	});

	const Filings = Schema.Struct({
		numbers: Schema.Array(Numbered).check(Schema.isBetweenLength(0, 4)),
		title: Schema.String.check(Schema.isPattern(/^[A-Z][a-z]{2,9}( [a-z]{2,9}){0,3}$/)),
		body: Schema.String.check(Schema.isPattern(/^[a-z]{0,12}( [a-z]{1,9}){0,3}$/)),
	});

	it("L3: a filing on the full list answers with a view holding its new number and title, and its title and body are already on the ledger", async () => {
		await Effect.runPromise(
			holds(Arbitrary.schema(Filings), ({numbers, title, body}) =>
				Effect.gen(function* () {
					const had = [...new Set(numbers)];
					const ledger = yield* seeded(had.map((number) => ({number, state: "open" as const})));
					const drive = yield* door(ledger);
					const view = viewOf(yield* drive.call("tracker_file", {value: {title, body}}));
					const next = Math.max(0, ...had) + 1;
					const row = (yield* ledger
						.readStream(streams(`tracker/ticket/${next}`).inbox)
						.pipe(Effect.orElseSucceed(() => []))).find((r) => r.kind === "filed");
					yield* same("the saved fact", row === undefined ? null : JSON.parse(row.data), {
						type: "filed",
						title,
						body,
					});
					const tickets: unknown = Reflect.get(pageOf(view), "tickets");
					const mine = Array.isArray(tickets)
						? tickets.find((t) => Reflect.get(Object(t), "number") === next)
						: undefined;
					yield* same(
						"its row in the returned view",
						mine === undefined ? null : Reflect.get(mine, "title"),
						title,
					);
				}).pipe(Effect.scoped),
			),
		);
	});

	const TrackerWrites = Schema.Struct({
		others: Schema.Array(Numbered).check(Schema.isBetweenLength(0, 3)),
		held: Numbered,
		state: Schema.Literals(["open", "closed"]),
		write: Schema.Literals(["comment", "flip"]),
		body: Schema.String.check(Schema.isPattern(/^[a-z]{1,10}( [a-z]{1,9}){0,3}$/)),
	});

	it("L4: comment, close and reopen answer with the selected ticket as that write left it, and the ledger agrees", async () => {
		await Effect.runPromise(
			holds(Arbitrary.schema(TrackerWrites), ({others, held, state, write, body}) =>
				Effect.gen(function* () {
					const rest = [...new Set(others)].filter((n) => n !== held);
					const ledger = yield* seeded([
						...rest.map((number) => ({number, state: "open" as const})),
						{number: held, state},
					]);
					const drive = yield* door(ledger);
					yield* drive.call("tracker_query", {value: {ticket: held}});
					const tool =
						write === "comment"
							? "tracker_comment"
							: state === "open"
								? "tracker_close"
								: "tracker_reopen";
					const value = write === "comment" ? {ticket: held, body} : {ticket: held};
					const view = viewOf(yield* drive.call(tool, {value}));
					const opened = Reflect.get(Object(Reflect.get(pageOf(view), "opened")), "ticket");
					const timeline: unknown = Reflect.get(Object(opened), "timeline");
					const last = Array.isArray(timeline) ? timeline.at(-1) : undefined;
					const fact = Reflect.get(Object(Reflect.get(Object(last), "fact")), "type");
					const wantFact =
						write === "comment" ? "commented" : state === "open" ? "closed" : "reopened";
					const wantState = write === "comment" ? state : state === "open" ? "closed" : "open";
					yield* same("the last fact the view shows", fact, wantFact);
					yield* same(
						"the ticket's state in the view",
						Reflect.get(Object(opened), "state"),
						wantState,
					);
					const rows = yield* ledger.readStream(streams(`tracker/ticket/${held}`).inbox);
					yield* same("the last fact on the ledger", rows.at(-1)?.kind, wantFact);
				}).pipe(Effect.scoped),
			),
		);
	});
});
