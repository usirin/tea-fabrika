// Experiment 157: the login lives in the person's own locker. Each person's Claude token and
// Codex auth.json sit sealed in their own Durable Object. A Claude box holds a placeholder and the
// Worker adds the token on the way out; a Codex box borrows auth.json for one job and gives back
// the refreshed copy.
//
//   env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY -u ANTHROPIC_API_KEY \
//     -u CLAUDE_CODE_OAUTH_TOKEN nice -n 15 node experiments/157-login-stays-home.ts
//
// The Worker runs under `wrangler dev` (`157-login-stays-home/worker.ts`), each box is a Docker
// container started through Cloudflare's Sandbox SDK shape, and every call a box makes lands in the
// Worker's Outbound handler. The model servers are fakes on 127.0.0.1, and so are the logins.
// Steps: claude, codex, kill, killFixed, queue, queuePlantedOff, two, allow, time, then the leak
// count. Once first: `pnpm install --ignore-workspace` in 157-login-stays-home. Needs Docker.
//
// Nothing here calls OpenAI or Anthropic, signs in, or deploys. $0. The first run builds the box's
// image (`157-login-stays-home/Dockerfile`), which takes minutes.
//
// Node at the edge: reading the fixture, temp folders and writing the box dumps.
import {mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {join} from "node:path";
import {NodeRuntime} from "@effect/platform-node";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Effect, Fiber, FileSystem} from "effect";
import {countIn, countText, type Dev, startDev} from "./157-login-stays-home/dev.ts";
import {TOOL_PRINTS} from "./157-login-stays-home/fake-openai.ts";
import type {Done, Job} from "./157-login-stays-home/worker.ts";

const HERE = new URL(".", import.meta.url).pathname;
const FIXTURE = join(HERE, "..", "fixtures", "format-bytes", "repo");
const RESULTS = join(HERE, "results", "157-login-stays-home.json");
const WORK = process.env.WORK ?? join(tmpdir(), "exp157");
const FILES = Object.fromEntries(
	["bytes.js", "package.json"].map((f) => [f, readFileSync(join(FIXTURE, f), "utf8")]),
);

type Agent = "codex" | "claude";
const keys = new Map<string, string>();
/** Every box, with its owner and agent, for the leak count. */
const boxes: {readonly box: string; readonly who: string; readonly agent: Agent}[] = [];

const keyOf = (dev: Dev, who: string) =>
	Effect.gen(function* () {
		const held = keys.get(who);
		if (held !== undefined) return held;
		const k = yield* dev.key(who);
		keys.set(who, k);
		return k;
	});

/** The person's app sends a login to its locker, once. */
const keep = (dev: Dev, who: string, provider: Agent, login: unknown) =>
	Effect.gen(function* () {
		const r = yield* dev.call(yield* keyOf(dev, who), "/login", {provider, login});
		return JSON.parse(r.body).said as string;
	});

/** A fresh Codex sign-in whose access token has run out: its first job refreshes. */
const freshCodex = (dev: Dev, who: string) =>
	keep(dev, who, "codex", dev.openai.login(who, -5_000));

const openBox = (dev: Dev, who: string, agent: Agent) =>
	Effect.gen(function* () {
		const r = yield* dev.call(yield* keyOf(dev, who), "/box", {agent});
		const box = JSON.parse(r.body).box as string;
		boxes.push({box, who, agent});
		return box;
	});

/** Dump the box's files and process environments to WORK, for the leak count. */
const peek = (dev: Dev, who: string, box: string) =>
	Effect.gen(function* () {
		const bytes = yield* dev.bytes(yield* keyOf(dev, who), "/peek", {box});
		mkdirSync(join(WORK, "boxes"), {recursive: true});
		writeFileSync(join(WORK, "boxes", `${box}.bin`), bytes);
		return bytes.length;
	});

const kill = (dev: Dev, who: string, box: string) =>
	Effect.gen(function* () {
		yield* dev.call(yield* keyOf(dev, who), "/kill", {box});
	});

