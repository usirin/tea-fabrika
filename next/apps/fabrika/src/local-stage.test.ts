import {readdirSync, mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, expect, it} from "@effect/vitest";
import {Effect} from "effect";
import {brainOutbox} from "./local-stage.ts";

const homes: Array<string> = [];
const home = () => {
	const folder = mkdtempSync(join(tmpdir(), "p12-m-"));
	homes.push(folder);
	return folder;
};
afterEach(() => {
	for (const folder of homes.splice(0)) rmSync(folder, {recursive: true, force: true});
});
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
