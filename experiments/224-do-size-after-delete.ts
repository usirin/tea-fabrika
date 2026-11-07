// Experiment 224: does deleting rows shrink a SQLite-backed Durable Object's
// `ctx.storage.sql.databaseSize`? Do `VACUUM`, `PRAGMA incremental_vacuum` and `auto_vacuum` work?
//
//   (cd experiments/224-do-size-after-delete && pnpm install --ignore-workspace)   # once
//   env -u TYPESAFE_API_KEY nice -n 15 node experiments/224-do-size-after-delete.ts local
//   env -u TYPESAFE_API_KEY CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
//       nice -n 15 node experiments/224-do-size-after-delete.ts cloud
//
// `local` runs the stack under `alchemy dev` (workerd on this laptop), with every CLOUDFLARE_*
// variable removed. `cloud` runs `alchemy deploy`, the same steps, `alchemy destroy` in a
// `finally`, then lists the account's Workers and Durable Object namespaces named for this run.
// Each writes results/224-do-size-after-delete-<stage>.json.
//
// Object `size`, on both stages: probe the vacuum pragmas on the new, empty object, write about
// 50 MB, delete the older half, probe again, delete the rest, write 10 MB back, deleteAll. Every
// step reads `databaseSize` and the row count after it. Locally it also reads the object's file
// with node:sqlite: its bytes, its WAL's, and SQLite's own page_count and freelist_count.
// Object `cap`, local only: workerd's test hook caps the file, to see whether a delete makes room
// under the cap (`capPlan`). The hook needs the `experimental` flag, so Cloudflare cannot run it.
//
// The run's key is 32 random bytes made here. The Worker holds only its SHA-256. Nothing this
// script prints or saves holds the key, the Worker's address, the token or the account.
import {spawn} from "node:child_process";
import {createHash, randomBytes} from "node:crypto";
import {mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {fileURLToPath} from "node:url";

const DIR = fileURLToPath(new URL("./224-do-size-after-delete/", import.meta.url));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const NAME = "tf-exp-224";
const BYTES = 2_000; // two rows to a 4 KB page
const BATCH = 5_000; // rows per request

const ROWS = 25_000; // about 50 MB
const AGAIN = 5_000; // written back after the deletes

type Stage = "local" | "cloud";
const stage = process.argv[2] as Stage;
if (stage !== "local" && stage !== "cloud") throw new Error("say `local` or `cloud`");
if (process.env.TYPESAFE_API_KEY) throw new Error("run with TYPESAFE_API_KEY unset");

let secrets: string[] = [];
const hide = (text: string) => {
	let out = text.split(ROOT).join("").split(tmpdir()).join("<tmp>");
	for (const s of secrets) if (s) out = out.split(s).join("<hidden>");
	return out.replace(/[a-z0-9.-]+\.workers\.dev/gi, "<the Worker's address>");
};
const say = (s: string) => console.log(hide(s));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const mb = (n: unknown) => (typeof n === "number" ? Math.round((n / 1e6) * 100) / 100 : n);

const files = (dir: string): string[] => {
	try {
		return readdirSync(dir).flatMap((f) => {
			const p = join(dir, f);
			return statSync(p).isDirectory() ? files(p) : [p];
		});
	} catch {
		return [];
	}
};

const tokenless = () =>
	Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("CLOUDFLARE_")));

