// P16, next/. P12's actual workerLoader, stack and localStage contracts, not saved proof JSON.
// The input-ID migration is missing on the base. Never manufacture an old stamped ID here.
import assert from "node:assert/strict";
import {createHash, generateKeyPairSync, sign} from "node:crypto";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import {createServer as httpServer} from "node:http";
import {createServer} from "node:net";
import {join, resolve} from "node:path";
import {NodeServices} from "@effect/platform-node";
import {workerLoader} from "@kampus/libfabrika/workers";
import {Effect, Layer, Schema} from "effect";
import * as fc from "fast-check";
import {parseSync} from "oxc-parser";
import {afterEach, describe, expect, it, vi} from "vitest";

const APP = resolve(import.meta.dirname, "..");
const homes: string[] = [];
const runs = {seed: 119120, numRuns: 3};
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const home = () => {
	const h = mkdtempSync("/tmp/fh.");
	homes.push(h);
	vi.stubEnv("FABRIKA_HOME", h);
	vi.stubEnv("TYPESAFE_API_KEY", undefined);
	vi.stubEnv("DO_NOT_TRACK", "1");
	return h;
};
// Change the disposable completed file, then exercise that file on the real stage below.
// Parsing finds P12's loader policy, so the plant cannot silently miss a formatting change.
const plantPolicy = (source: string, mode: "binding" | "outbound", name: string, value: string) => {
	const ranges: Array<{start: number; end: number}> = [];
	const visit = (node: any): void => {
		if (node === null || typeof node !== "object") return;
		if (node.type === "ObjectExpression") {
			const prop = (key: string) =>
				node.properties.find((p: any) => p.key?.name === key || p.key?.value === key);
			if (
				prop("mainModule")?.value?.value === "program.js" &&
				prop("env") &&
				prop("globalOutbound")
			) {
				const target = mode === "binding" ? prop("env").value : prop("globalOutbound");
				ranges.push({start: target.start, end: target.end});
			}
		}
		for (const child of Object.values(node)) visit(child);
	};
	visit(parseSync("brain.mjs", source).program);
	assert.equal(ranges.length, 1, "plant must reach exactly one real loader policy");
	const at = ranges[0]!;
	const changed =
		source.slice(0, at.start) +
		(mode === "binding" ? JSON.stringify({[name]: value}) : "") +
		source.slice(at.end);
	assert.equal(
		parseSync("brain.mjs", changed).errors.length,
		0,
		"plant must leave executable JavaScript",
	);
	return changed;
};
afterEach(() => {
	vi.doUnmock("alchemy");
	vi.doUnmock("@alchemy.run/cloudflare");
	vi.resetModules();
	vi.unstubAllEnvs();
	for (const h of homes.splice(0)) rmSync(h, {recursive: true, force: true});
});
const field = (value: string | Buffer) => {
	const b = Buffer.from(value),
		n = Buffer.alloc(4);
	n.writeUInt32BE(b.length);
	return Buffer.concat([n, b]);
};
// P12's driver field names. Its current driver supplies no lostLinkMs and publishes no caps.
// Those are missing measurements, never a license to reuse PR 223's caps or invent new ones.
const Metrics = Schema.Struct({
	acceptedSend: Schema.Number,
	publication: Schema.Number,
	restart: Schema.Number,
	reconnect: Schema.Number,
	lostLink: Schema.Number,
	rss: Schema.Number,
	startup: Schema.Number,
});
const Sample = Schema.Struct({
	session: Schema.String,
	settings: Schema.String,
	chaos: Schema.Boolean,
	brain: Schema.String,
	load: Schema.String,
	missing: Schema.Record(Schema.String, Schema.String),
	error: Schema.optionalKey(Schema.String),
	startMs: Schema.Number,
	sendMs: Schema.Array(Schema.Number),
	publishMs: Schema.Array(Schema.Number),
	replaceMs: Schema.Number,
	reconnectMs: Schema.Number,
	lostLinkMs: Schema.Number,
	workerdRssMb: Schema.Number,
});
const Bar = Schema.Struct({
	driver: Schema.String,
	capsFrom: Schema.String,
	caps: Metrics,
	base: Schema.Array(Sample),
	head: Schema.Array(Sample),
	sizes: Schema.Struct({brain: Schema.Number, programs: Schema.Number, window: Schema.Number}),
});
type Bar = typeof Bar.Type;
const median = (values: readonly number[]) => {
	assert(values.length > 0, "reading missing");
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)]!;
};
const readings = (s: typeof Sample.Type) => ({
	acceptedSend: median(s.sendMs.slice(1)),
	publication: median(s.publishMs),
	restart: s.replaceMs,
	reconnect: s.reconnectMs,
	lostLink: s.lostLinkMs,
	rss: s.workerdRssMb,
	startup: s.startMs,
});
const localBar = (bar: Bar, digest: string, enforce: boolean) => {
	assert.equal(bar.driver, "experiments/233-local-stage-speed-bar.ts");
	assert(bar.capsFrom.length > 0, "measured cap source missing");
	assert.equal(bar.base.length, 4);
	assert.equal(bar.head.length, 5);
	for (const sample of [...bar.base, ...bar.head]) {
		assert.equal(sample.error, undefined, "failed run");
		assert.deepEqual(sample.missing, {}, "missing reading");
		for (const key of ["session", "settings", "chaos"] as const)
			assert.equal(sample[key], bar.base[0]![key], "different sitting or settings");
		assert(sample.load.length > 0, "load missing");
		for (const value of Object.values(readings(sample)))
			assert(Number.isFinite(value) && value >= 0, "invalid reading");
	}
	for (const sample of bar.head) assert.equal(sample.brain, digest, "wrong built bytes");
	for (const size of Object.values(bar.sizes)) assert(size > 0, "separate byte sizes missing");
	for (const key of Object.keys(bar.caps) as Array<keyof typeof bar.caps>) {
		assert(Number.isFinite(bar.caps[key]) && bar.caps[key] > 0, "recorded cap missing");
		if (enforce)
			assert(
				median(bar.head.map((s) => readings(s)[key])) <= bar.caps[key],
				`local bar regressed: ${key}`,
			);
	}
};
const identity = () => {
	const pair = generateKeyPairSync("ed25519"),
		raw = pair.publicKey.export({format: "jwk"}).x!;
	const blob = Buffer.concat([field("ssh-ed25519"), field(Buffer.from(raw, "base64url"))]);
	return {
		raw,
		line: `ssh-ed25519 ${blob.toString("base64")}`,
		fingerprint: `SHA256:${createHash("sha256").update(Buffer.from(raw, "base64url")).digest("base64").replace(/=+$/, "")}`,
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
			return `-----BEGIN SSH SIGNATURE-----\n${Buffer.concat([
				Buffer.from("SSHSIG"),
				version,
				field(blob),
				field("fabrika-client"),
				field(""),
				field("sha512"),
				field(Buffer.concat([field("ssh-ed25519"), field(sign(null, payload, pair.privateKey))])),
			])
				.toString("base64")
				.match(/.{1,70}/g)!
				.join("\n")}\n-----END SSH SIGNATURE-----\n`;
		},
	};
};

