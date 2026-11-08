import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import {Effect, FileSystem, Layer, Schema, type Scope} from "effect";
import {describe, expect, it} from "vitest";
import {fileStorage} from "../program/storage-node.ts";
import {Agent, User} from "./writer.ts";

// Today's summon contract puts rooms in this library, not apps/fabrika/src/host.
// Real file storage, reopened through the service. No fake DM store acknowledges its own write.
type Message = {
	readonly id: string;
	readonly by: unknown;
	readonly text: string;
	readonly replyTo: string | null;
};
type Client = {
	send: (value: unknown) => Effect.Effect<{readonly _tag: string; readonly id: string}, unknown>;
	read: (query: {after: number; limit: number}) => Effect.Effect<readonly Message[], unknown>;
};
type RoomService = {for: (writer: unknown) => Client};
type Manager = {
	make: (options: {
		storage: ReturnType<typeof fileStorage>;
	}) => Effect.Effect<
		RoomService,
		unknown,
		FileSystem.FileSystem | import("effect").Path.Path | Scope.Scope
	>;
};
const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const {AGENT, OWNER, DELIVERY} = Schema.decodeUnknownSync(
	Schema.Struct({AGENT: Agent, OWNER: User, DELIVERY: Schema.Unknown}),
)(
	JSON.parse(
		readFileSync(new URL("../../../../fixtures/inbox/actors.json", import.meta.url), "utf8"),
	),
);

describe("today's native DM service", () => {
	it("I8/I11: a lost acknowledgement and restart still write the same reply only once", async () => {
		const path = "./rooms.ts";
		expect(
			existsSync(new URL(path, import.meta.url)),
			"I8/I11: no summon DM record or acknowledgement service exists",
		).toBe(true);
		const module = await import(path);
		const manager: Manager = Reflect.get(module, "RoomManager");
		expect(manager, "I8/I11: no kept room service").toBeDefined();
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const dir = yield* fs.makeTempDirectoryScoped({prefix: "ir-"});
				const storage = fileStorage(join(dir, "rooms"));
				const first = yield* Effect.scoped(
					Effect.gen(function* () {
						const rooms = yield* manager.make({storage});
						const owner = rooms.for(OWNER);
						// The receiver saves, but the caller loses the acknowledgement. Retry the same id.
						yield* owner.send(DELIVERY);
						return yield* owner.send(DELIVERY);
					}),
				);
				const rooms = yield* manager.make({storage});
				const again = yield* rooms.for(OWNER).send(DELIVERY);
				const received = yield* rooms.for(AGENT).read({after: 0, limit: 100});
				return {first, again, received};
			}).pipe(Effect.scoped, Effect.provide(platform)),
		);
		expect(seen.first.id).toBe("r18");
		expect(seen.again.id).toBe("r18");
		expect(seen.received.filter((m) => m.id === "r18")).toEqual([
			expect.objectContaining({by: OWNER, replyTo: "m17", text: "Please fix it."}),
		]);
	});
});
