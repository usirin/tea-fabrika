import {mkdtempSync, readdirSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "@effect/vitest";
import {Effect} from "effect";
import type {BrainFact} from "../app/brain-fact.ts";
import {brainOutbox} from "./local-stage.ts";

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
	it.effect(
		"p81 plant: sample workerd RSS, replace at 500000000, never measure the Node parent",
		() =>
			Effect.gen(function* () {
				const {checkMemory} = yield* Effect.promise(() => import("./local-stage.ts"));
				const sampled: Array<number> = [],
					requests: Array<unknown> = [];
				for (const bytes of [499_999_999, 500_000_000, 500_000_001]) {
					yield* checkMemory({
						pid: 417,
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
				}
				expect(sampled).toEqual([417, 417, 417]);
				expect(sampled).not.toContain(process.pid);
				expect(requests).toEqual([
					{why: "memory", pid: 417, bytes: 500_000_000},
					{why: "memory", pid: 417, bytes: 500_000_001},
				]);
			}),
	);
	it.effect(
		"p81/content plant: remove a pending fact before acknowledgement or leak error text",
		() =>
			Effect.gen(function* () {
				const {brainOutbox} = yield* Effect.promise(() => import("./local-stage.ts"));
				const folder = home();
				let outbox = yield* brainOutbox(folder);
				const fact = {
					id: "brain-start-1",
					_tag: "started",
					start: "process_01jc9q4w7z3m8n5r2t6v0xkb4d",
					after: null,
					build: "build-a",
					why: "open",
					pid: 417,
					at: 42,
				};
				yield* outbox.add(fact);
				yield* Effect.exit(outbox.flush(() => Effect.fail(new Error("private control failure"))));
				outbox = yield* brainOutbox(folder);
				expect(yield* outbox.pending).toEqual([fact]);
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
	);
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
	const fact: typeof BrainFact.Type = {
		id: "brain-start-1",
		_tag: "started",
		start: "process_01jc9q4w7z3m8n5r2t6v0xkb4d",
		after: null,
		build: "build-a",
		why: "open",
		pid: 417,
		at: 42,
	};

	it.effect("an outbox id accepts an exact retry once and rejects changed content", () =>
		Effect.gen(function* () {
			const folder = home();
			const outbox = yield* brainOutbox(folder);
			yield* outbox.add(fact);
			yield* outbox.add(fact);
			expect(yield* outbox.pending).toEqual([fact]);
			expect(yield* Effect.flip(outbox.add({...fact, build: "build-b"}))).toMatchObject({
				_tag: "BrainError",
				why: "id_reused",
			});
			expect(yield* (yield* brainOutbox(folder)).pending).toEqual([fact]);
		}),
	);

	it.effect("outbox writes release both the pending file and its directory handle", () =>
		Effect.gen(function* () {
			const outbox = yield* brainOutbox(home());
			const before = readdirSync("/dev/fd").sort();
			yield* outbox.add(fact);
			expect(readdirSync("/dev/fd").sort()).toEqual(before);
			yield* outbox.flush(() => Effect.void);
			expect(readdirSync("/dev/fd").sort()).toEqual(before);
		}),
	);
});