describe("P16 stack and sealed loader", () => {
	it("p33 environment and declarations: actual stack selects completed bytes, no rebundle, byte-limited code-free env", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.integer({min: 1600, max: 1800}),
				fc.boolean(),
				async (length, multibyte) => {
					const calls: Array<{main: string; bundle: boolean; env: Record<string, unknown>}> = [];
					vi.doMock("@alchemy.run/cloudflare", () => ({
						providers: () => Layer.empty,
						R2: {Bucket: () => Effect.succeed({type: "r2"})},
						DurableObject: (name: string) => ({type: "object", name}),
						WorkerLoader: () => ({type: "loader"}),
						Workers: {
							Worker: (_name: string, props: (typeof calls)[number]) => {
								calls.push(props);
								return Effect.succeed({url: "http://test.invalid"});
							},
						},
					}));
					vi.doMock("alchemy", () => ({
						localState: () => Layer.empty,
						Stack: (_name: string, _options: unknown, body: Effect.Effect<unknown>) => body,
					}));
					vi.resetModules();
					const {stack} = await import("../alchemy.run.ts"),
						h = home();
					const built = {
						brain: join(h, "brain.mjs"),
						build: hash("brain"),
						programs: {counter: {hash: hash("program-marker"), source: "program-marker"}},
					};
					for (const name of ["local", "cloud"]) {
						const settings = {
							name,
							port: 18787,
							person: "person-test",
							founder: (multibyte ? "雪" : "a").repeat(length),
							window: null,
							build: built.build,
						};
						const result = await Effect.runPromise(Effect.result(stack(built, settings)));
						const expectedBytes = Buffer.byteLength(JSON.stringify(settings));
						if (expectedBytes >= 5 * 1024) {
							expect(result._tag, "oversized serialized setting must be refused").toBe("Failure");
							continue;
						}
						expect(result._tag).toBe("Success");
					}
					for (const call of calls) {
						expect(call.main).toBe(built.brain);
						expect(call.bundle).toBe(false);
						for (const [name, value] of Object.entries(call.env)) {
							expect(name).not.toMatch(/WINDOW_JS|PROGRAM_SOURCE/);
							expect(JSON.stringify(value)).not.toContain("program-marker");
							if (typeof value === "string")
								expect(Buffer.byteLength(value)).toBeLessThan(5 * 1024);
							else expect(value).toHaveProperty("type");
						}
					}
					vi.doUnmock("alchemy");
					vi.doUnmock("@alchemy.run/cloudflare");
					vi.resetModules();
				},
			),
			{...runs, numRuns: 6},
		);
	});
	it("p33 loader: actual config uses recorded bytes/hash and exact process, empty env, null outbound; unknown is typed no_program", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.string({minLength: 1, maxLength: 50}),
				fc.uuid(),
				fc.string({minLength: 1, maxLength: 20}),
				async (source, process, missing) => {
					const calls: Array<{key: string; config: unknown}> = [];
					const get = (key: string, callback: () => unknown) => {
						calls.push({key, config: callback()});
						return {
							getEntrypoint: () => ({
								describe: async () => ({name: "counter", v: 1, writes: {}, inputs: {}, cmds: []}),
							}),
						};
					};
					// WorkerLoader is a platform capability. The stand-in only records calls to the real adapter.
					const loader = workerLoader(
						{
							get,
							load: () => {
								throw Error("unused load");
							},
						} as WorkerLoader,
						{counter: {hash: hash(source), source}},
					);
					const loaded = await Effect.runPromise(loader.load("counter", process));
					expect(loaded.hash).toBe(hash(source));
					expect(calls).toEqual([
						{
							key: `${hash(source)}/${process}`,
							config: {
								compatibilityDate: "2026-10-12",
								mainModule: "program.js",
								modules: {"program.js": source},
								env: {},
								globalOutbound: null,
							},
						},
					]);
					const refused = await Effect.runPromise(
						Effect.result(loader.load(`missing-${missing}`, process)),
					);
					expect(refused).toMatchObject({
						_tag: "Failure",
						failure: {_tag: "ProgramDown", why: "no_program"},
					});
					expect(calls).toHaveLength(1);
					const config = calls[0]!.config;
					const sealed = (value: unknown) => assert.deepEqual(value, config);
					for (const plant of [
						{...Object(config), env: {PLANTED: source}},
						{...Object(config), globalOutbound: undefined},
						{...Object(config), modules: {"program.js": "host fallback"}},
					])
						expect(() => sealed(plant)).toThrow();
				},
			),
			{...runs, numRuns: 12},
		);
	});
});

