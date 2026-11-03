// Experiment 157, round 2: the box holds the login, the GitHub Actions way. Each person's Claude
// token and Codex auth.json sit sealed in their own Durable Object. A Claude box gets the token as
// CLAUDE_CODE_OAUTH_TOKEN; a Codex box borrows auth.json for one job and gives back the copy it
// leaves. The boxes have open internet, and nothing of ours stands in a model or refresh call.
//
//   env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY -u ANTHROPIC_API_KEY \
//     -u CLAUDE_CODE_OAUTH_TOKEN -u CLOUDFLARE_API_TOKEN nice -n 15 node experiments/157-login-stays-home.ts
//
// The Worker runs under `wrangler dev` (`157-login-stays-home/worker.ts`), each box is a Docker
// container started through Cloudflare's Sandbox SDK shape. The model servers are fakes on
// 127.0.0.1, and so are the logins; the programs are pointed at them by their own settings.
// Steps: claude, codex, deadLogin, loanEnds, loanNoEnd, queue, queuePlantedOff, two, open,
// witness, time, then the leak count. One box runs at a time: a Codex job waiting in line holds no
// box. queuePlantedOff needs two at once and runs only with STEPS=queuePlantedOff. Once first:
// `pnpm install --ignore-workspace` in 157-login-stays-home. Needs Docker.
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
import {countIn, countText, type Dev, inBox, startDev} from "./157-login-stays-home/dev.ts";
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

/** A fresh Codex sign-in. With `lifeMs` below 0 its access token has run out: the job refreshes. */
const freshCodex = (dev: Dev, who: string, lifeMs = -5_000) =>
	keep(dev, who, "codex", dev.openai.login(who, lifeMs));

const openBox = (dev: Dev, who: string, agent: Agent) =>
	Effect.gen(function* () {
		const r = yield* dev.call(yield* keyOf(dev, who), "/box", {agent});
		const box = JSON.parse(r.body).box as string;
		boxes.push({box, who, agent});
		return box;
	});

/** Dump the box's files and process environments to WORK, for the leak count. */
const peek = (dev: Dev, who: string, box: string, when = "after") =>
	Effect.gen(function* () {
		const bytes = yield* dev.bytes(yield* keyOf(dev, who), "/peek", {box});
		mkdirSync(join(WORK, "boxes", box), {recursive: true});
		writeFileSync(join(WORK, "boxes", box, `${when}.bin`), bytes);
		return bytes.length;
	});

const kill = (dev: Dev, who: string, box: string) =>
	Effect.gen(function* () {
		yield* dev.call(yield* keyOf(dev, who), "/kill", {box});
	});

const look = (dev: Dev, who: string) =>
	Effect.gen(function* () {
		const r = yield* dev.call(yield* keyOf(dev, who), "/look?provider=codex");
		const l = JSON.parse(r.body);
		return {counts: l.counts as Record<string, number>, loan: l.loan as unknown};
	});

