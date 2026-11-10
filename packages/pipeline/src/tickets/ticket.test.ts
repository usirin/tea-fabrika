import type {Row} from "@kampus/fabrika-old";
import {Schema} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {
	CodeFact,
	type Entry,
	type Fact,
	fold,
	liveRun,
	mayWrite,
	readRow,
	Said,
	Title,
	WRITTEN_BY,
} from "./ticket.ts";

// A ticket from its rows: what reads, what is broken, and what the fold makes of the facts.

const row = (over: Partial<Row> & {readonly fact?: Fact}): Row => {
	const {fact = {type: "filed", title: "Login fails", body: ""}, ...rest} = over;
	return {
		pos: 1,
		stream: "tracker/ticket/1/inbox",
		rev: 1,
		writer: "user:owner",
		kind: fact.type,
		at: 1000,
		data: JSON.stringify(fact),
		id: "m1",
		...rest,
	};
};

const owner = {kind: "user", id: "owner"} as const;

const entry = (pos: number, ticket: number, fact: Fact): Entry => ({
	pos,
	ticket,
	by: owner,
	at: pos * 1000,
	fact,
});

describe("a row", () => {
	it("in a ticket's inbox is a fact on that ticket, with who wrote it and when", () => {
		expect(readRow(row({stream: "tracker/ticket/12/inbox", writer: "agent:review"}))).toEqual({
			kind: "entry",
			entry: {
				pos: 1,
				ticket: 12,
				by: {kind: "agent", id: "review"},
				at: 1000,
				fact: {type: "filed", title: "Login fails", body: ""},
			},
		});
	});

	it("anywhere else is no ticket's fact: the name's registration, another program's stream", () => {
		expect(readRow(row({stream: "tracker/ticket/1", kind: "registered"}))).toEqual({
			kind: "other",
		});
		expect(readRow(row({stream: "tracker/ticket/0/inbox"}))).toEqual({kind: "other"});
		expect(readRow(row({stream: "pipeline/asks/inbox"}))).toEqual({kind: "other"});
	});

	const cases: readonly (readonly [string, Parameters<typeof row>[0], RegExp])[] = [
		["a writer that is neither a user nor an agent", {writer: "ledger"}, /neither a user/],
		["data that is no fact", {data: '{"type":"edited"}'}, /not a fact/],
		["data that is not JSON", {data: "filed"}, /not a fact/],
		["a fact kept under another kind", {kind: "closed"}, /a filed fact kept as closed/],
		["a blank title", {fact: {type: "filed", title: " ", body: ""}}, /not a fact/],
	];
	it.each(cases)("is broken with %s, and says where", (_, over, why) => {
		const read = readRow(row(over));
		expect(read.kind).toBe("broken");
		expect(read.kind === "broken" && read.why).toMatch(/^row 1 on #1: /);
		expect(read.kind === "broken" && read.why).toMatch(why);
	});
});

describe("the fold", () => {
	it("makes a ticket from its facts, oldest first, with closed and reopened as its state", () => {
		const entries = [
			entry(1, 1, {type: "filed", title: "Login fails", body: "On main."}),
			entry(2, 2, {type: "filed", title: "Docs typo", body: ""}),
			entry(3, 1, {type: "commented", body: "Seen it too."}),
			entry(4, 1, {type: "closed"}),
		];
		const {tickets, problems} = fold([], entries);
		expect(problems).toEqual([]);
		expect(tickets.map((t) => [t.number, t.title, t.state, t.timeline.length])).toEqual([
			[1, "Login fails", "closed", 3],
			[2, "Docs typo", "open", 1],
		]);
		const reopened = fold(tickets, [entry(5, 1, {type: "reopened"})]).tickets[0];
		expect(reopened?.state).toBe("open");
		expect(reopened?.timeline.map((e) => e.fact.type)).toEqual([
			"filed",
			"commented",
			"closed",
			"reopened",
		]);
	});

	it("keeps a fact that does not fit out of every ticket, and says why", () => {
		const {tickets, problems} = fold(
			[],
			[
				entry(1, 3, {type: "commented", body: "Early."}),
				entry(2, 3, {type: "filed", title: "Late", body: ""}),
				entry(3, 3, {type: "filed", title: "Again", body: ""}),
			],
		);
		expect(tickets.map((t) => [t.number, t.title, t.timeline.length])).toEqual([[3, "Late", 1]]);
		expect(problems).toEqual([
			"row 1 on #3: commented, but the ticket was never filed",
			"row 3 on #3: filed a second time",
		]);
	});
});

describe("a lane's facts", () => {
	const build = {kind: "agent", id: "build", for: "owner"} as const;
	const by = (pos: number, who: Entry["by"], fact: Fact): Entry => ({
		...entry(pos, 1, fact),
		by: who,
	});
	const filed = entry(1, 1, {type: "filed", title: "Login fails", body: ""});
	const asked = by(2, build, {
		type: "asked",
		ask: "a-1",
		what: "approve plan v2",
		picks: ["approve", "no"],
	});

	it("read from a row like the tracker's own four, each by its type", () => {
		const fact: Fact = {type: "asked", ask: "a-1", what: "approve plan v2", picks: ["approve"]};
		const read = readRow(row({fact, writer: "agent:plan for:owner"}));
		expect(read.kind === "entry" && read.entry.fact).toEqual(fact);
		const empty = readRow(row({data: JSON.stringify({...fact, picks: []}), kind: "asked"}));
		expect(empty.kind).toBe("broken");
	});

	it("keep an agent's answer out of every ticket: only a person answers an ask", () => {
		const {tickets, problems} = fold(
			[],
			[filed, asked, by(3, build, {type: "answered", ask: "a-1", pick: "approve", note: ""})],
		);
		expect(tickets[0]?.timeline.map((e) => e.fact.type)).toEqual(["filed", "asked"]);
		expect(problems).toEqual([
			"row 3 on #1: answered written by an agent, but only a person writes it",
		]);
		expect(WRITTEN_BY.answered).toBe("person");
		expect(mayWrite(build, "answered")).toBe(false);
		expect(mayWrite(owner, "answered")).toBe(true);
	});

	const misfits: readonly (readonly [string, readonly Entry[], string])[] = [
		[
			"an answer to an ask never asked",
			[filed, entry(2, 1, {type: "answered", ask: "a-9", pick: "approve", note: ""})],
			"an answer to ask a-9, which was never asked",
		],
		[
			"a second answer",
			[
				filed,
				asked,
				entry(3, 1, {type: "answered", ask: "a-1", pick: "approve", note: ""}),
				entry(4, 1, {type: "answered", ask: "a-1", pick: "no", note: ""}),
			],
			"ask a-1 answered a second time",
		],
		[
			"an answer that is not one of the picks",
			[filed, asked, entry(3, 1, {type: "answered", ask: "a-1", pick: "maybe", note: ""})],
			`"maybe" is not one of ask a-1's picks`,
		],
		[
			"a run that ends without a start",
			[
				filed,
				by(2, build, {
					type: "ended",
					run: "r-1",
					stage: "build",
					outcome: {kind: "done", part: false},
					usd: 0,
					input: 0,
					output: 0,
					turns: 1,
				}),
			],
			"run r-1 ended, but it never started",
		],
		[
			"a ticket hinted as a duplicate of itself",
			[filed, entry(2, 1, {type: "maybe_duplicate", of: 1, yes: 0.9})],
			"a ticket hinted as a duplicate of itself",
		],
		[
			"the same hint twice",
			[
				filed,
				entry(2, 1, {type: "maybe_duplicate", of: 4, yes: 0.9}),
				entry(3, 1, {type: "maybe_duplicate", of: 4, yes: 0.8}),
			],
			"#4 hinted as a duplicate a second time",
		],
		[
			"a word on a hint never given",
			[filed, entry(2, 1, {type: "duplicate_rated", of: 4, says: "accept"})],
			"a word on #4, which was never hinted as a duplicate",
		],
	];
	it("keep an agent's accept or dismiss out, and take a person's newest word", () => {
		const hint = entry(2, 1, {type: "maybe_duplicate", of: 4, yes: 0.9});
		const {tickets, problems} = fold(
			[],
			[
				filed,
				hint,
				by(3, build, {type: "duplicate_rated", of: 4, says: "accept"}),
				entry(4, 1, {type: "duplicate_rated", of: 4, says: "accept"}),
				entry(5, 1, {type: "duplicate_rated", of: 4, says: "dismiss"}),
			],
		);
		expect(problems).toEqual([
			"row 3 on #1: duplicate_rated written by an agent, but only a person writes it",
		]);
		expect(tickets[0]?.timeline.map((e) => e.fact.type)).toEqual([
			"filed",
			"maybe_duplicate",
			"duplicate_rated",
			"duplicate_rated",
		]);
		expect(tickets[0]?.state).toBe("open");
	});
	it.each(misfits)("keep %s out, and say why", (_, entries, why) => {
		const {problems} = fold([], entries);
		expect(problems.at(-1)).toMatch(why);
	});

	it("read a comment that asks for changes and an answer with its hash, and the rows from before", () => {
		const text = `sha256:${"a".repeat(64)}`;
		const facts: readonly Fact[] = [
			{type: "commented", body: "Skip part 2.", asks: "changes"},
			{type: "commented", body: "Seen it."},
			{type: "answered", ask: "a-1", pick: "approve", note: "", text},
			{type: "answered", ask: "a-1", pick: "approve", note: ""},
		];
		for (const fact of facts) {
			const read = readRow(row({fact}));
			expect(read.kind === "entry" && read.entry.fact).toEqual(fact);
		}
		const wrong = [
			{type: "commented", body: "Skip.", asks: "merge"},
			{type: "answered", ask: "a-1", pick: "approve", note: "", text: "sha256:short"},
		];
		for (const fact of wrong)
			expect(readRow(row({data: JSON.stringify(fact), kind: fact.type})).kind).toBe("broken");
	});

	// Self-fix PR 3: the error text exists only while the tests run, so the step's end keeps the names.
	describe("a step's end that names its failing tests", () => {
		const ended = (failed: readonly string[]) => ({
			type: "ended",
			run: "r-mutation-6",
			stage: "mutation",
			outcome: {kind: "send", to: "builder", why: "tests_red"},
			usd: 0,
			input: 0,
			output: 0,
			turns: 0,
			failed,
		});
		const name = (n: number) => `src/lower.test.ts > lower > case ${n}`;

		it("reads with each name, as written", () => {
			const fact = ended([name(1), name(2)]);
			const read = readRow(row({data: JSON.stringify(fact), kind: "ended"}));
			expect(read.kind === "entry" && read.entry.fact).toEqual(fact);
		});

		it("holds 50 names at most", () => {
			const fifty = ended(Array.from({length: 50}, (_, i) => name(i)));
			expect(readRow(row({data: JSON.stringify(fifty), kind: "ended"})).kind).toBe("entry");
			const more = ended(Array.from({length: 51}, (_, i) => name(i)));
			expect(readRow(row({data: JSON.stringify(more), kind: "ended"})).kind).toBe("broken");
		});

		it("an end from before the key still reads", () => {
			const {failed: _, ...before} = ended([]);
			expect(readRow(row({data: JSON.stringify(before), kind: "ended"})).kind).toBe("entry");
		});
	});

	// Tracker 193: the cause of a test writer's failed run on the base exists only as it fails.
	describe("a test writer's end whose run on the base failed", () => {
		const ended = (failure: unknown) => ({
			type: "ended",
			run: "r-test_writer-5",
			stage: "test_writer",
			outcome: {kind: "stuck", why: "run_failed"},
			usd: 0,
			input: 0,
			output: 0,
			turns: 0,
			failure,
		});

		it.each([
			{why: "no_report", code: 1, ms: 726_000, tail: "Error: boom"},
			{why: "box_failed", code: null, ms: 40, tail: "srt: could not start"},
		])("keeps the cause `$why` whole, its code, its time and its tail", (failure) => {
			const fact = ended(failure);
			expect(Schema.decodeUnknownSync(CodeFact)(fact)).toEqual(fact);
			const read = readRow(row({data: JSON.stringify(fact), kind: "ended"}));
			expect(read.kind === "entry" && read.entry.fact).toEqual(fact);
		});

		it.each([
			["no tail", {why: "no_report", code: 1, ms: 5}],
			["no time", {why: "no_report", code: 1, tail: ""}],
			["a code that is words", {why: "no_report", code: "one", ms: 5, tail: ""}],
		])("a cause with %s is broken", (_, failure) => {
			expect(readRow(row({data: JSON.stringify(ended(failure)), kind: "ended"})).kind).toBe(
				"broken",
			);
		});
	});

	// Self-fix PR 4: code runs `[build] checks` at the head after every build, and the ticket keeps
	// what it found. The mutation step that skips its own suite run on a green one says so on its end.
	describe("code's checks at a head", () => {
		const lane = {kind: "agent", id: "lane", for: "owner"} as const;
		const head = "c".repeat(40);
		const name = (n: number) => `src/clamp.test.ts > clamp > case ${n}`;
		const VITEST = "node_modules/.bin/vitest run --reporter=json --outputFile={out}";
		const checked = (result: string, failed: readonly string[] = []) => ({
			type: "checked",
			head,
			commands: [{command: VITEST, code: result === "green" ? 0 : 1, ms: 41_250}],
			result,
			failed,
		});

		it("read as a `checked` fact, green, red with its names, or not_run, and nothing else", () => {
			for (const fact of [
				checked("green"),
				checked("red", [name(1), name(2)]),
				checked("not_run"),
			]) {
				const read = readRow(
					row({data: JSON.stringify(fact), kind: "checked", writer: "agent:lane"}),
				);
				expect(read.kind === "entry" && read.entry.fact).toEqual(fact);
			}
			// Broken: a result that is not one of the three, a head that is not a sha, or 51 names.
			const wrong = [
				checked("skipped"),
				{...checked("green"), head: "main"},
				checked(
					"red",
					Array.from({length: 51}, (_, i) => name(i)),
				),
			];
			for (const fact of wrong)
				expect(readRow(row({data: JSON.stringify(fact), kind: "checked"})).kind).toBe("broken");
		});

		// The PR 4 review, record wide: each command's exit code and how long it took, which exist
		// only as it runs. `code: null`: it could not start, or ran past its time.
		it("keep each command's exit code and how long it took", () => {
			const fact = {
				...checked("not_run"),
				commands: [
					{command: "pnpm typecheck", code: 0, ms: 61_032},
					{command: VITEST, code: 1, ms: 1_204_118},
					{command: "pnpm lint", code: null, ms: 7},
				],
			};
			const read = readRow(
				row({data: JSON.stringify(fact), kind: "checked", writer: "agent:lane"}),
			);
			expect(read.kind === "entry" && read.entry.fact).toEqual(fact);
		});

		it.each([
			["a command with no exit code or time", {command: VITEST}],
			["an exit code that is not a whole number", {command: VITEST, code: 1.5, ms: 3}],
			["a time below zero", {command: VITEST, code: 0, ms: -1}],
			["a time that is not a whole number", {command: VITEST, code: 0, ms: 2.5}],
			["no command", {code: 0, ms: 3}],
			// No row was saved with the shape before codes and times, so it reads as nothing.
			["the command alone, as words", VITEST],
		])("a command written today with %s is broken", (_, command) => {
			const fact = {...checked("green"), commands: [command]};
			expect(readRow(row({data: JSON.stringify(fact), kind: "checked"})).kind).toBe("broken");
		});

		it("are code's to write: the lane may write one", () => {
			expect(mayWrite(lane, "checked" as Fact["type"])).toBe(true);
		});

		const mutationEnd = {
			type: "ended",
			run: "r-mutation-4",
			stage: "mutation",
			outcome: {kind: "done", part: false},
			usd: 0,
			input: 0,
			output: 0,
			turns: 0,
		};

		it("a mutation step's end names the green checks it trusted in place of its own suite run", () => {
			const {type: _, ...trusted} = checked("green");
			const fact = {...mutationEnd, trusted};
			const read = readRow(row({data: JSON.stringify(fact), kind: "ended"}));
			expect(read.kind === "entry" && read.entry.fact).toEqual(fact);
		});

		it("an end that trusted checks that were not green is broken: a skip is never on a red", () => {
			const {type: _, ...trusted} = checked("red", [name(1)]);
			const fact = {...mutationEnd, trusted};
			expect(readRow(row({data: JSON.stringify(fact), kind: "ended"})).kind).toBe("broken");
		});
	});
});

// Record wide (docs/plan/pipeline-self-fix.md, PR 7): what exists only while a run happens. A run's
// harness session id goes on its `started`, and a comment names the run that was live when it
// was written, as `during`. Both are new keys, so the rows written before them still read.
describe("what a lane records wide", () => {
	const lane = {kind: "agent", id: "lane", for: "owner"} as const;
	const by = (pos: number, who: Entry["by"], fact: Fact): Entry => ({
		...entry(pos, 1, fact),
		by: who,
	});
	const filed = entry(1, 1, {type: "filed", title: "Login fails", body: ""});
	const start = (pos: number, run: string): Entry =>
		by(pos, lane, {type: "started", run, stage: "build", task: null, log: null});
	const end = (pos: number, run: string): Entry =>
		by(pos, lane, {
			type: "ended",
			run,
			stage: "build",
			outcome: {kind: "done", part: false},
			usd: 0,
			input: 0,
			output: 0,
			turns: 1,
		});
	const said = (pos: number): Entry => entry(pos, 1, {type: "commented", body: "Skip part 2."});

	it("reads a run's session as a fact of its own, and keeps it off the start", () => {
		const fact = {type: "session", run: "r-build-1", id: "fake-build"};
		const read = readRow(row({data: JSON.stringify(fact), kind: "session"}));
		expect(read.kind === "entry" && read.entry.fact).toEqual(fact);
		const onStart = {
			type: "started",
			run: "r-build-1",
			stage: "build",
			task: null,
			log: null,
			session: "fake-build",
		};
		const started = readRow(row({data: JSON.stringify(onStart), kind: "started"}));
		expect(started.kind === "entry" && "session" in started.entry.fact).toBe(false);
	});

	it("takes a run's session once, after its start", () => {
		const session = (pos: number, run: string): Entry =>
			by(pos, lane, {type: "session", run, id: `fake-${run}`});
		expect(fold([], [filed, start(2, "r-build-1"), session(3, "r-build-1")]).problems).toEqual([]);
		expect(fold([], [filed, session(2, "r-build-1")]).problems).toEqual([
			"row 2 on #1: run r-build-1 opened a session, but it never started",
		]);
		expect(
			fold([], [filed, start(2, "r-build-1"), session(3, "r-build-1"), session(4, "r-build-1")])
				.problems,
		).toEqual(["row 4 on #1: run r-build-1 opened a session a second time"]);
	});

	it("names the live run from its start alone, before its session opens", () => {
		expect(liveRun([filed, start(2, "r-build-1")])).toBe("r-build-1");
	});

	it("reads a comment with the run it was written during, and a comment from before it", () => {
		const facts = [
			{type: "commented", body: "Skip part 2.", during: "r-build-1"},
			{type: "commented", body: "Skip part 2.", asks: "changes", during: "r-build-1"},
			{type: "commented", body: "Seen it."},
		];
		for (const fact of facts) {
			const read = readRow(row({data: JSON.stringify(fact), kind: "commented"}));
			expect(read.kind === "entry" && read.entry.fact).toEqual(fact);
		}
		const spaced = {type: "commented", body: "Skip.", during: "r build 1"};
		expect(readRow(row({data: JSON.stringify(spaced), kind: "commented"})).kind).toBe("broken");
	});

	it("names the live run: the ticket's last start with no end", () => {
		expect(liveRun([filed])).toBeNull();
		expect(liveRun([filed, start(2, "r-build-1")])).toBe("r-build-1");
		expect(liveRun([filed, start(2, "r-build-1"), said(3)])).toBe("r-build-1");
		expect(liveRun([filed, start(2, "r-build-1"), end(3, "r-build-1")])).toBeNull();
		expect(
			liveRun([filed, start(2, "r-build-1"), end(3, "r-build-1"), start(4, "r-review-1")]),
		).toBe("r-review-1");
	});

	it("names no run once a later run ended, though an earlier one never did: that one died", () => {
		// r-build-1 crashed with no end; the lane restarted and r-build-2 ran to its end.
		const timeline = [filed, start(2, "r-build-1"), start(3, "r-build-2"), end(4, "r-build-2")];
		expect(liveRun(timeline)).toBeNull();
	});

	it("names the last start, if and only if that run has not ended, on any timeline that folds", () => {
		const step = fc.record({kind: fc.constantFrom("start", "end", "said"), pick: fc.nat()});
		fc.assert(
			fc.property(fc.array(step, {maxLength: 16}), (steps) => {
				// Only what the fold keeps: each run starts once, and ends once, after its start.
				const timeline: Entry[] = [filed];
				const open: string[] = [];
				let runs = 0;
				for (const {kind, pick} of steps) {
					const pos = timeline.length + 1;
					if (kind === "start") {
						runs += 1;
						open.push(`r-build-${runs}`);
						timeline.push(start(pos, `r-build-${runs}`));
					} else if (kind === "end" && open.length > 0) {
						const [run = ""] = open.splice(pick % open.length, 1);
						timeline.push(end(pos, run));
					} else timeline.push(said(pos));
				}
				expect(fold([], timeline).problems).toEqual([]);
				// The model: the last start, unless an end after it names the same run.
				const at = timeline.findLastIndex((e) => e.fact.type === "started");
				const last = timeline[at]?.fact;
				const run = last?.type === "started" ? last.run : null;
				const ended = timeline
					.slice(at + 1)
					.some((e) => e.fact.type === "ended" && e.fact.run === run);
				expect(liveRun(timeline)).toBe(run === null || ended ? null : run);
			}),
			{numRuns: 300, seed: 119120},
		);
	});
});

describe("what a person may write", () => {
	it("is a title on one trimmed line, and a comment with something in it", () => {
		const isTitle = Schema.is(Title);
		const isSaid = Schema.is(Said);
		expect(["Login fails", "", " x", "a\nb", "x".repeat(257)].map((t) => isTitle(t))).toEqual([
			true,
			false,
			false,
			false,
			false,
		]);
		expect([isSaid("ok"), isSaid("  \n "), isSaid("")]).toEqual([true, false, false]);
	});
});

// Self-fix PR 10, Part 4: a yes binds to the diff, not the commit. Each of these exists only when it
// happens, so it is written then: what the person saw, and what the review read.
describe("what a yes was given on", () => {
	const HEAD = "a".repeat(40);
	const ONTO = "main";
	const BASE = "b".repeat(40);
	const DIFF = "d".repeat(40);
	const EXAM_PR = "local:example/lane/pull/1";
	const read = (fact: object, kind: string, writer = "agent:lane") =>
		readRow(row({data: JSON.stringify(fact), kind, writer}));
	const kept = (fact: object, kind: string, writer?: string) => {
		const got = read(fact, kind, writer);
		expect(got.kind === "entry" && got.entry.fact).toEqual(fact);
	};

	it("an ask keeps the head the person was shown", () => {
		kept(
			{
				type: "asked",
				ask: "a-exam_merge-9",
				what: "Merge the rule changes?",
				picks: ["merge", "no"],
				head: HEAD,
			},
			"asked",
		);
	});

	it("a review keeps its pull request, the branch it went onto, its base and its diff's id", () => {
		kept(
			{
				type: "reviewed",
				head: HEAD,
				met: 1,
				of: 1,
				findings: [],
				pr: EXAM_PR,
				onto: ONTO,
				base: BASE,
				diff: DIFF,
			},
			"reviewed",
		);
	});

	it("a person's merge keeps the head, branch, base and diff's id they said yes to", () => {
		kept(
			{
				type: "answered",
				ask: "a-exam_merge-9",
				pick: "merge",
				note: "",
				head: HEAD,
				onto: ONTO,
				base: BASE,
				diff: DIFF,
			},
			"answered",
			"user:owner",
		);
	});

	it("an exam head's checks keep its pull request, so the lane never reads them as its own", () => {
		kept(
			{type: "checked", head: HEAD, commands: [], result: "green", failed: [], pr: EXAM_PR},
			"checked",
		);
	});

	it("a carried yes is a fact of its own: from which head, to which, and why", () => {
		for (const why of ["same_head", "replayed", "formatted", "glanced"])
			kept({type: "carried", from: HEAD, to: "c".repeat(40), why}, "carried");
	});

	it("a carried yes is code's to write, never only a person's", () => {
		expect(mayWrite({kind: "agent", id: "lane", for: "owner"}, "carried" as Fact["type"])).toBe(
			true,
		);
		expect((WRITTEN_BY as Record<string, string>)["carried"]).toBe("anyone");
	});

	it("a carried yes to a head that is not a sha is broken", () => {
		expect(read({type: "carried", from: HEAD, to: "main", why: "replayed"}, "carried").kind).toBe(
			"broken",
		);
	});
});

// Ticket 196: a filing records where it came from (docs/direction/a-ticket-says-where-it-came-from.md).
// Each case is the shape one of tickets 186 to 195 needed. The run ids and PR numbers are the real
// ones; the comment anchors and the exam_review run's id are made up.
describe("a filing that says where it came from", () => {
	const REPO = "https://github.com/usirin/tea-fabrika";
	const filedRow = (data: object) =>
		row({
			kind: "filed",
			data: JSON.stringify({type: "filed", title: "Login fails", body: "", ...data}),
		});
	const factRead = (data: object) => {
		const read = readRow(filedRow(data));
		return read.kind === "entry" ? read.entry.fact : read;
	};

	// p1
	it("with no `from` reads and folds as it did before the key, with no `from` made up", () => {
		const fact = factRead({});
		expect(fact).toStrictEqual({type: "filed", title: "Login fails", body: ""});
		const read = readRow(filedRow({}));
		const {tickets, problems} = fold([], read.kind === "entry" ? [read.entry] : []);
		expect(problems).toEqual([]);
		expect(tickets.map((t) => [t.number, t.title, t.timeline[0]?.fact])).toEqual([
			[1, "Login fails", {type: "filed", title: "Login fails", body: ""}],
		]);
	});

	// p2
	const cases: readonly (readonly [string, object])[] = [
		["a pull request's step (188)", {_tag: "pr", url: `${REPO}/pull/352`, step: "mutation"}],
		[
			"a review comment on a pull request (186)",
			{_tag: "pr", url: `${REPO}/pull/357#discussion_r1001`, step: "review"},
		],
		["a pull request, no step named", {_tag: "pr", url: `${REPO}/pull/352`}],
		["a lane run (193)", {_tag: "run", ticket: 117, run: "r-test_writer-26"}],
		[
			"a lane run at a head (194)",
			{_tag: "run", ticket: 117, run: "r-test_writer-25", head: "b5b969a0"},
		],
		["a walk of a pull request (191)", {_tag: "walk", url: `${REPO}/pull/332`}],
	];
	it.each(cases)("from %s reads back as written, `_tag` and all", (_, from) => {
		expect(factRead({from})).toStrictEqual({type: "filed", title: "Login fails", body: "", from});
	});

	it("keeps its `from` on the ticket the fold makes", () => {
		const from = {_tag: "walk", url: `${REPO}/pull/361`};
		const read = readRow(filedRow({from}));
		const [ticket] = fold([], read.kind === "entry" ? [read.entry] : []).tickets;
		expect(ticket?.timeline[0]?.fact).toStrictEqual({
			type: "filed",
			title: "Login fails",
			body: "",
			from,
		});
	});

	// p4
	const bad: readonly (readonly [string, object])[] = [
		["an unknown case", {_tag: "job", url: `${REPO}/pull/352`}],
		["a `pr` url that is an issue, not a pull request", {_tag: "pr", url: `${REPO}/issues/352`}],
		["a `pr` url on another host", {_tag: "pr", url: "https://gitlab.com/a/b/pull/3"}],
		["a `pr` step that is no stage's name", {_tag: "pr", url: `${REPO}/pull/352`, step: "Re view"}],
		["a `run` on ticket 0", {_tag: "run", ticket: 0, run: "r-1"}],
		["a `run` with no run id", {_tag: "run", ticket: 117}],
		["a `run` at a short sha", {_tag: "run", ticket: 117, run: "r-1", head: "b5b96"}],
		["a `walk` with no url", {_tag: "walk", pr: 332}],
		["a `walk` url that is not https", {_tag: "walk", url: "http://example.com/x"}],
		["no `_tag`", {url: `${REPO}/pull/352`}],
		// Each pattern holds the whole value: nothing before the address, nothing after it.
		["a `pr` url with words before it", {_tag: "pr", url: `see ${REPO}/pull/352`}],
		["a `pr` url with words after it", {_tag: "pr", url: `${REPO}/pull/352 and more`}],
		["a `pr` number run on into letters", {_tag: "pr", url: `${REPO}/pull/352abc`}],
		["a `walk` url with words before it", {_tag: "walk", url: "see https://example.com/x"}],
		["a `walk` url with words after it", {_tag: "walk", url: "https://example.com/x and more"}],
	];
	it.each(bad)("with %s is a broken row, and says where", (_, from) => {
		const read = readRow(filedRow({from}));
		expect(read.kind).toBe("broken");
		expect(read.kind === "broken" && read.why).toMatch(/^row 1 on #1: its data is not a fact/);
	});
});