// P12's driver protocol, exercised on copied output. No private key is read from disk.
class Client {
	readonly frames: any[] = [];
	readonly ws: WebSocket;
	serial = 0;
	constructor(
		readonly url: string,
		readonly key: ReturnType<typeof identity>,
		readonly tab: string,
	) {
		this.ws = new WebSocket(
			`${url.replace("http", "ws")}/client/${encodeURIComponent(key.fingerprint)}/${tab}`,
		);
		this.ws.addEventListener("error", () => this.frames.push({closed: true}));
		this.ws.addEventListener("close", () => this.frames.push({closed: true}));
		this.ws.addEventListener("message", ({data}) => this.frames.push(JSON.parse(String(data))));
	}
	async next(match: (x: any) => boolean): Promise<any> {
		for (;;) {
			const at = this.frames.findIndex(match);
			if (at >= 0) return this.frames.splice(at, 1)[0];
			if (this.frames.some((x) => x.closed)) throw Error("wire closed");
			await new Promise((done) => setTimeout(done, 10));
		}
	}
	async call(method: string, params: unknown) {
		const id = ++this.serial;
		this.ws.send(JSON.stringify({jsonrpc: "2.0", id, method, params}));
		return this.next((x) => x.id === id);
	}
	async hello() {
		const {
			params: {nonce},
		} = await this.next((x) => x.method === "challenge");
		return this.call("initialize", {
			versions: [1],
			has: ["seal"],
			ping: "30s",
			key: this.key.raw,
			tab: this.tab,
			nonce,
			platform: "headless",
			os: "linux",
			sentAt: "2026-11-08T04:00:00.000Z",
			signed: this.key.proof(`fabrika-hello\n${this.url}\n${this.tab}\n${nonce}`),
		});
	}
}

