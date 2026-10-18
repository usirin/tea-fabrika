import {Deferred, Effect, Layer} from "effect";
import {describe, expect, it} from "vitest";
import {ear} from "../../program/ear.ts";
import {type RunOf, start, tell} from "../../program/program.ts";
import {memoryStorage, type Storage} from "../../program/storage.ts";
import {SANDBOX_URL} from "../../sandbox.ts";
import type {BuildDrafted} from "./form.ts";
import {type Built, buildProgram} from "./program.ts";
import {built, builtBy, scriptedBuilder} from "./scripted.ts";
import {BuildHost, BuildWrites} from "./services.ts";
import {READY, type Ticket} from "./ticket.ts";

// The build program, started from code: the machine and its handlers are the
// real ones; the builder is scripted, and the sandbox is a fake that keeps
// every write.

const TICKET = `${SANDBOX_URL}/issues/1`;
const PR = `${SANDBOX_URL}/pull/9`;
const FLAGS = {model: "opus", effort: "medium", budget: 1} as const;
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
	labels: [READY],
	criteria: [{n: 1, text: "it ends", checked: false, evidence: null}],
	prs: [],
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
const once = <A>(
	w: ReturnType<typeof world>,
	storage: Storage,
	body: (
		run: BuildRun,
		heard: {built: ReturnType<typeof ear<Built>>; opened: ReturnType<typeof ear<string>>},
		close: (n: "ticket") => void,
	) => Effect.Effect<A>,
) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const builtEar = ear<Built>();
			const opened = ear<string>();
			const started = yield* start(
				buildProgram,
				FLAGS,
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
			tell(run, "ticket", TICKET);
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

	it("a ticket not labelled ready is skipped: no copy, no run, no write", async () => {
		const w = world({...ready, labels: []}, () => form("x"));
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

	it("a demlik ticket is refused when it is decoded, and nothing is read or written", async () => {
		const w = world(ready, () => form("x"));
		const words = await once(w, memoryStorage(), (run) =>
			Effect.succeed([tell(run, "ticket", "https://github.com/kamp-us/demlik/issues/670")]),
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
				tell(run, "ticket", TICKET);
				yield* Deferred.await(started);
			}),
		);
		expect(before.writes).toEqual(["copy"]);

		const after = world(ready, () => form("It ends now."));
		const {end} = await once(after, storage, (run, heard, close) =>
			Effect.gen(function* () {
				tell(run, "ticket", TICKET);
				close("ticket");
				const [e] = yield* heard.built.upTo(1);
				return {end: e as Built};
			}),
		);
		expect(end.name).toBe("done");
		// The copy was made before the cut: it is not made again, the builder runs once more, and one pull request is opened.
		expect(after.writes).toEqual(["push build: stop() hangs (round 1)", "open"]);
		expect(after.briefs).toHaveLength(1);
	});
});
