// P23, next/. The box cannot launch Electron, Chromium, sockets or launchd.
// The driver runs these same scenarios outside the box, with a short isolated home.
import {execFileSync, spawnSync} from "node:child_process";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync} from "node:fs";
import {join, resolve} from "node:path";
import {Entry, LedgerError} from "@kampus/libfabrika/data";
import {Context, Effect, Fiber, Redacted, Schema} from "effect";
import type {Browser, ElectronApplication, Page} from "playwright";

export class DemoError extends Schema.TaggedError<DemoError>()("DemoError", {
	why: Schema.Literals(["launch", "browser", "stage", "timeout", "cleanup"]),
}) {}
export const DemoOptions = Schema.Struct({
	home: Schema.NonEmptyString,
	label: Schema.NonEmptyString,
	layout: Schema.Literals(["one", "side", "stacked", "2x2", "small"]),
	look: Schema.Literals(["dark", "light"]),
	brain: Schema.Literals(["stand-in", "launchd"]),
	seal: Schema.Literals(["stand-in", "real"]),
});
export type DemoOptions = typeof DemoOptions.Type;

// Exact P19 service names. These declare outside effects, never a second lifecycle machine.
class DesktopDown extends Schema.TaggedError<DesktopDown>()("DesktopDown", {
	why: Schema.Literals([
		"storage",
		"existing_data",
		"bad_home",
		"bad_key",
		"crypto",
		"seal_unavailable",
		"port_taken",
		"foreign_service",
		"launchctl",
		"startup",
		"stop",
		"unsupported",
	]),
}) {}
export class BrainService extends Context.Service<
	BrainService,
	{
		readonly up: Effect.Effect<{readonly url: string}, DesktopDown>;
		readonly stop: Effect.Effect<void, DesktopDown>;
	}
>()("@kampus/libfabrika/BrainService") {}
export class Seal extends Context.Service<
	Seal,
	{
		readonly available: Effect.Effect<boolean, DesktopDown>;
		readonly encrypt: (
			plain: Redacted.Redacted<string>,
		) => Effect.Effect<Redacted.Redacted<Uint8Array>, DesktopDown>;
		readonly decrypt: (
			sealed: Redacted.Redacted<Uint8Array>,
		) => Effect.Effect<
			{readonly plain: Redacted.Redacted<string>; readonly rotate: boolean},
			DesktopDown
		>;
	}
>()("@kampus/libfabrika/Seal") {}

export interface P23Control {
	readonly url: string;
	answerCheck(answer: "touch" | "click" | "no"): void;
	takeOpened(): string | PromiseLike<string>;
	entries(): unknown | PromiseLike<unknown>;
	diagnostics(): ReadonlyArray<string> | PromiseLike<ReadonlyArray<string>>;
	observations(): unknown;
	privateFilesAreSealed(): boolean;
	expireLinks(): void;
	killBrain(): void;
	quit(): void;
	stop(): void | PromiseLike<void>;
}
declare global {
	var fabrika: Record<string, unknown> | undefined;
	var p23: P23Control;
	var p23Closes: number[];
	var p23Startup: string[];
	var p23History: Array<{name: "replaceState" | "pushState"; state: unknown; url: string}>;
}

// One marked platform edge shared by the test driver. Errors carry a fixed reason only.
export const outside = Effect.fn("test.p23Outside")(
	<A>(why: typeof DemoError.fields.why.Type, call: () => PromiseLike<A>) =>
		// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright and its build tools return Promises
		Effect.tryPromise({try: () => call(), catch: () => new DemoError({why})}),
);

export const freshHome = Effect.fn("test.p23Home")(function* () {
	const home = yield* Effect.sync(() => mkdtempSync("/tmp/fh."));
	// Cleanup follows app/service cleanup because finalizers run in reverse order.
	yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(home, {recursive: true, force: true})));
	return home;
});
const requiredPage = (page: Page | undefined): Page => {
	if (!page) throw new DemoError({why: "launch"});
	return page;
};

