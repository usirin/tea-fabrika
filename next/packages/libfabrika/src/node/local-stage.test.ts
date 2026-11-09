import {mkdtempSync, readdirSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "@effect/vitest";
import {Effect} from "effect";
import * as fc from "fast-check";
import type {BrainFact} from "../app/brain-fact.ts";
import {brainOutbox, checkMemory} from "./local-stage.ts";

const SEED = 119120;
const firstStart: typeof BrainFact.Type = {
	id: "brain-start-1",
	_tag: "started",
	start: "process_01jc9q4w7z3m8n5r2t6v0xkb4d",
	after: null,
	build: "build-a",
	why: "open",
	pid: 417,
	at: 42,
};
const life = {
	id: fc.string({minLength: 1}),
	start: fc.string({minLength: 1}),
	at: fc.integer({min: 0}),
	exitCode: fc.option(fc.integer(), {nil: null}),
	signal: fc.option(fc.string(), {nil: null}),
	bytes: fc.integer({min: 0}),
	backoff: fc.integer({min: 0}),
};
const reason = fc.constantFrom("open", "crash", "memory", "core");
const brainFact: fc.Arbitrary<typeof BrainFact.Type> = fc.oneof(
	fc.record({
		...life,
		_tag: fc.constant("started"),
		after: fc.option(fc.string(), {nil: null}),
		build: fc.string(),
		why: reason,
		pid: fc.integer({min: 1}),
	}),
	fc.record({...life, _tag: fc.constant("exited"), why: reason}),
	fc.record({
		...life,
		_tag: fc.constant("braked"),
		why: fc.constantFrom("intensity", "restart_failed"),
	}),
	fc.record({...life, _tag: fc.constant("stopped"), why: fc.constant("stop")}),
);

describe("P12 local brain life", () => {
	const homes: Array<string> = [];
	const home = () => {
		const h = mkdtempSync(join(tmpdir(), "p12-l-"));
		homes.push(h);
		return h;
	};
	afterEach(() => {
		for (const h of homes.splice(0)) rmSync(h, {recursive: true, force: true});
	});
	it("p81 plant: sample workerd RSS, replace at 500000000, never measure the Node parent", async () => {
		const child = fc.integer({min: 1}).filter((pid) => pid !== process.pid);
		const belowCap: [number, number] = [499_999_999, 417];
		const atCap: [number, number] = [500_000_000, 417];
		const aboveCap: [number, number] = [500_000_001, 417];
		await fc.assert(
			fc.asyncProperty(fc.integer({min: 0, max: Number.MAX_SAFE_INTEGER}), child, (bytes, pid) =>
				Effect.runPromise(
					Effect.gen(function* () {
						const sampled: Array<number> = [],
							requests: Array<unknown> = [];
						yield* checkMemory({
							pid,
							sample: (pid: number) =>
								Effect.sync(() => {
									sampled.push(pid);
									return bytes;
								}),
							replace: (reason: unknown) =>
								Effect.sync(() => {
									requests.push(reason);
								}),
						});
						expect(sampled).toEqual([pid]);
						expect(sampled).not.toContain(process.pid);
						expect(requests).toEqual(bytes < 500_000_000 ? [] : [{why: "memory", pid, bytes}]);
					}),
				),
			),
			{seed: SEED, examples: [belowCap, atCap, aboveCap]},
		);
	});
	it("p81/content plant: remove a pending fact before acknowledgement or leak error text", async () => {
		await fc.assert(
			fc.asyncProperty(brainFact, (fact) =>
				Effect.runPromise(
					Effect.gen(function* () {
						const folder = home();
						let outbox = yield* brainOutbox(folder);
						yield* outbox.add(fact);
						yield* Effect.exit(
							outbox.flush(() => Effect.fail(new Error("private control failure"))),
						);
						outbox = yield* brainOutbox(folder);
						expect(yield* outbox.pending).toEqual([fact]);
						expect(readFileSync(join(folder, "brain.pending.jsonl"), "utf8")).not.toContain(
							"private control failure",
						);
						const sent: Array<unknown> = [];
						yield* outbox.flush((row: unknown) =>
							Effect.sync(() => {
								sent.push(row);
							}),
						);
						expect(sent).toEqual([fact]);
						expect(yield* outbox.pending).toEqual([]);
						yield* outbox.add(fact);
						yield* outbox.flush((row: unknown) =>
							Effect.sync(() => {
								sent.push(row);
							}),
						);
						expect(sent).toEqual([fact, fact]); // Same stable id lets Project deduplicate a lost reply.
						expect(readFileSync(join(folder, "brain.pending.jsonl"), "utf8")).not.toContain(
							"private control failure",
						);
					}),
				),
			),
			{seed: SEED, examples: [[firstStart]]},
		);
	});
});

describe("P12 durable brain outbox", () => {
	const homes: Array<string> = [];
	const home = () => {
		const folder = mkdtempSync(join(tmpdir(), "p12-m-"));
		homes.push(folder);
		return folder;
	};
	afterEach(() => {
		for (const folder of homes.splice(0)) rmSync(folder, {recursive: true, force: true});
	});
	it("an outbox id accepts an exact retry once and rejects changed content", async () => {
		await fc.assert(
			fc.asyncProperty(brainFact, (fact) =>
				Effect.runPromise(
					Effect.gen(function* () {
						const folder = home();
						const outbox = yield* brainOutbox(folder);
						yield* outbox.add(fact);
						yield* outbox.add(fact);
						expect(yield* outbox.pending).toEqual([fact]);
						if (fact._tag === "started") {
							const build = fact.build === "build-b" ? "build-c" : "build-b";
							expect(yield* Effect.flip(outbox.add({...fact, build}))).toMatchObject({
								_tag: "BrainError",
								why: "id_reused",
							});
						}
						expect(
							yield* Effect.flip(outbox.add({...fact, start: `${fact.start}-changed`})),
						).toMatchObject({
							_tag: "BrainError",
							why: "id_reused",
						});
						expect(yield* (yield* brainOutbox(folder)).pending).toEqual([fact]);
					}),
				),
			),
			{seed: SEED, examples: [[firstStart]]},
		);
	});

	it("outbox writes release both the pending file and its directory handle", async () => {
		await fc.assert(
			fc.asyncProperty(brainFact, (fact) =>
				Effect.runPromise(
					Effect.gen(function* () {
						const outbox = yield* brainOutbox(home());
						const before = readdirSync("/dev/fd").sort();
						yield* outbox.add(fact);
						expect(readdirSync("/dev/fd").sort()).toEqual(before);
						yield* outbox.flush(() => Effect.void);
						expect(readdirSync("/dev/fd").sort()).toEqual(before);
					}),
				),
			),
			{seed: SEED, examples: [[firstStart]]},
		);
	});
});
