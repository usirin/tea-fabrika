import {chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Effect} from "effect";
import {describe, expect, it} from "vitest";
import {Fabrika} from "./fabrika.ts";
import {cliFabrika} from "./fabrika-cli.ts";

// The adapter's own rules: how each verb's stdout and exit code become a typed
// answer. A stand-in binary answers from a table, keyed by the start of its
// arguments, and logs each call. The operator's tests never use this; they
// run on the in-memory Layer.

type Answer = {readonly exit?: number; readonly out?: unknown; readonly err?: string};

function standIn(answers: Readonly<Record<string, Answer>>) {
	const repo = mkdtempSync(join(tmpdir(), "fabrika-cli-"));
	mkdirSync(join(repo, "node_modules", ".bin"), {recursive: true});
	const bin = join(repo, "node_modules", ".bin", "fabrika");
	writeFileSync(join(repo, "answers.json"), JSON.stringify(answers));
	writeFileSync(
		bin,
		[
			"#!/usr/bin/env node",
			'const fs = require("node:fs"), path = require("node:path");',
			'const repo = path.resolve(__dirname, "..", "..");',
			'const answers = JSON.parse(fs.readFileSync(path.join(repo, "answers.json"), "utf8"));',
			'const line = process.argv.slice(2).join(" ");',
			'fs.appendFileSync(path.join(repo, "calls.log"), line + "\\n");',
			"const key = Object.keys(answers).filter((k) => line.startsWith(k)).sort((a, b) => b.length - a.length)[0];",
			"const a = key === undefined ? { exit: 99 } : answers[key];",
			'if (a.out !== undefined) process.stdout.write(typeof a.out === "string" ? a.out : JSON.stringify(a.out));',
			"if (a.err) process.stderr.write(a.err);",
			"process.exit(a.exit ?? 0);",
		].join("\n"),
	);
	chmodSync(bin, 0o755);
	const layer = cliFabrika({
		repo,
		slug: "example/repo",
		session: "run-1",
		journal: join(repo, "journal", "intents.json"),
	});
	const use = <A, E>(f: (fabrika: Fabrika["Service"]) => Effect.Effect<A, E>) =>
		Effect.runPromise(
			Effect.gen(function* () {
				return yield* f(yield* Fabrika);
			}).pipe(Effect.provide(layer), Effect.result),
		);
	const calls = () => readFileSync(join(repo, "calls.log"), "utf8").trim().split("\n");
	return {use, calls};
}

const active = (leaf: string, cause?: string) => ({
	stateValue: {pipeline: {issue: leaf}},
	status: "active",
	context: {issue: {retries: 0, ...(cause === undefined ? {} : {cause})}, errors: []},
});
const PR = "https://github.com/example/repo/pull/7";
const at = {lane: "42", task: "issue"};

