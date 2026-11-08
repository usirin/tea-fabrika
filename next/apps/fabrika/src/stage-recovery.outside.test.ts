// P12, next/. Outside only: P12_OUTSIDE=1 pnpm exec vitest run --maxWorkers=1 <this file>.
// Real Alchemy/workerd objects. The extra private driver reads saved data and forces failures;
// it supplies no implementation of admission, wait registration, delivery, or runner behavior.
import {createHash, generateKeyPairSync, sign} from "node:crypto";
import {mkdtempSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {NodeServices} from "@effect/platform-node";
import {Effect} from "effect";
import {rolldown} from "rolldown";
import {describe, expect, it, vi} from "vitest";

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn",
	PROJECT = "recovery-contract";
const SENT = "2026-11-08T04:00:00.000Z";
const APP = resolve(import.meta.dirname, "..");
const field = (v: Buffer | string) => {
	const b = Buffer.from(v),
		n = Buffer.alloc(4);
	n.writeUInt32BE(b.length);
	return Buffer.concat([n, b]);
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
			const signed = Buffer.concat([
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
				field(Buffer.concat([field("ssh-ed25519"), field(sign(null, signed, pair.privateKey))])),
			]);
			return `-----BEGIN SSH SIGNATURE-----\n${packet.toString("base64")}\n-----END SSH SIGNATURE-----\n`;
		},
	};
};
const pause = (ms = 20) => new Promise<void>((done) => setTimeout(done, ms));
const until = async <A>(read: () => Promise<A>, accepts: (value: A) => boolean) => {
	const end = Date.now() + 15_000;
	for (;;) {
		const value = await read();
		if (accepts(value)) return value;
		if (Date.now() > end) throw new Error("recovery condition not reached");
		await pause();
	}
};
type Frame = {id?: number; method?: string; params?: any; result?: any; error?: any};
class Client {
	readonly frames: Array<Frame> = [];
	readonly path: string;
	readonly ws: WebSocket;
	closeCode: number | undefined;
	private serial = 0;
	constructor(
		readonly url: string,
		readonly key: ReturnType<typeof identity>,
		tab: string,
	) {
		this.path = `/client/${encodeURIComponent(key.fingerprint)}/${tab}`;
		this.ws = new WebSocket(`${url.replace("http", "ws")}${this.path}`);
		this.ws.addEventListener("message", ({data}) => {
			if (data !== "pong") this.frames.push(JSON.parse(String(data)));
		});
		this.ws.addEventListener("close", (event) => {
			this.closeCode = event.code;
		});
		this.ws.addEventListener("error", () => {
			this.closeCode ??= 1006;
		});
	}
	async next(test: (frame: Frame) => boolean): Promise<Frame> {
		const end = Date.now() + 15_000;
		for (;;) {
			const at = this.frames.findIndex(test);
			if (at >= 0) return this.frames.splice(at, 1)[0]!;
			if (this.closeCode !== undefined) throw new Error(`connection closed ${this.closeCode}`);
			if (Date.now() > end) throw new Error("no wire answer");
			await pause();
		}
	}
	async issue(method: string, params: unknown) {
		while (this.ws.readyState === WebSocket.CONNECTING && this.closeCode === undefined)
			await pause();
		const id = ++this.serial;
		this.ws.send(JSON.stringify({jsonrpc: "2.0", id, method, params}));
		return id;
	}
	async call(method: string, params: unknown) {
		const id = await this.issue(method, params);
		return this.next((f) => f.id === id);
	}
	async hello(tab: string, signed?: string) {
		const nonce = (await this.next((f) => f.method === "challenge")).params.nonce;
		return this.call("initialize", {
			versions: [1],
			has: [],
			ping: "30s",
			key: this.key.raw,
			tab,
			nonce,
			platform: "headless",
			os: "linux",
			sentAt: SENT,
			signed: signed ?? this.key.proof(`fabrika-hello\n${this.url}\n${tab}\n${nonce}`),
		});
	}
}

