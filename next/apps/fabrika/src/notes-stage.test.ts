// P13, next/. Real dev.ts and JSON-RPC. The driver retains pending text; it proves no screen.
import {spawn, execFileSync, type ChildProcess} from "node:child_process";
import {createHash, generateKeyPairSync, sign} from "node:crypto";
import {mkdtempSync, readFileSync, rmSync, readdirSync, statSync} from "node:fs";
import {createServer} from "node:net";
import {join, resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {Id} from "@kampus/libfabrika";
import {Entry, PAGE} from "@kampus/libfabrika/data";
import {Schema} from "effect";
import * as fc from "fast-check";
import {afterEach, describe, expect, it} from "vitest";

const APP = resolve(import.meta.dirname, "..");
const SENT = "2026-11-08T04:00:00.000Z";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const options = {seed: 119120, numRuns: 3, endOnFailure: true};
const InputId = Id.make("input");
const inputIds = fc.uuid({version: 7}).map((uuid) => {
	let bits = BigInt(`0x${uuid.replaceAll("-", "")}`),
		text = "";
	for (let n = 0; n < 26; n++) {
		text = "0123456789abcdefghjkmnpqrstvwxyz"[Number(bits & 31n)] + text;
		bits >>= 5n;
	}
	return InputId.make(`input_${text}`);
});
const letters = fc.sample(inputIds, {seed: options.seed, numRuns: 80});
const homes: string[] = [],
	children: ChildProcess[] = [],
	sockets: WebSocket[] = [];
const pause = () => new Promise<void>((done) => setTimeout(done, 25));
const until = async <A>(f: () => Promise<A | undefined>, why: string): Promise<A> => {
	const end = Date.now() + 45_000;
	while (Date.now() < end) {
		const answer = await f();
		if (answer !== undefined) return answer;
		await pause();
	}
	throw new Error(`Timed out: ${why}`);
};
afterEach(async () => {
	for (const ws of sockets.splice(0)) ws.close();
	for (const child of children.splice(0)) {
		if (child.exitCode === null && child.signalCode === null) {
			const stopped = new Promise<void>((done) => child.once("exit", () => done()));
			child.kill("SIGTERM");
			await Promise.race([stopped, new Promise<void>((done) => setTimeout(done, 3000))]);
		}
		if (child.pid !== undefined) {
			try {
				process.kill(-child.pid, "SIGKILL");
			} catch (error) {
				if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
			}
		}
	}
	for (const home of homes.splice(0)) rmSync(home, {recursive: true, force: true});
});
const field = (value: string | Buffer) => {
	const bytes = typeof value === "string" ? Buffer.from(value) : value,
		size = Buffer.alloc(4);
	size.writeUInt32BE(bytes.length);
	return Buffer.concat([size, bytes]);
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
			const digest = createHash("sha512").update(text).digest();
			const packet = Buffer.concat([
				Buffer.from("SSHSIG"),
				field("fabrika-client"),
				field(""),
				field("sha512"),
				field(digest),
			]);
			const signature = Buffer.concat([
				field("ssh-ed25519"),
				field(sign(null, packet, pair.privateKey)),
			]);
			const version = Buffer.alloc(4);
			version.writeUInt32BE(1);
			const result = Buffer.concat([
				Buffer.from("SSHSIG"),
				version,
				field(blob),
				field("fabrika-client"),
				field(""),
				field("sha512"),
				field(signature),
			]);
			return `-----BEGIN SSH SIGNATURE-----\n${result
				.toString("base64")
				.match(/.{1,70}/g)!
				.join("\n")}\n-----END SSH SIGNATURE-----\n`;
		},
	};
};
const port = async () => {
	const server = createServer();
	await new Promise<void>((done, fail) => {
		server.once("error", fail);
		server.listen(0, "127.0.0.1", done);
	});
	const address = server.address();
	await new Promise<void>((done) => server.close(() => done()));
	if (address === null || typeof address === "string") throw new Error("No TCP port");
	return address.port;
};
const stage = async (saved?: {home: string; key: ReturnType<typeof identity>}) => {
	// Fail on the absent P12 entry before allocating a socket or starting any child.
	readFileSync(join(APP, "dev.ts"), "utf8");
	const key = saved?.key ?? identity(),
		home = saved?.home ?? mkdtempSync("/tmp/fh.");
	if (saved === undefined) homes.push(home);
	const number = await port();
	const url = `http://127.0.0.1:${number}`;
	const env: NodeJS.ProcessEnv = {...process.env, FABRIKA_HOME: home, DO_NOT_TRACK: "1"};
	delete env.TYPESAFE_API_KEY;
	delete env.FABRIKA_FOREGROUND;
	const child = spawn(
		process.execPath,
		[
			join(APP, "dev.ts"),
			"--port",
			String(number),
			"--name",
			"p13-notes",
			"--person",
			"person_0000000000e008000000000001",
			"--founder",
			key.line,
			"--window",
			key.raw,
		],
		{cwd: APP, env, detached: true, stdio: ["ignore", "pipe", "pipe"]},
	);
	children.push(child);
	let output = "";
	child.stdout!.on("data", (b: Buffer) => {
		output += b.toString();
	});
	child.stderr!.on("data", (b: Buffer) => {
		output += b.toString();
	});
	await until(async () => {
		if (child.exitCode !== null || child.signalCode !== null)
			throw new Error(`dev.ts exited: ${output}`);
		return fetch(url).then(
			(r) => (r.ok ? true : undefined),
			() => undefined,
		);
	}, "real local stage start");
	return {key, home, url, child};
};
type Frame = {
	id?: number;
	method?: string;
	params?: any;
	result?: any;
	error?: {data?: {why?: string}};
};
class Client {
	readonly frames: Frame[] = [];
	readonly socket: WebSocket;
	private serial = 0;
	constructor(
		readonly url: string,
		readonly key: ReturnType<typeof identity>,
		readonly tab: string,
	) {
		this.socket = new WebSocket(
			`${url.replace("http", "ws")}/client/${encodeURIComponent(key.fingerprint)}/${tab}`,
		);
		sockets.push(this.socket);
		this.socket.addEventListener("message", ({data}) => {
			if (data !== "pong") this.frames.push(JSON.parse(String(data)));
		});
	}
	next(match: (f: Frame) => boolean) {
		return until(async () => {
			const index = this.frames.findIndex(match);
			if (index >= 0) return this.frames.splice(index, 1)[0]!;
			if (this.socket.readyState === WebSocket.CLOSED) throw new Error("wire closed before answer");
			return undefined;
		}, "wire answer");
	}
	async call(method: string, params: unknown) {
		const id = ++this.serial;
		await until(
			async () => (this.socket.readyState === WebSocket.OPEN ? true : undefined),
			"socket open",
		);
		this.socket.send(JSON.stringify({jsonrpc: "2.0", id, method, params}));
		return this.next((f) => f.id === id);
	}
	async initialize() {
		const nonce = (await this.next((f) => f.method === "challenge")).params.nonce;
		const answer = await this.call("initialize", {
			versions: [1],
			has: ["seal"],
			ping: "30s",
			key: this.key.raw,
			tab: this.tab,
			nonce,
			platform: "headless",
			os: "macos",
			sentAt: SENT,
			signed: this.key.proof(`fabrika-hello\n${this.url}\n${this.tab}\n${nonce}`),
		});
		expect(answer.error).toBeUndefined();
	}
}
const connect = async (s: Awaited<ReturnType<typeof stage>>, tab = "notes-a") => {
	const c = new Client(s.url, s.key, tab);
	await c.initialize();
	return c;
};
const read = async (c: Client, stream: string) => {
	const entries: Array<typeof Entry.Type> = [];
	let after = 0;
	for (;;) {
		const answer = await c.call("ledger.read", {stream, after});
		expect(answer.error).toBeUndefined();
		const page = Schema.decodeUnknownSync(Schema.Array(Entry))(answer.result.entries);
		entries.push(...page);
		if (page.length < PAGE) return entries;
		after = page.at(-1)!.rev;
	}
};
const processId = async (c: Client, name = "notes:1") => {
	const rows = await read(c, `processes/${name}`);
	const started = rows.findLast((e) => e._tag === "started");
	const body = Schema.decodeUnknownSync(
		Schema.Struct({name: Schema.String, process: Schema.String}),
	)(started?.body);
	return body.process;
};
const send = (c: Client, pid: string, letter: typeof InputId.Type, value: object) =>
	c.call("process.send", {
		pid,
		letter,
		m: {type: "save", value},
		sentAt: SENT,
		seen: 0,
		traceId: TRACE,
	});
