// P12, next/. Project and Gateway use their real composition and SQLite services.
// Only platform handles are supplied here. No sockets or substitute authority rules.
import {createHash, generateKeyPairSync, sign} from "node:crypto";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import type {Descriptor, Incoming, Sent} from "@kampus/libfabrika";
import {BrainFact} from "@kampus/libfabrika/brain-fact";
import {revokeText, SigningRefused, Start, type From} from "@kampus/libfabrika/coordination";
import type {SpanRow} from "@kampus/libfabrika/data";
import {nodeSql} from "@kampus/libfabrika/sqlite";
import {Attached} from "@kampus/libfabrika/transport";
import {GatewayService, gatewayRuntime} from "@kampus/libfabrika/workers/gateway";
import {ProjectService, bucketCalls} from "@kampus/libfabrika/workers/runtime";
import {Deferred, Effect, Exit, Option, Tracer} from "effect";
import * as fc from "fast-check";
import {afterEach, describe, expect, it, vi} from "vitest";
import {projectRuntime, settings, type Env} from "./runtime.ts";

const table = vi.hoisted(() => ({programs: {} as Record<string, {hash: string; source: string}>}));
vi.mock("./table.ts", () => table);
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const SENT = "2026-11-08T04:00:00.000Z";
const field = (value: Buffer | string) => {
	const body = Buffer.from(value),
		size = Buffer.alloc(4);
	size.writeUInt32BE(body.length);
	return Buffer.concat([size, body]);
};
const identity = () => {
	const pair = generateKeyPairSync("ed25519"),
		raw = pair.publicKey.export({format: "jwk"}).x!;
	const bytes = Buffer.from(raw, "base64url"),
		blob = Buffer.concat([field("ssh-ed25519"), field(bytes)]);
	return {
		raw,
		line: `ssh-ed25519 ${blob.toString("base64")}`,
		fingerprint: `SHA256:${createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "")}`,
		proof: (text: string) => {
			const payload = Buffer.concat([
				Buffer.from("SSHSIG"),
				field("fabrika-client"),
				field(""),
				field("sha512"),
				field(createHash("sha512").update(text).digest()),
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
				field(Buffer.concat([field("ssh-ed25519"), field(sign(null, payload, pair.privateKey))])),
			]);
			return `-----BEGIN SSH SIGNATURE-----\n${packet
				.toString("base64")
				.match(/.{1,70}/g)!
				.join("\n")}\n-----END SSH SIGNATURE-----\n`;
		},
	};
};
const closers: Array<() => Promise<void>> = [];
const generated = fc.record({
	letter: fc.uuid(),
	write: fc.uuid(),
	trace: fc
		.uint8Array({minLength: 16, maxLength: 16})
		.map((bytes) => Buffer.from(bytes).toString("hex")),
	build: fc.uuid(),
	rev: fc.integer({min: 1, max: 1_000_000}),
});
const prepareInput = {
	letter: "prepare",
	write: "write-1",
	trace: TRACE,
	build: "counter-b",
	rev: 1,
};
const approveInput = {...prepareInput, letter: "approve"};
const law = (
	name: string,
	check: (input: ReturnType<typeof generated.generate>["value"]) => Promise<void>,
) =>
	it(name, async () => {
		await fc.assert(
			fc.asyncProperty(generated, async (input) => {
				try {
					await check(input);
				} finally {
					for (const close of closers.splice(0).reverse()) await close();
				}
			}),
			{seed: 119120, numRuns: 20, examples: [[prepareInput], [approveInput]]},
		);
	});
