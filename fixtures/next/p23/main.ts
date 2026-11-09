import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {closeSync, existsSync, openSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
// P23, next/. Test-only wiring. The library owns founding, admission, menus, layouts and lifecycle.
// The external browser and person check are controlled outside operations. No renderer gets them.
import {NodeRuntime, NodeServices} from "@effect/platform-node";
import {counter} from "@kampus/counter";
import {Entry, Id, IdGenerator} from "@kampus/libfabrika/data";
import {
	Clock,
	Duration,
	Effect,
	Fiber,
	Layer,
	ManagedRuntime,
	Option,
	Queue,
	Redacted,
	Schema,
	Stream,
} from "effect";
import {Socket} from "effect/socket";
import {app} from "electron";
import {
	BrainService,
	DemoOptions,
	type P23Control,
	Seal,
} from "../../../next/apps/fabrika/e2e/p23.test-support.ts";

const run = Effect.scoped(
	Effect.gen(function* () {
		const options = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(DemoOptions))(
			process.env.P23_OPTIONS,
		);
		const built = yield* Schema.decodeUnknownEffect(Schema.NonEmptyString)(process.env.P23_BUILT);
		const liveClock = yield* Clock.Clock;
		let elapsed = 0;
		const mainClock: Clock.Clock = {
			...liveClock,
			currentTimeMillisUnsafe: () => liveClock.currentTimeMillisUnsafe() + elapsed,
			currentTimeMillis: Effect.sync(() => liveClock.currentTimeMillisUnsafe() + elapsed),
			currentTimeNanosUnsafe: () =>
				liveClock.currentTimeNanosUnsafe() + BigInt(elapsed) * 1_000_000n,
			currentTimeNanos: Effect.sync(
				() => liveClock.currentTimeNanosUnsafe() + BigInt(elapsed) * 1_000_000n,
			),
		};
		const desktop = yield* Effect.promise(() => import("@kampus/libfabrika/desktop"));
		const electron = yield* Effect.promise(() => import("@kampus/libfabrika/electron"));
		const node = yield* Effect.promise(() => import("@kampus/libfabrika/node"));
		const client = yield* Effect.promise(() => import("@kampus/libfabrika/client"));
		const answers = yield* Queue.unbounded<"touch" | "click" | "no">();
		const opened = yield* Queue.unbounded<string>();
		const build = createHash("sha256")
			.update(readFileSync(join(built, "brain.js")))
			.digest("hex");
		const diagnosticsPath = join(options.home, "p23-diagnostics.json");
		const diagnostics: string[] = existsSync(diagnosticsPath)
			? Schema.decodeUnknownSync(Schema.Array(Schema.String))(
					JSON.parse(readFileSync(diagnosticsPath, "utf8")),
				)
			: [];
		const note = (line: string) => {
			diagnostics.push(line);
			writeFileSync(diagnosticsPath, JSON.stringify(diagnostics));
		};
		const port =
			40_000 +
			([...options.label].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7) % 20_000);
		const url = `http://127.0.0.1:${port}`;
		note(`build ${build}`);
		note(`stage ${url}`);
		note(`versions ${JSON.stringify(process.versions)}`);
		note(
			`lock ${createHash("sha256")
				.update(readFileSync(join(process.cwd(), "pnpm-lock.yaml")))
				.digest("hex")}`,
		);
		const savedPath = join(options.home, "p23-brain.json");
		const Saved = Schema.Struct({pid: Schema.Int, workerd: Schema.Int});
		const saved = () =>
			existsSync(savedPath)
				? Schema.decodeUnknownSync(Saved)(JSON.parse(readFileSync(savedPath, "utf8")))
				: undefined;
		const alive = (pid: number) => {
			try {
				process.kill(pid, 0);
				return true;
			} catch {
				return false;
			}
		};
		let child: ReturnType<typeof spawn> | undefined;
		let workerd: number | undefined;
		const children = new Set<number>();
		const service = {
			up: Effect.gen(function* () {
				const prior = saved();
				if (prior && alive(prior.pid)) {
					workerd = prior.workerd;
					return {url};
				}
				const env = {...process.env, FABRIKA_HOME: options.home, ELECTRON_RUN_AS_NODE: "1"};
				delete env.TYPESAFE_API_KEY;
				delete env.FABRIKA_FOREGROUND;
				// The actual P12 stage. Its typed readiness callback supplies the owned workerd PID.
				const log = openSync(join(options.home, "p23-stage.log"), "a", 0o600);
				child = spawn(process.execPath, [join(built, "brain.js"), "--port", String(port)], {
					env,
					detached: true,
					stdio: ["ignore", log, log, "ipc"],
				});
				closeSync(log);
				if (child.pid) children.add(child.pid);
				const selected = child;
				yield* Effect.callback<void>((resume) => {
					const ready = (message: unknown) => {
						const decoded = Schema.decodeUnknownOption(
							Schema.Struct({type: Schema.Literal("ready"), workerd: Schema.Int}),
						)(message);
						if (decoded._tag === "Some" && selected.pid) {
							workerd = decoded.value.workerd;
							children.add(workerd);
							writeFileSync(savedPath, JSON.stringify({pid: selected.pid, workerd}));
							resume(Effect.void);
						}
					};
					selected.on("message", ready);
					return Effect.sync(() => selected.off("message", ready));
				});
				selected.unref();
				return {url};
			}),
			stop: Effect.gen(function* () {
				const prior = saved();
				if (prior && alive(prior.pid)) process.kill(-prior.pid, "SIGTERM");
				if (prior) {
					children.add(prior.pid);
					children.add(prior.workerd);
				}
				child = undefined;
				for (const pid of children) {
					while (alive(pid)) yield* Effect.sleep(Duration.millis(20));
				}
				note("owned children absent");
			}),
		};
		// Persisted test AES key permits a cross-process reopen without touching the login Keychain.
		const aesPath = join(options.home, "test-seal.bytes");
		const rawAes = existsSync(aesPath)
			? new Uint8Array(readFileSync(aesPath))
			: crypto.getRandomValues(new Uint8Array(32));
		if (!existsSync(aesPath)) writeFileSync(aesPath, rawAes, {mode: 0o600});
		const aes = yield* Effect.promise(() =>
			crypto.subtle.importKey("raw", rawAes, "AES-GCM", false, ["encrypt", "decrypt"]),
		);
		const privateText: string[] = [];
		const seal = Layer.succeed(Seal, {
			available: Effect.succeed(true),
			encrypt: (plain: Redacted.Redacted<string>) =>
				Effect.gen(function* () {
					privateText.push(Redacted.value(plain));
					const iv = crypto.getRandomValues(new Uint8Array(12));
					const bytes = yield* Effect.promise(() =>
						crypto.subtle.encrypt(
							{name: "AES-GCM", iv},
							aes,
							new TextEncoder().encode(Redacted.value(plain)),
						),
					);
					return Redacted.make(Uint8Array.from([...iv, ...new Uint8Array(bytes)]));
				}),
			decrypt: (sealed: Redacted.Redacted<Uint8Array>) =>
				Effect.gen(function* () {
					const bytes = Redacted.value(sealed);
					const plain = yield* Effect.promise(() =>
						crypto.subtle.decrypt({name: "AES-GCM", iv: bytes.slice(0, 12)}, aes, bytes.slice(12)),
					);
					privateText.push(new TextDecoder().decode(plain));
					return {plain: Redacted.make(new TextDecoder().decode(plain)), rotate: false};
				}),
		});
		const ids = IdGenerator.layer;
		const store = node
			.fileDesktopStore({home: options.home})
			.pipe(
				Layer.provide(options.seal === "real" ? electron.electronSeal : seal),
				Layer.provide(ids),
				Layer.provide(NodeServices.layer),
			);
		const runtime = ManagedRuntime.make(
			Layer.mergeAll(store, ids, Socket.layerWebSocketConstructorGlobal, NodeServices.layer),
		);
		const observationPath = join(options.home, "p23-observations.json");
		const observations: Schema.Json[] = existsSync(observationPath)
			? [
					...Schema.decodeUnknownSync(Schema.Array(Schema.Json))(
						JSON.parse(readFileSync(observationPath, "utf8")),
					),
				]
			: [];
		// P19's real durable journal. The forward callback captures the outside receiver's rows.
		const records = desktop
			.desktopJournal({
				home: options.home,
				forward: (rows: ReadonlyArray<Schema.Json>) =>
					Effect.sync(() => {
						observations.push(...rows);
						writeFileSync(observationPath, JSON.stringify(observations));
					}),
			})
			.pipe(Layer.provide(NodeServices.layer));
		yield* Effect.addFinalizer(() => Effect.promise(() => runtime.dispose()));
		const observe = (method: string, params: Schema.Json) =>
			Effect.scoped(
				Effect.gen(function* () {
					const tab = yield* IdGenerator.use((ids) => ids.next(Id.make("tab")));
					return yield* Effect.gen(function* () {
						const connection = yield* client.ClientConnection;
						const key = yield* client.ClientKey;
						const news = yield* Effect.forkChild(Stream.runHead(connection.news));
						yield* connection.open(1);
						const identity = yield* key.identity;
						const challenge = Option.getOrThrow(yield* Fiber.join(news));
						const nonce = challenge.params.nonce;
						const signed = yield* key.sign({nonce, url, tab});
						yield* connection.request("initialize", {
							versions: [1],
							has: [],
							ping: "10s",
							key: identity.key,
							tab,
							nonce,
							platform: "headless",
							os: "macos",
							sentAt: new Date().toISOString(),
							signed,
						});
						return yield* connection.request(method, params);
					}).pipe(
						Effect.provide(client.browserConnection(url)),
						Effect.provide(desktop.sealedClientKey(tab)),
					);
				}),
			);
		const diskText = (folder: string): string =>
			readdirSync(folder, {withFileTypes: true})
				.map((entry) => {
					const path = join(folder, entry.name);
					return entry.isDirectory() ? diskText(path) : readFileSync(path).toString("utf8");
				})
				.join("\n");
		const control: P23Control = {
			url,
			answerCheck: (answer) => {
				Queue.offerUnsafe(answers, answer);
			},
			takeOpened: () => runtime.runPromise(Queue.take(opened)),
			entries: () =>
				runtime.runPromise(
					Effect.forEach(
						[
							"door/members",
							"door/inputs",
							...["one", "two", "three", "four"].map((name) => `counter:${name}/inbox`),
						],
						(stream) =>
							observe("ledger.read", {stream, after: 0}).pipe(
								Effect.flatMap(
									Schema.decodeUnknownEffect(Schema.Struct({entries: Schema.Array(Entry)})),
								),
								Effect.map((page) => page.entries),
							),
						{concurrency: 1},
					).pipe(Effect.map((pages) => pages.flat())),
				),
			diagnostics: () => diagnostics,
			observations: () => observations,
			privateFilesAreSealed: () => {
				if (privateText.length < 2) return false;
				const stored = diskText(options.home);
				return privateText.every((text) => !stored.includes(text));
			},
			expireLinks: () => {
				elapsed += 60_001;
			},
			killBrain: () => {
				if (!workerd) throw new Error("stage not ready");
				process.kill(workerd, "SIGKILL");
			},
			quit: () => app.quit(),
			stop: () => runtime.runPromise(service.stop),
		};
		globalThis.p23 = control;
		const tile = (id: string) => ({id, shows: `counter:${id}`, keep: "failed"});
		const pair = (dir: "row" | "column") => ({
			dir,
			parts: [
				{percent: 50, inner: tile("one")},
				{percent: 50, inner: tile("two")},
			],
		});
		const layouts = {
			one: tile("one"),
			small: tile("one"),
			side: pair("row"),
			stacked: pair("column"),
			"2x2": {
				dir: "column",
				parts: [
					{percent: 50, inner: pair("row")},
					{
						percent: 50,
						inner: {
							dir: "row",
							parts: [
								{percent: 50, inner: tile("three")},
								{percent: 50, inner: tile("four")},
							],
						},
					},
				],
			},
		};
		const external = Layer.succeed(desktop.ExternalBrowser, {
			open: (origin: string, pass: Redacted.Redacted<string>) =>
				Queue.offer(opened, `${origin}/#pass=${Redacted.value(pass)}`).pipe(Effect.asVoid),
		});
		const check = Layer.succeed(desktop.PersonCheck, {
			ask: () =>
				Queue.take(answers).pipe(
					Effect.map((answer) =>
						answer === "no" ? {_tag: "not_checked", why: "no"} : {_tag: "checked", check: answer},
					),
				),
		});
		// P19 constructs its launchd spec after founding. The real mode supplies its real platform Layer.
		const brain =
			options.brain === "stand-in"
				? Layer.succeed(BrainService, service)
				: node.launchControl.pipe(Layer.provide(NodeServices.layer));
		// Every real counter goes through Program.make in its own package, never a screenshot-only view.
		yield* electron
			.desktopApp({
				home: options.home,
				pages: {
					founding: join(built, "founding.html"),
					foundingPreload: join(built, "preload-founding.js"),
					windowPreload: join(built, "preload-window.js"),
				},
				localBrain: {
					label: options.label,
					executable: process.execPath,
					entry: join(built, "brain.js"),
					port,
					throttle: 1,
				},
				stage: {url, kind: "local"},
				programs: {counter},
				window: {
					layout: layouts[options.layout],
					views: {counter},
					look: options.look,
					size:
						options.layout === "small" ? {width: 1024, height: 700} : {width: 1440, height: 1000},
				},
			})
			.pipe(
				Effect.provide(
					Layer.mergeAll(external, check, brain, records, store, ids, NodeServices.layer),
				),
				Effect.provide(electron.electronPlatform),
				Effect.provideService(Clock.Clock, mainClock),
			);
	}),
);
NodeRuntime.runMain(run);