const accepted = (answer: Frame) => {
	expect(answer.error).toBeUndefined();
	expect(answer.result).toMatchObject({
		_tag: "accepted",
		rev: expect.any(Number),
		pos: expect.any(Number),
	});
	return answer.result;
};
const workerd = (parent: number, excluding = 0) =>
	until(async () => {
		const rows = execFileSync("ps", ["-axo", "pid=,ppid=,command="], {encoding: "utf8"})
			.split("\n")
			.flatMap((line) => {
				const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
				return m ? [{pid: Number(m[1]), parent: Number(m[2]), command: m[3]!}] : [];
			});
		const descendants = new Set([parent]);
		for (let n = 0; n < rows.length; n++)
			for (const r of rows) if (descendants.has(r.parent)) descendants.add(r.pid);
		const found = rows.filter(
			(r) => descendants.has(r.pid) && /\/workerd(?:\s|$)/.test(r.command) && r.pid !== excluding,
		);
		return found.length === 1 ? found[0]!.pid : undefined;
	}, "replacement workerd PID");
const values = ["\n# Title\r\ntrailing  \n", "🙂👩🏽‍💻\nשלום\nمرحبا", "", "same", "same"];

// Test-only wake hooks. Run with the wrapper stopped, so SQLite and workerd never write together.
// No new route or production cache is introduced. T17's driver can use these same observations.
const storage = (home: string) => {
	const files: string[] = [];
	const walk = (dir: string) => {
		for (const child of readdirSync(dir, {withFileTypes: true})) {
			const path = join(dir, child.name);
			if (child.isDirectory()) walk(path);
			else if (child.isFile() && /\.(sqlite|sqlite3|db)$/.test(child.name)) files.push(path);
		}
	};
	walk(home);
	return files;
};
const checkpoint = (home: string, pid: string, remove: boolean) => {
	let bytes = 0,
		found = 0;
	const files = storage(home);
	for (const file of files) {
		const db = new DatabaseSync(file);
		try {
			if (
				db
					.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='process_state'")
					.get() === undefined
			)
				continue;
			const row = db.prepare("SELECT checkpoint FROM process_state WHERE process=?").get(pid);
			if (row === undefined) continue;
			found++;
			bytes += Buffer.byteLength(String(row.checkpoint));
			if (remove) db.prepare("DELETE FROM process_state WHERE process=?").run(pid);
		} finally {
			db.close();
		}
	}
	expect(found, "the derived notes checkpoint must exist before a full-fold measurement").toBe(1);
	return {
		checkpointBytes: bytes,
		objectBytes: files.reduce((n, file) => n + statSync(file).size, 0),
	};
};
const stop = async (s: Awaited<ReturnType<typeof stage>>) => {
	const ended = new Promise<void>((done) => s.child.once("exit", () => done()));
	s.child.kill("SIGTERM");
	await ended;
	if (s.child.pid !== undefined) {
		try {
			process.kill(-s.child.pid, "SIGKILL");
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
		}
	}
};

