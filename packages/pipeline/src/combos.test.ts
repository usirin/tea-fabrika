import {createDraft, type DraftMsg, noSpend} from "@kampus/fabrika/agents/claude";
import {describe, expect, it} from "vitest";
import {z} from "zod";
import {
	type Children,
	covers,
	createAsk,
	createRefineLoop,
	gateCheck,
	gateJudge,
	hashOf,
	inFlight,
	nextTry,
	remember,
	sessionOf,
	slotSubs,
	spawn,
	stepChild,
	written,
} from "./combos.ts";
import {act, createJudge, gather, intentOf} from "./primitives.ts";
import {sentBack} from "./refine.ts";

// The primitives and the combos on their own, with no engine: each is data
// and pure functions, stepped here by hand the way a parent steps them.

describe("the primitives", () => {
	it("an Act carries the intent its model named; a Gather carries none", () => {
		const write = act("note_write", {
			input: z.object({text: z.string()}),
			ok: z.null(),
			err: ["unknown"],
		});
		const read = gather("note_read", {
			input: z.object({id: z.string()}),
			ok: z.string(),
			err: ["unknown"],
		});

		expect(write({text: "hi", intent: intentOf("run-1", 3, "issue", "note")})).toEqual({
			type: "note_write",
			text: "hi",
			intent: "run-1/3/issue/note",
		});
		expect(read({id: "a"})).toEqual({type: "note_read", id: "a"});
	});

	it("a Judge's floor is applied by its rule, in update: below it is unsure", () => {
		const judge = createJudge({
			name: "kind",
			instructions: "Which kind?",
			choices: {a: "the first", b: "the second"},
		});

		expect(judge.ask({key: "k", texts: {text: "t"}})).toEqual({
			type: "kind_judge",
			key: "k",
			texts: {text: "t"},
		});
		expect(judge.rule({choice: "a", confidence: 0.81}, 0.8)).toEqual({
			sure: true,
			choice: "a",
			confidence: 0.81,
		});
		expect(judge.rule({choice: "a", confidence: 0.79}, 0.8)).toEqual({
			sure: false,
			best: "a",
			confidence: 0.79,
		});
	});

	it("a conversation is named from where it stands, the same on every replay, as a UUID", () => {
		expect(sessionOf("run-1/1/issue/shell")).toBe(sessionOf("run-1/1/issue/shell"));
		expect(sessionOf("run-1/1/issue/shell")).not.toBe(sessionOf("run-1/2/issue/shell"));
		expect(sessionOf("x")).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
		);
	});

	it("a Draft reads the SDK's result into a typed answer, `null` when it does not fit, and a failure when it errs", () => {
		const draft = createDraft({name: "poem", output: z.object({lines: z.array(z.string())})});
		const run = {
			key: "k",
			id: "k/1",
			prompt: "p",
			session: {id: "s", continues: false},
			agent: null,
			folder: null,
		};
		const result = (fields: object) =>
			draft.msgsOf(
				{
					type: "result",
					subtype: "success",
					is_error: false,
					total_cost_usd: 0.02,
					num_turns: 3,
					duration_ms: 30_000,
					session_id: "s",
					usage: {
						input_tokens: 10,
						output_tokens: 5,
						cache_creation_input_tokens: 0,
						cache_read_input_tokens: 85,
					},
					...fields,
				} as never,
				run,
			);

		expect(result({structured_output: {lines: ["tea"]}})).toEqual([
			{
				type: "poem_finished",
				key: "k",
				id: "k/1",
				output: {lines: ["tea"]},
				session: "s",
				spend: {costUsd: 0.02, tokens: 100, context: 0, turns: 3, minutes: 0.5},
			},
		]);
		expect(result({structured_output: {lines: "tea"}})[0]).toMatchObject({
			type: "poem_finished",
			output: null,
		});
		// No structured output: the last object in the closing text that fits the schema is the answer.
		expect(
			result({result: 'Done. {"note": 1}\n```json\n{"lines": ["kettle"]}\n```\nBYE'})[0],
		).toMatchObject({
			output: {lines: ["kettle"]},
		});
		expect(result({result: "Done, with no object at all."})[0]).toMatchObject({output: null});
		expect(result({subtype: "error_max_turns", is_error: true})[0]).toMatchObject({
			type: "poem_failed",
			error: "error_max_turns (error)",
		});
	});
});

