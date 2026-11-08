// P12, next/. localStage returns trusted object capabilities used by its lifecycle control path.
// No control method below is an unauthenticated HTTP route. All record calls hit real local objects.
// The small record cap belongs to this fixture; the default remains P37's 1 GB.
import {createHash, generateKeyPairSync, sign} from "node:crypto";
import {mkdtempSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {createServer as httpServer} from "node:http";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {NodeServices} from "@effect/platform-node";
import type {From} from "@kampus/libfabrika/coordination";
import {Archive, RecordManager, SpanRow, SpanSink} from "@kampus/libfabrika/data";
import {nodeSql} from "@kampus/libfabrika/sqlite";
import {Effect, Layer, Schema, Stream} from "effect";
import {describe, expect, it} from "vitest";

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const SENT = "2026-11-08T04:00:00.000Z";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const field = (value: Buffer | string) => {
	const body = Buffer.from(value),
		n = Buffer.alloc(4);
	n.writeUInt32BE(body.length);
	return Buffer.concat([n, body]);
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
			const v = Buffer.alloc(4);
			v.writeUInt32BE(1);
			const packet = Buffer.concat([
				Buffer.from("SSHSIG"),
				v,
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
const span = (n: number) =>
	Schema.decodeUnknownSync(SpanRow)({
		traceId: TRACE,
		spanId: n.toString(16).padStart(16, "0"),
		parentSpanId: null,
		name: "runner.step",
		kind: "internal",
		startTimeUnixNano: "1794096000000000000",
		endTimeUnixNano: "1794096000001000000",
		attributes: {"fab.fill": "x".repeat(2000)},
		events: [],
		links: [],
		resource: {attributes: {"fab.object": "record-test"}},
		ok: true,
	});
const world = async (
	test: (
		stage: any,
		key: ReturnType<typeof identity>,
		probe: {
			hits: () => number;
			start: (name: string, program: string) => Promise<{process: string}>;
			from: From;
		},
	) => Promise<void>,
) => {
	process.env.DO_NOT_TRACK = "1";
	const {localState} = await import("alchemy/State/LocalState");
	const {build} = await import("./build.ts");
	const {localStage} = await import("./local-stage.ts");
	const home = mkdtempSync(join(tmpdir(), "p12-o-")),
		key = identity();
	let hits = 0;
	const outbound = httpServer((_request, reply) => {
		hits++;
		reply.end("reachable");
	});
	try {
		await new Promise<void>((done, fail) => {
			outbound.once("error", fail);
			outbound.listen(0, "127.0.0.1", done);
		});
		const destination = outbound.address();
		if (destination === null || typeof destination === "string")
			throw new Error("no probe address");
		const listener = createServer();
		await new Promise<void>((done, fail) => {
			listener.once("error", fail);
			listener.listen(0, "127.0.0.1", done);
		});
		const at = listener.address();
		if (at === null || typeof at === "string") throw new Error("no TCP port");
		await new Promise<void>((done) => listener.close(() => done()));
		symlinkSync(resolve(import.meta.dirname, "../node_modules"), join(home, "node_modules"));
		const writer = join(home, "writer.ts"),
			timer = join(home, "timer.ts"),
			sealed = join(home, "sealed.ts");
		const common = [
			'import {Machine, Cmd} from "@demlik/tea/effect";',
			'import {Schema} from "effect";',
			'const noted = Schema.TaggedStruct("noted", {n: Schema.Int});',
			"const Model = Schema.Struct({count: Schema.Int, replies: Schema.Int, wake: Schema.NullOr(Schema.Number)});",
			'const Msg = Schema.Union([Schema.Struct({type: Schema.Literal("throw")}), Schema.Struct({type: Schema.Literal("prepare")}), Schema.Struct({type: Schema.Literal("schedule"), at: Schema.Number}), Schema.Struct({type: Schema.Literal("timer"), at: Schema.Number})]);',
			'const write = Cmd.make("write", {input: Schema.Struct({stream: Schema.String, write: Schema.Json}), ok: Schema.Json, err: ["not_delivered"]});',
			'const machine = Machine.make({model: Model, msg: Msg, cmds: [write], init: (loaded) => [loaded ?? {count:0,replies:0,wake:null}, []], update: {throw: () => {throw new Error("private failure P12");}, prepare: s => [s,[]], schedule: (s,m) => [{...s,wake:m.at},[]], timer: (s,m) => [{...s,count:s.count+1,wake:m.at+10},[write({stream:"timer-facts",write:{_tag:"own",fact:{_tag:"noted",n:s.count+1}}})]], write_ok: s => [{...s,replies:s.replies+1},[]], write_err: s => [{...s,replies:s.replies+1},[]]}});',
			'const declaration = {machine,state:{v:1,schema:Model,upgrades:[]},msg:Msg,view:{data:Model,select:s=>s},refuse:()=>null,inputs:{throw:{_tag:"write",schema:Msg,description:"Fail",personOnly:false},prepare:{_tag:"write",schema:Msg,description:"Prepare",personOnly:false},schedule:{_tag:"write",schema:Msg,description:"Schedule",personOnly:false}},outputs:{},writes:{noted:{schema:noted,personOnly:false}},wake:s=>s.wake};',
		].join("\n");
		writeFileSync(
			writer,
			`${common}\nexport const program = {...declaration,name:"writer-fixture"};`,
		);
		writeFileSync(
			timer,
			`${common}\nexport const program = {...declaration,name:"timer-fixture"};`,
		);
		writeFileSync(
			sealed,
			[
				'import {env} from "cloudflare:workers";',
				'import {Machine} from "@demlik/tea/effect"; import {Schema} from "effect";',
				'let outbound = "blocked";',
				`try { await fetch("http://127.0.0.1:${destination.port}"); outbound = "allowed"; } catch {}`,
				"const Model = Schema.Struct({bindings: Schema.Array(Schema.String), outbound: Schema.String});",
				'const Msg = Schema.Struct({type: Schema.Literal("read")});',
				"const machine = Machine.make({model:Model,msg:Msg,cmds:[],init:loaded=>[loaded??{bindings:Object.keys(env),outbound},[]],update:{read:s=>[s,[]]}});",
				'export const program = {name:"sealed-fixture",machine,state:{v:1,schema:Model,upgrades:[]},msg:Msg,view:{data:Model,select:s=>s},refuse:()=>null,inputs:{},outputs:{},writes:{},wake:()=>null};',
			].join("\n"),
		);
		const built = await Effect.runPromise(
			build({
				out: join(home, "dist"),
				programs: {"writer-fixture": writer, "timer-fixture": timer, "sealed-fixture": sealed},
			}),
		);
		await Effect.runPromise(
			Effect.gen(function* () {
				const stage = yield* localStage(built, {
					home,
					name: "p12-records",
					person: PERSON,
					founder: key.line,
					window: key.raw,
					port: at.port,
					limits: {recordBytes: 64 * 1024},
				});
				const from: From = {
					by: key.fingerprint,
					for: PERSON,
					sentAt: SENT,
					seen: 0,
					parent: null,
					traceId: TRACE,
					build: built.build,
				};
				yield* Effect.promise(() =>
					test(stage, key, {
						hits: () => hits,
						from,
						start: async (name, program) => {
							const code = built.programs[program];
							expect(code, `fixture program ${program} must be built`).toBeDefined();
							const started = await Reflect.get(stage.project("p12-records"), "start")(
								{
									_tag: "first",
									id: `start-${name}`,
									name,
									code: {program, hash: code!.hash},
								},
								from,
							);
							return Schema.decodeUnknownSync(Schema.Struct({process: Schema.String}))(started);
						},
					}),
				);
			}).pipe(Effect.scoped, Effect.provide(localState()), Effect.provide(NodeServices.layer)),
		);
	} finally {
		await new Promise<void>((done) => outbound.close(() => done()));
		// localStage must close before removing its durable files.
		rmSync(home, {recursive: true, force: true});
	}
};
const admitted = async (stage: any, key: ReturnType<typeof identity>, project = "p12-records") => {
	const p = stage.project(project);
	const client = await p.connect(),
		nonce = await p.challenge(client),
		tab = "internal-test";
	const hello = await p.initialize(
		client,
		{
			versions: [1],
			has: ["seal"],
			ping: "30s",
			key: key.raw,
			tab,
			nonce,
			platform: "headless",
			os: "linux",
			sentAt: SENT,
			signed: key.proof(`fabrika-hello\n${stage.url}\n${tab}\n${nonce}`),
		},
		{url: stage.url, tab, name: key.fingerprint},
	);
	expect(hello._tag).toBe("online");
	return {p, client};
};
const routed = (p: any, client: string, method: string, params: unknown) =>
	p.route(client, method, params);
const read = async (p: any, client: string, stream: string) => {
	const r = await routed(p, client, "ledger.read", {stream, after: 0});
	expect(r._tag).toBe("ok");
	return r.result.entries as Array<any>;
};

describe("P12 real object adapters", () => {
	it("p79 plant: an old close cannot remove the newer session; failed real probes give unknown", async () => {
		await world(async (stage, key) => {
			const p = stage.project("p12-records");
			const first = {
				client: "client-1",
				key: key.fingerprint,
				gateway: "gateway-1",
				session: "process_01jc9q4w7z3m8n5r2t6v0xkb4d",
				at: 1,
			};
			await p.gateways.join(first);
			const newer = "process_01jc9q4w7z3m8n5r2t6v0xkb4e";
			await p.gateways.join({...first, session: newer, at: 2});
			await p.gateways.leave("client-1", first.session);
			const rows = await p.gateways.online(key.fingerprint);
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({client: "client-1", session: newer, state: "unknown"});
			await p.gateways.leave("client-1", newer);
			expect(await p.gateways.online(key.fingerprint)).toEqual([]);
		});
	});
	it("P37 object wiring plant: alias every SQL part, omit project, or lose had after a lost reply", async () => {
		await world(async (stage) => {
			const chain = {_tag: "spans"} as const;
			const first = stage.record("project-a", "spans/0");
			const rows = Array.from({length: 70}, (_, n) => ({span: span(n), content: null}));
			let part = 0;
			for (const row of rows) {
				for (;;) {
					const answer = await stage.record("project-a", `spans/${part}`).write(chain, part, [row]);
					if (answer._tag === "written") break;
					expect(answer.next).toBe(`spans/${part + 1}`);
					part++;
				}
			}
			expect(part).toBeGreaterThan(0);
			// Lose a successful write reply and resend it through the real manager.
			const manager = RecordManager.remote((name) => stage.record("project-a", name));
			const found = await Effect.runPromise(
				RecordManager.use((r) => Stream.runCollect(r.read(chain))).pipe(Effect.provide(manager)),
			);
			expect(found.map((r) => r.spanId)).toEqual(rows.map((r) => r.span.spanId));
			const held = await first.read(chain, 0, 0);
			const retry = await first.write(chain, 0, [rows[0], {span: span(99), content: null}]);
			expect(retry).toMatchObject({_tag: "rolled", had: [rows[0]!.span.spanId]});
			expect((await first.read(chain, 0, 0)).spans).toEqual(held.spans);
			await stage
				.record("project-b", "spans/0")
				.write(chain, 0, [{span: span(100), content: null}]);
			expect(
				(await stage.record("project-b", "spans/0").read(chain, 0, 0)).spans.map(
					(r: any) => r.spanId,
				),
			).toEqual([span(100).spanId]);
			expect(found.some((r) => r.spanId === span(100).spanId)).toBe(false);
		});
	});
	it("R2 archive plant: unlike checksum encodings or a lost acknowledgement must not lose the local copy", async () => {
		await world(async (stage) => {
			const {bucketCalls} = await import("./runtime.ts");
			const calls = bucketCalls(stage.bucket);
			const body = new TextEncoder().encode("local health archive");
			const expected = createHash("sha256").update(body).digest("hex");
			await calls.put("p12/health.json", body, expected);
			expect(await calls.head("p12/health.json")).toEqual({sha256: expected});
			await expect(calls.put("p12/bad.json", body, "0".repeat(64))).rejects.toThrow();
			const archive = Archive.bucket(calls);
			expect(
				await Effect.runPromise(
					Archive.use((a) => a.put("p12/health.json", body)).pipe(Effect.provide(archive)),
				),
			).toEqual({sha256: expected});
			// The same key/body after a lost answer is legal. A bucket lock would make this fail.
			expect(
				await Effect.runPromise(
					Archive.use((a) => a.put("p12/health.json", body)).pipe(Effect.provide(archive)),
				),
			).toEqual({sha256: expected});
			for (const fail of ["put", "checksum"]) {
				const db = new DatabaseSync(":memory:");
				try {
					const archive = Archive.bucket(
						fail === "put"
							? {
									put: async () => {
										throw new Error("private R2 failure");
									},
									head: calls.head,
								}
							: {put: calls.put, head: async () => ({sha256: "0".repeat(64)})},
					);
					const records = RecordManager.remote((name) => stage.record("p12-records", name));
					// P37: a failed archive try deletes nothing and never fails `flush`.
					await expect(
						Effect.runPromise(
							Effect.gen(function* () {
								const sink = yield* SpanSink;
								yield* sink.summaries(0, 1);
								db.prepare(
									'INSERT INTO health (piece,at,ms,ok,error,lag,"spanId") VALUES (?,0,1,1,NULL,NULL,NULL)',
								).run("fixture");
								// Summarize the fixture's hour, so its day is due and flush tries the archive.
								yield* sink.summaries(0, 1);
								yield* sink.flush;
							}).pipe(
								Effect.provide(
									Layer.mergeAll(
										SpanSink.layer(nodeSql(db), {object: "archive-fixture"}),
										archive,
										records,
									),
								),
							),
						),
					).resolves.toBeUndefined();
					expect(db.prepare("SELECT piece FROM health WHERE piece='fixture'").all()).toHaveLength(
						1,
					);
					expect(db.prepare("SELECT * FROM archived").all()).toEqual([]);
					// The try happened and failed: its own health row says why.
					expect(
						db.prepare("SELECT ok,error FROM health WHERE piece='sink.archive'").all(),
					).toEqual([{ok: 0, error: fail === "put" ? "unreachable" : "mismatch"}]);
					expect(db.prepare("SELECT piece,count FROM summary").all()).toEqual(
						expect.arrayContaining([expect.objectContaining({piece: "fixture", count: 1})]),
					);
				} finally {
					db.close();
				}
			}
		});
	});
	it("recording/content plant: flush before final span, omit failure flush, or trace the sink recursively", async () => {
		await world(async (stage, key, fixture) => {
			const {p, client} = await admitted(stage, key);
			const info = await p.info(),
				pid = info.find((i: any) => i.name === "counter:1").process;
			const input = {
				pid,
				letter: "recorded",
				m: {type: "inc"},
				sentAt: SENT,
				seen: 0,
				traceId: TRACE,
			};
			const accepted = await routed(p, client, "process.send", input);
			expect(accepted).toMatchObject({_tag: "ok", result: {_tag: "accepted"}});
			const broken = await fixture.start("broken:1", "writer-fixture");
			await expect(
				routed(p, client, "process.send", {
					...input,
					pid: broken.process,
					letter: "failed",
					m: {type: "throw", body: "private raw frame P12"},
				}),
			).rejects.toThrow();
			const manager = RecordManager.remote((name) => stage.record("p12-records", name));
			const collect = (chain: any) =>
				Effect.runPromise(
					RecordManager.use((r) => Stream.runCollect(r.read(chain))).pipe(Effect.provide(manager)),
				);
			const job = await collect({_tag: "job", process: pid});
			expect(job.some((r) => r.name === "runner.step" && r.endTimeUnixNano !== "0")).toBe(true);
			const failures = await collect({_tag: "job", process: broken.process});
			expect(failures.some((r) => r.ok === false && r.name === "runner.step")).toBe(true);
			expect(job.every((r) => r.attributes["fab.process"] === pid)).toBe(true);
			const outside = await collect({_tag: "spans"});
			expect(outside.some((r) => r.name === "door.initialize")).toBe(true);
			const permanent = JSON.stringify([...job, ...outside, ...failures]);
			expect(permanent).not.toContain("private raw frame P12");
			expect(permanent).not.toContain("private failure P12");
			expect(permanent).not.toContain("PRIVATE KEY");
			expect(
				[...job, ...outside].some((r) => /record\.(write|read)|sink\.flush/.test(r.name)),
			).toBe(false);
			const again = await collect({_tag: "job", process: pid});
			expect(again.map((r) => r.spanId)).toEqual(job.map((r) => r.spanId));
			expect(new Set(job.map((r) => r.spanId)).size).toBe(job.length);
		});
	});
	it.each(["revoke", "exit"] as const)(
		"checked writes plant: a receipt cannot authorize a new append after %s",
		async (end) => {
			await world(async (stage, key, fixture) => {
				const {p, client} = await admitted(stage, key);
				// Trusted declarations for this process permit the fact; the signer is bound to this pid.
				const started = await fixture.start("writer:1", "writer-fixture");
				const pid = started.process;
				const delivered = await routed(p, client, "process.send", {
					pid,
					letter: "cause",
					m: {type: "prepare"},
					sentAt: SENT,
					seen: 0,
					traceId: TRACE,
				});
				expect(delivered).toMatchObject({_tag: "ok", result: {_tag: "accepted"}});
				const parent = (await read(p, client, "writer:1/inbox"))[0].parent;
				const capability = p.forProcess(pid);
				const receipt = await capability.sign("write-1", parent, "noted");
				expect(receipt.parent).toBe(parent);
				if (end === "exit") await p.exit(pid, "normal", fixture.from);
				else {
					const {revokeText} = await import("@kampus/libfabrika/coordination");
					const text = revokeText({
						id: "revoke-1",
						key: key.raw,
						for: PERSON,
						to: "p12-records",
						saw: {label: "fixture", where: "local", how: "command", check: "none"},
						sentAt: SENT,
					});
					expect(await p.grant({text, armored: key.proof(text)})).toMatchObject({_tag: "applied"});
				}
				await expect(
					capability.append({
						id: "write-1",
						parent,
						kind: "noted",
						stream: "facts",
						fact: {_tag: "noted", n: 1},
					}),
				).rejects.toThrow();
				expect(await p.read("facts", 0, "audit")).toEqual([]);
				// A changed process identity cannot reuse a capability issued to the old process.
				await expect(
					capability.append({
						id: "forged",
						parent,
						process: "another",
						kind: "noted",
						stream: "facts",
						fact: {_tag: "noted"},
					}),
				).rejects.toThrow();
			});
		},
	);
	it("p79/alarm handoff plant: storage wake keeps pid; durable due delivery has one letter and one Cmd", async () => {
		await world(async (stage, _key, fixture) => {
			const p = stage.project("p12-records");
			const start = await fixture.start("timer:1", "timer-fixture");
			const process = stage.process(start.process);
			await process.msg({
				id: "schedule",
				envelope: {
					id: `in-${start.process}-1`,
					by: {_tag: "person", key: "SHA256:fixture", for: PERSON},
					arrivedAt: 1,
					input: {type: "schedule", at: 42},
				},
				sentAt: SENT,
				seen: 0,
				span: {traceId: TRACE, spanId: "00f067aa0ba902b7"},
			});
			await process.abort();
			expect((await p.info()).find((i: any) => i.name === "timer:1").process).toBe(start.process);
			await process.due(42);
			await process.due(42);
			const inbox = await p.read("timer:1/inbox", 0, "audit");
			expect(inbox.filter((r: any) => r.body.m?.type === "timer")).toHaveLength(1);
			expect(await process.open("audit")).toMatchObject({view: {count: 1, replies: 1}});
			expect(await process.alarm()).toBe(52);
			// Durable Activity belongs to P33/P11. A wake must report it instead of counting constructors.
			await process.activity({
				_tag: "stepping",
				process: start.process,
				letter: "interrupted",
				build: "fixture",
			});
			await process.abort();
			expect(await process.recover()).toMatchObject({_tag: "interrupted", letter: "interrupted"});
		});
	});
	it("sealed program plant: external fetch and Project/R2 bindings stay unavailable; unknown program fails", async () => {
		await world(async (stage, _key, probe) => {
			const loader = stage.loader;
			await expect(
				loader.load("no-such-program", "process_01jc9q4w7z3m8n5r2t6v0xkb4d"),
			).rejects.toMatchObject({why: "no_program"});
			const sealed = await loader.load("sealed-fixture", "process_01jc9q4w7z3m8n5r2t6v0xkb4e");
			expect((await sealed.init(null)).view).toEqual({bindings: [], outbound: "blocked"});
			expect(probe.hits()).toBe(0);
			const counter = await loader.load("counter", "process_01jc9q4w7z3m8n5r2t6v0xkb4f");
			expect(await counter.init(null)).toMatchObject({_tag: "stepped", view: {count: 0}});
			expect(await counter.step({count: 0}, {type: "inc"})).toMatchObject({
				_tag: "stepped",
				view: {count: 1},
			});
		});
	});
});