/** One job, start to end, in a box of its own. The box is dumped, then stopped. */
const job = (dev: Dev, who: string, agent: Agent, o: Partial<Job> = {}, box?: string) =>
	Effect.gen(function* () {
		const id = box ?? (yield* openBox(dev, who, agent));
		const run = `${id}-${Math.random().toString(36).slice(2, 6)}`;
		const startedAt = Date.now();
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
			backAt: done.backAt,
			lentAt: done.lentAt,
			startedAt,
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

/** Wait until `f` holds, checking every 20 ms. */
const until = (f: () => boolean) =>
	Effect.callback<void>((resume) => {
		const timer = setInterval(() => {
			if (f()) {
				clearInterval(timer);
				resume(Effect.void);
			}
		}, 20);
		return Effect.sync(() => clearInterval(timer));
	});

/** The next refresh the fake answers. */
const nextRefresh = (dev: Dev) => {
	const n = dev.openai.refreshes.length;
	return until(() => dev.openai.refreshes.length > n);
};

// ---------------------------------------------------------------- the steps

/** Claude: the box gets the locker's token as CLAUDE_CODE_OAUTH_TOKEN and calls the fake itself. */
const claude = (dev: Dev) =>
	Effect.gen(function* () {
		const kept = yield* keep(dev, "a", "claude", dev.anthropic.issue("a"));
		const box = yield* openBox(dev, "a", "claude");
		const running = yield* Effect.forkChild(job(dev, "a", "claude", {}, box));
		// While Claude Code runs: the token is in its environment, by design.
		yield* until(() => dev.anthropic.calls.some((x) => x.run?.startsWith(box) === true));
		const dumpedDuring = yield* peek(dev, "a", box, "during");
		const r = yield* Fiber.join(running);
		const c = dev.anthropic.calls.filter((x) => x.run === r.run);
		return {
			kept,
			...r,
			dumpedDuring,
			fake: {
				calls: c.length,
				who: [...new Set(c.map((x) => x.who))],
				why: [...new Set(c.map((x) => x.why))],
				answers: c.map((x) => x.answer),
			},
		};
	});

/**
 * Codex (a): a refresh inside the box, the copy taken back, and the next job still works. The
 * window is how long the new tokens lived only in the box: from the refresh to the take-back.
 */
const codex = (dev: Dev) =>
	Effect.gen(function* () {
		const kept = yield* freshCodex(dev, "a");
		const n = dev.openai.refreshes.length;
		dev.openai.tune({thinkMs: 1_500});
		const box = yield* openBox(dev, "a", "codex");
		const running = yield* Effect.forkChild(job(dev, "a", "codex", {}, box));
		// While Codex runs: auth.json is in the box, by design. The box stops before the take-back.
		yield* until(() => dev.openai.calls.some((x) => x.run?.startsWith(box) === true));
		const dumpedDuring = yield* peek(dev, "a", box, "during");
		const first = yield* Fiber.join(running);
		dev.openai.tune({thinkMs: 0});
		const refreshAt = dev.openai.refreshes[n]?.at ?? 0;
		const second = yield* job(dev, "a", "codex");
		return {
			kept,
			dumpedDuring,
			first: {...first, fake: codexSeen(dev, first.run)},
			second: {...second, fake: codexSeen(dev, second.run)},
			refreshes: refreshesSince(dev, n),
			onlyInTheBoxMs: (first.backAt ?? 0) - refreshAt,
		};
	});

/**
 * Codex (b): the box dies right after its refresh, before it gives the login back. There is no
 * catch on the refresh path now: the login dies, a known cost.
 */
const deadLogin = (dev: Dev) =>
	Effect.gen(function* () {
		yield* freshCodex(dev, "a");
		const n = dev.openai.refreshes.length;
		dev.openai.tune({thinkMs: 4_000});
		const box = yield* openBox(dev, "a", "codex");
		const running = yield* Effect.forkChild(job(dev, "a", "codex", {}, box));
		yield* nextRefresh(dev);
		const refreshedAt = Date.now();
		yield* kill(dev, "a", box);
		const killMs = Date.now() - refreshedAt;
		const died = yield* Fiber.join(running);
		dev.openai.tune({thinkMs: 0});
		const next = yield* job(dev, "a", "codex");
		return {
			died: {ok: died.ok, back: died.back, error: died.error},
			killedMsAfterRefresh: killMs,
			next: {ok: next.ok, right: next.right, error: next.error, fake: codexSeen(dev, next.run)},
			refreshes: refreshesSince(dev, n),
			dead: dev.openai.deadFor("a"),
		};
	});

/**
 * Codex (c): the loan end time. A box dies mid-job and its object says nothing (planted `quiet`),
 * so only the locker's alarm can end the loan. The person's next job waits for it, then runs.
 * The login does not run out, so the dead box never refreshed and the next job can work.
 */
const loanEnds = (dev: Dev, who: string, loanMs: number) =>
	Effect.gen(function* () {
		yield* freshCodex(dev, who, 3_600_000);
		dev.openai.tune({thinkMs: 4_000});
		const box = yield* openBox(dev, who, "codex");
		const running = yield* Effect.forkChild(job(dev, who, "codex", {quiet: true, loanMs}, box));
		yield* until(() => dev.openai.calls.some((c) => c.run?.startsWith(box) === true));
		yield* kill(dev, who, box);
		const killedAt = Date.now();
		const died = yield* Fiber.join(running);
		dev.openai.tune({thinkMs: 0});
		const held = yield* look(dev, who);
		const loan = held.loan as {box: string; until: number} | null;
		const next = yield* job(dev, who, "codex");
		return {
			loanMs,
			died: {ok: died.ok, back: died.back},
			heldAfterDeath: loan?.box === box,
			endsMsAfterKill: (loan?.until ?? 0) - killedAt,
			next: {
				ok: next.ok,
				right: next.right,
				waitedMs: next.waitedMs,
				/** When the next job got the login, against the dead loan's end time. */
				lentMsAfterEnd: (next.lentAt ?? 0) - (loan?.until ?? 0),
				error: next.error,
			},
			counts: (yield* look(dev, who)).counts,
		};
	});

/** Codex (c'): the same with no end time to speak of. The next job is given 20 s, then stopped. */
const loanNoEnd = (dev: Dev) =>
	Effect.gen(function* () {
		const who = "c";
		yield* freshCodex(dev, who, 3_600_000);
		dev.openai.tune({thinkMs: 4_000});
		const box = yield* openBox(dev, who, "codex");
		const running = yield* Effect.forkChild(job(dev, who, "codex", {quiet: true}, box));
		yield* until(() => dev.openai.calls.some((c) => c.run?.startsWith(box) === true));
		yield* kill(dev, who, box);
		yield* Fiber.join(running);
		dev.openai.tune({thinkMs: 0});
		const second = yield* openBox(dev, who, "codex");
		const waited = yield* job(dev, who, "codex", {}, second).pipe(
			Effect.timeoutOption("20 seconds"),
		);
		yield* kill(dev, who, second);
		return {
			loanMs: 600_000,
			nextStartedWithin20s: waited._tag === "Some",
			heldAfter20s: (yield* look(dev, who)).loan !== null,
		};
	});

/** Codex (d): a second job of the same person while the first runs. */
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
		// One box at a time, so the laptop is not overloaded: the two people take turns.
		const [ca, cb, xa, xb] = yield* Effect.all(
			[
				job(dev, "a", "claude"),
				job(dev, "b", "claude"),
				job(dev, "a", "codex"),
				job(dev, "b", "codex"),
			],
			{concurrency: 1},
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
			lockers: {a: (yield* look(dev, "a")).counts, b: (yield* look(dev, "b")).counts},
		};
	});