const DRIVER = `
import base, {Project as RealProject, Process as RealProcess, Gateway as RealGateway, RecordPart, Control as RealControl} from ${JSON.stringify(join(APP, "src/brain.ts"))};
export {RecordPart};
export class Project extends RealProject {
  binding(letter) { const rows = [...this.ctx.storage.sql.exec("SELECT value FROM door_bindings WHERE letter=?", letter)]; return rows.length ? JSON.parse(rows[0].value) : null; }
}
export class Gateway extends RealGateway {
  constructor(ctx, env) { super(ctx, env); this.loaded = ctx.blockConcurrencyWhile(async () => { this.generation = (await ctx.storage.get("test-generation") ?? 0) + 1; await ctx.storage.put("test-generation", this.generation); }); }
  async inspect() { await this.loaded; return {generation:this.generation, attachments:this.ctx.getWebSockets().map(ws => ws.deserializeAttachment())}; }
  abort() { this.ctx.abort("test storage wake"); }
}
export class Process extends RealProcess {
  async msg(input) { if(input.id === "busy-letter" && !await this.ctx.storage.get("released")) { await this.ctx.storage.put("entered", true); await new Promise(done => {this.releaseCall = done}); } return super.msg(input); }
  entered() {return this.ctx.storage.get("entered");}
  async release() {await this.ctx.storage.put("released",true); this.releaseCall?.();}
}
export class Control extends RealControl {
  async fetch(request) {
    const call = await request.clone().json();
    if(call.target !== "process" || call.name !== "test-driver" || call.method !== "activity") return super.fetch(request);
    if(request.headers.get("authorization") !== "Bearer " + this.ctx.props.token) return new Response(null,{status:403});
    const {action, name, letter} = call.args[0];
    let value;
    if(action === "inspect") value = await this.env.GATEWAY.getByName(name).inspect();
    else if(action === "abort") {try {await this.env.GATEWAY.getByName(name).abort();} catch {} value = null;}
    else if(action === "binding") value = await this.env.PROJECT.getByName(${JSON.stringify(PROJECT)}).binding(letter);
    else if(action === "entered") value = await this.env.PROCESS.getByName(JSON.stringify([${JSON.stringify(PROJECT)},name])).entered();
    else if(action === "release") value = await this.env.PROCESS.getByName(JSON.stringify([${JSON.stringify(PROJECT)},name])).release();
    else return new Response(null,{status:400});
    return Response.json({value:value ?? null});
  }
}
export default base;
`;
const world = async (
	test: (f: {
		key: ReturnType<typeof identity>;
		client: (tab: string, key?: ReturnType<typeof identity>) => Client;
		connect: (tab: string) => Promise<Client>;
		project: any;
		driver: (action: string, name?: string, letter?: string) => Promise<any>;
	}) => Promise<void>,
) => {
	const home = mkdtempSync(join(tmpdir(), "p12-rec-")),
		key = identity(),
		clients: Array<Client> = [];
	vi.stubEnv("FABRIKA_HOME", home);
	vi.stubEnv("DO_NOT_TRACK", "1");
	const {build} = await import("./build.ts"),
		{localStage} = await import("./local-stage.ts");
	try {
		symlinkSync(join(APP, "node_modules"), join(home, "node_modules"));
		const listener = createServer();
		await new Promise<void>((done, fail) => {
			listener.once("error", fail);
			listener.listen(0, "127.0.0.1", done);
		});
		const at = listener.address();
		if (at === null || typeof at === "string") throw new Error("no port");
		await new Promise<void>((done) => listener.close(() => done()));
		const built = await Effect.runPromise(build({out: join(home, "build")}));
		const entry = join(home, "test-brain.ts");
		writeFileSync(entry, DRIVER);
		const bundle = await rolldown({
			input: entry,
			platform: "browser",
			external: ["cloudflare:workers"],
			plugins: [
				{
					name: "test-program-table",
					resolveId(id) {
						if (id === "./table.ts") return "\0test-programs";
					},
					load(id) {
						if (id === "\0test-programs")
							return `export const programs = ${JSON.stringify(built.programs)};`;
					},
				},
			],
		});
		try {
			const result = await bundle.generate({format: "esm", codeSplitting: false});
			writeFileSync(
				built.brain,
				result.output
					.filter((o) => o.type === "chunk")
					.map((o) => o.code)
					.join("\n"),
			);
		} finally {
			await bundle.close();
		}
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const stage = yield* localStage(built, {
						home,
						name: PROJECT,
						person: PERSON,
						founder: key.line,
						window: key.raw,
						port: at.port,
					});
					const driver = (action: string, name = "", letter = "") =>
						Reflect.get(
							stage.process("test-driver"),
							"activity",
						)({action, name, letter}) as Promise<any>;
					const client = (tab: string, who = key) => {
						const c = new Client(stage.url, who, tab);
						clients.push(c);
						return c;
					};
					yield* Effect.promise(() =>
						test({
							key,
							client,
							project: stage.project(PROJECT),
							driver,
							connect: async (tab) => {
								const c = client(tab);
								expect((await c.hello(tab)).error).toBeUndefined();
								return c;
							},
						}),
					);
				}),
			).pipe(Effect.provide(NodeServices.layer)),
		);
	} finally {
		for (const c of clients) c.ws.close();
		vi.unstubAllEnvs();
		rmSync(home, {recursive: true, force: true});
	}
};
const pid = async (p: any) =>
	(await p.info()).find((row: any) => row.name === "counter:1").process as string;