/** One job, start to end, in a box of its own. The box is dumped, then stopped. */
const job = (dev: Dev, who: string, agent: Agent, o: Partial<Job> = {}, box?: string) =>
	Effect.gen(function* () {
		const id = box ?? (yield* openBox(dev, who, agent));
		const run = `${id}-${Math.random().toString(36).slice(2, 6)}`;
		const r = yield* dev.call(yield* keyOf(dev, who), "/run", {
			box: id,
			job: {agent, run, files: FILES, ...o},
		});
		const done: Partial<Done> =
			r.status === 200 ? JSON.parse(r.body) : {error: r.body.slice(0, 200)};
		const dumped = yield* peek(dev, who, id);
		yield* kill(dev, who, id);
		return {
			box: id,
			run,
			ok: done.ok === true,
			right: done.answer?.includes(TOOL_PRINTS) ?? false,
			ms: done.ms,
			waitedMs: done.waitedMs,
			back: done.back,
			error: done.error ?? null,
			dumped,
		};
	});

/** What the fake OpenAI saw of a run: whose tokens, which generation, and the refreshes. */
const codexSeen = (dev: Dev, run: string) => {
	const c = dev.openai.calls.filter((x) => x.run === run);
	return {
		calls: c.length,
		who: [...new Set(c.map((x) => x.who))],
		gens: [...new Set(c.map((x) => x.gen))],
		why: [...new Set(c.map((x) => x.why))],
		account: c.every((x) => x.account),
	};
};
const refreshesSince = (dev: Dev, n: number) =>
	dev.openai.refreshes.slice(n).map((r) => ({who: r.who, what: r.what, gen: r.gen}));

/** The next refresh the fake answers. */
const nextRefresh = (dev: Dev) =>
	Effect.callback<void>((resume) => {
		const n = dev.openai.refreshes.length;
		const timer = setInterval(() => {
			if (dev.openai.refreshes.length > n) {
				clearInterval(timer);
				resume(Effect.void);
			}
		}, 20);
		return Effect.sync(() => clearInterval(timer));
	});

// ---------------------------------------------------------------- the steps

/** Claude: the box holds a placeholder; the Outbound handler adds the locker's token. */
const claude = (dev: Dev) =>
	Effect.gen(function* () {
		const kept = yield* keep(dev, "a", "claude", dev.anthropic.issue("a"));
		const r = yield* job(dev, "a", "claude");
		const c = dev.anthropic.calls.filter((x) => x.run === r.run);
		return {
			kept,
			...r,
			fake: {
				calls: c.length,
				who: [...new Set(c.map((x) => x.who))],
				answers: c.map((x) => x.answer),
			},
		};
	});

/** Codex (a): a refresh inside the box, the copy taken back, and the next job still works. */
const codex = (dev: Dev) =>
	Effect.gen(function* () {
		const kept = yield* freshCodex(dev, "a");
		const n = dev.openai.refreshes.length;
		const first = yield* job(dev, "a", "codex");
		const second = yield* job(dev, "a", "codex");
		return {
			kept,
			first: {...first, fake: codexSeen(dev, first.run)},
			second: {...second, fake: codexSeen(dev, second.run)},
			refreshes: refreshesSince(dev, n),
		};
	});

/**
 * Codex (b): the box dies after its refresh, before it gives the login back. Then the same with
 * the fix, `catch`: the Outbound handler keeps the refresh answer in the locker first.
 */
const killed = (dev: Dev, fix: boolean) =>
	Effect.gen(function* () {
		yield* freshCodex(dev, "a");
		const n = dev.openai.refreshes.length;
		dev.openai.tune({thinkMs: 4_000});
		const box = yield* openBox(dev, "a", "codex");
		const running = yield* Effect.forkChild(job(dev, "a", "codex", {catch: fix}, box));
		yield* nextRefresh(dev);
		yield* kill(dev, "a", box);
		const died = yield* Fiber.join(running);
		dev.openai.tune({thinkMs: 0});
		const next = yield* job(dev, "a", "codex", {catch: fix});
		return {
			died: {ok: died.ok, back: died.back, error: died.error},
			next: {...next, fake: codexSeen(dev, next.run)},
			refreshes: refreshesSince(dev, n),
			dead: dev.openai.deadFor("a"),
		};
	});

