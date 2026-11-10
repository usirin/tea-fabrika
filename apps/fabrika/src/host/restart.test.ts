import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import {Effect, FileSystem, Layer, Path, type Scope} from "effect";
import {describe, expect, it} from "vitest";
import {personOn} from "./restart.ts";

// Who the person's own restart names (tracker 185b, PR 5): read from the home's ledger.json alone.
// Today's version. Owed by the mutation step on PR 382: no test before reached a connected home.
//
//   no ledger.json                    user:owner
//   ledger.json {"login": "ana"}      user:ana
//   a login that is not one word of 1 to 100 characters, none, or a file that does not read: null

const run = <A, E>(test: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope>) =>
	Effect.runPromise(
		test.pipe(Effect.scoped, Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
	);

/** The person on a fresh home whose ledger.json holds `text`, or none when `text` is null. */
const personWith = (text: string | null) =>
	run(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const home = yield* fs.makeTempDirectoryScoped({prefix: "pr-"});

			if (text !== null) {
				yield* fs.writeFileString(path.join(home, "ledger.json"), text);
			}

			return yield* personOn(home);
		}),
	);

describe("the person a restart from the window names", () => {
	it("is the owner on a home with no ledger.json", async () => {
		expect(await personWith(null)).toBe("user:owner");
	});

	it("is the login a connected home signs in as", async () => {
		expect(await personWith(JSON.stringify({login: "ana"}))).toBe("user:ana");
		const longest = "a".repeat(100);
		expect(await personWith(JSON.stringify({login: longest}))).toBe(`user:${longest}`);
	});

	it("is none for a login that is not one word of 1 to 100 characters, no login, or a file that does not read", async () => {
		for (const text of [
			JSON.stringify({login: "a b"}),
			JSON.stringify({login: "a".repeat(101)}),
			JSON.stringify({login: "a\nb"}),
			JSON.stringify({login: ""}),
			JSON.stringify({url: "https://ledger.example"}),
			"not json",
		]) {
			expect(await personWith(text), text).toBeNull();
		}
	});
});
