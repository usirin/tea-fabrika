import {existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import type {ReadableSpan} from "@opentelemetry/sdk-trace-base";
import {type Given, start, tell} from "@tea-fabrika/tea-program";
import {ear} from "@tea-fabrika/tea-program/ear";
import {memoryStorage, type Storage} from "@tea-fabrika/tea-program/storage";
import {memoryTracing} from "@tea-fabrika/tsh/trace/otel";
import {Duration, Effect, type FileSystem, type Path, type Scope} from "effect";
import type {ChildProcessSpawner} from "effect/process";
import {describe, expect, it} from "vitest";
import {FABRIKA_VIEWING} from "../../trace/viewing.ts";
import {acpProgram} from "./program.ts";
import {type Transcript, turnShapes} from "./transcript.ts";

// The acp program on the fake agent (./fake-agent.ts): a real child process
// spoken to over ACP, with no model. The user's job first: three turns, read
// two files, answer, follow up. Then the mechanism rows.

type Flags = Given<(typeof acpProgram)["flags"]>;
type Heard = {
	readonly opened: ReturnType<typeof ear<unknown>>;
	readonly said: ReturnType<typeof ear<string>>;
	readonly result: ReturnType<typeof ear<{readonly stop: string; readonly turn: number}>>;
	readonly ask: ReturnType<typeof ear<{readonly ask: string; readonly answer: string}>>;
};

/** A scratch folder with two files to read, outside any repository. */
const scratch = () => {
	const folder = realpathSync(mkdtempSync(join(tmpdir(), "acp-fake-")));
	writeFileSync(join(folder, "a.txt"), "The river is called Kura.\n");
	writeFileSync(join(folder, "b.txt"), "The bridge has 7 arches.\n");
	return folder;
};

/** What the fake agent noted of each prompt it was sent: `prompt <session> <n> <first word>`. */
const promptsSent = (folder: string) => {
	const at = join(folder, ".fake-acp", "log");
	return existsSync(at) ? readFileSync(at, "utf8").split("\n").filter(Boolean) : [];
};

let runs = 0;
/** One start of the acp program, kept under `id` in `storage`. */
const life = (flags: Flags, storage: Storage, id: string) =>
	Effect.gen(function* () {
		const heard: Heard = {opened: ear(), said: ear(), result: ear(), ask: ear()};
		const started = yield* start(
			acpProgram,
			flags,
			{
				opened: heard.opened.hear,
				said: heard.said.hear,
				result: heard.result.hear,
				ask: heard.ask.hear,
			},
			{id, storage},
		);
		if (started.kind !== "running") return yield* Effect.die(`acp did not start: ${started.why}`);
		const transcript = () => started.run.machines.transcript.state() as Transcript | null;
		return {started, heard, transcript};
	});

const fake = (folder: string, more: Partial<Flags> = {}): Flags => ({
	agent: "fake",
	folder,
	model: undefined,
	effort: undefined,
	mode: undefined,
	permissions: undefined,
	reopen: undefined,
	budget: undefined,
	...more,
});

const until = (check: () => boolean, what: string) =>
	Effect.gen(function* () {
		while (!check()) yield* Effect.sleep(Duration.millis(10));
	}).pipe(
		Effect.timeout(Duration.seconds(10)),
		Effect.catch(() => Effect.die(`waited for ${what}`)),
	);

type Node = ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path;

const run = <A, E>(effect: Effect.Effect<A, E, Node | Scope.Scope>) =>
	Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(nodeServices)));

