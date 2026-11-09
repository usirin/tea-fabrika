// P24, next/. Shared driver. A cloud URL must be supplied explicitly by the lead after deploy.
// This file reads no credentials, starts no deploy, and never reads a private-key file.
import {createHash, generateKeyPairSync, sign} from "node:crypto";
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync} from "node:fs";
import {createServer} from "node:net";
import {join} from "node:path";
import {NodeServices} from "@effect/platform-node";
import {KeyLine, writeSshsig} from "@kampus/libfabrika/transport";
import type {Scope} from "effect";
import {Effect, Fiber, Schema} from "effect";
import {expect} from "vitest";

export class SmokeError extends Schema.TaggedError<SmokeError>()("SmokeError", {
	why: Schema.String,
}) {}
export type SmokeReport = {
	readonly build: string;
	readonly sha256: string;
	readonly samples: readonly {
		readonly measure:
			| "first_answer"
			| "press_to_count"
			| "reconnect"
			| "cold_wake"
			| "isolate_cold_load";
		readonly ms: number | null;
		readonly why: string | null;
	}[];
	readonly checks: readonly {
		readonly name: string;
		readonly passed: boolean;
		readonly why: string | null;
	}[];
};
const attempt = <A>(work: () => Promise<A>) =>
	Effect.tryPromise({
		try: work,
		catch: (error) =>
			new SmokeError({why: error instanceof Error ? error.message : "outside operation failed"}),
	});
const publicKey = () => {
	const pair = generateKeyPairSync("ed25519");
	const raw = Buffer.from(pair.publicKey.export({format: "jwk"}).x ?? "", "base64url");
	const field = (b: Buffer) => {
		const n = Buffer.alloc(4);
		n.writeUInt32BE(b.length);
		return Buffer.concat([n, b]);
	};
	const line = Schema.decodeUnknownSync(KeyLine)(
		`ssh-ed25519 ${Buffer.concat([field(Buffer.from("ssh-ed25519")), field(raw)]).toString("base64")}`,
	);
	return {
		raw: raw.toString("base64url"),
		line,
		fingerprint: `SHA256:${createHash("sha256").update(raw).digest("base64").replace(/=+$/, "")}`,
		sign: (bytes: Uint8Array) =>
			Effect.sync(() => new Uint8Array(sign(null, bytes, pair.privateKey))),
	};
};

export const localOff = Effect.fn("test.p24.localOff")(function* (
	notes = false,
	name = "p24-local",
) {
	const home = yield* Effect.acquireRelease(
		Effect.sync(() => mkdtempSync("/tmp/fh.")),
		(home) => Effect.sync(() => rmSync(home, {recursive: true, force: true})),
	);
	const oldHome = process.env.FABRIKA_HOME;
	yield* Effect.acquireRelease(
		Effect.sync(() => {
			process.env.FABRIKA_HOME = home;
			process.env.DO_NOT_TRACK = "1";
			delete process.env.TYPESAFE_API_KEY;
			delete process.env.FABRIKA_FOREGROUND;
		}),
		() =>
			Effect.sync(() => {
				if (oldHome === undefined) delete process.env.FABRIKA_HOME;
				else process.env.FABRIKA_HOME = oldHome;
			}),
	);
	if (notes) {
		// P13 has no window. Require its actual program before any stage startup.
		const notesPackage = "@kampus/notes";
		yield* attempt(() => import(notesPackage));
	}
	const {build} = yield* attempt(() => import("../src/build.ts"));
	const built = yield* build({
		out: join(home, "built"),
		chaos: false,
		...(notes ? {programs: {notes: "@kampus/notes"}} : {}),
	});
	const bytes = readFileSync(built.brain),
		sha256 = createHash("sha256").update(bytes).digest("hex");
	const alone = join(home, "alone");
	mkdirSync(alone);
	cpSync(built.brain, join(alone, "brain.mjs"));
	rmSync(join(home, "built"), {recursive: true});
	expect(readFileSync(join(alone, "brain.mjs"))).toEqual(bytes);
	const port = yield* attempt(
		() =>
			new Promise<number>((done, fail) => {
				const server = createServer();
				server.once("error", fail);
				server.listen(0, "127.0.0.1", () => {
					const address = server.address();
					if (address === null || typeof address === "string") {
						server.close();
						fail(new Error("no port"));
						return;
					}
					server.close((error) => (error ? fail(error) : done(address.port)));
				});
			}),
	);
	const key = publicKey();
	const {localStage} = yield* attempt(() => import("../src/local-stage.ts"));
	const {localState} = yield* attempt(() => import("alchemy/State/LocalState"));
	const stage = yield* localStage(
		{...built, brain: join(alone, "brain.mjs")},
		{
			home,
			name,
			person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
			founder: key.line,
			window: null,
			port,
		},
	).pipe(Effect.provide(localState()), Effect.provide(NodeServices.layer));
	return {home, url: stage.url, built, sha256, brain: join(alone, "brain.mjs")};
});