describe("gate", () => {
	it("passes a Check with no problems, and parks one with any", () => {
		expect(gateCheck([])).toEqual({pass: true});
		expect(gateCheck(["too long"])).toEqual({pass: false, why: ["too long"]});
	});

	it("passes a sure Judge answer among the passing ones, and parks the rest", () => {
		expect(gateJudge({sure: true, choice: "keep", confidence: 0.9}, ["keep"])).toEqual({
			pass: true,
		});
		expect(gateJudge({sure: true, choice: "drop", confidence: 0.9}, ["keep"]).pass).toBe(false);
		expect(gateJudge({sure: false, best: "keep", confidence: 0.5}, ["keep"]).pass).toBe(false);
	});
});

describe("remember", () => {
	it("writes, then reads back, and a restart sends whichever was in flight", () => {
		const write = {type: "w", intent: "i"} as const;
		const read = {type: "r"} as const;
		const [writing, first] = remember(write, read);
		const [reading, second] = written(writing);

		expect([first, second]).toEqual([[write], [read]]);
		expect([inFlight(writing), inFlight(reading)]).toEqual([write, read]);
	});
});

describe("refine: Draft and Check in a loop", () => {
	const draft = createDraft({name: "poem", output: z.object({lines: z.array(z.string())})});
	const loop = createRefineLoop({
		draft,
		check: (out: {lines: string[]}) =>
			out.lines.flatMap((l, i) => (l.split(" ").length > 3 ? [`line ${i + 1} is long`] : [])),
		prompt: (brief: string, note) => (note === null ? `Write about ${brief}.` : note),
		agent: "poet",
		folder: null,
	});
	const finished = (id: string, lines: string[] | null): DraftMsg<"poem", {lines: string[]}> => ({
		type: "poem_finished",
		key: "k",
		id,
		output: lines === null ? null : {lines},
		session: "s",
		spend: noSpend,
	});

	it("drafts, sends the Check's problems back in the same conversation, and is done once they are fixed", () => {
		const first = loop.start("k", "tea", 3);
		expect(loop.runOf(first)).toMatchObject({
			id: "k/1",
			prompt: "Write about tea.",
			agent: "poet",
			session: {continues: false},
		});

		const second = loop.update(first, finished("k/1", ["the kettle sings a song"]));
		expect(loop.runOf(second)).toMatchObject({
			id: "k/2",
			prompt: sentBack(["line 1 is long"]),
			session: {id: sessionOf("k"), continues: true},
		});

		expect(loop.update(second, finished("k/2", ["kettle sings"]))).toEqual({
			phase: "done",
			output: {lines: ["kettle sings"]},
			tries: 2,
			session: "s",
		});
	});

	it("stops out of tries with the last draft, fails on an answer that does not fit, and ignores a late answer", () => {
		const one = loop.start("k", "tea", 1);
		expect(loop.update(one, finished("k/1", ["a b c d e"]))).toMatchObject({
			phase: "out_of_tries",
			problems: ["line 1 is long"],
		});
		expect(loop.update(one, finished("k/1", null))).toMatchObject({phase: "failed"});
		expect(loop.update(one, finished("k/0", ["ok"]))).toBe(one);
		expect(loop.runOf(loop.update(one, finished("k/1", ["ok"])))).toBeNull();
	});

	it("the rule both loops share: no problems is done, problems with tries left go again told them, none left keeps them", () => {
		expect(nextTry([], 1, 2)).toEqual({go: "done"});
		expect(nextTry(["a", "b"], 1, 2)).toEqual({go: "again", tries: 2, note: sentBack(["a", "b"])});
		expect(nextTry(["a"], 1, 2, (p) => `told: ${p.join(",")}`)).toEqual({
			go: "again",
			tries: 2,
			note: "told: a",
		});
		expect(nextTry(["a", "b"], 2, 2)).toEqual({go: "out_of_tries", problems: ["a", "b"]});
	});
});