/** Alchemy's CLI from this experiment's folder, under nice. `dev` stays up; the rest finish. */
const alchemy = (verb: "dev" | "deploy" | "destroy", env: NodeJS.ProcessEnv) => {
	const kid = spawn(
		"nice",
		[
			...["-n", "15", "node_modules/.bin/alchemy", verb, "--stage", stage, "--no-input"],
			...(verb === "dev" ? [] : ["--yes"]),
		],
		{
			cwd: DIR,
			env: {...env, ALCHEMY_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1"},
			stdio: ["ignore", "pipe", "pipe"],
			detached: verb === "dev",
		},
	);
	const run = {kid, out: "", code: null as number | null};
	kid.stdout.on("data", (c) => {
		run.out += String(c);
	});
	kid.stderr.on("data", (c) => {
		run.out += String(c);
	});
	const done = new Promise<number>((r) => kid.on("close", (code) => r((run.code = code ?? -1))));
	return {run, done};
};

const until = async (test: () => boolean, ms: number) => {
	const t = Date.now();
	while (Date.now() - t < ms) {
		if (test()) return true;
		await sleep(200);
	}
	return false;
};

/** The Worker's address: a local URL from `alchemy dev`, or the public one after a deploy. */
const addressOf = (out: string): string | null => {
	const local = /(https?:\/\/(?:localhost|127\.0\.0\.1):\d+)/.exec(out)?.[1];
	if (stage === "local") return local ?? null;
	const re = /https:\/\/tf-exp-224-size\.[a-z0-9-]+\.workers\.dev/i;
	const found = re.exec(out)?.[0];
	if (found) return found;
	for (const f of files(join(DIR, ".alchemy"))) {
		const hit = re.exec(readFileSync(f, "utf8"))?.[0];
		if (hit) return hit;
	}
	return null;
};

let requests = 0;
const step = async (base: string, key: string, object: string, body: Record<string, unknown>) => {
	requests += 1;
	const t = Date.now();
	const res = await fetch(`${base}/${key}/step`, {
		method: "POST",
		headers: {"content-type": "application/json"},
		body: JSON.stringify({object, ...body}),
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`step ${JSON.stringify(body)}: ${res.status} ${text.slice(0, 500)}`);
	return {...(JSON.parse(text) as Record<string, unknown>), roundTripMs: Date.now() - t};
};

/**
 * Local only: the object's file under `alchemy dev`, named by its id. Its bytes and its WAL's, and
 * SQLite's own page counts, read by a second, read-only connection (WAL mode lets a reader in).
 */
const onDisk = (id: unknown) => {
	if (stage !== "local" || typeof id !== "string") return null;
	const file = join(DIR, ".alchemy", "local", "tf-exp-224-size-Sizer", `${id}.sqlite`);
	const size = (p: string) => {
		try {
			return statSync(p).size;
		} catch {
			return null;
		}
	};
	const out: Record<string, unknown> = {file: size(file), wal: size(`${file}-wal`)};
	if (out.file === null) return out;
	const db = new DatabaseSync(file, {readOnly: true});
	try {
		for (const p of ["page_count", "freelist_count", "auto_vacuum"])
			out[p] = Object.values(db.prepare(`PRAGMA ${p}`).get() ?? {})[0];
	} finally {
		db.close();
	}
	return out;
};

/** One object through its steps. Each row of the answer is one step and the numbers after it. */
const runObject = async (
	base: string,
	key: string,
	object: string,
	plan: (s: Steps) => Promise<void>,
) => {
	const rows: Array<Record<string, unknown>> = [];
	const go = async (label: string, body: Record<string, unknown>) => {
		const r = await step(base, key, object, body);
		const after = (r.after ?? {}) as Record<string, unknown>;
		const row = {
			step: label,
			result: r.result,
			ms: r.ms,
			databaseSize: after.databaseSize,
			rows: after.rows,
			disk: onDisk(after.id),
		};
		rows.push(row);
		say(
			`${stage} ${object} | ${label} | databaseSize ${String(mb(row.databaseSize))} MB | rows ${String(row.rows)} | disk ${JSON.stringify(row.disk)} | ${JSON.stringify(r.result).slice(0, 120)}`,
		);
		return row;
	};
	const insert = async (label: string, from: number, count: number, cap?: number) => {
		for (let at = from; at < from + count; at += BATCH) {
			const n = Math.min(BATCH, from + count - at);
			await go(`${label} (ids to ${at + n})`, {
				op: "insert",
				from: at,
				count: n,
				bytes: BYTES,
				cap,
			});
		}
	};
	await plan({go, insert, sql: (label, query) => go(label, {op: "sql", query})});
	return rows;
};

type Steps = {
	go: (label: string, body: Record<string, unknown>) => Promise<unknown>;
	insert: (label: string, from: number, count: number, cap?: number) => Promise<void>;
	sql: (label: string, query: string) => Promise<unknown>;
};

const CREATE = "CREATE TABLE t (id INTEGER PRIMARY KEY, body BLOB NOT NULL)";

/** The main object: about 50 MB in, the older half out, the rest out, some back in. */
const sizePlan = async ({go, insert, sql}: Steps) => {
	await go("new object", {op: "stats"});
	// On a brand-new object, before any table: the only moment auto_vacuum could still be set.
	await go("probe on the empty object", {op: "probe"});
	await sql("create table", CREATE);
	await insert("insert", 0, ROWS);
	await sql("delete the older half", `DELETE FROM t WHERE id < ${ROWS / 2}`);
	await go("probe after the delete", {op: "probe"});
	await sql("delete the rest", "DELETE FROM t");
	// Does new data reuse the freed pages, or does the file grow again?
	await insert("insert again", ROWS, AGAIN);
	await go("storage.deleteAll()", {op: "deleteAll"});
	await sleep(5_000);
	await go("5 s later", {op: "stats"});
};

/**
 * Local only: does deleting make room under the cap? workerd's test hook caps the file at CAP
 * pages (room for about 6,000 rows). Write 5,000, delete the older 2,500, write 2,500 more: 7,500
 * written in all, more than fits without the delete. Then 2,500 more, which cannot fit.
 */
const CAP = 3_000;
const capPlan = async ({go, insert, sql}: Steps) => {
	await sql("create table", CREATE);
	await insert(`insert under a ${CAP}-page cap`, 0, 5_000, CAP);
	await sql("delete the older 2,500", "DELETE FROM t WHERE id < 2500");
	await insert("insert 2,500 more", 5_000, 2_500, CAP);
	await insert("insert 2,500 more, past the cap", 7_500, 2_500, CAP);
	await go("the next request", {op: "stats"});
	await go("storage.deleteAll()", {op: "deleteAll"});
};

/** The account's Workers and Durable Object namespaces with this run's name in them. */
const leftovers = async () => {
	const acct = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
	const get = async (path: string) => {
		const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}${path}`, {
			headers: {authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN ?? ""}`},
		});
		const body = (await res.json()) as {success?: boolean; result?: unknown};
		return {
			ok: res.ok && body.success === true,
			rows: Array.isArray(body.result) ? body.result : [],
		};
	};
	const scripts = await get("/workers/scripts");
	const spaces = await get("/workers/durable_objects/namespaces?per_page=1000");
	const mine = (s: unknown) => typeof s === "string" && s.includes(NAME);
	return {
		listed: scripts.ok && spaces.ok,
		workersLeft: scripts.rows.map((r) => (r as {id?: unknown}).id).filter(mine),
		namespacesLeft: spaces.rows
			.filter((r) => mine((r as {name?: unknown}).name) || mine((r as {script?: unknown}).script))
			.map((r) => String((r as {name?: unknown}).name)),
	};
};