/** What a box can reach with open internet, and what our Worker sees of it: nothing. */
const OPEN = `(async () => {
const out = {};
const go = async (name, f) => { try { out[name] = await f(); } catch (e) { out[name] = "failed: " + (e.cause?.code ?? e.code ?? e.message); } };
const status = (u, o) => fetch(u, o).then((r) => r.status);
await go("fake anthropic, straight", () => status(process.env.CLAUDE_BASE + "/v1/messages", {method: "POST", body: "{}"}));
await go("fake openai, straight", () => status(process.env.CODEX_BASE + "/backend-api/codex/models"));
await go("https example.com", () => status("https://example.com/", {method: "HEAD"}));
await go("dns example.com", () => new Promise((res) => require("dns").lookup("example.com", (e) => res(e ? "failed: " + e.code : "resolved"))));
await go("user id", async () => process.getuid());
await go("write in /var/empty", async () => { require("fs").writeFileSync("/var/empty/settings.json", "{}"); return "written"; });
await go("/var/empty holds", async () => require("fs").readdirSync("/var/empty").length);
console.log(JSON.stringify(out));
})();`;

const workerLines = (dev: Dev) =>
	dev
		.log()
		.split("\n")
		.filter((l) => l.includes('{"at":')).length;

const open = (dev: Dev) =>
	Effect.gen(function* () {
		const box = yield* openBox(dev, "a", "claude");
		const before = {
			anthropic: dev.anthropic.calls.length,
			lines: workerLines(dev),
		};
		const r = yield* dev.call(yield* keyOf(dev, "a"), "/probe", {box, script: OPEN});
		yield* peek(dev, "a", box);
		yield* kill(dev, "a", box);
		const p = JSON.parse(r.body);
		return {
			asked: JSON.parse(p.out || "{}"),
			fakeAnthropicSawStraight: dev.anthropic.calls.length - before.anthropic,
			workerLogLinesAdded: workerLines(dev) - before.lines,
		};
	});