export const launchP23 = Effect.fn("test.launchP23")(function* (input: DemoOptions) {
	const options = yield* Schema.decodeUnknownEffect(DemoOptions)(input).pipe(
		Effect.mapError(() => new DemoError({why: "launch"})),
	);
	const root = resolve(import.meta.dirname, "../../../..");
	// Deferred missing product export is red before any process or listener is started.
	const electronPath = "@kampus/libfabrika/electron";
	// oxlint-disable-next-line fabrika/no-promises -- edge: the test driver loads the real product entry lazily
	const product = yield* Effect.promise(() => import(electronPath));
	if (typeof product.desktopApp !== "function") return yield* new DemoError({why: "launch"});
	const main = join(root, "fixtures/next/p23/main.ts");
	if (!existsSync(main) || !existsSync(join(root, "next/apps/fabrika/build.ts")))
		return yield* new DemoError({why: "launch"});
	// Build P12's real stage and real browser/renderer entries first. No direct Miniflare fixture.
	const built = join(options.home, "built");
	yield* Effect.sync(() => mkdirSync(built, {recursive: true}));
	yield* Effect.try({
		try: () =>
			execFileSync("node", ["next/apps/fabrika/build.ts", "--out", built], {
				cwd: root,
				env: {
					...process.env,
					FABRIKA_HOME: options.home,
					TYPESAFE_API_KEY: undefined,
					FABRIKA_FOREGROUND: undefined,
				},
				stdio: "pipe",
			}),
		catch: () => new DemoError({why: "launch"}),
	});
	const builderPath = "esbuild",
		playwrightPath = "playwright";
	// oxlint-disable-next-line fabrika/no-promises -- edge: esbuild is the test entry's bundler
	const builder = yield* Effect.promise(() => import(builderPath));
	const output = join(options.home, "p23-main.cjs");
	yield* outside("launch", () =>
		builder.build({
			entryPoints: [main],
			outfile: output,
			bundle: true,
			platform: "node",
			format: "cjs",
			external: ["electron"],
			alias: {
				"@kampus/libfabrika": join(root, "next/packages/libfabrika"),
				"@kampus/counter": join(root, "next/programs/counter"),
			},
			sourcemap: false,
		}),
	);
	// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright supplies Electron and Chromium drivers
	const {_electron, chromium} = yield* Effect.promise(() => import(playwrightPath));
	const env = {
		...process.env,
		FABRIKA_HOME: options.home,
		P23_OPTIONS: JSON.stringify(options),
		P23_BUILT: built,
	};
	delete env.TYPESAFE_API_KEY;
	delete env.FABRIKA_FOREGROUND;
	let app: ElectronApplication = yield* outside("launch", () =>
		_electron.launch({args: [output], env, cwd: root}),
	);
	const mainDiagnostics: string[] = [];
	const captureMain = () => {
		for (const output of [app.process().stdout, app.process().stderr])
			output?.on("data", (chunk) => {
				mainDiagnostics.push(String(chunk));
			});
	};
	captureMain();
	// Register each cleanup as soon as its process exists, including partial startup failures.
	yield* Effect.addFinalizer(() => outside("cleanup", () => app.close()).pipe(Effect.ignore));
	yield* Effect.addFinalizer(() => stopOwned(options.home, options.label, options.brain));
	let window: Page = yield* outside("launch", () => app.firstWindow());
	const browser: Browser = yield* outside("browser", () => chromium.launch());
	yield* Effect.addFinalizer(() => outside("cleanup", () => browser.close()).pipe(Effect.ignore));
	const control = <A>(why: typeof DemoError.fields.why.Type, fn: () => A) =>
		outside(why, () => app.evaluate(fn));
	const stop = Effect.gen(function* () {
		yield* control("cleanup", () => globalThis.p23.stop()).pipe(Effect.catch(() => Effect.void));
		yield* outside("cleanup", () => browser.close());
		yield* outside("cleanup", () => app.close()).pipe(Effect.catch(() => Effect.void));
	});
	const url = yield* control("stage", () => globalThis.p23.url);
	// The menu window may already exist by the time the founding page appears.
	const menuWindow = () =>
		Effect.gen(function* () {
			const existing = app.windows().find((page) => page !== window);
			return (
				existing ??
				(yield* outside("launch", () =>
					app.waitForEvent("window", {predicate: (page: Page) => page !== window}),
				))
			);
		});
	// Founding must finish before P21 can create its connected menu window.
	let popover: Page | undefined;
	const menuReady = Effect.gen(function* () {
		popover = yield* menuWindow();
	});
	return {
		get app() {
			return app;
		},
		get window() {
			return window;
		},
		get popover() {
			return requiredPage(popover);
		},
		menuReady,
		browser,
		url,
		answerCheck: Effect.fn("test.p23Check")((answer: "touch" | "click" | "no") =>
			outside("launch", () =>
				app.evaluate((_, answer) => globalThis.p23.answerCheck(answer), answer),
			),
		),
		takeOpened: control("browser", () => globalThis.p23.takeOpened()).pipe(
			Effect.map(Redacted.make),
		),
		entries: control("stage", () => globalThis.p23.entries()).pipe(
			Effect.mapError(() => new LedgerError({why: "unreachable"})),
			Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Entry))),
			Effect.mapError(() => new LedgerError({why: "bad_row"})),
		),
		diagnostics: Effect.try({
			try: () => [
				...Schema.decodeUnknownSync(Schema.Array(Schema.String))(
					JSON.parse(readFileSync(join(options.home, "p23-diagnostics.json"), "utf8")),
				),
				...mainDiagnostics,
				...(existsSync(join(options.home, "p23-stage.log"))
					? [readFileSync(join(options.home, "p23-stage.log"), "utf8")]
					: []),
			],
			catch: () => new DemoError({why: "stage"}),
		}),
		observations: control("stage", () => globalThis.p23.observations()).pipe(
			Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.Json))),
		),
		privateFilesAreSealed: control("stage", () => globalThis.p23.privateFilesAreSealed()),
		expireLinks: control("launch", () => globalThis.p23.expireLinks()),
		killApp: Effect.sync(() => app.process().kill("SIGKILL")),
		killBrain: control("stage", () => globalThis.p23.killBrain()),
		reopen: Effect.gen(function* () {
			app = yield* outside("launch", () => _electron.launch({args: [output], env, cwd: root}));
			captureMain();
			window = yield* outside("launch", () => app.firstWindow());
			popover = yield* menuWindow();
		}),
		quit: Effect.gen(function* () {
			const closed = yield* Effect.forkChild(outside("cleanup", () => app.waitForEvent("close")));
			yield* control("cleanup", () => globalThis.p23.quit()).pipe(Effect.ignore);
			yield* Fiber.join(closed);
		}),
		stop,
	};
});