const main = async () => {
	if (
		stage === "cloud" &&
		(!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID)
	)
		throw new Error("set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID for the cloud stage");
	const key = randomBytes(32).toString("base64url");
	const hash = createHash("sha256").update(key).digest("hex");
	secrets = [key, process.env.CLOUDFLARE_ACCOUNT_ID ?? "", process.env.CLOUDFLARE_API_TOKEN ?? ""];
	const results: Record<string, unknown> = {
		experiment: 224,
		stage,
		date: new Date().toISOString().slice(0, 10),
		alchemy: "alchemy@2.0.0-beta.84, @alchemy.run/cloudflare@2.0.0-beta.84",
		compatibilityDate: "2026-07-01",
		rowBytes: BYTES,
	};
	const env: NodeJS.ProcessEnv =
		stage === "local"
			? {
					...tokenless(),
					EXP_KEY_HASH: hash,
					EXP_FLAGS: "experimental",
					ALCHEMY_HOME: mkdtempSync(join(tmpdir(), "e224-")),
				}
			: {...process.env, EXP_KEY_HASH: hash};
	const t0 = Date.now();
	const up = alchemy(stage === "local" ? "dev" : "deploy", env);
	try {
		if (stage === "local") {
			await until(() => addressOf(up.run.out) !== null || up.run.code !== null, 120_000);
			await sleep(1_000);
		} else await up.done;
		const base = addressOf(up.run.out);
		if (base === null) throw new Error(`no address: ${hide(up.run.out.slice(-3000))}`);
		secrets.push(base, new URL(base).host);
		results.upMs = Date.now() - t0;
		say(`${stage}: up in ${Math.round((Date.now() - t0) / 100) / 10} s`);
		const wrong = await fetch(`${base}/not-the-key/step`, {method: "POST", body: "{}"});
		results.wrongKey = wrong.status;
		const objects: Record<string, unknown> = {};
		results.objects = objects;
		objects.size = await runObject(base, key, "size", sizePlan);
		if (stage === "local") objects.cap = await runObject(base, key, "cap", capPlan);
	} catch (e) {
		results.error = hide(e instanceof Error ? (e.stack ?? e.message) : String(e));
		say(`stopped: ${String(results.error)}`);
	} finally {
		results.requests = requests;
		if (stage === "local") {
			const kill = (signal: NodeJS.Signals) => {
				if (up.run.code !== null || up.run.kid.pid === undefined) return;
				try {
					process.kill(-up.run.kid.pid, signal);
				} catch {
					// already gone
				}
			};
			kill("SIGINT");
			await Promise.race([up.done, sleep(10_000)]);
			kill("SIGKILL");
			results.devExit = up.run.code;
		} else {
			const down = alchemy("destroy", env);
			results.destroyExit = await down.done;
			if (results.destroyExit !== 0) say(hide(down.run.out.slice(-3000)));
			results.leftovers = await leftovers();
			say(`left on the account: ${JSON.stringify(results.leftovers)}`);
		}
		results.totalMs = Date.now() - t0;
		mkdirSync(fileURLToPath(new URL("./results/", import.meta.url)), {recursive: true});
		writeFileSync(
			fileURLToPath(new URL(`./results/224-do-size-after-delete-${stage}.json`, import.meta.url)),
			`${hide(JSON.stringify(results, null, "\t"))}\n`,
		);
	}
};

await main();
