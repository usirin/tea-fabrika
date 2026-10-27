// Experiment 157's local twin: the two fakes on 127.0.0.1, and the Worker under `wrangler dev`
// with Docker for the boxes. The Worker's log and its objects' data go to a folder the leak count
// reads afterwards.
//
//   const dev = yield* startDev({dir});
//   const key = yield* dev.key("a");                              // the person's app holds this
//   yield* dev.call(key, "/login", {provider: "claude", login: dev.anthropic.issue("a")});
//
// Node at the edge: the wrangler child process, a free port, folders and the leak walk.
import {execFileSync, spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {createServer} from "node:net";
import {join} from "node:path";
import {Effect, Schema} from "effect";
import {type FakeAnthropic, startFakeAnthropic} from "./fake-anthropic.ts";
import {type FakeOpenAI, startFakeOpenAI} from "./fake-openai.ts";
import {mint} from "./ticket.ts";

const HERE = new URL(".", import.meta.url).pathname;

export class DevFailed extends Schema.TaggedError<DevFailed>()("DevFailed", {
	message: Schema.String,
}) {}

export const attempt = <A>(what: string, f: () => Promise<A>) =>
	Effect.tryPromise({
		try: f,
		catch: (e) =>
			new DevFailed({message: `${what}: ${e instanceof Error ? e.message : String(e)}`}),
	});

const freePort = () =>
	new Promise<number>((resolve) => {
		const s = createServer();
		s.listen(0, "127.0.0.1", () => {
			const a = s.address();
			const port = typeof a === "object" && a !== null ? a.port : 0;
			s.close(() => resolve(port));
		});
	});

export interface Dev {
	readonly url: string;
	readonly persist: string;
	readonly logFile: string;
	readonly secret: string;
	readonly openai: FakeOpenAI;
	readonly anthropic: FakeAnthropic;
	/** What wrangler printed so far: the Worker's log. */
	readonly log: () => string;
	/** The person's own key, as their app would hold it. */
	readonly key: (who: string) => Effect.Effect<string, DevFailed>;
	/** A call to the front door with a person's key: status and body. */
	readonly call: (
		key: string,
		path: string,
		body?: unknown,
	) => Effect.Effect<{readonly status: number; readonly body: string}, DevFailed>;
	readonly bytes: (
		key: string,
		path: string,
		body: unknown,
	) => Effect.Effect<Uint8Array, DevFailed>;
}

// workerd's egress helper, built for this laptop's CPU (arm64), as experiment 148 found. Wrangler's
// own default did not pull here ("cannot overwrite digest").
const HELPER =
	"cloudflare/proxy-everything@sha256:78c7910f4575a511d928d7824b1cbcaec6b7c4bf4dbb3fafaeeae3104030e73c";

export const startDev = Effect.fnUntraced(function* (o: {readonly dir: string}) {
	const openai = yield* Effect.acquireRelease(
		attempt("fake openai", () => startFakeOpenAI({lifeMs: 3_600_000})),
		(f) => Effect.promise(() => f.close()),
	);
	const anthropic = yield* Effect.acquireRelease(
		attempt("fake anthropic", () => startFakeAnthropic()),
		(f) => Effect.promise(() => f.close()),
	);
	const secret = randomBytes(32).toString("hex");
	const persist = join(o.dir, "persist");
	const logFile = join(o.dir, "worker.log");
	const envFile = join(o.dir, "secret.env");
	mkdirSync(persist, {recursive: true});
	writeFileSync(envFile, `SECRET=${secret}\n`, {mode: 0o600});
	const port = yield* attempt("port", freePort);
	let text = "";
	const dev = yield* Effect.acquireRelease(
		Effect.sync(() => {
			const child = spawn(
				join(HERE, "node_modules", ".bin", "wrangler"),
				[
					"dev",
					"--ip",
					"127.0.0.1",
					"--port",
					String(port),
					"--persist-to",
					persist,
					"--env-file",
					envFile,
					"--var",
					`OPENAI_UP:${openai.url}`,
					"--var",
					`ANTHROPIC_UP:${anthropic.url}`,
					"--show-interactive-dev-session=false",
				],
				{
					cwd: HERE,
					detached: true,
					stdio: ["ignore", "pipe", "pipe"],
					// Built name by name: no key from this shell reaches wrangler.
					env: {
						PATH: process.env.PATH ?? "",
						HOME: process.env.HOME ?? "",
						CI: "1",
						WRANGLER_SEND_METRICS: "false",
						DO_NOT_TRACK: "1",
						MINIFLARE_CONTAINER_EGRESS_IMAGE: HELPER,
					},
				},
			);
			child.stdout.on("data", (d: Buffer) => {
				text += d.toString("utf8");
			});
			child.stderr.on("data", (d: Buffer) => {
				text += d.toString("utf8");
			});
			return child;
		}),
		(child) =>
			Effect.promise(async () => {
				writeFileSync(logFile, text);
				if (child.exitCode === null) process.kill(-(child.pid ?? 0), "SIGINT");
				await new Promise((r) => setTimeout(r, 4000));
				writeFileSync(logFile, text);
				// Each box's egress helper outlives wrangler, as experiment 148 saw: remove them.
				const left = execFileSync("docker", [
					"ps",
					"-aq",
					"--filter",
					"name=workerd-exp-157-locker",
				])
					.toString()
					.split("\n")
					.filter(Boolean);
				if (left.length > 0) execFileSync("docker", ["rm", "-f", ...left]);
			}),
	);
	yield* attempt("wrangler dev", async () => {
		const t0 = Date.now();
		while (!/Ready on/.test(text)) {
			if (dev.exitCode !== null) throw new Error(`wrangler stopped:\n${text.slice(-2000)}`);
			if (Date.now() - t0 > 900_000) throw new Error(`not ready:\n${text.slice(-2000)}`);
			await new Promise((r) => setTimeout(r, 500));
		}
	});
	const url = `http://127.0.0.1:${port}`;
	const send = (key: string, path: string, body?: unknown) =>
		fetch(`${url}${path}`, {
			method: body === undefined ? "GET" : "POST",
			headers: {authorization: `Bearer ${key}`, "content-type": "application/json"},
			...(body === undefined ? {} : {body: JSON.stringify(body)}),
		});
	const d: Dev = {
		url,
		persist,
		logFile,
		secret,
		openai,
		anthropic,
		log: () => text,
		key: (who) =>
			attempt("mint", () =>
				mint(secret, {kind: "person", person: who, until: Date.now() + 3_600_000}),
			),
		call: (key, path, body) =>
			attempt(path, async () => {
				const r = await send(key, path, body);
				return {status: r.status, body: await r.text()};
			}),
		bytes: (key, path, body) =>
			attempt(path, async () => new Uint8Array(await (await send(key, path, body)).arrayBuffer())),
	};
	return d;
});

// ---------------------------------------------------------------- the leak count

// A link is not followed: it points at a file that is not the run's.
const walk = (p: string): string[] => {
	try {
		const s = lstatSync(p);
		if (!s.isDirectory()) return s.isFile() ? [p] : [];
		return readdirSync(p).flatMap((n) => walk(join(p, n)));
	} catch {
		return [];
	}
};

/** How many times any of `secrets` appears in `text`. A count, never a match. */
export const countText = (text: string, secrets: readonly string[]) =>
	secrets.reduce((n, s) => n + text.split(s).length - 1, 0);

/** How many times any of `secrets` appears in the files under `paths`. */
export const countIn = (paths: readonly string[], secrets: readonly string[]) => {
	const files = paths.flatMap(walk);
	let hits = 0;
	let bytes = 0;
	for (const file of files) {
		const t = readFileSync(file).toString("latin1");
		bytes += t.length;
		hits += countText(t, secrets);
	}
	return {files: files.length, bytes, hits};
};
