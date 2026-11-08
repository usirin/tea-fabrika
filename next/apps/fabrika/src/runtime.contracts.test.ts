// P12, next/. Real Project/Gateway logic over SQLite; only platform handles are supplied here.
import {createHash, generateKeyPairSync, sign} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {Incoming} from "@kampus/libfabrika";
import {revokeText, Start, type From} from "@kampus/libfabrika/coordination";
import {type SpanRow} from "@kampus/libfabrika/data";
import {nodeSql} from "@kampus/libfabrika/sqlite";
import {Attached} from "@kampus/libfabrika/transport";
import {Effect, Exit, Schema, Tracer} from "effect";
import {afterEach, describe, expect, it, vi} from "vitest";
import {GatewayService, gatewayRuntime} from "./gateway.ts";
import {ProjectService, projectRuntime, type Env} from "./runtime.ts";

const bundles = vi.hoisted(() => ({
	programs: {
		counter: {hash: "counter-a", source: "counter"},
		approvals: {hash: "approvals-a", source: "approvals"},
	},
}));
vi.mock("./table.ts", () => bundles);
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const SENT = "2026-11-08T04:00:00.000Z";
const field = (v: string | Buffer) => {
	const bytes = Buffer.from(v),
		size = Buffer.alloc(4);
	size.writeUInt32BE(bytes.length);
	return Buffer.concat([size, bytes]);
};
// Ephemeral test identities. No key is read from disk or printed.
const identity = () => {
	const pair = generateKeyPairSync("ed25519");
	const raw = pair.publicKey.export({format: "jwk"}).x!;
	const bytes = Buffer.from(raw, "base64url");
	const blob = Buffer.concat([field("ssh-ed25519"), field(bytes)]);
	return {
		raw,
		line: `ssh-ed25519 ${blob.toString("base64")}`,
		fingerprint: `SHA256:${createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "")}`,
		proof: (text: string) => {
			const hash = createHash("sha512").update(text).digest();
			const signed = Buffer.concat([
				Buffer.from("SSHSIG"),
				field("fabrika-client"),
				field(""),
				field("sha512"),
				field(hash),
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
				field(Buffer.concat([field("ssh-ed25519"), field(sign(null, signed, pair.privateKey))])),
			]);
			return `-----BEGIN SSH SIGNATURE-----\n${packet.toString("base64")}\n-----END SSH SIGNATURE-----\n`;
		},
	};
};
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const close of cleanups.splice(0).reverse()) await close();
	bundles.programs.counter.hash = "counter-a";
});
const storage = () => {
	const db = new DatabaseSync(":memory:"),
		sql = nodeSql(db);
	const values = new Map<string, unknown>();
	const handle = {
		sql: {
			exec: sql.exec,
			get databaseSize() {
				return sql.size();
			},
		},
		transactionSync: sql.transaction,
		get: async (key: string) => values.get(key),
		put: async (key: string, value: unknown) => {
			values.set(key, value);
		},
	};
	cleanups.push(async () => {
		db.close();
	});
	return {db, handle};
};
const world = async () => {
	const key = identity(),
		store = storage();
	const spans: Array<typeof SpanRow.Type> = [],
		deliveries: Array<typeof Incoming.Type> = [];
	const descriptors = new Map<string, unknown>();
	let ring = async (_stream: string, _rev: number) => {};
	// oxlint-disable-next-line fabrika/no-type-assertions -- Node supplies only the Workers handles this fixture exercises
	const env = {
		STAGE: JSON.stringify({
			name: "contract-project",
			person: PERSON,
			founder: key.line,
			window: key.raw,
			port: 18787,
			build: "brain-build",
		}),
		LOADER: {
			get: (_id: string, make: () => {modules: Record<string, string>}) => {
				const approvals = Object.values(make().modules).includes("approvals");
				return {
					getEntrypoint: () => ({
						describe: async () => ({
							name: approvals ? "approvals" : "counter",
							v: 1,
							inputs: {
								inc: {write: true, personOnly: false},
								approve: {write: true, personOnly: true},
							},
							writes: approvals ? {approved: {personOnly: true}, noted: {personOnly: false}} : {},
							cmds: [],
						}),
					}),
				};
			},
		},
		PROCESS: {
			getByName: (name: string) => ({
				configure: async (descriptor: unknown) => {
					descriptors.set(name, descriptor);
				},
				msg: async (input: unknown) => {
					deliveries.push(Schema.decodeUnknownSync(Incoming)(input));
					return {_tag: "accepted", rev: 1, pos: 1};
				},
			}),
		},
		GATEWAY: {
			getByName: () => ({
				ring: (stream: string, rev: number) => ring(stream, rev),
				notify: async () => {},
			}),
		},
		RECORD: {
			getByName: () => ({
				write: async (_chain: unknown, _part: number, rows: Array<{span: typeof SpanRow.Type}>) => {
					spans.push(...rows.map((r) => r.span));
					return {_tag: "written"};
				},
			}),
		},
		HEALTH: {head: async () => null, put: async () => null},
	} as unknown as Env;
	// oxlint-disable-next-line fabrika/no-type-assertions -- Node SQLite stands in for the platform-owned Durable Object state
	const ctx = {
		id: {name: "contract-project"},
		storage: store.handle,
	} as unknown as DurableObjectState;
	const runtime = projectRuntime(ctx, env);
	cleanups.push(() => runtime.dispose());
	const p = await runtime.runPromise(ProjectService);
	const from: From = {
		by: key.fingerprint,
		for: PERSON,
		sentAt: SENT,
		seen: 0,
		parent: null,
		traceId: TRACE,
		build: "brain-build",
	};
	const run = <A, E>(work: Effect.Effect<A, E>) => runtime.runPromise(work);
	const online = async (who = key) => {
		const client = await run(p.connect()),
			nonce = await run(p.challenge(client));
		const tab = "contract-tab",
			url = "http://127.0.0.1:18787";
		const hello = await run(
			p.initialize(
				client,
				{
					versions: [1],
					has: [],
					ping: "30s",
					key: who.raw,
					tab,
					nonce,
					platform: "headless",
					os: "linux",
					sentAt: SENT,
					signed: who.proof(`fabrika-hello\n${url}\n${tab}\n${nonce}`),
				},
				{url, tab, name: who.fingerprint},
			),
		);
		expect(hello._tag).toBe("online");
		return client;
	};
	return {
		p,
		env,
		key,
		store,
		spans,
		deliveries,
		descriptors,
		ctx,
		run,
		online,
		from,
		ring: (f: typeof ring) => {
			ring = f;
		},
	};
};