/** Codex (c): a second job of the same person while the first runs. */
const queue = (dev: Dev, queued: boolean) =>
	Effect.gen(function* () {
		yield* freshCodex(dev, "a");
		const n = dev.openai.refreshes.length;
		dev.openai.tune({thinkMs: 1_500});
		const [one, two] = yield* Effect.all(
			[
				job(dev, "a", "codex", {queue: queued}),
				Effect.sleep("300 millis").pipe(Effect.andThen(job(dev, "a", "codex", {queue: queued}))),
			],
			{concurrency: 2},
		);
		dev.openai.tune({thinkMs: 0});
		return {
			one: {...one, fake: codexSeen(dev, one.run)},
			two: {...two, fake: codexSeen(dev, two.run)},
			refreshes: refreshesSince(dev, n),
			dead: dev.openai.deadFor("a"),
		};
	});

/** Two people: each box gets its own person's login, and every wrong ask is refused. */
const two = (dev: Dev) =>
	Effect.gen(function* () {
		yield* keep(dev, "b", "claude", dev.anthropic.issue("b"));
		yield* freshCodex(dev, "b");
		yield* freshCodex(dev, "a");
		const [ca, cb, xa, xb] = yield* Effect.all(
			[
				job(dev, "a", "claude"),
				job(dev, "b", "claude"),
				job(dev, "a", "codex"),
				job(dev, "b", "codex"),
			],
			{concurrency: 4},
		);
		const whoClaude = (run: string) => [
			...new Set(dev.anthropic.calls.filter((x) => x.run === run).map((x) => x.who)),
		];
		const ka = yield* keyOf(dev, "a");
		const kb = yield* keyOf(dev, "b");
		const aBox = yield* openBox(dev, "a", "claude");
		const wrong = {
			/** a's key names b in the body. */
			keyForOther: (yield* dev.call(ka, "/box", {agent: "claude", person: "b"})).status,
			/** b's key asks to run a's box. */
			otherBox: (yield* dev.call(kb, "/run", {
				box: aBox,
				job: {agent: "claude", run: "x", files: {}},
			})).status,
			/** a's box asks b's locker for both logins. */
			crossLocker: JSON.parse((yield* dev.call(ka, "/cross", {box: aBox, to: "b"})).body),
			/** b's login sent with a's key lands in a's locker, never b's. */
			loginForOther: (yield* dev.call(ka, "/login", {
				person: "b",
				provider: "claude",
				login: {token: "x"},
			})).status,
			/** No key at all. */
			noKey: (yield* dev.call("nope", "/box", {agent: "claude"})).status,
		};
		// The box says it is b, in every way a box can say it: the handler goes by its props.
		const claims = yield* dev.call(ka, "/probe", {
			box: aBox,
			script: `(async () => { const r = await fetch("https://anthropic.internal/v1/messages?beta=true", {method: "POST", headers: {"content-type": "application/json", "x-person": "b", authorization: "Bearer b", "x-api-key": "b"}, body: JSON.stringify({model: "claude-haiku-4-5", max_tokens: 64, messages: [{role: "user", content: "Say it. [[run:claims-b]]"}]})}); console.log(r.status); })();`,
		});
		yield* peek(dev, "a", aBox);
		yield* kill(dev, "a", aBox);
		return {
			claude: {
				a: {ok: ca.ok, right: ca.right, who: whoClaude(ca.run)},
				b: {ok: cb.ok, right: cb.right, who: whoClaude(cb.run)},
			},
			codex: {
				a: {ok: xa.ok, right: xa.right, ...codexSeen(dev, xa.run)},
				b: {ok: xb.ok, right: xb.right, ...codexSeen(dev, xb.run)},
			},
			wrong,
			claims: {
				status: JSON.parse(claims.body).out?.trim() ?? null,
				who: whoClaude("claims-b"),
			},
			lockers: {
				a: JSON.parse((yield* dev.call(ka, "/look?provider=codex")).body).counts,
				b: JSON.parse((yield* dev.call(kb, "/look?provider=codex")).body).counts,
			},
		};
	});

