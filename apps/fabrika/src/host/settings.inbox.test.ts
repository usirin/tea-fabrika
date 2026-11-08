import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import {Effect, FileSystem, Layer, Result, type Scope} from "effect";
import {describe, expect, it} from "vitest";
import {member} from "../../../../fixtures/inbox/subject.ts";
import * as settings from "./settings.ts";

type SettingManager = {
	choose: (program: string) => Effect.Effect<unknown, {why: string}>;
	get: () => {choice: string; effective: string; why: string | null};
	providers: (names: readonly string[]) => void;
};
type Make = (options: {
	folder: string;
}) => Effect.Effect<
	SettingManager,
	unknown,
	FileSystem.FileSystem | import("effect").Path.Path | Scope.Scope
>;

describe("today's glance choice", () => {
	it("I18: saves one choice without losing theme, falls back temporarily, and retains last good after refusal", async () => {
		const make = member<Make>(
			settings,
			"glanceSettings",
			"I18: shared personal settings do not keep a glance choice",
		);
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const home = yield* fs.makeTempDirectoryScoped({prefix: "ig-"});
				const path = `${home}/fabrika.toml`;
				yield* fs.writeFileString(path, 'theme = "dark"\nother = "keep"\n');
				const initial = yield* make({folder: home});
				initial.providers(["inbox", "tracker"]);
				expect(initial.get()).toMatchObject({choice: "inbox", effective: "inbox"});
				yield* initial.choose("tracker");
				expect(initial.get()).toMatchObject({choice: "tracker", effective: "tracker"});
				initial.providers(["inbox"]);
				expect(initial.get()).toMatchObject({choice: "tracker", effective: "inbox"});
				initial.providers(["inbox", "tracker"]);
				expect(initial.get()).toMatchObject({choice: "tracker", effective: "tracker"});
				const saved = yield* fs.readFileString(path);
				const reopened = yield* make({folder: home});
				reopened.providers(["inbox", "tracker"]);
				expect(reopened.get()).toMatchObject({choice: "tracker", effective: "tracker"});
				yield* fs.remove(path);
				yield* fs.makeDirectory(path);
				const refused = yield* initial.choose("inbox").pipe(Effect.result);
				expect(Result.isFailure(refused)).toBe(true);
				expect(initial.get()).toMatchObject({
					choice: "tracker",
					effective: "tracker",
					why: expect.any(String),
				});
				return saved;
			}).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
		);
		expect(seen).toContain('theme = "dark"');
		expect(seen).toContain('other = "keep"');
	});
});
