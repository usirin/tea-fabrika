// P25, next/. Real dev.ts, real SDK stdio child, real notes and P21 signed menu changes.
import {spawn} from "node:child_process";
import {createHash, generateKeyPairSync, sign} from "node:crypto";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {createServer} from "node:net";
import {resolve} from "node:path";
import {Id} from "@kampus/libfabrika";
import {Entry} from "@kampus/libfabrika/data";
import {helloText, KeyLine, writeSshsig} from "@kampus/libfabrika/transport";
import {Client} from "@modelcontextprotocol/client";
import {StdioClientTransport} from "@modelcontextprotocol/client/stdio";
import {Effect, Layer, Queue, Result, Schema, Schedule} from "effect";

const APP = resolve(import.meta.dirname, "..");
const stageIdentity = () => {
	const pair = generateKeyPairSync("ed25519"),
		raw = pair.publicKey.export({type: "spki", format: "der"}).subarray(-32);
	const field = (bytes: Uint8Array) => {
		const size = Buffer.alloc(4);
		size.writeUInt32BE(bytes.length);
		return Buffer.concat([size, bytes]);
	};
	const blob = Buffer.concat([field(Buffer.from("ssh-ed25519")), field(raw)]),
		line = `ssh-ed25519 ${blob.toString("base64")}`;
	const rawSign = (bytes: Uint8Array) => new Uint8Array(sign(null, bytes, pair.privateKey));
	return {
		line,
		raw: raw.toString("base64url"),
		fingerprint: `SHA256:${createHash("sha256").update(raw).digest("base64").replace(/=+$/, "")}`,
		rawSign,
		sign: Effect.fn("test.signHello")(function* (text: string) {
			return yield* writeSshsig({
				text,
				space: "fabrika-client",
				line: yield* Schema.decodeUnknownEffect(KeyLine)(line),
				sign: (bytes) => Effect.succeed(rawSign(bytes)),
			});
		}),
	};
};
const Frame = Schema.Struct({
	id: Schema.optionalKey(Schema.Number),
	method: Schema.optionalKey(Schema.String),
	params: Schema.optionalKey(Schema.Json),
	result: Schema.optionalKey(Schema.Json),
	error: Schema.optionalKey(Schema.Json),
});
const Watch = Schema.Struct({
	rows: Schema.Array(Schema.Unknown),
	clients: Schema.Array(Schema.Unknown),
});
const Records = Schema.Struct({entries: Schema.Array(Entry)});
const port = Effect.callback<number, Error>((resume) => {
	const server = createServer();
	server.once("error", (e) => resume(Effect.fail(e)));
	server.listen(0, "127.0.0.1", () => {
		const at = server.address();
		server.close();
		resume(
			typeof at === "object" && at !== null
				? Effect.succeed(at.port)
				: Effect.fail(new Error("no test port")),
		);
	});
	return Effect.sync(() => {
		server.close();
	});
});
export const startMcpStage = Effect.fn("test.startMcpStage")(function* () {
	// Parent imports are deliberate. A missing parent stays red, never becomes a fake stage.
	// oxlint-disable-next-line fabrika/no-promises -- edge: Node loads the actual P21 public API only after a law starts
	const d = yield* Effect.promise(() => import("@kampus/libfabrika/desktop"));
	const {MenuRow, MenuClient, MenuModel, MenuIntent, menuView, PersonKey, signMenuChange} = d;
	// Fail at the named P12 entry if it has not landed. Never launch an unrelated installed app.
	readFileSync(resolve(APP, "dev.ts"), "utf8");
	const chosen = yield* port;
	const home = mkdtempSync("/tmp/fh."),
		key = stageIdentity();
	const person = "person_0000000000e008000000000000",
		ledger = "p25-test",
		url = `http://127.0.0.1:${chosen}`;
	const child = spawn(
		process.execPath,
		[
			resolve(APP, "dev.ts"),
			"--port",
			String(chosen),
			"--name",
			ledger,
			"--person",
			person,
			"--founder",
			key.line,
			"--window",
			key.raw,
		],
		{
			cwd: APP,
			env: {PATH: process.env.PATH, HOME: process.env.HOME, FABRIKA_HOME: home, DO_NOT_TRACK: "1"},
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	const children: Client[] = [];
	child.stdout.resume();
	child.stderr.resume();
	yield* Effect.addFinalizer(() =>
		Effect.gen(function* () {
			// oxlint-disable-next-line fabrika/no-promises -- edge: the SDK closes each outside stdio process through a Promise
			yield* Effect.forEach(children, (c) => Effect.promise(() => c.close()), {
				concurrency: 1,
			}).pipe(Effect.ignore);
			if (child.exitCode === null)
				yield* Effect.callback<void>((resume) => {
					child.once("exit", () => resume(Effect.void));
					child.kill();
				});
			rmSync(home, {recursive: true, force: true});
		}),
	);
	// Each wait yields. Test runner owns the overall test deadline and Scope owns cleanup.
	// oxlint-disable-next-line fabrika/no-promises -- edge: Node fetch probes the actual local stage through HTTP
	yield* Effect.tryPromise({try: () => fetch(url), catch: () => new Error("stage starting")}).pipe(
		Effect.flatMap((r) => (r.ok ? Effect.void : Effect.fail(new Error("stage starting")))),
		Effect.retry(Schedule.spaced("20 millis")),
	);
	const incoming = yield* Queue.unbounded<typeof Frame.Type>();
	const ws = new WebSocket(
		`${url.replace("http", "ws")}/client/${encodeURIComponent(key.fingerprint)}/menubar`,
	);
	yield* Effect.addFinalizer(() => Effect.sync(() => ws.close()));
	ws.addEventListener("message", ({data}) => {
		const decoded = Schema.decodeUnknownResult(Schema.fromJsonString(Frame))(String(data));
		if (Result.isSuccess(decoded)) Queue.offerUnsafe(incoming, decoded.success);
	});
	let serial = 0;
	const pending: Array<typeof Frame.Type> = [];
	const next = Effect.fn("test.nextFrame")(function* (matches: (f: typeof Frame.Type) => boolean) {
		const old = pending.findIndex(matches);
		if (old >= 0) {
			const found = pending.splice(old, 1)[0];
			if (found) return found;
		}
		for (;;) {
			const frame = yield* Queue.take(incoming);
			if (matches(frame)) return frame;
			pending.push(frame);
		}
	});
	const call = Effect.fn("test.ownerCall")(function* (method: string, params: Schema.Json) {
		const id = ++serial;
		ws.send(JSON.stringify({jsonrpc: "2.0", id, method, params}));
		const frame = yield* next((f) => f.id === id);
		if (frame.error !== undefined) return yield* Effect.fail(new Error("owner wire refused"));
		return frame.result;
	});
	const challenge = yield* next((f) => f.method === "challenge");
	const nonce = yield* Schema.decodeUnknownEffect(Schema.Struct({nonce: Schema.String}))(
		challenge.params,
	);
	yield* call("initialize", {
		versions: [1],
		has: ["verify"],
		ping: "30s",
		key: key.raw,
		tab: "menubar",
		nonce: nonce.nonce,
		platform: "headless",
		os: "linux",
		sentAt: "2026-11-08T00:00:00Z",
		signed: yield* key.sign(helloText({url, tab: "menubar", nonce: nonce.nonce})),
	});
	const connections = new Map<string, {client: Client; transport: StdioClientTransport}>();
	const connect = Effect.fn("test.connectMcp")(function* (name: string) {
		const transport = new StdioClientTransport({
			command: process.execPath,
			args: [resolve(APP, "mcp.ts"), "--as", name, "--url", url],
			cwd: APP,
			env: {
				PATH: process.env.PATH ?? "",
				HOME: process.env.HOME ?? "",
				FABRIKA_HOME: home,
				MCP_TIMEOUT: "10000",
			},
			stderr: "pipe",
		});
		const client = new Client({name: "p25-test", version: "1"});
		// oxlint-disable-next-line fabrika/no-promises -- edge: the SDK connects an outside stdio process through a Promise
		yield* Effect.promise(() => client.connect(transport));
		children.push(client);
		connections.set(name, {client, transport});
		return client;
	});
	const snapshot = Effect.fn("test.menuSnapshot")(function* () {
		return yield* Schema.decodeUnknownEffect(Watch)(yield* call("door.watch", {}));
	});
	const rows = Effect.fn("test.menuRows")(function* () {
		return yield* Schema.decodeUnknownEffect(Schema.Array(MenuRow))((yield* snapshot()).rows);
	});
	const personKey = Layer.succeed(PersonKey, {
		line: Schema.decodeUnknownEffect(KeyLine)(key.line),
		sign: (bytes: Uint8Array) => Effect.succeed(key.rawSign(bytes)),
	});
	const context = {person, ledger, own: key.raw, browser: false};
	const change = Effect.fn("test.menuChange")(function* (name: string, remove: boolean) {
		const snap = yield* snapshot();
		const waiting = yield* Schema.decodeUnknownEffect(Schema.Array(MenuRow))(snap.rows);
		const admitted = yield* Schema.decodeUnknownEffect(Schema.Array(MenuClient))(snap.clients);
		const row = waiting.find((r: {readonly label: string}) => r.label === name);
		const client = admitted.find((r: {readonly label: string}) => r.label === name);
		if (remove ? !client : !row)
			return yield* Effect.fail(new Error("missing actual P21 menu row"));
		const intent = remove
			? MenuIntent.cases.remove.make({
					id: yield* Id.Generator.use((g) => g.next(Id.Revoke)),
					client,
				})
			: MenuIntent.cases.approve.make({id: yield* Id.Generator.use((g) => g.next(Id.Grant)), row});
		const signed = yield* signMenuChange({intent, context, check: "none"}).pipe(
			Effect.provide(personKey),
		);
		// oxlint-disable-next-line fabrika/no-promises -- edge: P12 accepts signed membership changes through its actual HTTP endpoint
		return yield* Effect.tryPromise({
			try: () =>
				fetch(`${url}/grant`, {
					method: "POST",
					headers: {"content-type": "application/json"},
					body: JSON.stringify(signed),
				}),
			catch: () => new Error("grant HTTP failed"),
		});
	});
	const entries = Effect.gen(function* () {
		return (yield* Schema.decodeUnknownEffect(Records)(
			yield* call("ledger.read", {stream: "notes:1/inbox", after: 0}),
		)).entries;
	});
	const loseReply = Effect.fn("test.loseMcpReply")(function* (
		name: string,
		args: Parameters<Client["callTool"]>[0],
	) {
		const connection = connections.get(name);
		if (!connection) return yield* Effect.fail(new Error("test bridge missing"));
		const original = connection.transport.onmessage,
			abort = new AbortController();
		let dropped = false;
		connection.transport.onmessage = (frame) => {
			if ("result" in frame) {
				dropped = true;
				abort.abort();
				return;
			}
			original?.(frame);
		};
		// oxlint-disable-next-line fabrika/no-promises -- edge: the SDK call is interrupted only after its actual result frame is deliberately dropped
		yield* Effect.promise(() => connection.client.callTool(args, {signal: abort.signal})).pipe(
			Effect.exit,
			Effect.ensuring(
				Effect.sync(() => {
					connection.transport.onmessage = original;
				}),
			),
		);
		if (!dropped) return yield* Effect.fail(new Error("no actual reply was dropped"));
	});
	const membership = Effect.gen(function* () {
		return (yield* Schema.decodeUnknownEffect(Records)(
			yield* call("ledger.read", {stream: "door/members", after: 0}),
		)).entries;
	});
	return {
		url,
		home,
		person,
		connect,
		loseReply,
		approve: (name: string) => change(name, false),
		remove: (name: string) => change(name, true),
		rows,
		entries,
		membership,
		ps: call("process.info", {}),
		restartBridge: Effect.fn("test.restartMcp")(function* (name: string) {
			const old = connections.get(name);
			// oxlint-disable-next-line fabrika/no-promises -- edge: the SDK stops the old outside process before the replacement starts
			if (old) yield* Effect.promise(() => old.client.close());
			return yield* connect(name);
		}),
		menuItems: Effect.gen(function* () {
			const snap = yield* snapshot();
			const model = yield* Schema.decodeUnknownEffect(MenuModel)({
				context,
				brain: "online",
				rows: snap.rows,
				clients: snap.clients,
				pending: [],
				passes: [],
				error: null,
			});
			return menuView(model);
		}),
		clients: MenuClient,
	};
});