/** Measuring only: every host the two programs call, with these settings, in a caught box. */
const witness = (dev: Dev) =>
	Effect.gen(function* () {
		yield* keep(dev, "a", "claude", dev.anthropic.issue("a"));
		yield* freshCodex(dev, "a");
		const from = dev.log().length;
		const [c, x] = yield* Effect.all(
			[job(dev, "a", "claude", {witness: true}), job(dev, "a", "codex", {witness: true})],
			{concurrency: 1},
		);
		const seen = dev
			.log()
			.slice(from)
			.split("\n")
			.flatMap((l) => {
				const i = l.indexOf('{"at":"witness"');
				if (i < 0) return [];
				try {
					return [JSON.parse(l.slice(i)) as {box: string; host: string; path: string}];
				} catch {
					return [];
				}
			});
		const of = (box: string) => [
			...new Set(
				seen
					.filter((s) => s.box === box)
					.map((s) => `${s.host.replace(/:\d+$/, ":<fake>")}${s.path}`),
			),
		];
		return {
			claude: {ok: c.ok, right: c.right, error: c.error, calls: of(c.box)},
			codex: {ok: x.ok, right: x.right, error: x.error, calls: of(x.box)},
			notAFake: seen.filter((s) => !s.host.endsWith(".fakes.internal")).length,
		};
	});

/** A call's time from inside a box straight to a fake: no Worker in the path now. */
const TIME = `(async () => {
const times = async (u) => { const xs = []; for (let i = 0; i < 25; i++) { const t = performance.now(); await (await fetch(u)).text(); xs.push(performance.now() - t); } return xs.slice(5).sort((a, b) => a - b); };
const med = (xs) => Math.round(xs[Math.floor(xs.length / 2)] * 10) / 10;
console.log(JSON.stringify({straightToFake: med(await times(process.env.CODEX_BASE + "/ping"))}));
})();`;

const time = (dev: Dev) =>
	Effect.gen(function* () {
		const box = yield* openBox(dev, "a", "claude");
		const r = yield* dev.call(yield* keyOf(dev, "a"), "/probe", {box, script: TIME});
		yield* kill(dev, "a", box);
		return {roundTripMedianMs: JSON.parse(JSON.parse(r.body).out || "{}")};
	});

// ---------------------------------------------------------------- the leak count

