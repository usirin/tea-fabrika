import {
	ear,
	type Given,
	memoryStorage,
	type RunOf,
	type Storage,
	start,
	tell,
} from "@kampus/fabrika";
import {Deferred, Effect, Layer} from "effect";
import {describe, expect, it} from "vitest";
import {criterionId} from "../../ids.ts";
import {AcpBuilder} from "./builder-acp.ts";
import type {BuildDrafted} from "./form.ts";
import {type Built, buildProgram} from "./program.ts";
import {built, builtBy, scriptedBuilder} from "./scripted.ts";
import {BuildHost, BuildWrites} from "./services.ts";
import {numberOf, type Ticket} from "./ticket.ts";

// The build program, started from code: the machine and its handlers are the
// real ones; the builder is scripted, and the repository is a fake that keeps
// every write.

const REPO = "https://github.com/acme/widgets";
const TICKET = `${REPO}/issues/1`;
const PR = `${REPO}/pull/9`;
const FLAGS = {model: "opus", effort: "medium", budget: 1, harness: undefined} as const;
const RAN = {
	spend: {costUsd: 0.5, tokens: 1, context: 1, turns: 1, minutes: 0.1},
	tools: [],
	refused: [],
	links: 0,
};

const ready: Ticket = {
	url: TICKET,
	number: 1,
	state: "open",
	title: "stop() hangs",
	body: "- [ ] it ends",
	plan: "approved",
	criteria: [{id: criterionId("c1"), version: 1, text: "it ends", checked: false, evidence: null}],
	prs: [],
	rules: [],
};

function world(
	ticket: Ticket,
	answer: (at: number) => BuildDrafted | Effect.Effect<BuildDrafted>,
	more: {readonly changed?: boolean} = {},
) {
	const writes: string[] = [];
	const bodies: string[] = [];
	const host = Layer.succeed(BuildHost, {ticket: () => Effect.succeed(ticket)});
	const sandbox = Layer.succeed(BuildWrites, {
		copy: (_, n) =>
			Effect.sync(() => {
				writes.push("copy");
				return {tree: `/work/trees/${n}`, branch: `build/${n}`, base: "b".repeat(40)};
			}),
		push: (_, __, message) =>
			Effect.sync(() => {
				writes.push(`push ${message.split("\n")[0]}`);
				return more.changed === false
					? {head: "b".repeat(40), changed: false}
					: {head: "h".repeat(40), changed: true};
			}),
		open: (_, __, ___, body) =>
			Effect.sync(() => {
				writes.push("open");
				bodies.push(body);
				return PR;
			}),
	});
	const builder = scriptedBuilder((_, at) => answer(at));
	return {
		services: Layer.mergeAll(host, sandbox, builder.layer),
		writes,
		bodies,
		briefs: builder.briefs,
	};
}

type BuildRun = RunOf<typeof buildProgram>;
const once = <A, E>(
	w: {readonly services: ReturnType<typeof world>["services"]},
	storage: Storage,
	body: (
		run: BuildRun,
		heard: {built: ReturnType<typeof ear<Built>>; opened: ReturnType<typeof ear<string>>},
		close: (n: "ticket") => void,
	) => Effect.Effect<A, E>,
	flags: Given<typeof buildProgram.flags> = FLAGS,
) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const builtEar = ear<Built>();
			const opened = ear<string>();
			const started = yield* start(
				buildProgram,
				flags,
				{built: builtEar.hear, opened: opened.hear},
				{id: "build:test", storage},
			);
			if (started.kind !== "running") return yield* Effect.die(`did not start: ${started.why}`);
			return yield* body(started.run, {built: builtEar, opened}, started.close);
		}).pipe(Effect.scoped, Effect.provide(w.services), Effect.timeout("5 seconds")),
	);

const one = (w: ReturnType<typeof world>) =>
	once(w, memoryStorage(), (run, heard, close) =>
		Effect.gen(function* () {
			yield* tell(run, "ticket", TICKET);
			close("ticket");
			yield* run.ended;
			return {end: heard.built.values[0] as Built, opened: heard.opened.values};
		}),
	);

const form = (summary: string, deviations: string[] = []) =>
	built({...builtBy(summary), deviations, ran: [{command: "pnpm test", passed: true}]});