describe("P12 Project authority contracts", () => {
	it("each process uses its own program's person-only fact policy", async () => {
		const w = await world(),
			client = await w.online();
		const started = await w.run(
			w.p.start(
				Start.cases.first.make({
					id: "approvals",
					name: "approvals:1",
					code: {program: "approvals", hash: "approvals-a"},
				}),
				w.from,
			),
		);
		await w.run(
			w.p.route(client, "process.send", {
				pid: started.process,
				letter: "ordinary",
				m: {type: "inc"},
				sentAt: SENT,
				seen: 0,
			}),
		);
		const parent = w.deliveries.at(-1)!.envelope.id;
		const denied = await w.run(
			Effect.exit(w.p.sign(started.process, "answer", parent, "approved")),
		);
		expect
			.soft(denied, "ordinary input cannot authorize this program's person-only fact")
			.toMatchObject({_tag: "Failure"});
		await w.run(
			w.p.route(client, "process.send", {
				pid: started.process,
				letter: "approval",
				m: {type: "approve"},
				sentAt: SENT,
				seen: 0,
			}),
		);
		const allowed = await w.run(
			w.p.sign(started.process, "approved-answer", w.deliveries.at(-1)!.envelope.id, "approved"),
		);
		expect(allowed.by.key).toBe(w.key.fingerprint);
	});
	it("the final inbox append requires the sender's current permission", async () => {
		const w = await world(),
			client = await w.online(),
			pid = w.p.boot.process;
		await w.run(
			w.p.route(client, "process.send", {
				pid,
				letter: "allowed",
				m: {type: "inc"},
				sentAt: SENT,
				seen: 0,
			}),
		);
		expect(await w.run(w.p.inbox(pid, w.deliveries.at(-1)!))).toMatchObject({_tag: "placed"});
		await w.run(
			w.p.route(client, "process.send", {
				pid,
				letter: "admitted",
				m: {type: "inc"},
				sentAt: SENT,
				seen: 0,
			}),
		);
		const incoming = w.deliveries.at(-1)!;
		const text = revokeText({
			id: "revoke",
			key: w.key.raw,
			for: PERSON,
			to: "contract-project",
			saw: {label: "fixture", where: "local", how: "command", check: "none"},
			sentAt: SENT,
		});
		expect(await w.run(w.p.grant({text, armored: w.key.proof(text)}))).toMatchObject({
			_tag: "applied",
		});
		const result = await w.run(Effect.exit(w.p.inbox(pid, incoming)));
		expect
			.soft(
				Exit.isFailure(result) || result.value._tag === "refused",
				"permission was removed after admission",
			)
			.toBe(true);
		expect((await w.run(w.p.read("counter:1/inbox", 0, "audit"))).map((row) => row.id)).toEqual([
			"allowed",
		]);
	});
	it("Project notifications can reenter a write after the append commits", async () => {
		const w = await world(),
			pid = w.p.boot.process;
		await w.run(w.p.wait("facts", 0, "gateway"));
		let notified = false;
		w.ring(async () => {
			// A callback that needs the same write turn must finish before the caller can answer.
			await w.run(
				w.p.own(pid, "nested", "other-facts", {_tag: "noted"}).pipe(Effect.timeout("1 second")),
			);
			notified = true;
		});
		const result = await w.run(Effect.exit(w.p.own(pid, "outer", "facts", {_tag: "noted"})));
		expect.soft(result).toMatchObject({_tag: "Success"});
		expect(notified).toBe(true);
	});
	it("opening an existing project restores its process across a bundle hash change", async () => {
		const w = await world(),
			before = await w.run(w.p.info);
		bundles.programs.counter.hash = "counter-b";
		const reopened = projectRuntime(w.ctx, w.env);
		cleanups.push(() => reopened.dispose());
		const restored = await reopened.runPromise(ProjectService);
		expect(await reopened.runPromise(restored.info)).toEqual(before);
		expect(restored.boot.process).toBe(w.p.boot.process);
	});
	it("an own fact keeps the process owner and the active trace", async () => {
		const w = await world(),
			pid = w.p.boot.process;
		await w.run(
			w.p
				.own(pid, "own-fact", "facts", {_tag: "noted"})
				.pipe(
					Effect.withParentSpan(Tracer.externalSpan({traceId: TRACE, spanId: "00f067aa0ba902b7"})),
				),
		);
		const [row] = await w.run(w.p.read("facts", 0, "audit"));
		const descriptor = [...w.descriptors.values()].find((v) => (v as {id: string}).id === pid) as {
			owner: {key: string; for: string};
		};
		expect(row).toMatchObject({
			by: descriptor.owner.key,
			for: descriptor.owner.for,
			parent: null,
			traceId: TRACE,
		});
	});
});