// JSON-RPC only. The server, P21 menu and P23 adapters make every admission decision.
export const protocolKey = publicKey;
export const protocol = Effect.fn("test.p24.protocol")(function* (
	url: string,
	label: string,
	key = publicKey(),
) {
	let serial = 0,
		socket: WebSocket;
	const pending = new Map<number, {done: (value: any) => void; fail: (error: Error) => void}>();
	const notices: any[] = [];
	const call = (method: string, params: unknown): Promise<any> =>
		new Promise((done, fail) => {
			const id = ++serial;
			pending.set(id, {done, fail});
			socket.send(JSON.stringify({jsonrpc: "2.0", id, method, params}));
		});
	const connect = () =>
		new Promise<any>((done, fail) => {
			socket = new WebSocket(
				`${url.replace(/^http/, "ws")}/client/${encodeURIComponent(key.fingerprint)}/${encodeURIComponent(label)}`,
			);
			socket.addEventListener("error", () => fail(new Error("stage socket failed")));
			socket.addEventListener("close", ({code}) => {
				notices.push({closed: code});
				for (const waiting of pending.values()) waiting.fail(new Error(`closed ${code}`));
				pending.clear();
			});
			const hello = async (nonce: string) => {
				const armored = await Effect.runPromise(
					writeSshsig({
						text: `fabrika-hello\n${url}\n${label}\n${nonce}`,
						space: "fabrika-client",
						line: key.line,
						sign: key.sign,
					}),
				);
				return call("initialize", {
					versions: [1],
					has: ["seal"],
					ping: "30s",
					key: key.raw,
					tab: label,
					nonce,
					platform: "browser",
					os: "linux",
					sentAt: new Date().toISOString(),
					signed: armored,
				});
			};
			socket.addEventListener("message", ({data}) => {
				if (data === "pong") return;
				const frame = JSON.parse(String(data));
				notices.push(frame);
				if (frame.method === "challenge") void hello(frame.params.nonce).then(done, fail);
				if (frame.method === "client.granted")
					void hello(frame.params.nonce).then((reply) => notices.push({ready: reply}), fail);
				if (typeof frame.id === "number") {
					pending.get(frame.id)?.done(frame);
					pending.delete(frame.id);
				}
			});
		});
	const first = yield* attempt(connect);
	yield* Effect.addFinalizer(() => Effect.sync(() => socket.close()));
	return {
		first,
		notices,
		key: key.fingerprint,
		call: (method: string, params: unknown) => attempt(() => call(method, params)),
		reconnect: attempt(async () => {
			socket.close();
			return connect();
		}),
		close: Effect.sync(() => socket.close()),
	};
});

export const processId = Effect.fn("test.p24.processId")(function* (
	client: Effect.Success<ReturnType<typeof protocol>>,
	name: string,
) {
	const answer = yield* client.call("ledger.read", {stream: `processes/${name}`, after: 0});
	expect(answer.error).toBeUndefined();
	const started = answer.result.entries.find(
		(r: any) => r._tag === "started" && r.body.name === name,
	);
	expect(started, `${name} is not a real started program`).toBeDefined();
	return String(started.body.process);
});
export const assertWake = (before: readonly any[], after: readonly any[], process: string) => {
	for (const object of ["project", "gateway"]) {
		const instances = (rows: readonly any[]) =>
			rows
				.filter(
					(r) =>
						r.name === "object.wake" && JSON.stringify(r.resource).toLowerCase().includes(object),
				)
				.flatMap((r) =>
					Object.values(r.attributes).filter(
						(v) => typeof v === "string" && v.startsWith("instance_"),
					),
				);
		const old = new Set(instances(before));
		expect(
			instances(after).some((id) => !old.has(id)),
			`${object}: no new activation observed`,
		).toBe(true);
	}
	expect(
		after.filter(
			(r) => /exited|restarted|DOWN/.test(r.name) && JSON.stringify(r.attributes).includes(process),
		),
	).toEqual([]);
};

