import {execFileSync} from "node:child_process";
import {existsSync, mkdtempSync, readdirSync, realpathSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Effect, type Scope} from "effect";
import {describe, expect, it} from "vitest";
import {memoryStorage} from "../../program/storage.ts";
import {SummonManager} from "../../shell/summon.ts";
import {summonManager} from "./manager.ts";

// Law S-3 of the summon tryout (ticket 237, PR 1), today's version: a name is unique, and a
// summon on a taken one is refused, never a replacement (Slack's last-installed-wins is the trap;
// Erlang's `register` fails on a taken name). Checked on the real manager and the fake ACP agent
// (../acp/fake-agent.ts), whose `.fake-acp/<session>.jsonl` files count the sessions it opened:
// a refused summon opens none.
//
//   summon scout fake-large    scout · fake · fake-large
//   summon scout fake-small    refused: scout is already fake fake-large ... dismiss scout first
//   dismiss scout; summon scout fake-small     scout · fake · fake-small, a second session
//
// The name rule is the door's writer rule, `^[a-z0-9][a-z0-9._-]{0,63}$`, with all, here,
// everyone and me kept back; upper case is refused with the lower-case name as its did-you-mean.

const PERSON = "user:owner";
const TIME = 60_000;

const repo = () => {
	const folder = realpathSync(mkdtempSync(join(tmpdir(), "summon-law-")));
	execFileSync("git", ["init", "-q"], {cwd: folder});
	return folder;
};

/** The sessions the fake opened new: one file each. */
const sessions = (folder: string) => {
	const at = join(folder, ".fake-acp");
	return existsSync(at) ? readdirSync(at).filter((f) => f.endsWith(".jsonl")) : [];
};

const hosted = <A, E>(folder: string, body: Effect.Effect<A, E, SummonManager | Scope.Scope>) =>
	Effect.runPromise(
		body.pipe(Effect.scoped, Effect.provide(summonManager({storage: memoryStorage(), folder}))),
	);

const summon = (name: string, settings: readonly string[] = []) =>
	Effect.gen(function* () {
		const manager = yield* SummonManager;
		return yield* manager.summon({agent: "fake", settings, name, by: PERSON});
	});

const whyOf = (e: unknown) =>
	`${JSON.stringify(e)} ${e instanceof Error ? e.message : String((e as {message?: unknown})?.message ?? "")}`;

describe("S-3: a summon on a taken name is refused", () => {
	it(
		"keeps the first agent, says how to free the name, and starts no second harness",
		async () => {
			const folder = repo();
			const seen = await hosted(
				folder,
				Effect.gen(function* () {
					yield* summon("scout", ["fake-large"]);
					const opened = sessions(folder).length;
					const why = whyOf(yield* Effect.flip(summon("scout", ["fake-small"])));
					const list = yield* (yield* SummonManager).list;
					return {opened, why, list};
				}),
			);
			expect(seen.opened).toBe(1);
			expect(seen.why).toContain("dismiss scout");
			expect(seen.list.map((s) => [s.name, s.model.resolved])).toEqual([["scout", "fake-large"]]);
			expect(sessions(folder)).toHaveLength(1);
		},
		TIME,
	);

	it(
		"a dismissed name is free again, for a new session",
		async () => {
			const folder = repo();
			const seen = await hosted(
				folder,
				Effect.gen(function* () {
					const manager = yield* SummonManager;
					yield* summon("scout", ["fake-large"]);
					yield* manager.dismiss("scout", PERSON);
					const again = yield* summon("scout", ["fake-small"]);
					return {again, list: yield* manager.list};
				}),
			);
			expect(seen.again.model.resolved).toBe("fake-small");
			expect(seen.list.map((s) => [s.name, s.model.resolved])).toEqual([["scout", "fake-small"]]);
			expect(sessions(folder)).toHaveLength(2);
		},
		TIME,
	);

	it(
		"two names are two agents, each its own session",
		async () => {
			const folder = repo();
			const list = await hosted(
				folder,
				Effect.gen(function* () {
					yield* summon("scout");
					yield* summon("researcher");
					return yield* (yield* SummonManager).list;
				}),
			);
			expect(
				list
					.map((s) => s.name)
					.slice()
					.sort(),
			).toEqual(["researcher", "scout"]);
			expect(sessions(folder)).toHaveLength(2);
		},
		TIME,
	);
});

describe("the name rule: refused before any harness starts", () => {
	it(
		"refuses upper case with the lower-case name, the kept-back words, and what the writer rule does not take",
		async () => {
			const folder = repo();
			const seen = await hosted(
				folder,
				Effect.gen(function* () {
					const whys: Record<string, string> = {};

					for (const name of [
						"Scout",
						"all",
						"here",
						"everyone",
						"me",
						"-x",
						"a b",
						"",
						"x".repeat(65),
					]) {
						whys[name] = whyOf(yield* Effect.flip(summon(name)));
					}

					return {whys, list: yield* (yield* SummonManager).list};
				}),
			);
			expect(seen.whys.Scout).toContain("scout");
			expect(seen.list).toEqual([]);
			expect(sessions(folder)).toEqual([]);
		},
		TIME,
	);

	it(
		"takes the agent's own word as a name, and the writer rule's dots, dashes and underscores",
		async () => {
			const folder = repo();
			const list = await hosted(
				folder,
				Effect.gen(function* () {
					yield* summon("fake");
					yield* summon("a.b_c-9");
					return yield* (yield* SummonManager).list;
				}),
			);
			expect(
				list
					.map((s) => s.name)
					.slice()
					.sort(),
			).toEqual(["a.b_c-9", "fake"]);
		},
		TIME,
	);

	it(
		"refuses a dismiss of a name nobody summoned",
		async () => {
			const folder = repo();
			const why = await hosted(
				folder,
				Effect.gen(function* () {
					return whyOf(yield* Effect.flip((yield* SummonManager).dismiss("nobody", PERSON)));
				}),
			);
			expect(why).toContain("nobody");
		},
		TIME,
	);
});