describe("ask: a question, the replies, a typed answer", () => {
	const ask = createAsk({
		name: "q",
		judge: createJudge({
			name: "q_read",
			instructions: "Which?",
			choices: {yes: "Go ahead", no: "Stop"},
		}),
	});
	const question = {
		where: "issue-1",
		text: "Go on?",
		about: "The plan, version 2.",
		who: ["owner"],
		floor: 0.8,
	};
	const reply = (author: string, body: string, at: number) => ({id: `${at}`, author, body, at});
	const waiting = () => ask.posted(ask.start("k", question, "run/ask")[0], "thread-1", 100);

	it("posts once, with the choices under the question, then listens after its own post", () => {
		const [posting, cmds] = ask.start("k", question, "run/ask");

		expect(cmds[0]).toMatchObject({type: "q_post", key: "k", where: "issue-1", intent: "run/ask"});
		expect(cmds[0]?.text).toContain("`/yes`: Go ahead");
		expect(ask.asked(posting)).toBe(cmds[0]);
		expect(ask.listening(waiting())).toEqual({key: "k", thread: "thread-1", after: 100});
	});

	it("reads `/choice` by code, passes over a stranger, and skips a reply it has read", () => {
		const [stranger] = ask.replied(waiting(), reply("someone", "/no", 200));
		expect(stranger).toMatchObject({phase: "waiting", after: 200});
		expect(ask.replied(stranger, reply("owner", "/yes", 150))).toEqual([stranger, []]);

		const [answered, cmds] = ask.replied(stranger, reply("owner", "/yes please", 300));
		expect(answered).toMatchObject({phase: "answered", choice: "yes", by: "code"});
		expect(cmds).toEqual([]);
	});

	it("knows a person by their login in any case", () => {
		expect(ask.replied(waiting(), reply("Owner", "/yes", 200))[0]).toMatchObject({
			phase: "answered",
			choice: "yes",
		});
		const listed = ask.posted(
			ask.start("k", {...question, who: ["OWNER"]}, "run/ask")[0],
			"thread-1",
			100,
		);
		expect(ask.replied(listed, reply("owner", "/no", 200))[0]).toMatchObject({
			phase: "answered",
			choice: "no",
		});
	});

	it("asks a Judge about a reply in words, takes a sure reading, and goes back to waiting on an unsure one", () => {
		const [reading, cmds] = ask.replied(waiting(), reply("owner", "sure, carry on", 200));
		expect(cmds).toEqual([
			{type: "q_read_judge", key: "k", texts: {question: "Go on?", reply: "sure, carry on"}},
		]);

		expect(ask.read(reading, {sure: true, choice: "yes", confidence: 0.9})).toMatchObject({
			phase: "answered",
			choice: "yes",
			by: "jev",
		});
		expect(ask.read(reading, {sure: false, best: "yes", confidence: 0.5})).toMatchObject({
			phase: "waiting",
			after: 200,
		});
		expect(ask.unread(reading)).toMatchObject({phase: "waiting", after: 200});
	});

	describe("a yes covers what it was about", () => {
		const yes = (q = question) => {
			const asked = ask.posted(ask.start("k", q, "run/ask")[0], "thread-1", 100);
			const [answered] = ask.replied(asked, reply("owner", "/yes", 200));
			if (answered.phase !== "answered") throw new Error("not answered");
			return answered;
		};

		it("keeps the hash of the subject, by code or by Jev", () => {
			expect(yes().saw).toMatch(/^sha256:[0-9a-f]{64}$/);
			expect(covers(yes(), "The plan, version 2.")).toBe(true);

			const [reading] = ask.replied(waiting(), reply("owner", "sure", 200));
			const read = ask.read(reading, {sure: true, choice: "yes", confidence: 0.9});
			expect(read).toMatchObject({phase: "answered", saw: yes().saw});
		});

		it("does not cover the subject once one character changes: the ask goes out again", () => {
			expect(covers(yes(), "The plan, version 2!")).toBe(false);
		});

		it("covers the subject, not the question's words", () => {
			expect(covers(yes(), question.text)).toBe(false);
			expect(yes({...question, text: "Approve plan v2? See the link."}).saw).toBe(yes().saw);
		});

		it("names the same hash on a replay", () => {
			const again = ask.start("k", question, "run/ask")[0];
			expect(again.saw).toBe(yes().saw);
			expect(again.saw).toBe(hashOf("The plan, version 2."));
			expect(hashOf("abc")).toBe(
				"sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
			);
		});
	});
});

