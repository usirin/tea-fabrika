import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import {JevReceipts} from "@kampus/pipeline/jev-live";
import {Jev} from "@kampus/pipeline/services";
import {Context, Effect, FileSystem, Layer, Option, Path} from "effect";
import {describe, expect, it} from "vitest";
import {HOST_CAP, hostJev, JEV_KEY_FILE} from "./jev.ts";

// The host's Jev is on only when its home holds a key file. No call is made here.

const found = (write: string | null) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const home = yield* fs.makeTempDirectoryScoped({prefix: "jev-"});
		if (write !== null)
			yield* fs.writeFileString((yield* Path.Path).join(home, JEV_KEY_FILE), write);
		const context = yield* Layer.build(hostJev(home));
		return {
			jev: Option.isSome(Context.getOption(context, Jev)),
			receipts: Option.isSome(Context.getOption(context, JevReceipts)),
		};
	}).pipe(Effect.scoped, Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)));

describe("the host's Jev", () => {
	it("is off on a home with no key file, so the tracker asks nothing", async () => {
		expect(await Effect.runPromise(found(null))).toEqual({jev: false, receipts: false});
	});

	it("is off on a key file with nothing in it", async () => {
		expect(await Effect.runPromise(found(" \n"))).toEqual({jev: false, receipts: false});
	});

	it("is on, with its receipts, on a home that holds a key, capped", async () => {
		expect(await Effect.runPromise(found("not-a-key\n"))).toEqual({jev: true, receipts: true});
		expect(HOST_CAP).toEqual({calls: 2_000, usd: 0.25});
	});
});