const read = async (c: Client, stream: string) => {
	const r = await c.call("ledger.read", {stream, after: 0});
	expect(r.error).toBeUndefined();
	return r.result.entries as Array<any>;
};
const send = (c: Client, process: string, letter: string, seen = 0) =>
	c.call("process.send", {pid: process, letter, m: {type: "inc"}, sentAt: SENT, seen});

describe.skipIf(process.env.P12_OUTSIDE !== "1")("P12 real recovery, outside only", () => {
	it("a parked wait survives sleep and abort; replacement retries keep its placing", async () => {
		await world(async (f) => {
			const c = await f.connect("wait"),
				other = await f.connect("writer"),
				process = await pid(f.project);
			const first = await send(other, process, "first");
			const request = await c.issue("ledger.wait", {
				stream: "counter:1/inbox",
				after: first.result.rev,
			});
			const before = await until(
				() => f.driver("inspect", c.path),
				(state) => state.attachments.some((a: any) => a.waits?.some((w: any) => w.id === request)),
			);
			// An idle window, followed by constructor evidence that the object actually slept.
			await pause(11_000);
			const slept = await f.driver("inspect", c.path);
			expect(slept.generation, "constructor changed after actual idle eviction").toBeGreaterThan(
				before.generation,
			);
			await f.driver("abort", c.path);
			const woke = await f.driver("inspect", c.path);
			expect(woke.generation).toBeGreaterThan(slept.generation);
			expect(woke.attachments).toMatchObject([{waits: [{id: request}]}]);
			const next = await send(other, process, "after-wake");
			expect(await c.next((frame) => frame.id === request)).toMatchObject({
				result: {rev: next.result.rev},
			});
			const starts = await f.project.read("door/brain", 0, "audit");
			const old = starts.findLast((r: any) => r._tag === "started").body;
			const interruptedWait = await c.issue("ledger.wait", {
				stream: "counter:1/inbox",
				after: next.result.rev,
			});
			await until(
				() => f.driver("inspect", c.path),
				(state) =>
					state.attachments.some((a: any) => a.waits?.some((w: any) => w.id === interruptedWait)),
			);
			processKill(old.pid);
			let recovered: Client | undefined;
			await until(async () => {
				try {
					recovered = await f.connect(`retry-${Date.now()}`);
					return true;
				} catch {
					return false;
				}
			}, Boolean);
			expect(await pid(f.project)).toBe(process);
			expect((await send(recovered!, process, "after-wake")).result).toEqual(next.result);
			const retriedWait = await recovered!.issue("ledger.wait", {
				stream: "counter:1/inbox",
				after: next.result.rev,
			});
			const writer = await f.connect("replacement-writer");
			const afterReplacement = await send(writer, process, "after-replacement");
			expect(await recovered!.next((frame) => frame.id === retriedWait)).toMatchObject({
				result: {rev: afterReplacement.result.rev},
			});
			expect(
				(await read(recovered!, "counter:1/inbox")).filter((r) => r.id === "after-wake"),
			).toHaveLength(1);
		});
	});
	it("an interrupted busy call closes with 1012 and a stable retry applies once", async () => {
		await world(async (f) => {
			const c = await f.connect("busy"),
				process = await pid(f.project);
			await c.issue("process.send", {
				pid: process,
				letter: "busy-letter",
				m: {type: "inc"},
				sentAt: SENT,
				seen: 0,
			});
			await until(() => f.driver("entered", process), Boolean);
			const state = await f.driver("inspect", c.path);
			expect(state.attachments).toMatchObject([{busy: true}]);
			await f.driver("abort", c.path);
			await f.driver("inspect", c.path);
			await until(
				async () => c.closeCode,
				(code) => code !== undefined,
			);
			expect(c.closeCode).toBe(1012);
			await f.driver("release", process);
			const retry = await f.connect("retry"),
				accepted = await send(retry, process, "busy-letter");
			expect(accepted).toMatchObject({result: {_tag: "accepted", pos: 1}});
			expect((await send(retry, process, "busy-letter")).result).toEqual(accepted.result);
			expect(
				(await read(retry, "counter:1/inbox")).filter((r) => r.id === "busy-letter"),
			).toHaveLength(1);
			expect(await retry.call("view.open", {pid: process})).toMatchObject({
				result: {view: {count: 1}},
			});
		});
	});
	it("unadmitted connections leave no records under their actual connection or key identity", async () => {
		await world(async (f) => {
			const audit = await f.connect("audit"),
				identities: Array<string> = [];
			for (const mode of ["no-hello", "unknown", "bad-proof"]) {
				const key = identity(),
					c = f.client(mode, key);
				if (mode === "no-hello") {
					await c.next((r) => r.method === "challenge");
					expect((await c.call("ledger.read", {stream: "facts", after: 0})).error).toBeDefined();
				} else
					expect(
						(await c.hello(mode, mode === "bad-proof" ? "invalid" : undefined)).error,
					).toBeDefined();
				const saved = await f.driver("inspect", c.path);
				identities.push(key.raw, key.fingerprint, saved.attachments[0].client);
			}
			const records: Array<any> = [];
			let after = 0;
			for (;;) {
				const page = await audit.call("spans.read", {chain: {_tag: "spans"}, after});
				expect(page.error).toBeUndefined();
				records.push(...page.result.spans);
				if (!page.result.spans.length) break;
				if (page.result.next <= after) break;
				after = page.result.next;
			}
			expect(records.length, "authorized traffic proves the sink is live").toBeGreaterThan(0);
			expect(
				records.filter((record) => identities.some((id) => JSON.stringify(record).includes(id))),
			).toEqual([]);
		});
	});
	it("delivery and retry retain nonzero seen and the independently saved original binding", async () => {
		await world(async (f) => {
			const c = await f.connect("metadata"),
				process = await pid(f.project);
			const warmup = await send(c, process, "warmup"),
				seen = warmup.result.rev;
			expect(seen).toBeGreaterThan(0);
			const accepted = await send(c, process, "metadata", seen);
			const original = await f.driver("binding", "", "metadata");
			expect(original).toMatchObject({seen, sentAt: SENT, process, state: {_tag: "delivered"}});
			await send(c, process, "later", accepted.result.rev);
			expect((await send(c, process, "metadata", seen)).result).toEqual(accepted.result);
			expect(await f.driver("binding", "", "metadata")).toEqual(original);
			const row = (await read(c, "counter:1/inbox")).find((r) => r.id === "metadata");
			expect(row).toMatchObject({
				seen,
				sentAt: original.sentAt,
				by: original.by.key,
				parent: original.id,
				traceId: original.span.traceId,
				rev: accepted.result.rev,
				pos: accepted.result.pos,
			});
		});
	});
});
const processKill = (pid: number) => {
	process.kill(pid, "SIGKILL");
};
