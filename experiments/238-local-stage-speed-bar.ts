// Experiment 238: the local stage's first speed bar (P12, ticket 270, `next/`).
// The real stage only: `next/apps/fabrika/dev.ts`, which builds the brain, deploys it at Alchemy's
// local stage and serves it from workerd. No Miniflare stand-in, no network, no key, no model.
//
//   env -u TYPESAFE_API_KEY nice -n 15 node --no-warnings experiments/238-local-stage-speed-bar.ts stage initial 4
//   env -u TYPESAFE_API_KEY nice -n 15 node --no-warnings experiments/238-local-stage-speed-bar.ts stage head 5
//   env -u TYPESAFE_API_KEY nice -n 15 node --no-warnings experiments/238-local-stage-speed-bar.ts compiler 5
//   env -u TYPESAFE_API_KEY nice -n 15 node --no-warnings experiments/238-local-stage-speed-bar.ts sink 5
//
// Each stage run gets its own fresh FABRIKA_HOME (mktemp -d /tmp/fh.XXXX), removed after. One stage
// at a time; before each, it waits while 6 or more vitest workers run. Every reading is saved, not
// only medians, in results/238-local-stage-speed-bar.json (each call appends its runs).
// The wire client below is a copy of the one in next/apps/fabrika/src/stage-wire.test.ts.
import {execFileSync, spawn, type ChildProcess} from "node:child_process";
import {createHash, generateKeyPairSync, sign} from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import {createRequire} from "node:module";
import {createServer} from "node:net";
import {join, resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {pathToFileURL} from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const APP = join(ROOT, "next/apps/fabrika");
const OUT = join(ROOT, "experiments/results/238-local-stage-speed-bar.json");
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const SENT = "2026-11-08T04:00:00.000Z";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const SENDS = 20;
const PUBLISHES = 10;

const now = () => performance.now();
const pause = (ms = 10) => new Promise<void>((done) => setTimeout(done, ms));
const load = () =>
	execFileSync("uptime", {encoding: "utf8"})
		.trim()
		.replace(/^.*load/, "load");
const vitests = () => {
	try {
		return execFileSync("pgrep", ["-f", "node.*vitest"], {encoding: "utf8"}).trim().split("\n")
			.length;
	} catch {
		return 0;
	}
};
const saved = (): {runs: Array<unknown>; compiler: Array<unknown>} =>
	existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {runs: [], compiler: []};
const save = (data: object) => writeFileSync(OUT, `${JSON.stringify(data, null, "\t")}\n`);

// --- The wire client (copied from stage-wire.test.ts) ---
const field = (a: string | Buffer) => {
	const bytes = typeof a === "string" ? Buffer.from(a) : a;
	const size = Buffer.alloc(4);
	size.writeUInt32BE(bytes.length);
	return Buffer.concat([size, bytes]);
};
const identity = () => {
	const pair = generateKeyPairSync("ed25519");
	const raw = pair.publicKey.export({format: "jwk"}).x ?? "";
	const bytes = Buffer.from(raw, "base64url");
	const blob = Buffer.concat([field("ssh-ed25519"), field(bytes)]);
	const fingerprint = `SHA256:${createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "")}`;
	const proof = (text: string) => {
		const digest = createHash("sha512").update(text).digest();
		const signed = Buffer.concat([
			Buffer.from("SSHSIG"),
			field("fabrika-client"),
			field(""),
			field("sha512"),
			field(digest),
		]);
		const signature = Buffer.concat([
			field("ssh-ed25519"),
			field(sign(null, signed, pair.privateKey)),
		]);
		const version = Buffer.alloc(4);
		version.writeUInt32BE(1);
		const packet = Buffer.concat([
			Buffer.from("SSHSIG"),
			version,
			field(blob),
			field("fabrika-client"),
			field(""),
			field("sha512"),
			field(signature),
		]);
		return `-----BEGIN SSH SIGNATURE-----\n${packet
			.toString("base64")
			.match(/.{1,70}/g)
			?.join("\n")}\n-----END SSH SIGNATURE-----\n`;
	};
	return {raw, fingerprint, line: `ssh-ed25519 ${blob.toString("base64")}`, proof};
};
type Key = ReturnType<typeof identity>;
type Frame = {id?: number; method?: string; params?: any; result?: any; error?: any};
class Client {
	readonly frames: Array<Frame | string> = [];
	readonly arrived: Array<{frame: Frame; at: number}> = [];
	private serial = 0;
	private closed = false;
	readonly ws: WebSocket;
	readonly base: string;
	readonly key: Key;
	readonly tab: string;
	constructor(base: string, key: Key, tab: string) {
		this.base = base;
		this.key = key;
		this.tab = tab;
		this.ws = new WebSocket(
			`${base.replace("http", "ws")}/client/${encodeURIComponent(key.fingerprint)}/${tab}`,
		);
		this.ws.addEventListener("error", () => (this.closed = true));
		this.ws.addEventListener("close", () => (this.closed = true));
		this.ws.addEventListener("message", ({data}) => {
			const frame = data === "pong" ? "pong" : JSON.parse(String(data));
			if (typeof frame !== "string" && frame.method === "view.patch")
				this.arrived.push({frame, at: now()});
			this.frames.push(frame);
		});
	}
	async next(test: (f: Frame | string) => boolean, ms = 30_000): Promise<any> {
		const until = now() + ms;
		for (;;) {
			const at = this.frames.findIndex(test);
			if (at >= 0) return this.frames.splice(at, 1)[0];
			if (this.closed || this.ws.readyState === WebSocket.CLOSED)
				throw new Error("wire closed before answer");
			if (now() > until) throw new Error("no answer in time");
			await pause(2);
		}
	}
	async hello() {
		const nonce = (await this.next((f) => typeof f !== "string" && f.method === "challenge")).params
			.nonce as string;
		return this.call("initialize", {
			versions: [1],
			has: ["seal"],
			ping: "30s",
			key: this.key.raw,
			tab: this.tab,
			nonce,
			platform: "headless",
			os: "linux",
			sentAt: SENT,
			signed: this.key.proof(`fabrika-hello\n${this.base}\n${this.tab}\n${nonce}`),
		});
	}
	async call(method: string, params: unknown): Promise<Frame> {
		const id = ++this.serial;
		while (this.ws.readyState === WebSocket.CONNECTING) {
			if (this.closed) throw new Error("wire closed before open");
			await pause(2);
		}
		this.ws.send(JSON.stringify({jsonrpc: "2.0", id, method, params}));
		return this.next((f) => typeof f !== "string" && f.id === id);
	}
	close() {
		this.ws.close();
	}
}
const connect = async (base: string, key: Key, tab: string) => {
	const client = new Client(base, key, tab);
	const hello = await client.hello();
	if (hello.error !== undefined) throw new Error(`hello refused: ${JSON.stringify(hello.error)}`);
	return client;
};
const counterPid = async (c: Client) => {
	const r = await c.call("ledger.read", {stream: "processes/counter:1", after: 0});
	const started = (r.result.entries as Array<any>).findLast(
		(e) => e._tag === "started" && e.body?.name === "counter:1",
	);
	if (started === undefined) throw new Error("no counter:1");
	return started.body.process as string;
};
const send = (c: Client, pid: string, letter: string) =>
	c.call("process.send", {pid, letter, m: {type: "inc"}, sentAt: SENT, seen: 0, traceId: TRACE});

// --- Processes ---
const unusedPort = () =>
	new Promise<number>((done, fail) => {
		const listener = createServer();
		listener.once("error", fail);
		listener.listen(0, "127.0.0.1", () => {
			const at = listener.address();
			if (at === null || typeof at === "string") return fail(new Error("no port"));
			listener.close(() => done(at.port));
		});
	});
const table = () =>
	execFileSync("ps", ["-axo", "pid=,ppid=,rss=,command="], {encoding: "utf8"})
		.split("\n")
		.map((row) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(row))
		.filter((m) => m !== null)
		.map((m) => ({pid: Number(m[1]), ppid: Number(m[2]), rss: Number(m[3]), command: m[4] ?? ""}));
const descendants = (root: number) => {
	const rows = table(),
		found = new Set([root]);
	for (let round = 0; round < rows.length; round++)
		for (const row of rows) if (found.has(row.ppid)) found.add(row.pid);
	return rows.filter((row) => found.has(row.pid) && row.pid !== root);
};
const workerd = (root: number) =>
	descendants(root).filter((row) => /\/workerd(?:\s|$)/.test(row.command));
const exited = (child: ChildProcess) =>
	new Promise<void>((done) => {
		if (child.exitCode !== null || child.signalCode !== null) return done();
		child.once("exit", () => done());
	});

/** Every span's health row (piece, ms) from every object database in the home, read-only. */
const healthRows = (home: string) => {
	const rows: Array<{db: string; piece: string; ms: number; ok: number}> = [];
	for (const entry of readdirSync(home, {recursive: true, withFileTypes: true})) {
		if (!entry.isFile() || !/\.(sqlite|db)$/.test(entry.name)) continue;
		const db = new DatabaseSync(join(entry.parentPath, entry.name), {readOnly: true});
		try {
			if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='health'").get())
				continue;
			for (const r of db.prepare("SELECT piece, ms, ok FROM health").all() as Array<any>)
				rows.push({db: entry.name.slice(0, 12), piece: r.piece, ms: r.ms, ok: r.ok});
		} finally {
			db.close();
		}
	}
	return rows;
};

const stageRun = async (label: string, n: number) => {
	while (vitests() >= 6) await pause(5000);
	const before = load();
	const home = execFileSync("mktemp", ["-d", "/tmp/fh.XXXX"], {encoding: "utf8"}).trim();
	const port = await unusedPort(),
		url = `http://127.0.0.1:${port}`,
		key = identity();
	const env: NodeJS.ProcessEnv = {...process.env, FABRIKA_HOME: home, DO_NOT_TRACK: "1"};
	delete env.TYPESAFE_API_KEY;
	delete env.FABRIKA_FOREGROUND;
	delete env.CLOUDFLARE_API_TOKEN;
	const reading: Record<string, unknown> = {label, n, load: before, missing: {}};
	const missing = reading.missing as Record<string, string>;
	const t0 = now();
	const child = spawn(
		"nice",
		[
			"-n",
			"15",
			process.execPath,
			join(APP, "dev.ts"),
			"--port",
			String(port),
			"--name",
			"x232",
			"--person",
			PERSON,
			"--founder",
			key.line,
			"--window",
			key.raw,
		],
		{cwd: APP, env, stdio: ["ignore", "pipe", "pipe"]},
	);
	let output = "",
		readyLine: number | undefined;
	child.stdout.on("data", (b: Buffer) => {
		output += b.toString();
		if (readyLine === undefined && output.includes('{"ready":')) readyLine = now() - t0;
	});
	child.stderr.on("data", (b: Buffer) => (output += b.toString()));
	const clients: Array<Client> = [];
	const root = child.pid ?? 0;
	try {
		for (;;) {
			if (child.exitCode !== null) throw new Error(`dev.ts exited: ${output.slice(-2000)}`);
			if (now() - t0 > 180_000) throw new Error("no listener in 180 s");
			try {
				if ((await fetch(url)).ok) break;
			} catch {
				/* not listening yet */
			}
			await pause(10);
		}
		reading.startMs = now() - t0;
		while (readyLine === undefined && now() - t0 < 10_000) await pause(5);
		reading.readyLineMs = readyLine ?? null;

		let t = now();
		const a = await connect(url, key, "tab-a");
		reading.helloMs = now() - t;
		const b = await connect(url, key, "tab-b");
		clients.push(a, b);
		const pid = await counterPid(a);

		// Accepted-send latency: sequential sends from one client, until the `accepted` reply.
		const sends: Array<number> = [];
		for (let i = 0; i < SENDS; i++) {
			t = now();
			const r = await send(a, pid, `s-${i}`);
			if (r.result?._tag !== "accepted") throw new Error(`send refused: ${JSON.stringify(r)}`);
			sends.push(now() - t);
		}
		reading.sendMs = sends;

		// Cross-client publication: b watches the view; a sends; time until b sees the patch.
		const opened = await b.call("view.open", {pid});
		if (opened.error !== undefined) throw new Error("view.open refused");
		const publishes: Array<number> = [];
		for (let i = 0; i < PUBLISHES; i++) {
			b.arrived.length = 0;
			t = now();
			const r = await send(a, pid, `p-${i}`);
			const rev = r.result.pos as number;
			for (;;) {
				const seen = b.arrived.find((x) => x.frame.params?.rev === rev);
				if (seen !== undefined) {
					publishes.push(seen.at - t);
					break;
				}
				if (now() - t > 10_000) {
					missing.publish = `no view.patch for rev ${rev} within 10 s`;
					break;
				}
				await pause(1);
			}
			if (missing.publish !== undefined) break;
		}
		reading.publishMs = publishes;

		const before = workerd(root);
		const [old] = before;
		if (old === undefined || before.length !== 1)
			throw new Error(`expected one workerd, saw ${before.length}`);
		reading.workerdRssMb = old.rss / 1024;
		reading.nodeRssMb = descendants(root)
			.filter((r) => !/\/workerd(?:\s|$)/.test(r.command))
			.map((r) => r.rss / 1024);

		// Replacement: SIGKILL workerd; time until the same address answers again (Alchemy's restart).
		for (const c of clients.splice(0)) c.close();
		t = now();
		process.kill(old.pid, "SIGKILL");
		let served = false;
		while (now() - t < 60_000) {
			try {
				const r = await fetch(url);
				if (r.ok && workerd(root).some((w) => w.pid !== old.pid)) {
					served = true;
					break;
				}
			} catch {
				/* not back yet */
			}
			await pause(5);
		}
		if (!served) missing.replace = "address did not answer within 60 s";
		reading.replaceMs = served ? now() - t : null;

		// Reconnect: a fresh wire (open, challenge, signed hello) once the address answers again.
		t = now();
		let reconnected: Client | undefined;
		while (reconnected === undefined && now() - t < 30_000) {
			try {
				reconnected = await connect(url, key, `again-${Date.now()}`);
			} catch {
				await pause(10);
			}
		}
		reading.reconnectMs = reconnected === undefined ? null : now() - t;
		reading.killToHelloMs =
			reconnected === undefined ? null : now() - t + (reading.replaceMs as number);
		if (reconnected !== undefined) {
			clients.push(reconnected);
			t = now();
			const r = await send(reconnected, pid, "after-replace");
			reading.firstSendAfterReplaceMs = r.result?._tag === "accepted" ? now() - t : null;
			const after = workerd(root);
			reading.workerdRssAfterReplaceMb = after.length === 1 ? (after[0]?.rss ?? 0) / 1024 : null;
			const starts = await reconnected.call("ledger.read", {stream: "door/brain", after: 0});
			reading.brainFacts = (starts.result.entries as Array<any>).map((e) => ({
				_tag: e._tag,
				why: e.body?.why,
			}));
		}
		// Give the 1 s outbox and record flush loop two turns to send the restart's spans.
		await pause(2500);
	} catch (error) {
		reading.error = String(error);
	} finally {
		for (const c of clients) c.close();
		const t = now();
		child.kill("SIGTERM");
		await Promise.race([exited(child), pause(15_000)]);
		reading.stopMs = now() - t;
		const left = child.pid === undefined ? [] : descendants(child.pid);
		for (const row of left) {
			try {
				process.kill(row.pid, "SIGKILL");
			} catch {
				/* already gone */
			}
		}
		if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
		reading.leftBehind = left.length;
		try {
			const rows = healthRows(home);
			reading.health = rows;
		} catch (error) {
			missing.health = `could not read health rows: ${String(error)}`;
		}
		rmSync(home, {recursive: true, force: true});
	}
	return reading;
};

// --- Compiler on and off, on the build tests' temporary .tsx input ---
const compilerRuns = async (count: number) => {
	const require = createRequire(join(APP, "package.json"));
	const effect = await import(pathToFileURL(require.resolve("effect")).href);
	const {build} = await import(pathToFileURL(join(APP, "src/build.ts")).href);
	const lib = await import(
		pathToFileURL(join(ROOT, "next/packages/libfabrika/src/node/build.ts")).href
	);
	const react =
		readdirSync(join(ROOT, "node_modules/.pnpm")).find((d) => /^react@19\./.test(d)) ?? "";
	const readings: Array<object> = [];
	for (let i = 0; i < count; i++) {
		for (const compiler of [true, false]) {
			while (vitests() >= 6) await pause(5000);
			const folder = mkdtempSync("/tmp/fh.");
			try {
				mkdirSync(join(folder, "node_modules"));
				symlinkSync(
					join(ROOT, "node_modules/.pnpm", react, "node_modules/react"),
					join(folder, "node_modules/react"),
				);
				// The build tests' clean input, imported by a program beside the real counter.
				writeFileSync(
					join(folder, "hidden.tsx"),
					"export const Tip = (p: {text: string}) => <b>{p.text}</b>;",
				);
				const program = join(folder, "program.ts");
				writeFileSync(
					program,
					`import {Tip} from "./hidden.tsx"; import {counter} from ${JSON.stringify(join(ROOT, "next/programs/counter/src/program.ts"))}; export const program = {...counter, fixture: Tip};`,
				);
				const before = load();
				const t = now();
				if (compiler) {
					await effect.Effect.runPromise(
						build({out: join(folder, "dist"), files: [], ledger: [], programs: {counter: program}}),
					);
				} else {
					// The same two Rolldown passes build.ts makes, without the Compiler plugin and check.
					await effect.Effect.runPromise(
						effect.Effect.gen(function* () {
							const programs = yield* lib.bundlePrograms({
								root: APP,
								plugins: [],
								programs: {counter: {module: program, name: "program"}},
							});
							const output = yield* lib.bundle(join(APP, "src/brain.ts"), [
								{
									name: "fabrika-table",
									resolveId: (id: string) => (id === "./table.ts" ? "\0fabrika-table" : undefined),
									load: (id: string) =>
										id === "\0fabrika-table"
											? `export const programs = ${JSON.stringify(programs)};`
											: undefined,
								},
							]);
							mkdirSync(join(folder, "dist"), {recursive: true});
							writeFileSync(
								join(folder, "dist/brain.mjs"),
								output.output.map((o: any) => o.code ?? "").join("\n"),
							);
						}),
					);
				}
				readings.push({compiler, n: i + 1, ms: now() - t, load: before});
				console.log(JSON.stringify(readings.at(-1)));
			} finally {
				rmSync(folder, {recursive: true, force: true});
			}
		}
	}
	return readings;
};

// --- Sink flush, timed from outside ---
// `SpanSink.flush` ends no span on purpose, so this times the call itself with `performance.now()`
// around it. It is the real sink (`data/sink.ts`) on node:sqlite with the stage's own pragmas, as
// `node/stage-recording.ts` opens it, and the real record code (`recordPart`, what the record
// Durable Object runs) on its own node:sqlite file. Between them is the stage's transport shape: a
// JSON POST to 127.0.0.1, answered over HTTP. Not workerd: see the write-up for what that leaves out.
const sinkRuns = async (count: number) => {
	const require = createRequire(join(ROOT, "next/packages/libfabrika/package.json"));
	const {Context, Effect, Layer} = await import(pathToFileURL(require.resolve("effect")).href);
	const lib = (file: string) =>
		import(pathToFileURL(join(ROOT, "next/packages/libfabrika/src/data", file)).href);
	const {Archive, RecordManager, SpanSink, recordPart} = await lib("index.ts");
	const {nodeSql} = await lib("sqlite.ts");
	const {createServer: httpServer} = await import("node:http");
	const readings: Array<object> = [];
	// Few records, one full batch (BATCH = 100 in sink.ts: one record call), and nothing queued.
	for (const queued of [5, 100, 0]) {
		while (vitests() >= 6) await pause(5000);
		const home = mkdtempSync("/tmp/fh.");
		const parts = new Map<string, DatabaseSync>();
		const part = (name: string) => {
			const known = parts.get(name);
			if (known !== undefined) return known;
			const db = new DatabaseSync(join(home, `record-${parts.size}.sqlite`));
			db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL");
			parts.set(name, db);
			return db;
		};
		const server = httpServer((request, response) => {
			let body = "";
			request.on("data", (chunk) => (body += chunk));
			request.on("end", () => {
				const {name, args} = JSON.parse(body);
				const [chain, at, rows] = args;
				Effect.runPromise(
					recordPart(nodeSql(part(name)), chain, at, 1_000_000_000).write(rows),
				).then(
					(value: unknown) => response.end(JSON.stringify({value})),
					(error: unknown) => {
						response.statusCode = 500;
						response.end(String(error));
					},
				);
			});
		});
		await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
		const address = server.address();
		const port = typeof address === "object" && address !== null ? address.port : 0;
		const post = async (name: string, args: ReadonlyArray<unknown>) => {
			const response = await fetch(`http://127.0.0.1:${port}`, {
				method: "POST",
				headers: {"content-type": "application/json"},
				body: JSON.stringify({target: "record", name, method: "write", args}),
			});
			return ((await response.json()) as {value: unknown}).value;
		};
		const object = new DatabaseSync(join(home, "brain.records.sqlite"));
		object.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL");
		const unused = () => Promise.reject(new Error("not timed here"));
		const context = await Effect.runPromise(
			Effect.scoped(
				Layer.build(
					Layer.mergeAll(
						SpanSink.layer(nodeSql(object), {object: "brain:sink-probe"}),
						RecordManager.remote((name: string) => ({
							write: (...args: ReadonlyArray<unknown>) => post(name, args),
							read: unused,
							content: unused,
							deleteContent: unused,
						})),
						Archive.memory,
					),
				),
			),
		);
		const sink = Context.get(context, SpanSink);
		// Spans shaped like a door's: a handful of short tags and one event.
		const queue = (n: number) =>
			Effect.runPromise(
				Effect.forEach(
					Array.from({length: n}, (_, i) => i),
					(i: number) =>
						Effect.void.pipe(
							Effect.tap(() => Effect.annotateCurrentSpan("fab.seq", i)),
							Effect.withSpan("door.send", {
								attributes: {
									"fab.client": "client_probe",
									"fab.tab": "tab-1",
									"fab.letter": "a",
									"fab.ledger.lag": 0,
								},
							}),
						),
					{concurrency: 1, discard: true},
				).pipe(Effect.provideContext(context)),
			);
		const flushOnce = () =>
			Effect.runPromise(sink.flush.pipe(Effect.provideContext(context))) as Promise<{sent: number}>;
		try {
			// One warm-up flush per case: the tables, the part file and the first connection.
			for (let i = 0; i <= count; i++) {
				await queue(queued);
				const before = load();
				const start = now();
				const {sent} = await flushOnce();
				const ms = now() - start;
				const reading = {queued, sent, ms, warmup: i === 0, load: before};
				console.log(JSON.stringify(reading));
				readings.push(reading);
			}
		} finally {
			server.close();
			object.close();
			for (const db of parts.values()) db.close();
			rmSync(home, {recursive: true, force: true});
		}
	}
	return readings;
};

const [mode, label, times] = process.argv.slice(2);
if (process.env.TYPESAFE_API_KEY !== undefined) throw new Error("unset TYPESAFE_API_KEY first");
const data = saved();
if (mode === "stage") {
	const base = data.runs.length;
	for (let i = 0; i < Number(times ?? 1); i++) {
		const reading = await stageRun(label ?? "probe", base + i + 1);
		const {health: _health, ...shown} = reading;
		console.log(JSON.stringify(shown));
		data.runs.push(reading);
		save(data);
	}
} else if (mode === "compiler") {
	data.compiler.push(...(await compilerRuns(Number(label ?? 5))));
	save(data);
} else if (mode === "sink") {
	const sink = await sinkRuns(Number(label ?? 5));
	save({...data, sink: [...((data as {sink?: Array<unknown>}).sink ?? []), ...sink]});
} else throw new Error("mode: stage <label> <count> | compiler <count> | sink <count>");
