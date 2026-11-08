// P15a headless half. No browser/window-loader, tile marks or rendered Restart claims.
// Scenario: real filesystem watch + Rolldown + strict Compiler + Worker Loader + authenticated client.
// P12/P14 absence is reported apart and is neither P15 red nor green.
import {mkdtempSync, rmSync} from "node:fs";
import type {Scope} from "effect";
import {Effect, Fiber, Schema, Stream} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {changed, countView, headless, source, startReloadStage} from "./p15.test-support.ts";

const run = async (
	f: (
		stage: Effect.Success<ReturnType<typeof startReloadStage>>,
	) => Effect.Effect<void, unknown, Scope.Scope>,
) => {
	const home = mkdtempSync("/tmp/p15e.");
	try {
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const stage = yield* startReloadStage({home, port: 49315});
					yield* f(stage);
				}),
			),
		);
	} finally {
		rmSync(home, {recursive: true, force: true});
	}
};

describe("P15a under real dev.ts", () => {
	it("H4 rollback keeps the input once; incompatible saved state can Restart after update", async () => {
		// Scenario: exercise the P34 wrapper through a real authenticated headless connection.
		// Wire spelling assumption: process.restart {pid,id,build} forwards RestartRequest unchanged.
		await fc.assert(
			fc.asyncProperty(fc.integer({min: 1, max: 3}), async (n) =>
				run((stage) =>
					Effect.gen(function* () {
						const client = yield* headless(stage);
						const opened = Schema.decodeUnknownSync(
							Schema.Struct({tiles: Schema.Array(Schema.Struct({pid: Schema.String}))}),
						)(yield* client.request("window.open", {}));
						const pid = opened.tiles[0]!.pid;
						const send = (index: number, type: string) =>
							client.request("process.send", {
								pid,
								letter: `letter_01j0000000e00800000000000${String(index).padStart(2, "0")}`,
								m: {type},
								seen: 0,
								sentAt: "2026-11-08T01:00:00Z",
								action: {does: type, via: {_tag: "click"}},
							});
						for (let i = 0; i < n; i++) yield* send(i, "inc");
						const before = Schema.decodeUnknownSync(countView)(
							yield* client.request("view.open", {pid}),
						);
						const original = yield* Effect.promise(source);
						const badStep = original.replace(
							"s.count + 1",
							"(() => {throw new TypeError('p15 private diagnostic');})()",
						);
						const selected = yield* Effect.forkChild(changed(client, pid));
						yield* stage.editProgram("counter", badStep);
						yield* Fiber.join(selected);
						yield* send(8, "inc");
						const rolled = Schema.decodeUnknownSync(countView)(
							yield* client.request("view.open", {pid}),
						);
						expect(rolled.update.view.count).toBe(before.update.view.count + 1);
						expect(rolled.hash).toBe(before.hash);
						// Version 2 uses the named chain; later rollback to v1 must preserve v2 bytes and stop.
						const advanced = original
							.replace(
								"v: 1, upgrades: []",
								"v: 2, upgrades: [{name: 'counter-v2', from: 1, run: (raw: unknown) => raw}]",
							)
							.replace(
								"reset: () => [{count: 0}, []]",
								"reset: () => {throw new TypeError('p15 newer state');}",
							);
						expect(advanced).not.toBe(original);
						const upgrade = yield* Effect.forkChild(changed(client, pid));
						yield* stage.editProgram("counter", advanced);
						yield* Fiber.join(upgrade);
						yield* send(9, "reset").pipe(Effect.exit);
						const healthy = advanced.replace(
							"reset: () => {throw new TypeError('p15 newer state');}",
							"reset: () => [{count: 0}, []]",
						);
						const available = yield* Effect.forkChild(
							client.news.pipe(
								Stream.filter((news) => news.method === "code.loaded"),
								Stream.take(1),
								Stream.runCollect,
							),
						);
						yield* stage.editProgram("counter", healthy);
						const facts = yield* Fiber.join(available);
						const selectedBuild = Schema.decodeUnknownSync(Schema.Struct({hash: Schema.String}))(
							facts[0]!.params,
						).hash;
						const restart = {pid, id: "request_01j0000000e0080000000000008", build: selectedBuild};
						const successor = yield* client.request("process.restart", restart);
						expect(yield* client.request("process.restart", restart)).toEqual(successor);
						const replacement = Schema.decodeUnknownSync(Schema.Struct({process: Schema.String}))(
							successor,
						).process;
						expect(replacement).not.toBe(pid);
						const restored = Schema.decodeUnknownSync(countView)(
							yield* client.request("view.open", {pid: replacement}),
						);
						expect(restored.update.view.count).toBe(rolled.update.view.count);
					}),
				),
			),
			{seed: 119120, numRuns: 2},
		);
	});
	it("p70/p71/p73: headless client retains accepted work and runs changed program code", async () => {
		await fc.assert(
			fc.asyncProperty(fc.integer({min: 1, max: 4}), async (n) =>
				run((stage) =>
					Effect.gen(function* () {
						const client = yield* headless(stage);
						const opened = yield* client.request("window.open", {});
						const tiles = Schema.decodeUnknownSync(
							Schema.Struct({
								tiles: Schema.Array(Schema.Struct({pid: Schema.String, program: Schema.String})),
							}),
						)(opened).tiles;
						const tile = tiles.find((t) => t.program === "counter");
						expect(tile).toBeDefined();
						const pid = tile!.pid;
						const send = (id: number) =>
							client.request("process.send", {
								pid,
								letter: `letter_01j0000000e00800000000000${String(id).padStart(2, "0")}`,
								m: {type: "inc"},
								seen: 0,
								sentAt: "2026-11-08T01:00:00Z",
								action: {does: "inc", via: {_tag: "click"}},
							});
						for (let i = 0; i < n; i++) yield* send(i);
						const before = Schema.decodeUnknownSync(countView)(
							yield* client.request("view.open", {pid}),
						);
						const original = yield* Effect.promise(source);
						const replacement = original.replace("s.count + 1", "s.count + 2");
						expect(replacement).not.toBe(original);
						const news = yield* Effect.forkChild(changed(client, pid));
						yield* stage.editProgram("counter", replacement);
						yield* Fiber.join(news);
						const swapped = Schema.decodeUnknownSync(countView)(
							yield* client.request("view.open", {pid}),
						);
						expect(swapped.update.view).toEqual(before.update.view);
						expect(swapped.hash).not.toBe(before.hash);
						yield* send(90);
						yield* send(90);
						const after = Schema.decodeUnknownSync(countView)(
							yield* client.request("view.open", {pid}),
						);
						expect(after.update.view.count).toBe(before.update.view.count + 2);
						yield* stage.killWorker;
						yield* stage.start;
						const reopened = Schema.decodeUnknownSync(countView)(
							yield* client.request("view.open", {pid}),
						);
						expect(reopened.update.view).toEqual(after.update.view);
					}),
				),
			),
			{seed: 119120, numRuns: 2},
		);
	});
	it("H4: malformed save leaves last good bytes; a later good save resumes reload", async () => {
		await run((stage) =>
			Effect.gen(function* () {
				const client = yield* headless(stage);
				const opened = Schema.decodeUnknownSync(
					Schema.Struct({tiles: Schema.Array(Schema.Struct({pid: Schema.String}))}),
				)(yield* client.request("window.open", {}));
				const pid = opened.tiles[0]!.pid;
				const before = Schema.decodeUnknownSync(countView)(
					yield* client.request("view.open", {pid}),
				);
				const original = yield* Effect.promise(source);
				const failed = yield* Effect.forkChild(
					client.news.pipe(
						Stream.filter((n) => n.method === "code.failed"),
						Stream.take(1),
						Stream.runCollect,
					),
				);
				yield* stage.editProgram("counter", "export const counter = ;");
				yield* Fiber.join(failed);
				expect(
					Schema.decodeUnknownSync(countView)(yield* client.request("view.open", {pid})),
				).toEqual(before);
				const next = yield* Effect.forkChild(changed(client, pid));
				yield* stage.editProgram("counter", original.replace("s.count + 1", "s.count + 3"));
				yield* Fiber.join(next);
				expect(
					Schema.decodeUnknownSync(countView)(yield* client.request("view.open", {pid})).update
						.view,
				).toEqual(before.update.view);
			}),
		);
	});
});