describe("build: the user's job", () => {
	it("a ready ticket: one run, a commit pushed, a pull request opened whose text closes the ticket and lists the deviations", async () => {
		const w = world(ready, () => form("It ends now.", ["Kept the old name."]));
		const {end, opened} = await one(w);
		expect(end.name).toBe("done");
		expect(end.outcome).toMatchObject({kind: "done", pr: PR, changed: true});
		expect(opened).toEqual([PR]);
		expect(w.writes).toEqual(["copy", "push build: stop() hangs (round 1)", "open"]);
		const body = w.bodies[0] ?? "";
		expect(body.startsWith("Closes #1\n")).toBe(true);
		expect(body).toContain("## Deviations\n\n- Kept the old name.");
		expect(body).toContain("`pnpm test`: passed");
	});

	it("a ticket whose plan is not approved is skipped: no copy, no run, no write", async () => {
		const w = world({...ready, plan: "not_approved"}, () => form("x"));
		const {end, opened} = await one(w);
		expect(end.name).toBe("skip:not_ready");
		expect(w.writes).toEqual([]);
		expect(w.briefs).toEqual([]);
		expect(opened).toEqual([]);
	});

	it("a builder over its budget: stuck, and nothing is pushed", async () => {
		const w = world(ready, () => ({answer: "over_budget", ...RAN}));
		const {end} = await one(w);
		expect(end.name).toBe("stuck:over_budget");
		expect(w.writes).toEqual(["copy"]);
	});

	it("a builder that changed nothing, with no pull request open: stuck on no_change, and none is opened", async () => {
		const w = world(ready, () => form("Nothing to do."), {changed: false});
		const {end} = await one(w);
		expect(end.name).toBe("stuck:no_change");
		expect(w.writes.filter((x) => x === "open")).toEqual([]);
	});

	it("a url that is not a ticket is refused when it is decoded, and nothing is read or written", async () => {
		const w = world(ready, () => form("x"));
		const words = await once(w, memoryStorage(), (run) =>
			Effect.all([tell(run, "ticket", `${REPO}/pull/670`)], {concurrency: 1}),
		);
		expect(words).toEqual(["bad_shape"]);
		expect(w.writes).toEqual([]);
	});
});

describe("build: kept across a restart", () => {
	it("cut off mid run, told the ticket again: the copy is not made again, the builder runs once more, and one pull request is opened", async () => {
		const storage = memoryStorage();
		const started = Deferred.makeUnsafe<void>();
		const before = world(ready, () =>
			Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
		);
		await once(before, storage, (run) =>
			Effect.gen(function* () {
				yield* tell(run, "ticket", TICKET);
				yield* Deferred.await(started);
			}),
		);
		expect(before.writes).toEqual(["copy"]);

		const after = world(ready, () => form("It ends now."));
		const {end} = await once(after, storage, (run, heard, close) =>
			Effect.gen(function* () {
				yield* tell(run, "ticket", TICKET);
				close("ticket");
				const [e] = yield* heard.built.upTo(1);
				return {end: e as Built};
			}),
		);
		expect(end.name).toBe("done");
		// The copy was made before the cut: it is not made again, the builder runs once more, and one pull request is opened.
		expect(after.writes).toEqual(["push build: stop() hangs (round 1)", "open"]);
		expect(after.briefs).toHaveLength(1);
		// The builder started again is handed the round's conversation the first one had, so it can carry it on.
		expect(before.briefs).toHaveLength(1);
		expect(after.briefs[0]?.session).toBe(before.briefs[0]?.session);
		expect(after.briefs[0]?.session).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-/);
	});

	it("three tickets told and the input closed, cut off mid second and again mid third: starts nobody can tell carry every ticket to its end, each built once", async () => {
		const storage = memoryStorage();
		const tickets = [1, 2, 3].map((n) => `${REPO}/issues/${n}`);
		// Each life builds tickets below `cut`, and is cut off once the builder of ticket `cut` starts.
		const lives = [2, 3, 0].map((cut) => ({cut, started: Deferred.makeUnsafe<void>()}));
		const worlds = lives.map(({cut, started}) =>
			many((n) =>
				n === cut
					? Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
					: form(`Built ${n}.`),
			),
		);
		const built: string[][] = [];
		for (const [i, w] of worlds.entries()) {
			const life = lives[i];
			if (life === undefined) throw new Error("no life");
			built.push(
				await once(w, storage, (run, heard, close) =>
					Effect.gen(function* () {
						// Only the first start is told anything. The input it closes stays closed in the storage.
						if (i === 0) {
							for (const t of tickets) yield* tell(run, "ticket", t);
							close("ticket");
						}
						if (life.cut === 0) yield* run.ended;
						else yield* Deferred.await(life.started);
						return heard.built.values.map((b) => `${(b as Built).ticket} ${(b as Built).name}`);
					}),
				),
			);
		}
		expect(built).toEqual([[`${tickets[0]} done`], [`${tickets[1]} done`], [`${tickets[2]} done`]]);
		// Every write once, across the three lives: no copy made again, no second pull request.
		expect(worlds.flatMap((w) => w.writes).sort()).toEqual(
			[
				"copy 1",
				"push 1",
				"open 1",
				"copy 2",
				"push 2",
				"open 2",
				"copy 3",
				"push 3",
				"open 3",
			].sort(),
		);
		// The builder cut off is started again on the conversation it had.
		const sessions = (n: number) =>
			worlds.map((w) => w.briefs.find((b) => b.number === n)?.session ?? null);
		const [, second, third] = [1, 2, 3].map(sessions);
		expect(second?.[0]).toMatch(/^[0-9a-f-]{36}$/);
		expect(second).toEqual([second?.[0], second?.[0], null]);
		expect(third?.[1]).toMatch(/^[0-9a-f-]{36}$/);
		expect(third).toEqual([null, third?.[1], third?.[1]]);
	});

	it("a ticket told again while it waits or is being built is built once", async () => {
		const tickets = [1, 2].map((n) => `${REPO}/issues/${n}`);
		const w = many((n) => Effect.sleep("20 millis").pipe(Effect.as(form(`Built ${n}.`))));
		const built = await once(w, memoryStorage(), (run, heard, close) =>
			Effect.gen(function* () {
				for (const t of [...tickets, ...tickets, tickets[1] ?? ""]) yield* tell(run, "ticket", t);
				close("ticket");
				yield* run.ended;
				return heard.built.values.map((b) => (b as Built).ticket);
			}),
		);
		expect(built).toEqual(tickets);
		expect(w.writes.filter((x) => x.startsWith("open"))).toEqual(["open 1", "open 2"]);
		expect(w.briefs).toHaveLength(2);
	});
});