describe("fabrika 0.9.0 behind the Fabrika service", () => {
	it("reads the lane: the leaf's name, the ledger's length, the last pull request, and a cause only at a park", async () => {
		const lines = [
			{task: "issue", event: "ISSUE.WIP"},
			{task: "issue", event: "ISSUE.DONE", pr: PR},
			{task: "issue", event: "ISSUE.LAP", cause: "spawn-dead"},
		];
		const reviewing = standIn({
			"lane status": {out: active("review", "spawn-dead")},
			"lane history": {out: lines},
		});
		const parked = standIn({
			"lane status": {out: active("blocked", "head-ci-red")},
			"lane history": {out: lines},
		});

		expect(await reviewing.use((f) => f.view("42"))).toMatchObject({
			success: {
				lane: "42",
				issue: "https://github.com/example/repo/issues/42",
				status: "active",
				tasks: [{task: "issue", state: "review", cause: null, pr: PR, seq: 3}],
			},
		});
		expect(await parked.use((f) => f.view("42"))).toMatchObject({
			success: {tasks: [{state: "blocked", cause: "head-ci-red"}]},
		});
	});

	it("reads a finished lane as done, a cancelled one as cancelled, and a tripped one as a park a person can still open", async () => {
		const ended = (stateValue: string) =>
			standIn({
				"lane status": {out: {stateValue, status: "done", context: {errors: []}}},
				"lane history": {out: []},
			}).use((f) => f.view("42"));

		expect(await ended("complete")).toMatchObject({success: {status: "done", tasks: []}});
		expect(await ended("board:cancelled")).toMatchObject({success: {status: "cancelled"}});
		expect(await ended("tripped")).toMatchObject({
			success: {
				status: "active",
				tasks: [{state: "human:budget-spent", cause: "repair-budget-spent"}],
			},
		});
	});

	it("stops on a lane it cannot read, instead of guessing", async () => {
		const {use} = standIn({"lane status": {exit: 11, err: "read failed"}});
		expect(await use((f) => f.view("42"))).toMatchObject({failure: {_tag: "unknown"}});
	});

	it("hands over the brief as it is, with the shell and the pull request it names, and types each refusal", async () => {
		const brief = [
			"## Task",
			"lane: 42",
			"shell: reviewer",
			"## Ground",
			"issue: https://github.com/example/repo/issues/42",
			`pr: ${PR}`,
			"## Rules",
			"…",
		].join("\n");
		const ok = standIn({"lane brief": {out: brief}});
		const refused = (exit: number) => standIn({"lane brief": {exit}}).use((f) => f.brief(at));

		expect(await ok.use((f) => f.brief(at))).toMatchObject({
			success: {
				ok: true,
				brief: {
					shell: "reviewer",
					prompt: brief,
					issue: "https://github.com/example/repo/issues/42",
					pr: PR,
				},
			},
		});
		expect(await refused(20)).toMatchObject({success: {ok: false, why: "no_pr"}});
		expect(await refused(71)).toMatchObject({success: {ok: false, why: "size_stop"}});
		expect(await refused(11)).toMatchObject({failure: {_tag: "unknown"}});
	});

	it("claims, and boots a lane that has none; a lane it may not boot gives the claim back", async () => {
		const seats = {
			"lane seats": {out: {answer: "uncapped", retryAfter: null}},
			"lane claim": {out: {answer: "won", token: "lane:run-1:t"}},
		};
		const booted = standIn({
			...seats,
			"lane status": {exit: 7},
			"lane open": {out: {answer: "opened"}},
		});
		const child = standIn({
			...seats,
			"lane status": {exit: 7},
			"lane open": {exit: 48, err: "a child"},
			"lane release": {out: {}},
		});
		const held = standIn({
			"lane seats": seats["lane seats"],
			"lane claim": {exit: 31, err: "lost to another"},
		});

		expect(await booted.use((f) => f.claim({lane: "42", intent: "r/claim"}))).toMatchObject({
			success: {won: true, token: "lane:run-1:t"},
		});
		expect(booted.calls()).toEqual([
			"lane seats",
			"lane claim 42",
			"lane status 42",
			"lane open 42 --origin driver-pick",
		]);
		expect(await child.use((f) => f.claim({lane: "42", intent: "r/claim"}))).toMatchObject({
			success: {won: false, why: "not_a_lane"},
		});
		expect(child.calls().at(-1)).toBe("lane release 42 --token lane:run-1:t");
		expect(await held.use((f) => f.claim({lane: "42", intent: "r/claim"}))).toMatchObject({
			success: {won: false, why: "held"},
		});
	});

	it("writes a dead shell as a lap, and as a park where the state has no lap; a conflict outside ship is a park too", async () => {
		const lap = standIn({"lane report": {out: {}}});
		const noLap = standIn({"lane report": {exit: 12}, "lane transition": {out: {}}});

		expect(
			await lap.use((f) =>
				f.record({...at, pr: PR, fact: {kind: "shell_dead", why: "x"}, intent: "i1"}),
			),
		).toMatchObject({success: true});
		// The pull request comes with the request: no verb is spent finding it.
		expect(lap.calls()).toEqual([`lane report 42 --task issue --token SHELL-DEAD --pr ${PR}`]);
		expect(
			await noLap.use((f) =>
				f.record({...at, pr: PR, fact: {kind: "base_conflicted", pr: PR}, intent: "i2"}),
			),
		).toMatchObject({success: true});
		expect(noLap.calls()).toEqual([
			`lane report 42 --task issue --token BASE-CONFLICTED --pr ${PR}`,
			"lane transition 42 BLOCKED --task issue --cause base-conflicted",
		]);
	});

	it("answers a refused write as `false`, and writes an intent once however often it is sent", async () => {
		const refusing = standIn({"lane transition": {exit: 12}});
		const taking = standIn({"lane transition": {out: {}}});
		const started = {...at, pr: null, fact: {kind: "started"} as const, intent: "r/1/issue/record"};

		expect(await refusing.use((f) => f.record(started))).toMatchObject({success: false});
		expect(await taking.use((f) => f.record(started))).toMatchObject({success: true});
		expect(await taking.use((f) => f.record(started))).toMatchObject({success: true});
		expect(taking.calls().filter((c) => c.startsWith("lane transition"))).toEqual([
			"lane transition 42 WIP --task issue",
		]);
	});

	it("reads the pull request, the merge queue and a recipe's answer", async () => {
		const {use, calls} = standIn({
			"build verdicts": {out: {mergeability: "mergeable", requiredChecks: {state: "unknown"}}},
			"ship reconcile": {out: {outcome: "unresolved"}},
			"recipe unpark": {exit: 13},
		});

		expect(await use((f) => f.pr({...at, pr: PR}))).toMatchObject({
			success: {mergeable: "mergeable", checks: "pending"},
		});
		expect(await use((f) => f.queue({...at, pr: PR}))).toMatchObject({success: "waiting"});
		expect(await use((f) => f.unpark({...at, intent: "u1"}))).toMatchObject({success: "not_yet"});
		// One verb each: the pull request's number comes from the URL the lane's read gave.
		expect(calls()).toEqual([
			"build verdicts --pr 7",
			"ship reconcile 7 --polls 1 --json",
			"recipe unpark 42 --task issue",
		]);
	});
});