describe("spawn: a child per item", () => {
	type Child = {readonly n: number; readonly wants: string | null};

	it("gives each child the lowest free slot for life, and refuses one more than the slots", () => {
		let children: Children<Child> = {};
		for (const key of ["a", "b"])
			children = spawn(children, key, {n: 0, wants: key}, 2) ?? children;

		expect([children.a?.slot, children.b?.slot]).toEqual([0, 1]);
		expect(spawn(children, "c", {n: 0, wants: "c"}, 2)).toBeNull();
		expect(spawn(children, "a", {n: 9, wants: null}, 2)).toBe(children);
	});

	it("steps one child, and leaves an answer for no child alone", () => {
		const children: Children<Child> = {a: {slot: 0, state: {n: 0, wants: null}}};
		const [next, cmds] = stepChild(children, "a", (s) => [{...s, n: s.n + 1}, ["cmd"]]);

		expect(next.a).toEqual({slot: 0, state: {n: 1, wants: null}});
		expect(cmds).toEqual(["cmd"]);
		expect(stepChild(children, "zz", (s) => [s, ["cmd"]])).toEqual([children, []]);
	});

	it("takes a key named as a plain object's own names as any other key", () => {
		const none: Children<Child> = {};
		expect(stepChild(none, "constructor", (s) => [s, ["cmd"]])).toEqual([none, []]);
		let children = none;
		for (const key of ["constructor", "__proto__"])
			children = spawn(children, key, {n: 0, wants: key}, 2) ?? children;

		expect(Object.entries(children)).toEqual([
			["constructor", {slot: 0, state: {n: 0, wants: "constructor"}}],
			["__proto__", {slot: 1, state: {n: 0, wants: "__proto__"}}],
		]);
		const [next, cmds] = stepChild(children, "__proto__", (s) => [{...s, n: s.n + 1}, ["cmd"]]);
		expect(Object.entries(next)[1]).toEqual([
			"__proto__",
			{slot: 1, state: {n: 1, wants: "__proto__"}},
		]);
		expect(cmds).toEqual(["cmd"]);
	});

	it("lifts a kind of child Sub into one entry per slot, so a sibling ending never moves another's Sub", () => {
		const entries = slotSubs(
			2,
			"watch",
			(p: {children: Children<Child>}) => p.children,
			(k: Child) => k.wants,
		);
		const both = {
			children: {a: {slot: 0, state: {n: 0, wants: "x"}}, b: {slot: 1, state: {n: 0, wants: "y"}}},
		};
		const onlyB = {children: {b: {slot: 1, state: {n: 0, wants: "y"}}}};

		expect(entries.map((e) => e.deps(both))).toEqual(["x", "y"]);
		expect(entries.map((e) => e.deps(onlyB))).toEqual([null, "y"]);
	});
});