afterEach(async () => {
	for (const close of closers.splice(0).reverse()) await close();
});
const storage = (db: DatabaseSync) => {
	const sql = nodeSql(db),
		values = new Map<string, unknown>();
	return {
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
};
const world = async (trace = TRACE, build = "counter-b") => {
	table.programs.counter = {hash: "counter-a", source: "counter"};
	table.programs.approvals = {hash: "approvals-a", source: "approvals"};
	const home = mkdtempSync(join(tmpdir(), "p12-r-")),
		key = identity();
	const db = new DatabaseSync(join(home, "project.db"));
	// oxlint-disable-next-line fabrika/no-type-assertions -- Node fixture implements the platform members Project reads; only workerd can construct a full DurableObjectState
	const ctx = {id: {name: "project-test"}, storage: storage(db)} as unknown as DurableObjectState;
	const descriptors = new Map<string, Descriptor>(),
		configured: Descriptor[] = [],
		received: Incoming[] = [],
		recorded: SpanRow[] = [];
	let onMessage: (pid: string, input: Incoming) => Promise<Sent> = async (_pid, input) => {
		received.push(input);
		return {_tag: "accepted", rev: 1, pos: 1};
	};
	let onRing: () => Promise<void> = async () => {};
	// oxlint-disable-next-line fabrika/no-type-assertions -- Node binding doubles implement only the RPC methods this composition calls, without workerd's nominal brands
	const env = {
		STAGE: JSON.stringify({
			name: "project-test",
			person: PERSON,
			founder: key.line,
			window: key.raw,
			port: 18787,
			build: "brain-test",
		}),
		PROCESS: {
			getByName: (name: string) => {
				const [, pid] = JSON.parse(name) as [string, string];
				return {
					configure: async (descriptor: Descriptor) => {
						descriptors.set(pid, descriptor);
						configured.push(descriptor);
					},
					msg: (input: Incoming) => onMessage(pid, input),
				};
			},
		},
		GATEWAY: {
			getByName: () => ({ring: () => onRing(), notify: async () => {}, probe: async () => 42}),
		},
		RECORD: {
			getByName: () => ({
				write: async (_chain: unknown, _part: number, rows: ReadonlyArray<{span: SpanRow}>) => {
					recorded.push(...rows.map((row) => row.span));
					return {_tag: "written"};
				},
			}),
		},
		HEALTH: {},
		LOADER: {
			get: (id: string) => ({
				getEntrypoint: () => ({
					describe: async () =>
						id.startsWith("approvals-")
							? {
									name: "approvals",
									v: 1,
									writes: {answered: {personOnly: true}},
									inputs: {
										prepare: {write: true, personOnly: false},
										approve: {write: true, personOnly: true},
									},
									cmds: [],
								}
							: {
									name: "counter",
									v: 1,
									writes: {},
									inputs: {inc: {write: true, personOnly: false}},
									cmds: [],
								},
				}),
			}),
		},
	} as unknown as Env;
	let runtime = projectRuntime(ctx, env);
	const run = <A, E>(work: Effect.Effect<A, E, ProjectService>) => runtime.runPromise(work);
	closers.push(async () => {
		await runtime.dispose();
		db.close();
		rmSync(home, {recursive: true, force: true});
	});
	const p = await run(
		ProjectService.pipe(
			Effect.withParentSpan(Tracer.externalSpan({traceId: trace, spanId: "00f067aa0ba902b7"})),
		),
	);
	const from: From = {
		by: key.fingerprint,
		for: PERSON,
		sentAt: SENT,
		seen: 0,
		parent: null,
		traceId: trace,
		build: "brain-test",
	};
	const client = await run(p.connect()),
		nonce = await run(p.challenge(client));
	expect(
		await run(
			p.initialize(
				client,
				{
					versions: [1],
					has: ["seal"],
					ping: "30s",
					key: key.raw,
					tab: "tab-a",
					nonce,
					platform: "headless",
					os: "linux",
					sentAt: SENT,
					signed: key.proof(`fabrika-hello\nhttp://127.0.0.1:18787\ntab-a\n${nonce}`),
				},
				{url: "http://127.0.0.1:18787", tab: "tab-a", name: key.fingerprint},
			),
		),
	).toMatchObject({_tag: "online"});
	return {
		p,
		run,
		key,
		env,
		db,
		from,
		descriptors,
		configured,
		received,
		recorded,
		start: async () =>
			(
				await run(
					p.start(
						Start.cases.first.make({
							id: "approvals:1",
							name: "approvals:1",
							code: {program: "approvals", hash: "approvals-a"},
						}),
						from,
					),
				)
			).process,
		send: (pid: string, type: string, letter = type) =>
			run(p.route(client, "process.send", {pid, letter, m: {type}, sentAt: SENT, seen: 0})),
		revoke: () => {
			const text = revokeText({
				id: "revoke-1",
				key: key.raw,
				for: PERSON,
				to: "project-test",
				saw: {label: "fixture", where: "local", how: "command", check: "none"},
				sentAt: SENT,
			});
			return run(p.grant({text, armored: key.proof(text)}));
		},
		message: (f: typeof onMessage) => {
			onMessage = f;
		},
		ring: (f: typeof onRing) => {
			onRing = f;
		},
		reopen: async () => {
			await runtime.dispose();
			table.programs.counter = {hash: build, source: "changed counter"};
			runtime = projectRuntime(ctx, env);
			return run(ProjectService);
		},
	};
};

describe("P12 Project authority", () => {
	law("the bootstrap entry keeps the caller's span trace", async ({trace}) => {
		const w = await world(trace);
		const [row] = await w.run(w.p.read("processes/counter:1", 0, "audit"));
		expect(row).toMatchObject({traceId: trace, rev: w.p.boot.rev});
	});
	law("a brain lifecycle entry keeps the caller's span trace", async ({trace, write}) => {
		const w = await world();
		const fact = BrainFact.cases.stopped.make({id: write, start: write, at: 1, why: "stop"});
		await w.run(
			w.p
				.brain(fact)
				.pipe(
					Effect.withParentSpan(Tracer.externalSpan({traceId: trace, spanId: "00f067aa0ba902b7"})),
				),
		);
		const [row] = await w.run(w.p.read("door/brain", 0, "audit"));
		expect(row).toMatchObject({traceId: trace, id: write, body: fact});
	});
	law(
		"reopening an exited bootstrap reads its first placing without starting it again",
		async ({trace, build}) => {
			const w = await world(trace, build);
			const first = w.p.boot;
			const before = await w.run(w.p.read("processes/counter:1", 0, "audit"));
			await w.run(w.p.exit(first.process, "normal", w.from));
			const configured = w.configured.length;
			const reopened = await w.reopen();
			expect(reopened.boot).toEqual(first);
			expect(w.configured).toHaveLength(configured);
			const entries = await w.run(reopened.read("processes/counter:1", 0, "audit"));
			expect(entries[0]).toEqual(before[0]);
			expect(entries).toHaveLength(2);
		},
	);
	law(
		"a program's person-only facts require its own person-only input",
		async ({letter, write}) => {
			const w = await world(),
				pid = await w.start();
			await w.send(pid, "prepare", letter);
			const parent = w.received[0]!.envelope.id;
			const result = await w.run(Effect.exit(w.p.sign(pid, write, parent, "answered")));
			expect(result).toMatchObject({_tag: "Failure"});
			const failure = Option.getOrThrow(Exit.findErrorOption(result));
			expect(failure).toBeInstanceOf(SigningRefused);
			expect(failure).toMatchObject({why: "person_only"});
		},
	);
	law(
		"a program's declared person-only input authorizes its person-only fact",
		async ({letter, write}) => {
			const w = await world(),
				pid = await w.start();
			await w.send(pid, "approve", letter);
			const result = await w.run(
				Effect.exit(w.p.sign(pid, write, w.received[0]!.envelope.id, "answered")),
			);
			expect(result).toMatchObject({_tag: "Success", value: {by: {_tag: "person"}}});
			// The saved delivery is independent evidence of the declaration used at admission.
			const saved = w.db
				.prepare("SELECT saved FROM door_sessions WHERE parent=?")
				.get(w.received[0]!.envelope.id);
			expect(JSON.parse(String(saved!.saved))).toMatchObject({
				input: {personOnly: true, process: pid},
			});
		},
	);
	law("input permission is checked again at the final append", async ({letter}) => {
		const w = await world(),
			pid = w.p.boot.process;
		const entered = await Effect.runPromise(Deferred.make<void>()),
			release = await Effect.runPromise(Deferred.make<void>());
		w.message(async (_pid, input) => {
			w.received.push(input);
			await Effect.runPromise(Deferred.succeed(entered, undefined));
			await Effect.runPromise(Deferred.await(release));
			const result = await w.run(w.p.inbox(pid, input));
			return result._tag === "placed"
				? {_tag: "accepted", rev: result.rev, pos: result.pos}
				: {_tag: "refused", why: result.why};
		});
		const pending = w.send(pid, "inc", letter).then(
			(answer) => ({answer}),
			(error: unknown) => ({error}),
		);
		await Effect.runPromise(Deferred.await(entered));
		try {
			expect(await w.revoke()).toMatchObject({_tag: "applied"});
		} finally {
			await Effect.runPromise(Deferred.succeed(release, undefined));
		}
		await pending;
		expect(await w.run(w.p.read("counter:1/inbox", 0, "audit"))).toEqual([]);
	});
	for (const operation of ["own", "inbox", "start", "exit"] as const)
		law(
			`the Project releases its write permit before notifying ${operation}`,
			async ({write, letter}) => {
				const w = await world(),
					pid = w.p.boot.process;
				const stream =
					operation === "own"
						? "facts"
						: operation === "inbox"
							? "counter:1/inbox"
							: operation === "start"
								? "processes/approvals:1"
								: "processes/counter:1";
				const after = (await w.run(w.p.read(stream, 0, "audit"))).at(-1)?.rev ?? 0;
				await w.run(w.p.wait(stream, after, "gateway-test"));
				let reentered = false;
				let inside = false;
				w.ring(async () => {
					if (inside) return;
					inside = true;
					const answer = await w.run(
						w.p
							.start(
								Start.cases.first.make({
									id: `nested:${write}`,
									name: `nested:${write}`,
									code: {program: "counter", hash: "counter-a"},
								}),
								w.from,
							)
							.pipe(Effect.timeoutOption("150 millis")),
					);
					reentered = Option.isSome(answer);
				});
				if (operation === "own") await w.run(w.p.own(pid, write, "facts", {_tag: "noted"}));
				else if (operation === "start") await w.start();
				else if (operation === "exit") await w.run(w.p.exit(pid, "normal", w.from));
				else {
					await w.send(pid, "inc", letter);
					await w.run(w.p.inbox(pid, w.received[0]!));
				}
				expect(reentered, "a ring can reenter Project without waiting on its caller").toBe(true);
			},
		);
	law(
		"reopening a project restores its process when the available bundle changes",
		async ({build}) => {
			const w = await world(TRACE, build),
				before = await w.run(w.p.info),
				configured = w.configured.length;
			const result = await Effect.runPromise(
				Effect.tryPromise({
					try: w.reopen,
					catch: (cause) => new Error("project reopen failed", {cause}),
				}).pipe(Effect.exit),
			);
			expect(result).toMatchObject({_tag: "Success"});
			if (Exit.isSuccess(result)) {
				expect(await w.run(result.value.info)).toEqual(before);
				expect(w.configured).toHaveLength(configured);
				expect(await w.run(result.value.read("processes/counter:1", 0, "audit"))).toHaveLength(1);
			}
		},
	);
	for (const field of ["writer", "trace"] as const)
		law(`an own write retains its process ${field}`, async ({trace, write}) => {
			const w = await world(trace),
				pid = w.p.boot.process;
			await w.run(
				w.p
					.own(pid, write, "facts", {_tag: "noted"})
					.pipe(
						Effect.withParentSpan(
							Tracer.externalSpan({traceId: trace, spanId: "00f067aa0ba902b7"}),
						),
					),
			);
			const [row] = await w.run(w.p.read("facts", 0, "audit"));
			expect(row).toMatchObject(
				field === "writer"
					? {by: w.descriptors.get(pid)!.owner.key, for: PERSON, parent: null}
					: {traceId: trace},
			);
		});
});

describe("P12 WebCrypto failures", () => {
	const failure = fc.oneof(
		fc.anything(),
		fc.string().map((message) => new Error(message)),
		fc.constant(new DOMException("digest refused", "OperationError")),
	);
	for (const edge of ["fingerprint", "archive checksum"] as const)
		it(`${edge} refuses every thrown or rejected failure with why crypto`, async () => {
			await fc.assert(
				fc.asyncProperty(failure, fc.boolean(), fc.uint8Array(), async (value, throws, body) => {
					const w = edge === "fingerprint" ? await world() : null;
					const digest = vi.spyOn(crypto.subtle, "digest").mockImplementation(() => {
						if (throws) throw value;
						return Promise.reject(value);
					});
					const put = vi.fn(async () => null);
					try {
						if (w !== null) {
							const result = await w.run(Effect.exit(w.p.online(w.key.fingerprint)));
							expect(result).toMatchObject({_tag: "Failure"});
							expect(Option.getOrThrow(Exit.findErrorOption(result))).toMatchObject({
								_tag: "LedgerError",
								why: "crypto",
							});
						} else {
							// oxlint-disable-next-line fabrika/no-type-assertions -- the digest must fail before any R2 method runs
							const bucket = {put} as unknown as R2Bucket;
							await expect(
								bucketCalls(bucket).put("health", body, "0".repeat(64)),
							).rejects.toMatchObject({_tag: "LedgerError", why: "crypto"});
							expect(put).not.toHaveBeenCalled();
						}
						expect(digest).toHaveBeenCalled();
					} finally {
						digest.mockRestore();
						for (const close of closers.splice(0).reverse()) await close();
					}
				}),
				{seed: 119120, numRuns: 20},
			);
		});
});

describe("P12 Gateway recording", () => {
	for (const operation of ["ring", "probe", "close", "notify"] as const)
		law(
			`an authenticated ${operation} records through the project's sink`,
			async ({letter, rev}) => {
				const w = await world(),
					db = new DatabaseSync(":memory:");
				let attached: typeof Attached.Type = Attached.cases.online.make({
					client: letter,
					who: {key: w.key.fingerprint, person: PERSON, as: "window"},
					version: 1,
					waits: [],
					watching: false,
					busy: false,
				});
				const ws = {
					deserializeAttachment: () => attached,
					serializeAttachment: (a: typeof Attached.Type) => {
						attached = a;
					},
					send: () => {
						if (operation === "notify") throw new Error("delivery failed");
					},
					close: () => {},
				};
				// oxlint-disable-next-line fabrika/no-type-assertions -- Node fixture supplies the hibernating socket and SQL members consumed by Gateway
				const ctx = {
					id: {name: "gateway-test"},
					storage: storage(db),
					getWebSockets: () => [ws],
					getTags: () => ["session-test", "tab-a", w.key.fingerprint],
					getWebSocketAutoResponseTimestamp: () => new Date(42),
				} as unknown as DurableObjectState;
				// oxlint-disable-next-line fabrika/no-type-assertions -- this Node RPC double has no workerd namespace brand
				const project = {
					getByName: () => ({leave: async () => {}, disconnect: async () => {}}),
				} as unknown as Env["PROJECT"];
				// oxlint-disable-next-line fabrika/no-type-assertions -- Node socket double implements attachment, send and close without workerd's socket brand
				const socket = ws as unknown as WebSocket;
				const runtime = gatewayRuntime(ctx, {...w.env, PROJECT: project}, settings(w.env));
				try {
					const gateway = await runtime.runPromise(GatewayService),
						before = w.recorded.length;
					const action: Effect.Effect<unknown, unknown> =
						operation === "ring"
							? gateway.ring("facts", rev)
							: operation === "probe"
								? gateway.probe("session-test")
								: operation === "close"
									? gateway.close(socket)
									: gateway.notify(letter, {method: "view.patch", params: {}});
					await runtime.runPromise(Effect.exit(action));
					const rows = w.recorded.slice(before);
					expect(rows.some((row) => row.name === `gateway.${operation}`)).toBe(true);
					if (operation === "notify") expect(rows.some((row) => !row.ok)).toBe(true);
				} finally {
					await runtime.dispose();
					db.close();
				}
			},
		);
});