export const startDemo = Effect.fn("test.startDemo")(function* (over: Partial<DemoOptions> = {}) {
	const home = yield* freshHome();
	return yield* launchP23({
		home,
		label: `test.p23.${home.split("/").at(-1)}`,
		layout: "one",
		look: "dark",
		brain: "stand-in",
		seal: "stand-in",
		...over,
	});
});
export type Demo = Effect.Success<ReturnType<typeof startDemo>>;
export const visible = (page: Page, words: string | RegExp) =>
	outside("timeout", () => page.getByText(words, {exact: true}).waitFor({state: "visible"}));
export const click = (page: Page, name: string | RegExp) =>
	outside("browser", () => page.getByRole("button", {name, exact: true}).click());
export const count = (page: Page) =>
	outside("browser", () => page.getByRole("status", {name: "Count"}).allTextContents());
export const press = (page: Page) => click(page, "Add one");
// Independent network oracle. Saved evidence has no permitted secret-bearing field.
export const leaks = (secret: string, value: unknown): boolean => {
	let text = JSON.stringify(value);
	const forms = [
		secret,
		Buffer.from(secret).toString("base64"),
		Buffer.from(secret).toString("base64url"),
	];
	for (;;) {
		if (forms.some((form) => text.includes(form))) return true;
		const decoded = text
			.replace(/%([a-f\d]{2})/gi, (_, n) => String.fromCharCode(Number.parseInt(n, 16)))
			.replace(/\\u([a-f\d]{4})/gi, (_, n) => String.fromCharCode(Number.parseInt(n, 16)));
		if (decoded === text) return false;
		text = decoded;
	}
};
const invokeNative = ({Menu}: typeof import("electron")) => {
	const visit = (menu: Electron.Menu): Electron.MenuItem | undefined => {
		for (const item of menu.items) {
			if (item.label === "Open in browser") return item;
			if (item.submenu) {
				const found = visit(item.submenu);
				if (found) return found;
			}
		}
		return undefined;
	};
	const menu = Menu.getApplicationMenu();
	const item = menu && visit(menu);
	if (!item) throw new Error("native browser action missing");
	item.click(item, undefined, {triggeredByAccelerator: false});
};
export const openLink = Effect.fn("test.p23OpenLink")(function* (demo: Demo) {
	yield* demo.menuReady;
	// This invokes the actual native MenuItem callback, not a renderer or brain method.
	yield* outside("launch", () => demo.app.evaluate(invokeNative));
	return yield* demo.takeOpened;
});
export const linkTab = Effect.fn("test.p23LinkTab")(function* (demo: Demo) {
	const opened = yield* openLink(demo);
	const context = yield* outside("browser", () => demo.browser.newContext());
	yield* outside("browser", () =>
		context.addInitScript(() => {
			globalThis.p23Closes = [];
			const Original = WebSocket;
			globalThis.WebSocket = class extends Original {
				constructor(...args: ConstructorParameters<typeof WebSocket>) {
					super(...args);
					this.addEventListener("close", (event) => {
						globalThis.p23Closes.push(event.code);
					});
				}
			};
		}),
	);
	const page = yield* outside("browser", () => context.newPage());
	// oxlint-disable-next-line fabrika/no-redacted-value -- the driver hands a made-up test link to Chromium
	yield* outside("browser", () => page.goto(Redacted.value(opened)));
	return {context, page, opened};
});

