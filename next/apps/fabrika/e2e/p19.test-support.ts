// P19, next/. Starts the P19 Electron fixture (fixtures/next/p19) on its own short temp home, for
// the e2e laws beside this file. The fixture composes the same libfabrika entry as the app with
// test Layers; production has no flag that picks a stand-in seal (plan "Tests before
// implementation").
//
// What it needs from the build, the e2e's side of the contract (a plan gap, for the lead): the
// app's `build.ts` writes, into `--out <dir>`, the founding page `founding.html`, the two preloads
// `preload-founding.js` and `preload-window.js`, and the bundled P12 brain entry `brain.js`. This
// file then bundles the fixture's own `main.ts` and stand-in `brain.ts` beside them.
//
// One Electron app at a time, never FABRIKA_FOREGROUND, never a real home, never a key in the
// environment. Playwright answers Promises, so each call is one marked edge.
import {execFileSync, spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {createRequire} from "node:module";
import {join, resolve} from "node:path";
import type {Scope} from "effect";
import {Effect, FileSystem, Schema} from "effect";
import {buildSync} from "esbuild";
import {_electron, type ElectronApplication, type Page} from "playwright";

export class StageTestDown extends Schema.TaggedError<StageTestDown>()("StageTestDown", {
	why: Schema.Literals(["build", "bundle", "launch", "window", "stop"]),
	detail: Schema.String,
}) {}

const APP = resolve(import.meta.dirname, "..");
const ROOT = resolve(APP, "../../..");
const FIXTURE = join(ROOT, "fixtures/next/p19");
const fromApp = createRequire(join(APP, "package.json"));

/** The Electron binary the app depends on, and the label namespace no real app uses. */
export const ELECTRON: string = fromApp("electron");
export const testLabel = (): string => `dev.fabrika.test.p19.${randomBytes(4).toString("hex")}`;
export const DOMAIN = `gui/${process.getuid?.() ?? 0}`;

/** `launchctl print` of a label: 0 while it is loaded, 113 once it is gone (experiment 214). */
export const printLabel = (label: string): {readonly code: number; readonly pid: number} => {
	const out = spawnSync("launchctl", ["print", `${DOMAIN}/${label}`], {encoding: "utf8"});
	return {code: out.status ?? -1, pid: Number(/\bpid = (\d+)/.exec(out.stdout ?? "")?.[1] ?? 0)};
};
/** Boot a test label out and say whether it is gone. Never touches a label outside the test space. */
export const bootoutLabel = (label: string): boolean => {
	if (!label.startsWith("dev.fabrika.test.")) throw new Error(`refusing to boot out ${label}`);
	spawnSync("launchctl", ["bootout", `${DOMAIN}/${label}`], {stdio: "ignore"});
	return printLabel(label).code === 113;
};
export const alive = (pid: number): boolean =>
	pid > 0 && spawnSync("kill", ["-0", String(pid)], {stdio: "ignore"}).status === 0;

const fail = (why: StageTestDown["why"]) => (cause: unknown) =>
	new StageTestDown({why, detail: cause instanceof Error ? cause.message : String(cause)});

/** The app's build, then the fixture beside it, in a fresh folder of the scope. */
const assemble = (product: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const out = yield* fs
			.makeTempDirectoryScoped({directory: "/tmp", prefix: "p19b."})
			.pipe(Effect.mapError(fail("build")));
		yield* Effect.try({
			try: () =>
				execFileSync(process.execPath, [join(APP, "build.ts"), "--out", out], {
					cwd: APP,
					stdio: "pipe",
				}),
			catch: fail("build"),
		});
		yield* Effect.try({
			try: () =>
				buildSync({
					entryPoints: {
						"p19-main": join(FIXTURE, "main.ts"),
						"p19-brain": join(FIXTURE, "brain.ts"),
					},
					outdir: out,
					bundle: true,
					platform: "node",
					format: "esm",
					external: ["electron"],
					nodePaths: [join(APP, "node_modules")],
					logLevel: "silent",
				}),
			catch: fail("bundle"),
		});
		const template = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(
			JSON.parse(
				yield* fs
					.readFileString(join(FIXTURE, "package.json"))
					.pipe(Effect.mapError(fail("bundle"))),
			),
		);
		yield* fs
			.writeFileString(
				join(out, "package.json"),
				JSON.stringify({...template, productName: product, main: "p19-main.js"}),
			)
			.pipe(Effect.mapError(fail("bundle")));
		return out;
	});

export const launchP19 = (options: {
	readonly home: string;
	readonly label: string;
	readonly seal: "stand-in" | "real";
	readonly brain: "stand-in" | "launchd";
	/** The productName, which names the real seal's Keychain item. */
	readonly product?: string;
	/** Extra fixture switches, such as `P19_CORRUPT`. */
	readonly env?: Readonly<Record<string, string>>;
	/** The build folder of an earlier launch, so a reopen runs the same bytes. */
	readonly built?: string;
}): Effect.Effect<
	{
		readonly app: ElectronApplication;
		readonly page: Page;
		readonly url: string;
		readonly built: string;
		readonly stop: Effect.Effect<void, StageTestDown>;
	},
	StageTestDown,
	Scope.Scope | FileSystem.FileSystem
> =>
	Effect.gen(function* () {
		const built =
			options.built ??
			(yield* assemble(options.product ?? `fabrika-p19-${options.label.slice(-8)}`));
		const env: Record<string, string> = {
			PATH: process.env["PATH"] ?? "/usr/bin:/bin",
			HOME: process.env["HOME"] ?? "/tmp",
			FABRIKA_HOME: options.home,
			P19_LABEL: options.label,
			P19_SEAL: options.seal,
			P19_BRAIN: options.brain,
			P19_BUILT: built,
			...options.env,
		};
		const args = [
			built,
			...(process.platform === "linux" && process.env["CI"] ? ["--no-sandbox"] : []),
		];
		const launched = yield* Effect.acquireRelease(
			// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright starts Electron through a Promise
			Effect.tryPromise({
				try: () => _electron.launch({executablePath: ELECTRON, args, env}),
				catch: fail("launch"),
			}),
			(app) =>
				// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright closes Electron through a Promise
				Effect.tryPromise({try: () => app.close(), catch: fail("stop")}).pipe(Effect.ignore),
		);
		// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright hands the first window through a Promise
		const page = yield* Effect.tryPromise({
			try: () => launched.firstWindow(),
			catch: fail("window"),
		});
		return {
			app: launched,
			page,
			url: page.url(),
			built,
			// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright quits Electron through a Promise
			stop: Effect.tryPromise({
				try: () => launched.evaluate(({app}) => app.quit()),
				catch: fail("stop"),
			}),
		};
	});