const leaks = (dev: Dev, witnessLines: number) =>
	Effect.sync(() => {
		const claude = (who: string) => dev.anthropic.secretsOf(who);
		const codex = (who: string) => dev.openai.secretsOf(who);
		const dump = (b: {box: string}) => join(WORK, "boxes", b.box);
		const of = (who: string, agent?: Agent) =>
			boxes.filter((b) => b.who === who && (agent === undefined || b.agent === agent)).map(dump);
		const ofAgent = (agent: Agent) => boxes.filter((b) => b.agent === agent).map(dump);
		const all = [...dev.anthropic.secrets(), ...dev.openai.secrets()];
		const log = dev.log();
		return {
			worker: {
				log: {bytes: log.length, logins: countText(log, all), secret: countText(log, [dev.secret])},
				storage: {
					...countIn([dev.persist], all),
					secret: countIn([dev.persist], [dev.secret]).hits,
				},
				frontDoorSent: {
					calls: dev.traffic.sent.length,
					logins: countText(dev.traffic.sent.join("\n"), all),
				},
				frontDoorAnswers: {
					calls: dev.traffic.got.length,
					logins: countText(dev.traffic.got.join("\n"), all),
				},
				/** Lines of a handler on a box's calls, outside the witness step: there is none. */
				callLinesOutsideWitness:
					log.split("\n").filter((l) => l.includes('"at":"witness"')).length - witnessLines,
			},
			boxes: {
				count: boxes.length,
				/** By design: a Claude box holds its own person's token in the job's env. */
				claudeOfAInAsClaudeBoxes: countIn(of("a", "claude"), claude("a")).hits,
				/** Once the job ended: Claude Code wrote the token nowhere in the box's files. */
				claudeOfAInAsClaudeBoxesAfterTheJob: countIn(
					of("a", "claude").map((d) => join(d, "after.bin")),
					claude("a"),
				).hits,
				claudeOfBInAsBoxes: countIn(of("a"), claude("b")).hits,
				claudeOfAInBsBoxes: countIn(of("b"), claude("a")).hits,
				claudeInCodexBoxes: countIn(ofAgent("codex"), dev.anthropic.secrets()).hits,
				/** By design: a Codex box holds its own person's lent auth.json. */
				codexOfAInAsCodexBoxes: countIn(of("a", "codex"), codex("a")).hits,
				codexOfAInBsBoxes: countIn(of("b"), codex("a")).hits,
				codexOfBInAsBoxes: countIn(of("a"), codex("b")).hits,
				codexInClaudeBoxes: countIn(ofAgent("claude"), dev.openai.secrets()).hits,
			},
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
		const only = (process.env.STEPS ?? "").split(",").filter(Boolean);
		// queuePlantedOff runs two boxes at once, so it runs only when named.
		const want = (name: string) =>
			only.includes(name) || (only.length === 0 && name !== "queuePlantedOff");
		if (want("claude")) yield* step("claude", claude(dev));
		if (want("codex")) yield* step("codex", codex(dev));
		if (want("deadLogin")) yield* step("deadLogin", deadLogin(dev));
		if (want("loanEnds")) yield* step("loanEnds", loanEnds(dev, "a", 8_000));
		if (want("loanNoEnd")) yield* step("loanNoEnd", loanNoEnd(dev));
		if (want("queue")) yield* step("queue", queue(dev, true));
		if (want("queuePlantedOff")) yield* step("queuePlantedOff", queue(dev, false));
		if (want("two")) yield* step("two", two(dev));
		if (want("open")) yield* step("open", open(dev));
		const before = dev
			.log()
			.split("\n")
			.filter((l) => l.includes('"at":"witness"')).length;
		if (want("witness")) yield* step("witness", witness(dev));
		const witnessLines =
			dev
				.log()
				.split("\n")
				.filter((l) => l.includes('"at":"witness"')).length - before;
		if (want("time")) yield* step("time", time(dev));
		const found = yield* leaks(dev, witnessLines);
		console.log("leaks", JSON.stringify(found));
		const fs = yield* FileSystem.FileSystem;
		const out = {
			experiment: 157,
			round: 2,
			shape:
				"the box holds the login; open internet; no handler of ours in a model or refresh call",
			date: new Date().toLocaleDateString("en-CA"),
			versions: {
				wrangler: "4.153.0",
				sandbox: "@cloudflare/sandbox 1.0.3",
				codex: "codex-cli 0.163.0",
				claude: "@anthropic-ai/claude-code 2.1.310",
			},
			fakesAsTheBoxSees: inBox("http://127.0.0.1:<port>"),
			startMs,
			steps,
			leaks: found,
		};
		if (only.length === 0)
			yield* fs.writeFileString(RESULTS, `${scrub(JSON.stringify(out, null, "\t"))}\n`);
	}),
);

NodeRuntime.runMain(main.pipe(Effect.provide(nodeServices)));