// A killed app cannot answer IPC. Cleanup therefore reads only this fixture's saved process IDs.
const stopOwned = (home: string, label: string, brain: DemoOptions["brain"]) =>
	Effect.try({
		try: () => {
			if (brain === "launchd") {
				if (!label.startsWith("test.p23.")) throw new DemoError({why: "cleanup"});
				spawnSync("launchctl", ["bootout", `gui/${process.getuid?.()}/${label}`], {
					stdio: "ignore",
				});
			}
			const path = join(home, "p23-brain.json");
			if (existsSync(path)) {
				const child = Schema.decodeUnknownSync(Schema.Struct({pid: Schema.Int}))(
					JSON.parse(readFileSync(path, "utf8")),
				);
				if (child.pid <= 1) throw new DemoError({why: "cleanup"});
				try {
					process.kill(-child.pid, "SIGTERM");
				} catch (error) {
					if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
				}
			}
		},
		catch: () => new DemoError({why: "cleanup"}),
	});

export const launchdState = (label: string) =>
	Effect.try({
		try: () => {
			const result = spawnSync("launchctl", ["print", `gui/${process.getuid?.()}/${label}`], {
				encoding: "utf8",
			});
			if (result.status === 0) {
				const pid = /\bpid = (\d+)/.exec(result.stdout)?.[1];
				if (pid) return `pid:${pid}`;
				throw new DemoError({why: "cleanup"});
			}
			if (result.stderr.includes("Could not find service") && result.stderr.includes(label))
				return "absent";
			throw new DemoError({why: "cleanup"});
		},
		catch: () => new DemoError({why: "cleanup"}),
	});

const readOwnedProcessIds = (home: string, state: string, brain: DemoOptions["brain"]) => {
	const pid =
		brain === "launchd"
			? Number(state.replace("pid:", ""))
			: Schema.decodeUnknownSync(Schema.Struct({pid: Schema.Int}))(
					JSON.parse(readFileSync(join(home, "p23-brain.json"), "utf8")),
				).pid;
	if (!Number.isSafeInteger(pid) || pid <= 1) throw new DemoError({why: "cleanup"});
	const ids = [pid];
	for (let n = 0; n < ids.length; n++) {
		const children = spawnSync("pgrep", ["-P", String(ids[n])], {encoding: "utf8"});
		if (children.error || (children.status !== 0 && children.status !== 1))
			throw new DemoError({why: "cleanup"});
		for (const child of children.stdout.trim().split(/\s+/).filter(Boolean).map(Number)) {
			if (!Number.isSafeInteger(child) || child <= 1) throw new DemoError({why: "cleanup"});
			if (!ids.includes(child)) ids.push(child);
		}
	}
	return ids;
};
export const ownedProcessIds = Effect.fn("test.p23OwnedProcessIds")(function* (
	home: string,
	label: string,
	brain: DemoOptions["brain"],
) {
	const state = brain === "launchd" ? yield* launchdState(label) : "";
	return yield* Effect.try({
		try: () => readOwnedProcessIds(home, state, brain),
		catch: () => new DemoError({why: "cleanup"}),
	});
});
export const processesAbsent = (ids: ReadonlyArray<number>) =>
	Effect.sync(() =>
		ids.every((pid) => {
			try {
				process.kill(pid, 0);
				return false;
			} catch (error) {
				return error instanceof Error && "code" in error && error.code === "ESRCH";
			}
		}),
	);