describe("acp on the fake agent", () => {
	it("three turns (read two files and answer, then two follow-ups): three answers, one transcript of three whole turns", async () => {
		const folder = scratch();
		const {said, shapes, opened} = await run(
			Effect.gen(function* () {
				runs += 1;
				const {started, heard, transcript} = yield* life(
					fake(folder, {model: "fake-large", effort: "low"}),
					memoryStorage(),
					`acp:test-${runs}`,
				);
				for (const prompt of [
					"Read a.txt and b.txt, then say what each says.",
					"Which of the two files names a number?",
					"Say it in one word.",
				])
					expect(tell(started.run, "prompt", prompt)).toBe("queued");
				started.close("prompt");
				const end = yield* started.run.ended;
				expect(end.kind).toBe("ended");
				const s = transcript();
				return {
					said: heard.said.values,
					shapes: s === null ? [] : turnShapes(s),
					opened: heard.opened.values,
				};
			}),
		);
		expect(opened).toMatchObject([{how: "new", model: "fake-large", mode: "auto", resent: 0}]);
		expect(said[0]).toBe("a.txt: The river is called Kura.\nb.txt: The bridge has 7 arches.");
		expect(said).toHaveLength(3);
		expect(shapes).toEqual([
			{
				turn: 1,
				prompts: 1,
				said: true,
				tools: ["completed", "completed"],
				stop: "end_turn",
				usage: true,
			},
			{turn: 2, prompts: 1, said: true, tools: [], stop: "end_turn", usage: true},
			{turn: 3, prompts: 1, said: true, tools: [], stop: "end_turn", usage: true},
		]);
		expect(promptsSent(folder)).toHaveLength(3);
	}, 30_000);

	it("a permission ask is shown and refused by default: the file is not written", async () => {
		const folder = scratch();
		const asks = await run(
			Effect.gen(function* () {
				runs += 1;
				const {started, heard} = yield* life(fake(folder), memoryStorage(), `acp:test-${runs}`);
				tell(started.run, "prompt", "write it");
				started.close("prompt");
				yield* started.run.ended;
				return heard.ask.values;
			}),
		);
		expect(asks).toMatchObject([{ask: "ask-1", tool: "Write", kind: "edit", answer: "refused"}]);
		expect(existsSync(join(folder, "written.txt"))).toBe(false);
	}, 30_000);

	it("with --permissions ask it waits, and is allowed only when told: allow-once, never always", async () => {
		const folder = scratch();
		const asks = await run(
			Effect.gen(function* () {
				runs += 1;
				const {started, heard} = yield* life(
					fake(folder, {permissions: "ask"}),
					memoryStorage(),
					`acp:test-${runs}`,
				);
				tell(started.run, "prompt", "write it");
				tell(started.run, "prompt", "write it again");
				started.close("prompt");
				const first = (yield* heard.ask.upTo(1))[0];
				expect(first?.answer).toBe("waiting");
				expect(existsSync(join(folder, "written.txt"))).toBe(false);
				tell(started.run, "allow", "ask-1");
				yield* heard.ask.upTo(3);
				tell(started.run, "refuse", "ask-2");
				yield* started.run.ended;
				return heard.ask.values.map((a) => `${a.ask} ${a.answer}`);
			}),
		);
		expect(asks).toEqual(["ask-1 waiting", "ask-1 allowed", "ask-2 waiting", "ask-2 refused"]);
		expect(readFileSync(join(folder, "written.txt"), "utf8")).toBe("written\n");
	}, 30_000);

	it("cancel: the turn running ends cancelled, and the next one runs", async () => {
		const folder = scratch();
		const {results, transcript} = await run(
			Effect.gen(function* () {
				runs += 1;
				const {started, heard, transcript} = yield* life(
					fake(folder),
					memoryStorage(),
					`acp:test-${runs}`,
				);
				tell(started.run, "prompt", "slowly read a.txt and b.txt");
				tell(started.run, "prompt", "and now?");
				started.close("prompt");
				yield* until(() => promptsSent(folder).length === 1, "the first prompt");
				tell(started.run, "cancel", "now");
				yield* started.run.ended;
				return {results: heard.result.values, transcript: transcript()};
			}),
		);
		expect(results.map((r) => r.stop)).toEqual(["cancelled", "end_turn"]);
		expect(transcript?.turns.map((t) => t.stop)).toEqual(["cancelled", "end_turn"]);
	}, 30_000);

	for (const reopen of ["load", "resume"] as const)
		it(`stopped mid turn and started again (${reopen}): the same session opens again, the cut prompt is sent again, nobody retells it`, async () => {
			const folder = scratch();
			const storage = memoryStorage();
			runs += 1;
			const id = `acp:test-${runs}`;
			const flags = fake(folder, {reopen});
			await run(
				Effect.gen(function* () {
					const {started, heard} = yield* life(flags, storage, id);
					tell(started.run, "prompt", "Read a.txt and say what it says.");
					tell(started.run, "prompt", "slowly read b.txt");
					started.close("prompt");
					yield* heard.result.upTo(1);
					yield* until(() => promptsSent(folder).length === 2, "the second prompt");
					yield* started.stop;
				}),
			);
			const again = await run(
				Effect.gen(function* () {
					const {started, heard, transcript} = yield* life(flags, storage, id);
					yield* started.run.ended;
					return {
						opened: heard.opened.values,
						results: heard.result.values,
						transcript: transcript(),
					};
				}),
			);
			const sent = promptsSent(folder);
			// The same session, both starts; the cut prompt sent twice, the answered one once.
			expect(new Set(sent.map((l) => l.split(" ")[1])).size).toBe(1);
			expect(sent.map((l) => l.split(" ")[3])).toEqual(["Read", "slowly", "slowly"]);
			expect(again.opened).toMatchObject([{how: reopen, earlier: 1, resent: 1}]);
			expect(again.results).toMatchObject([{turn: 2, stop: "end_turn"}]);
			// Loaded, the transcript comes back from the replay; resumed, only what came after.
			const replayed = again.transcript?.messages.filter((m) => m.turn === null).length ?? 0;
			if (reopen === "load") expect(replayed).toBeGreaterThan(0);
			else expect(replayed).toBe(0);
		}, 30_000);

	it("a folder in a repository is refused before any harness starts", async () => {
		const inRepo = await run(
			Effect.gen(function* () {
				runs += 1;
				const {started} = yield* life(fake(process.cwd()), memoryStorage(), `acp:test-${runs}`);
				return yield* started.run.ended;
			}),
		);
		expect(JSON.stringify(inRepo)).toContain("inside a git repository");
	}, 30_000);

	it("traced: the turn is an agent span with its tool calls under it, and no prompt, answer or file text is in any span", async () => {
		const folder = scratch();
		/** Spans as made (`raw`), and as a viewer is shown them. */
		const traced = async (raw: boolean) => {
			const {spans, layer} = memoryTracing({raw, viewing: FABRIKA_VIEWING});
			await run(
				Effect.gen(function* () {
					runs += 1;
					const {started} = yield* life(fake(folder), memoryStorage(), `acp:test-${runs}`);
					tell(started.run, "prompt", "Read a.txt and b.txt, plan it, think, secretword");
					started.close("prompt");
					yield* started.run.ended;
				}).pipe(Effect.provide(layer)),
			);
			return spans;
		};
		const text = (s: ReadableSpan) =>
			JSON.stringify([s.name, s.attributes, s.events.map((e) => [e.name, e.attributes])]);
		const raw = await traced(true);
		const shown = await traced(false);
		for (const spans of [raw, shown]) {
			const all = spans.map(text).join("\n");
			for (const words of ["secretword", "Kura", "arches", "a.txt"])
				expect(all).not.toContain(words);
		}
		const names = raw.map((s) => s.name);
		expect(names).toContain("acp transcript");
		expect(names).toContain("acp session");
		expect(names).toContain("acp turn");
		// Made: each tool call a span of its own. Shown: the agent run folded into its turn.
		expect(names.filter((n) => n.includes("Read"))).toHaveLength(2);
		expect(shown.map((s) => s.name)).toContain("acp turn · 1 turn");
	}, 30_000);
});