describe("P12 Gateway recording contracts", () => {
	it.each(["ring", "probe", "close", "notify"] as const)(
		"an admitted Gateway %s records through its project sink",
		async (operation) => {
			const w = await world(),
				store = storage();
			let saved = Attached.cases.online.make({
				client: "client-1",
				who: {key: w.key.fingerprint, person: PERSON, as: "window"},
				version: 1,
				waits: [{id: "wait", stream: "facts", after: 0}],
				watching: false,
				busy: false,
			});
			const ws = {
				deserializeAttachment: () => saved,
				serializeAttachment: (value: typeof saved) => {
					saved = value;
				},
				send: () => {},
				close: () => {},
			};
			// oxlint-disable-next-line fabrika/no-type-assertions -- the fixture supplies socket and storage handles without starting workerd
			const ctx = {
				id: {name: "gateway-1"},
				storage: store.handle,
				getWebSockets: () => [ws],
				getTags: () => ["session-1", "tab", w.key.fingerprint],
				getWebSocketAutoResponseTimestamp: () => new Date(42),
			} as unknown as DurableObjectState;
			// oxlint-disable-next-line fabrika/no-type-assertions -- this Gateway fixture replaces only its remote Project binding
			const env = {
				...w.env,
				PROJECT: {getByName: () => ({leave: async () => {}, disconnect: async () => {}})},
			} as unknown as Env;
			const runtime = gatewayRuntime(ctx, env);
			cleanups.push(() => runtime.dispose());
			const g = await runtime.runPromise(GatewayService);
			w.spans.length = 0;
			// oxlint-disable-next-line fabrika/no-type-assertions -- the test socket implements only the attachment and send methods used here
			const socket = ws as unknown as WebSocket;
			await runtime.runPromise(
				operation === "ring"
					? g.ring("facts", 1)
					: operation === "probe"
						? g.probe("session-1").pipe(Effect.asVoid)
						: operation === "close"
							? g.close(socket)
							: g.notify("client-1", {method: "view.patch", params: {rev: 1}}),
			);
			expect(
				w.spans.some(
					(span) =>
						span.name === `gateway.${operation}` &&
						span.resource.attributes["fab.object"] === "gateway:gateway-1" &&
						span.endTimeUnixNano !== "0",
				),
			).toBe(true);
		},
	);
});