/** The allow list, from inside a box: everything off the list is refused, nothing gets out. */
const ALLOW = `(async () => {
const out = {};
const go = async (name, f) => { try { out[name] = await f(); } catch (e) { out[name] = "failed: " + (e.cause?.code ?? e.cause?.message ?? e.message); } };
const status = (u, o) => fetch(u, o).then((r) => r.status);
await go("https example.com", () => status("https://example.com/"));
await go("http example.com", () => status("http://example.com/"));
await go("https chatgpt.internal models", () => status("https://chatgpt.internal/backend-api/codex/models"));
await go("https anthropic.internal GET", () => status("https://anthropic.internal/v1/messages"));
await go("https anthropic.internal other model", () => status("https://anthropic.internal/v1/messages?beta=true", {method: "POST", body: JSON.stringify({model: "claude-opus-4-1", max_tokens: 10})}));
await go("https anthropic.internal max_tokens", () => status("https://anthropic.internal/v1/messages?beta=true", {method: "POST", body: JSON.stringify({model: "claude-haiku-4-5", max_tokens: 64001})}));
await go("https auth.internal other path", () => status("https://auth.internal/oauth/authorize"));
await go("http 127.0.0.1:8787", () => status("http://127.0.0.1:8787/"));
const tcp = (port) => new Promise((res) => { let back = ""; let opened = false; const s = require("net").connect(port, "1.1.1.1"); s.setTimeout(3000); s.on("connect", () => { opened = true; s.write("GET / HTTP/1.1\\r\\nHost: 1.1.1.1\\r\\n\\r\\n"); }); s.on("data", (d) => { back += d; }); const end = (how) => () => { res((opened ? "opened, then " : "") + how + ", answer: " + (back.split("\\r\\n")[0] || "none")); s.destroy(); }; s.on("error", (e) => end("failed " + e.code)()); s.on("timeout", end("timed out")); s.on("end", end("closed")); });
await go("tcp 1.1.1.1:443", () => tcp(443));
await go("tcp 1.1.1.1:80", () => tcp(80));
await go("dns example.com", () => new Promise((res) => require("dns").lookup("example.com", (e, a) => res(e ? "failed: " + e.code : "resolved"))));
console.log(JSON.stringify(out));
})();`;

const allow = (dev: Dev) =>
	Effect.gen(function* () {
		const box = yield* openBox(dev, "a", "claude");
		const before = {openai: dev.openai.calls.length, anthropic: dev.anthropic.calls.length};
		const r = yield* dev.call(yield* keyOf(dev, "a"), "/probe", {box, script: ALLOW});
		yield* peek(dev, "a", box);
		yield* kill(dev, "a", box);
		const p = JSON.parse(r.body);
		return {
			asked: JSON.parse(p.out || "{}"),
			reachedFakes: {
				openai: dev.openai.calls.length - before.openai,
				anthropic: dev.anthropic.calls.length - before.anthropic,
			},
		};
	});

/** The time a call pays for the catch: from inside a box, a route the Worker answers itself. */
const TIME = `(async () => {
const times = async (u) => { const xs = []; for (let i = 0; i < 25; i++) { const t = performance.now(); await (await fetch(u)).text(); xs.push(performance.now() - t); } return xs.slice(5).sort((a, b) => a - b); };
const med = (xs) => Math.round(xs[Math.floor(xs.length / 2)] * 10) / 10;
const h = await times("http://ping.internal/ping");
const s = await times("https://ping.internal/ping");
console.log(JSON.stringify({http: med(h), https: med(s)}));
})();`;

const median = (xs: readonly number[]) => {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)] ?? 0;
};

const time = (dev: Dev) =>
	Effect.gen(function* () {
		const box = yield* openBox(dev, "a", "claude");
		const r = yield* dev.call(yield* keyOf(dev, "a"), "/probe", {box, script: TIME});
		yield* kill(dev, "a", box);
		// The Worker's own part of each forwarded call, from its log: total minus the fake's time.
		const lines = dev
			.log()
			.split("\n")
			.flatMap((l) => {
				const i = l.indexOf('{"at":"outbound"');
				if (i < 0) return [];
				try {
					return [JSON.parse(l.slice(i)) as Record<string, number | string>];
				} catch {
					return [];
				}
			})
			.filter((l) => typeof l.upMs === "number");
		const own = (kind: string) =>
			lines.filter((l) => l.kind === kind).map((l) => Number(l.ms) - Number(l.upMs));
		const locker = lines.filter((l) => l.kind === "claude").map((l) => Number(l.lockerMs));
		return {
			roundTripMedianMs: JSON.parse(JSON.parse(r.body).out || "{}"),
			workerOwnMedianMs: {
				claude: median(own("claude")),
				codex: median(own("codex")),
				token: median(own("token")),
			},
			lockerLookupMedianMs: median(locker),
			calls: {claude: own("claude").length, codex: own("codex").length, token: own("token").length},
		};
	});