describe("build: --harness picks how the builder runs", () => {
	/** The world's SDK builder, and an ACP one beside it that says which it is. */
	const both = () => {
		const w = world(ready, () => form("from the SDK builder"));
		const acpBriefs: string[] = [];
		const acp = Layer.succeed(AcpBuilder, {
			build: (brief) =>
				Effect.sync(() => {
					acpBriefs.push(brief.ticket);
					return form("from the ACP builder");
				}),
		});
		return {...w, services: Layer.mergeAll(w.services, acp), acpBriefs};
	};
	const run = (w: ReturnType<typeof both>, harness: "sdk" | "acp" | undefined) =>
		once(
			w,
			memoryStorage(),
			(r, heard, close) =>
				Effect.gen(function* () {
					yield* tell(r, "ticket", TICKET);
					close("ticket");
					yield* r.ended;
					return heard.built.values[0] as Built;
				}),
			{...FLAGS, harness},
		);

	it("acp: the ACP builder builds the ticket, and the SDK one is never started; the rest of the round is the same", async () => {
		const w = both();
		const end = await run(w, "acp");
		expect(w.acpBriefs).toEqual([TICKET]);
		expect(w.briefs).toEqual([]);
		expect(end.name).toBe("done");
		expect(end.built?.summary).toBe("from the ACP builder");
		expect(w.writes).toEqual(["copy", "push build: stop() hangs (round 1)", "open"]);
	});

	it("left out, or sdk: the SDK builder, as before", async () => {
		for (const harness of [undefined, "sdk"] as const) {
			const w = both();
			const end = await run(w, harness);
			expect(w.acpBriefs).toEqual([]);
			expect(w.briefs).toHaveLength(1);
			expect(end.built?.summary).toBe("from the SDK builder");
		}
	});
});

/** A sandbox where every ticket is ready, and each write is noted with its ticket's number. */
function many(answer: (n: number) => BuildDrafted | Effect.Effect<BuildDrafted>) {
	const writes: string[] = [];
	const host = Layer.succeed(BuildHost, {
		ticket: (url, number) => Effect.succeed({...ready, url, number}),
	});
	const sandbox = Layer.succeed(BuildWrites, {
		copy: (_, n) =>
			Effect.sync(() => {
				writes.push(`copy ${n}`);
				return {tree: `/work/trees/${n}`, branch: `build/${n}`, base: "b".repeat(40)};
			}),
		push: (ticket) =>
			Effect.sync(() => {
				writes.push(`push ${numberOf(ticket)}`);
				return {head: "h".repeat(40), changed: true};
			}),
		open: (ticket) =>
			Effect.sync(() => {
				writes.push(`open ${numberOf(ticket)}`);
				return `${REPO}/pull/${numberOf(ticket) + 100}`;
			}),
	});
	const builder = scriptedBuilder((brief) => answer(brief.number));
	return {services: Layer.mergeAll(host, sandbox, builder.layer), writes, briefs: builder.briefs};
}