describe("P16 copied-file real stage, serial", () => {
	it("isolation plants reach the actual compiled loader policy before a real-stage run", async () => {
		await fc.assert(
			fc.asyncProperty(fc.integer({min: 1, max: 9999}), async (n) => {
				const h = home(),
					{build} = await import("./build.ts");
				const built = await Effect.runPromise(build({out: join(h, "dist"), files: [], ledger: []}));
				const source = readFileSync(built.brain, "utf8");
				for (const mode of ["binding", "outbound"] as const)
					expect(plantPolicy(source, mode, `P16_${n}`, String(n))).not.toBe(source);
			}),
			{...runs, numRuns: 2},
		);
	});
	it("p33 real isolation: a selected program sees no planted binding and cannot reach a controlled HTTP target", async () => {
		await fc.assert(
			fc.asyncProperty(fc.integer({min: 1, max: 9999}), async (n) => {
				const h = home(),
					key = identity();
				let hits = 0;
				const probe = httpServer((_request, response) => {
					hits++;
					response.end("reachable");
				});
				try {
					const port = await new Promise<number>((done, fail) => {
						probe.once("error", fail);
						probe.listen(0, "127.0.0.1", () => {
							const at = probe.address();
							assert(at && typeof at !== "string");
							done(at.port);
						});
					});
					const target = `http://127.0.0.1:${port}/probe-${n}`;
					expect((await fetch(target)).ok).toBe(true);
					hits = 0;
					const listener = createServer();
					const brainPort = await new Promise<number>((done, fail) => {
						listener.once("error", fail);
						listener.listen(0, "127.0.0.1", () => {
							const at = listener.address();
							assert(at && typeof at !== "string");
							listener.close(() => done(at.port));
						});
					});
					symlinkSync(join(APP, "node_modules"), join(h, "node_modules"));
					const file = join(h, "sealed.ts");
					writeFileSync(
						file,
						`import {env} from 'cloudflare:workers'; import {Machine} from '@demlik/tea/effect'; import {Schema} from 'effect'; let outbound='denied'; try {await fetch(${JSON.stringify(target)});outbound='allowed'} catch {} const Model=Schema.Struct({keys:Schema.Array(Schema.String),outbound:Schema.String}); const Msg=Schema.Struct({type:Schema.Literal('read')}); const machine=Machine.make({model:Model,msg:Msg,init:()=>[{keys:Object.keys(env),outbound},[]],update:{read:s=>[s,[]]}}); export const program={name:'sealed',machine,state:{v:1,schema:Model,upgrades:[]},msg:Msg,view:{data:Model,select:s=>s},refuse:()=>null,inputs:{},outputs:{},writes:{},wake:()=>null};`,
					);
					const {build} = await import("./build.ts"),
						{localStage} = await import("./local-stage.ts"),
						{localState} = await import("alchemy/State/LocalState");
					const built = await Effect.runPromise(
						build({
							out: join(h, "dist"),
							files: [],
							ledger: [],
							programs: Object.fromEntries(
								Array.from({length: (n % 3) + 1}, (_, i) => [`sealed-${i}`, file]),
							),
						}),
					);
					const alone = join(h, "alone");
					mkdirSync(alone);
					cpSync(built.brain, join(alone, "brain.mjs"));
					const bytes = readFileSync(join(alone, "brain.mjs"), "utf8");
					rmSync(join(h, "dist"), {recursive: true});
					rmSync(file);
					for (const mode of ["sealed", "binding", "outbound"] as const) {
						writeFileSync(
							join(alone, "brain.mjs"),
							mode === "sealed" ? bytes : plantPolicy(bytes, mode, `P16_${n}`, String(n)),
						);
						hits = 0;
						await Effect.runPromise(
							Effect.scoped(
								Effect.gen(function* () {
									const stage = yield* localStage(
										{...built, brain: join(alone, "brain.mjs")},
										{
											home: h,
											name: "p16-isolation",
											person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
											founder: key.line,
											window: key.raw,
											port: brainPort,
										},
									);
									yield* Effect.tryPromise({
										try: async () => {
											expect(Object.keys(built.programs).length).toBeGreaterThan(0);
											for (const name of Object.keys(built.programs)) {
												const program = await stage.loader.load(name, `probe-${n}-${mode}-${name}`);
												const value = await Reflect.get(program, "init")(null);
												if (name === "counter") {
													expect(value.model).toEqual({count: 0});
													continue;
												}
												const closed = (model: unknown) =>
													assert.deepEqual(model, {keys: [], outbound: "denied"});
												if (mode === "sealed") {
													closed(value.model);
													expect(hits).toBe(0);
												} else {
													expect(() => closed(value.model)).toThrow();
													expect(value.model).toEqual(
														mode === "binding"
															? {keys: [`P16_${n}`], outbound: "denied"}
															: {keys: [], outbound: "allowed"},
													);
												}
											}
										},
										catch: (e) => e,
									});
								}),
							).pipe(Effect.provide(localState()), Effect.provide(NodeServices.layer)),
						);
					}
				} finally {
					if (probe.listening) await new Promise<void>((done) => probe.close(() => done()));
				}
			}),
			{...runs, numRuns: 2},
		);
	});
	it("p33 complete output and T10 recovery: copied file loads programs; resend after restart retains placing, stamped ID, inbox and both views", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(fc.constantFrom("inc", "dec", "reset"), {minLength: 1, maxLength: 4}),
				async (messages) => {
					const h = home(),
						key = identity();
					const {build} = await import("./build.ts"),
						{localStage} = await import("./local-stage.ts");
					const built = await Effect.runPromise(
						build({out: join(h, "dist"), files: [], ledger: []}),
					);
					const alone = join(h, "alone");
					mkdirSync(alone);
					cpSync(built.brain, join(alone, "brain.mjs"));
					rmSync(join(h, "dist"), {recursive: true});
					const listener = createServer();
					const port = await new Promise<number>((done, fail) => {
						listener.once("error", fail);
						listener.listen(0, "127.0.0.1", () => {
							const at = listener.address();
							assert(at && typeof at !== "string");
							listener.close(() => done(at.port));
						});
					});
					const options = {
						home: h,
						name: "p16-stage",
						person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
						founder: key.line,
						window: key.raw,
						port,
					};
					const copied = {...built, brain: join(alone, "brain.mjs")};
					let pid = "",
						first: unknown,
						stamped = "",
						total = 0;
					const stage = async (again: boolean) =>
						Effect.runPromise(
							Effect.scoped(
								Effect.gen(function* () {
									const runtime = yield* localStage(copied, options);
									yield* Effect.tryPromise({
										try: async () => {
											const a = new Client(runtime.url, key, "a"),
												b = new Client(runtime.url, key, "b");
											try {
												expect((await a.hello()).error).toBeUndefined();
												expect((await b.hello()).error).toBeUndefined();
												const rows = (
													await a.call("ledger.read", {stream: "processes/counter:1", after: 0})
												).result.entries;
												const current = rows.findLast((r: any) => r._tag === "started").body
													.process;
												if (again) expect(current).toBe(pid);
												else pid = current;
												await b.call("view.open", {pid});
												for (const [n, type] of messages.entries()) {
													const answer = await a.call("process.send", {
														pid,
														letter: `p16-${n}`,
														m: {type},
														sentAt: "2026-11-08T04:00:00.000Z",
														seen: 0,
													});
													expect(answer.result).toMatchObject({_tag: "accepted"});
													if (n === 0) {
														if (again) expect(answer.result).toEqual(first);
														else first = answer.result;
													}
													if (!again)
														total = type === "reset" ? 0 : total + (type === "inc" ? 1 : -1);
												}
												const inbox = (
													await a.call("ledger.read", {stream: "counter:1/inbox", after: 0})
												).result.entries;
												const acknowledged = inbox.filter((r: any) =>
													String(r.id).startsWith("p16-"),
												);
												expect(acknowledged).toHaveLength(messages.length);
												expect(new Set(acknowledged.map((r: any) => r.id)).size).toBe(
													messages.length,
												);
												const input = inbox[0].parent;
												expect(input).toMatch(/^input_[0-9a-hjkmnp-tv-z]{26}$/);
												if (again) expect(input).toBe(stamped);
												else stamped = input;
												if (again) {
													const retried = await a.call("process.send", {
														pid,
														letter: "unanswered",
														m: {type: "inc"},
														sentAt: "2026-11-08T04:00:00.000Z",
														seen: 0,
													});
													expect(retried.result).toMatchObject({_tag: "accepted"});
													const after = (
														await a.call("ledger.read", {stream: "counter:1/inbox", after: 0})
													).result.entries;
													expect(after.filter((r: any) => r.id === "unanswered")).toHaveLength(1);
													for (const c of [a, b])
														expect((await c.call("view.open", {pid})).result.view).toEqual({
															count: total + 1,
														});
												} else {
													for (const c of [a, b])
														expect((await c.call("view.open", {pid})).result.view).toEqual({
															count: total,
														});
													a.ws.send(
														JSON.stringify({
															jsonrpc: "2.0",
															id: 999999,
															method: "process.send",
															params: {
																pid,
																letter: "unanswered",
																m: {type: "inc"},
																sentAt: "2026-11-08T04:00:00.000Z",
																seen: 0,
															},
														}),
													);
													a.ws.close();
												}
												// Every embedded route must answer from this one file. P14 is absent on this base.
												const missing = await fetch(`${runtime.url}/p16-missing.js`);
												expect(missing.status).toBe(404);
											} finally {
												a.ws.close();
												b.ws.close();
											}
										},
										catch: (error) => error,
									});
								}),
							).pipe(
								Effect.provide((await import("alchemy/State/LocalState")).localState()),
								Effect.provide(NodeServices.layer),
							),
						);
					await stage(false);
					await stage(true);
				},
			),
			{...runs, numRuns: 2},
		);
	});
	it("T10 timing scenario: keeps P12's four base and five head readings; unavailable readings remain unfinished", () => {
		const path = process.env.P16_LOCAL_BAR;
		assert(
			path,
			"T10 unfinished: rerun experiments/233-local-stage-speed-bar.ts, four base and five head, same sitting/settings/chaos; lost-link reading is missing on P12",
		);
		const bar = Schema.decodeUnknownSync(Schema.fromJsonString(Bar))(readFileSync(path, "utf8"));
		const brain = process.env.P16_BRAIN;
		assert(brain, "final brain path missing");
		const digest = createHash("sha256").update(readFileSync(brain)).digest("hex");
		localBar(bar, digest, !process.env.CI);
		console.log(
			JSON.stringify({
				law: "T10",
				base: bar.base.map(readings),
				head: bar.head.map(readings),
				sizes: bar.sizes,
			}),
		);
		expect(() =>
			localBar(
				{
					...bar,
					head: bar.head.map((s) => ({
						...s,
						sendMs: s.sendMs.map(() => bar.caps.acceptedSend + 1),
					})),
				},
				digest,
				true,
			),
		).toThrow("acceptedSend");
		expect(() =>
			localBar(
				{...bar, head: bar.head.map((s) => ({...s, error: "planted failure"}))},
				digest,
				false,
			),
		).toThrow("failed run");
		expect(() => localBar(bar, "wrong digest", false)).toThrow("wrong built bytes");
	});
});
