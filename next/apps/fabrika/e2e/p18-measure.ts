// Run baseline and candidate in one sitting. Keep each JSON reading, not only a summary.
// node next/apps/fabrika/e2e/p18-measure.ts baseline > /tmp/p18-before.json
// node next/apps/fabrika/e2e/p18-measure.ts candidate > /tmp/p18-after.json
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {registerHooks} from "node:module";
import {fileURLToPath} from "node:url";
import {NodeRuntime} from "@effect/platform-node";
import {Console, Effect, Schema} from "effect";
import {transformSync} from "oxc-transform-react";

// Native Node strips types but rejects main's constructor parameter properties. The same
// installed oxc transform the browser build uses removes them for this measurement command.
registerHooks({
	load(url, context, next) {
		const loaded = next(url, context);
		if (!url.endsWith(".ts") || loaded.source === undefined || loaded.source === null)
			return loaded;
		const text =
			typeof loaded.source === "string" ? loaded.source : new TextDecoder().decode(loaded.source);
		return {...loaded, format: "module", source: transformSync(fileURLToPath(url), text).code};
	},
});

class MeasureDown extends Schema.TaggedError<MeasureDown>()("MeasureDown", {
	message: Schema.String,
}) {}
const failed = (error: unknown) => new MeasureDown({message: String(error)});

const State = Schema.Struct({tiles: Schema.Record(Schema.String, Schema.Unknown)});
const Package = Schema.Struct({version: Schema.String});
const version = (name: string) =>
	Schema.decodeUnknownSync(Schema.fromJsonString(Package))(
		readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), "utf8"),
	).version;
const program = Effect.gen(function* () {
	// oxlint-disable-next-line fabrika/no-promises -- edge: Node imports the transformed measurement driver
	const {browserStep, openP18Browser, readBrowser, withP18Stage} = yield* Effect.tryPromise({
		// oxlint-disable-next-line fabrika/no-promises -- edge: Node resolves the test driver after installing its type loader
		try: () => import("./p18.test-support.ts"),
		catch: failed,
	});
	// oxlint-disable-next-line fabrika/no-promises -- edge: Node imports the public client event schemas
	const {Via} = yield* Effect.tryPromise({try: () => import("@kampus/libfabrika"), catch: failed});
	return yield* Effect.scoped(
		withP18Stage((stage) =>
			Effect.gen(function* () {
				const {browser, page, errors} = yield* openP18Browser(stage);
				const initial = yield* readBrowser(page);
				if (initial.length !== 16)
					return yield* Effect.die(new Error("p50 requires exactly 16 displayed tiles"));
				const state = yield* Schema.decodeUnknownEffect(State)(
					yield* browserStep(() => page.evaluate(() => window.p18.state())),
				);
				const tiles = Object.keys(state.tiles);
				const readings: Array<{
					readonly tile: string;
					readonly width: number;
					readonly height: number;
					readonly ms: number;
					readonly before: unknown;
					readonly after: unknown;
				}> = [];
				for (const layout of [
					{width: 4096, height: 900},
					{width: 1024, height: 700},
				]) {
					yield* browserStep(() => page.setViewportSize(layout));
					yield* browserStep(() => page.evaluate(() => window.p18.ready()));
					for (const tile of tiles) {
						yield* browserStep(() =>
							page.evaluate((tile) => window.p18.send({type: "focus", tile}), tile),
						);
						yield* browserStep(() => page.evaluate(() => window.p18.ready()));
						yield* browserStep(() => page.evaluate(() => window.p18.reset()));
						const before = yield* readBrowser(page);
						const started = performance.now();
						yield* browserStep(() =>
							page.evaluate(
								({tile, via}) => window.p18.send({type: "press", tile, m: {type: "inc"}, via}),
								{tile, via: Via.cases.click.make({})},
							),
						);
						yield* browserStep(() =>
							page.waitForFunction(() => window.p18.readings().some((r) => r.commits > 0)),
						);
						yield* browserStep(() => page.evaluate(() => window.p18.ready()));
						const after = yield* readBrowser(page);
						readings.push({tile, ...layout, ms: performance.now() - started, before, after});
					}
				}
				if (errors.length > 0) return yield* Effect.die(new Error(errors.join("\n")));
				yield* Console.log(
					JSON.stringify(
						{
							version: 1,
							phase: process.argv[2] ?? "unlabeled",
							seed: 119120,
							at: new Date().toISOString(),
							commit: execFileSync("git", ["rev-parse", "HEAD"], {encoding: "utf8"}).trim(),
							versions: {
								node: process.version,
								chromium: browser.version(),
								react: version("react"),
								tea: version("@demlik/tea"),
								effect: version("effect"),
								compiler: version("oxc-transform-react"),
							},
							readings,
						},
						null,
						2,
					),
				);
			}),
		),
	);
});

NodeRuntime.runMain(program);