describe("P13 real stage", () => {
	it("p56 text/restart plant: memory-only saves, normalized text, changed retry id or lost pending text", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(fc.string({maxLength: 40}), {minLength: 1, maxLength: 3}),
				fc.nat({max: 20}),
				async (extra, cut) => {
					const bodies = [...values, ...extra];
					const count = 1 + (cut % bodies.length);
					const s = await stage(),
						c = await connect(s),
						pid = await processId(c);
					const first = accepted(
						await send(c, pid, letters[0]!, {note: "a", base: 0, body: bodies[0]}),
					);
					for (let n = 1; n < count; n++)
						accepted(
							await send(c, pid, letters[n]!, {
								note: "a",
								base: n,
								body: bodies[n],
							}),
						);
					const before = await read(c, "notes:1/inbox");
					expect(before).toHaveLength(count);
					const old = await workerd(s.child.pid!);
					process.kill(old, "SIGKILL");
					// The pending save stays in this driver while no server can receive it.
					const pending = {
						letter: letters[count]!,
						value: {
							note: "a",
							base: count,
							body: bodies[count] ?? `pending  \r\n🙂${extra.join("")}`,
						},
					};
					await workerd(s.child.pid!, old);
					const after = await connect(s, "notes-after"),
						samePid = await processId(after);
					expect(samePid).toBe(pid);
					expect(await read(after, "notes:1/inbox")).toEqual(before);
					expect(
						accepted(
							await send(after, samePid, letters[0]!, {
								note: "a",
								base: 0,
								body: bodies[0],
							}),
						),
					).toEqual(first);
					const placing = accepted(await send(after, samePid, pending.letter, pending.value));
					expect(accepted(await send(after, samePid, pending.letter, pending.value))).toEqual(
						placing,
					);
					for (let n = count + 1; n < bodies.length; n++)
						accepted(
							await send(after, samePid, letters[n]!, {note: "a", base: n, body: bodies[n]}),
						);
					const rows = await read(after, "notes:1/inbox");
					const Body = Schema.Struct({
						m: Schema.Struct({
							type: Schema.Literal("save"),
							value: Schema.Struct({base: Schema.Int, body: Schema.String}),
						}),
					});
					expect(rows.map((e) => Schema.decodeUnknownSync(Body)(e.body).m.value)).toEqual(
						(count < bodies.length ? bodies : [...bodies, pending.value.body]).map(
							(body, base) => ({body, base}),
						),
					);
					const opened = await after.call("view.open", {pid});
					expect(opened.error).toBeUndefined();
					expect(opened.result.view).toEqual({
						notes: [
							{
								note: "a",
								version: Math.max(bodies.length, count + 1),
								body: count < bodies.length ? bodies.at(-1) : pending.value.body,
							},
						],
					});
					await stop(s);
					// A checkpoint wake and a full fold are separate paths. Remove no accepted letters.
					const kept = checkpoint(s.home, pid, false);
					expect(kept.checkpointBytes).toBeGreaterThan(0);
					const loaded = await stage(s),
						loadedClient = await connect(loaded, "checkpoint-wake");
					expect(await read(loadedClient, "notes:1/inbox")).toEqual(rows);
					expect((await loadedClient.call("view.open", {pid})).result.view).toEqual(
						opened.result.view,
					);
					await stop(loaded);
					checkpoint(s.home, pid, true);
					const folded = await stage(s),
						foldedClient = await connect(folded, "full-fold");
					expect(await read(foldedClient, "notes:1/inbox")).toEqual(rows);
					expect((await foldedClient.call("view.open", {pid})).result.view).toEqual(
						opened.result.view,
					);
					await stop(folded);
				},
			),
			options,
		);
	});
	it("p53 identity plant: let changed text or another admitted caller borrow a terminal reply", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.string({maxLength: 60}),
				fc.integer({min: 1, max: 8}),
				async (text, base) => {
					const s = await stage(),
						c = await connect(s),
						pid = await processId(c);
					const id = letters[0]!;
					const original = {note: "a", base, body: `refused-draft-marker-${text}`};
					const refusal = await send(c, pid, id, original);
					expect(refusal.result).toEqual({_tag: "refused", why: "changed_elsewhere", now: 0});
					const changed = await send(c, pid, id, {...original, body: "changed"});
					expect(changed.error?.data?.why ?? changed.result?.why).toBe("id_reused");
					// A second tab is an admitted caller too; its binding must remain distinct.
					const other = await connect(s, "notes-other");
					const borrowed = await send(other, pid, id, original);
					expect(borrowed.error?.data?.why ?? borrowed.result?.why).toBe("id_reused");
					const counter = await processId(c, "counter:1");
					const retargeted = await send(c, counter, id, original);
					expect(retargeted.error?.data?.why ?? retargeted.result?.why).toBe("id_reused");
					expect(await read(c, "notes:1/inbox")).toHaveLength(0);
					await stop(s);
				},
			),
			options,
		);
	});
	it("p54/recording plant: lose now/most on the wire or record refused bodies at the door", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.string({maxLength: 50}),
				fc.integer({min: 1, max: 12}),
				async (suffix, base) => {
					const s = await stage(),
						c = await connect(s),
						pid = await processId(c);
					const marker = `refused-body-must-not-be-recorded-${suffix}`;
					const stale = await send(c, pid, letters[0]!, {
						note: "a",
						base,
						body: marker,
						how: "kept",
						from: {note: "b", version: 1},
					});
					expect(stale.error).toBeUndefined();
					expect(stale.result).toEqual({_tag: "refused", why: "changed_elsewhere", now: 0});
					const large = await send(c, pid, letters[1]!, {
						note: "a",
						base: 0,
						body: marker + "x".repeat(256 * 1024),
					});
					expect(large.error).toBeUndefined();
					expect(large.result).toEqual({_tag: "refused", why: "too_long", most: 256 * 1024});
					const records = await read(c, "door/inputs");
					expect(records.length).toBeGreaterThan(0);
					expect(JSON.stringify(records)).not.toContain(marker);
					const Meta = Schema.Struct({
						input: Schema.Struct({
							type: Schema.Literal("save"),
							note: Schema.Literal("a"),
							base: Schema.Literal(base),
							how: Schema.Literal("kept"),
							from: Schema.Struct({note: Schema.Literal("b"), version: Schema.Literal(1)}),
						}),
					});
					expect(records.some((e) => Schema.is(Meta)(e.body))).toBe(true);
					expect(await read(c, "notes:1/inbox")).toHaveLength(0);
					const savedBody = `accepted-body-must-not-be-recorded-${suffix}`;
					accepted(
						await send(c, pid, letters[2]!, {note: "a", base: 0, body: savedBody, how: "done"}),
					);
					const logs = await read(c, "door/inputs");
					expect(JSON.stringify(logs)).not.toContain(savedBody);
					expect(
						logs.some((row) =>
							Schema.is(
								Schema.Struct({
									input: Schema.Struct({
										type: Schema.Literal("save"),
										note: Schema.Literal("a"),
										base: Schema.Literal(0),
										how: Schema.Literal("done"),
									}),
								}),
							)(row.body),
						),
					).toBe(true);
					await stop(s);
				},
			),
			options,
		);
	});
});