export const smoke = Effect.fn("test.p24.smoke")(function* (options: {
	readonly url: string;
	readonly home: string;
	readonly stage: "local" | "cloud";
}): Effect.fn.Return<SmokeReport, SmokeError, Scope.Scope> {
	const started = performance.now();
	const {launchP23} = yield* attempt(() => import("./p23.test-support.ts"));
	const app = yield* launchP23({
		home: options.home,
		label: "p24-smoke",
		layout: "one",
		look: "dark",
		brain: "stand-in",
		seal: "stand-in",
	});
	expect(app.url).toBe(options.url);
	const client = yield* protocol(options.url, "p24-smoke");
	yield* client.call("door.knock", {label: "P24 smoke"});
	const stageWords = options.stage === "local" ? "Local" : "Cloud";
	yield* attempt(() => app.popover.getByText(stageWords, {exact: false}).first().waitFor());
	yield* attempt(() =>
		app.popover
			.getByRole("button", {name: /Approve/})
			.filter({hasText: /P24 smoke/})
			.click(),
	);
	yield* app.answerCheck("click");
	yield* attempt(() =>
		expect.poll(() => client.notices.some((r: any) => r.ready?.result)).toBe(true),
	);
	const pid = yield* processId(client, "counter:1");
	const first = yield* client.call("view.open", {pid});
	expect(first.error).toBeUndefined();
	const samples: Array<SmokeReport["samples"][number]> = [
		{measure: "first_answer", ms: performance.now() - started, why: null},
	];
	const t = performance.now();
	const letter = `p24-${crypto.randomUUID()}`;
	const sent = yield* client.call("process.send", {
		pid,
		letter,
		m: {type: "inc"},
		sentAt: new Date().toISOString(),
		seen: 0,
	});
	expect(sent.result?._tag).toBe("accepted");
	yield* attempt(() =>
		expect
			.poll(async () => Number(await app.window.getByRole("status").first().innerText()))
			.toBe(first.result.view.count + 1),
	);
	samples.push({measure: "press_to_count", ms: performance.now() - t, why: null});
	const reconnectAt = performance.now();
	yield* client.reconnect;
	expect((yield* client.call("view.open", {pid})).result.view.count).toBe(
		first.result.view.count + 1,
	);
	samples.push({measure: "reconnect", ms: performance.now() - reconnectAt, why: null});
	const notes = yield* processId(client, "notes:1");
	const body = "# P24 smoke\nSaved through the real off file.";
	expect(
		(yield* client.call("process.send", {
			pid: notes,
			letter: `p24-note-${crypto.randomUUID()}`,
			m: {type: "save", value: {note: "p24-smoke", base: 0, body}},
			sentAt: new Date().toISOString(),
			seen: 0,
		})).result?._tag,
	).toBe("accepted");
	expect(JSON.stringify((yield* client.call("view.open", {pid: notes})).result.view)).toContain(
		body,
	);
	const spans = (yield* client.call("spans.read", {chain: {_tag: "spans"}, after: 0})).result.spans;
	const loads = spans.filter((r: any) => /loader.*load/.test(r.name));
	const cold = loads.find(
		(r: any) =>
			Object.values(r.attributes).includes(pid) && r.attributes["fab.loader.first"] === true,
	);
	samples.push({
		measure: "isolate_cold_load",
		ms: cold ? Number(BigInt(cold.endTimeUnixNano) - BigInt(cold.startTimeUnixNano)) / 1e6 : null,
		why: cold ? null : "No first callback/execution under a new cache key was observed",
	});
	// Keep the actual socket and wait parked. No abort, reset, test route, or simulated wake.
	const wait = yield* client
		.call("ledger.wait", {stream: "counter:1/inbox", after: sent.result.rev})
		.pipe(Effect.forkScoped);
	yield* attempt(() => app.window.close());
	yield* attempt(() => app.popover.close());
	// Cloudflare's idle condition is checked by new activation records after this quiet interval.
	// Real time, even under @effect/vitest's TestClock. A virtual pause cannot prove sleep.
	yield* attempt(() => new Promise<void>((done) => setTimeout(done, 45_000)));
	const wakeAt = performance.now();
	yield* client.call("process.send", {
		pid,
		letter: `p24-wake-${crypto.randomUUID()}`,
		m: {type: "inc"},
		sentAt: new Date().toISOString(),
		seen: sent.result.rev,
	});
	const delivered = yield* Fiber.join(wait);
	expect(delivered.error).toBeUndefined();
	const after = (yield* client.call("spans.read", {chain: {_tag: "spans"}, after: 0})).result.spans;
	const wake = Effect.runSync(Effect.exit(Effect.sync(() => assertWake(spans, after, pid))));
	const woke = wake._tag === "Success";
	samples.push({
		measure: "cold_wake",
		ms: woke ? performance.now() - wakeAt : null,
		why: woke ? null : "No new Project and Gateway activation was observed",
	});
	const process = (yield* client.call("ledger.read", {stream: "processes/counter:1", after: 0}))
		.result.entries;
	expect(process.filter((e: any) => ["exited", "restarted", "DOWN"].includes(e._tag))).toEqual([]);
	expect(process.find((e: any) => e._tag === "started")?.body.process).toBe(pid);
	const build = (yield* app.entries).find((e: any) => e._tag === "started")?.build;
	return {
		build,
		sha256: build,
		samples,
		checks: [
			{name: "counter and real notes", passed: true, why: null},
			{
				name: "parked wait survived a confirmed wake",
				passed: woke,
				why: woke ? null : "Idle time alone does not prove hibernation",
			},
			{
				name: "new loader cache key actually executed",
				passed: Boolean(cold),
				why: cold ? null : "First load was not observed",
			},
		],
	};
});