// ---------------------------------------------------------------- the leak count

const leaks = (dev: Dev) =>
	Effect.sync(() => {
		const claude = (who: string) => dev.anthropic.secretsOf(who);
		const codex = (who: string) => dev.openai.secretsOf(who);
		const dump = (b: {box: string}) => join(WORK, "boxes", `${b.box}.bin`);
		const of = (who: string, agent?: Agent) =>
			boxes.filter((b) => b.who === who && (agent === undefined || b.agent === agent)).map(dump);
		const all = [...dev.anthropic.secrets(), ...dev.openai.secrets()];
		const log = dev.log();
		return {
			boxes: {
				count: boxes.length,
				claudeTokenInAnyBox: countIn(boxes.map(dump), dev.anthropic.secrets()).hits,
				codexOfAInBsBoxes: countIn(of("b"), codex("a")).hits,
				codexOfBInAsBoxes: countIn(of("a"), codex("b")).hits,
				claudeOfBInAsBoxes: countIn(of("a"), claude("b")).hits,
				/** Expected: in v1 a Codex box holds its own person's lent auth.json. */
				codexOfAInAsCodexBoxes: countIn(of("a", "codex"), codex("a")).hits,
				codexInClaudeBoxes: countIn(
					boxes.filter((b) => b.agent === "claude").map(dump),
					dev.openai.secrets(),
				).hits,
			},
			workerLog: {
				bytes: log.length,
				logins: countText(log, all),
				secret: countText(log, [dev.secret]),
			},
			persist: {...countIn([dev.persist], all), secret: countIn([dev.persist], [dev.secret]).hits},
		};
	});

// ---------------------------------------------------------------- run

const scrub = (s: string) => s.replaceAll(WORK, "<work>").replaceAll(homedir(), "~");

const main = Effect.scoped(
	Effect.gen(function* () {
		rmSync(WORK, {recursive: true, force: true});
		mkdirSync(WORK, {recursive: true});
		const t0 = Date.now();
		const dev = yield* startDev({dir: WORK});
		const startMs = Date.now() - t0;
		const steps: Record<string, unknown> = {};
		const step = <A, E>(name: string, e: Effect.Effect<A, E>) =>
			e.pipe(
				Effect.tap((v) =>
					Effect.sync(() => {
						steps[name] = v;
						console.log(name, JSON.stringify(v).slice(0, 600));
					}),
				),
			);
		yield* step("claude", claude(dev));
		yield* step("codex", codex(dev));
		yield* step("kill", killed(dev, false));
		yield* step("killFixed", killed(dev, true));
		yield* step("queue", queue(dev, true));
		yield* step("queuePlantedOff", queue(dev, false));
		yield* step("two", two(dev));
		yield* step("allow", allow(dev));
		yield* step("time", time(dev));
		const found = yield* leaks(dev);
		console.log("leaks", JSON.stringify(found));
		const fs = yield* FileSystem.FileSystem;
		const out = {
			experiment: 157,
			date: new Date().toLocaleDateString("en-CA"),
			versions: {
				wrangler: "4.153.0",
				sandbox: "@cloudflare/sandbox 1.0.3",
				codex: "codex-cli 0.163.0",
				claude: "@anthropic-ai/claude-code 2.1.310",
			},
			startMs,
			steps,
			leaks: found,
		};
		yield* fs.writeFileString(RESULTS, `${scrub(JSON.stringify(out, null, "\t"))}\n`);
	}),
);

NodeRuntime.runMain(main.pipe(Effect.provide(nodeServices)));
