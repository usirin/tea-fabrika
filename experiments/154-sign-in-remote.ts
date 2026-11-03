// Experiment 154: can a remote box sign in to its person's own ChatGPT plan each time it starts,
// while the shared fabrika never gets or keeps the pass? Sign in with ChatGPT (SIWC), the OAuth
// 2.0 code flow with PKCE (RFC 7636) and a loopback redirect (RFC 8252), split across two
// machines: the box holds the verifier and the pass, the person's app catches the callback, and
// only a URL and a one-time code cross the shared ledger.
//
//   env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY node experiments/154-sign-in-remote.ts
//       fake: a fake sign-in server, the real local ledger (Miniflare), boxes as child processes
//   ... node experiments/154-sign-in-remote.ts docker
//       the same, with each box in a Docker container, the local twin of a Cloudflare container
//       (build the image first: node experiments/154-sign-in-remote/build.ts)
//   ... node experiments/154-sign-in-remote.ts live --local | live --remote  [--way a|b|c]
//       the live runner, for a person at the laptop: a real sign-in with OpenAI. Not run by the
//       agent that built this. It prints only what experiments/154-sign-in-remote.md lists.
//       Way a (the default): the box signs in and refreshes. Way b: no offline_access. Way c: the
//       person's app signs in and lends the box sealed passes.
//
// Every run's files are under runs/exp-154/<stamp>/ (ignored by git): the ledger's own files, the
// app's, each box's and each agent's folder, and every log. The fake run searches all of them for
// every secret the fake server made or saw, and writes experiments/results/154-sign-in-remote.json.
//
// Node at the edge, said here: child_process to start each box (as a person's machine or a
// container would), fs to keep its log and read the run's files back, and net to hold port 1455
// in one case. The fake sign-in server and the app's catcher use node:http (their files say why).
import {type ChildProcess, execFileSync, spawn} from "node:child_process";
import {
	createWriteStream,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import {createServer} from "node:net";
import {join, relative} from "node:path";
import {replay} from "@demlik/tea";
import {Ledger, streams} from "@kampus/fabrika-old";
import {LocalLedger, layerLocal} from "@kampus/fabrika-old/local";
import {Effect, Redacted} from "effect";
import {fakeBrowser, phoneBrowser, runApp} from "./154-sign-in-remote/app.ts";
import {type Fake, startFake} from "./154-sign-in-remote/fake-auth.ts";
import {runLender} from "./154-sign-in-remote/lender.ts";
import {type SignInMsg, signIn} from "./154-sign-in-remote/machine.ts";
import {challengeOf, pkce} from "./154-sign-in-remote/pkce.ts";
import {makeKeys, seal} from "./154-sign-in-remote/seal.ts";
import {type Auth, boxName, openai, SIWC, type ToBox} from "./154-sign-in-remote/wire.ts";

const here = join(import.meta.dirname, "154-sign-in-remote");
const root = join(import.meta.dirname, "..");
const mode = process.argv[2] ?? "fake";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(root, "runs", "exp-154", `${mode}-${stamp}`);
const logs = join(runDir, "logs");
const LEDGER = "exp154";
const WHO = "a";
const IMAGE = "exp154-box:local";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const quiet = process.env.QUIET === "1";
const print = (line: string) => {
	if (!quiet) process.stdout.write(`${line}\n`);
};

// ---------------------------------------------------------------- the machine alone

/** The machine's own rules, on `replay`: no box, no ledger, no network. */
const machineChecks = () => {
	const steps = (...msgs: SignInMsg[]) => replay(signIn, {ctx: undefined, msgs});
	const offered = {
		type: "offer_ok",
		cmd: {type: "offer", port: 1455, round: 0},
		value: {state: "s1", waitMs: 1000},
	};
	const traded = {
		type: "trade_ok",
		cmd: {type: "trade", code: "c", client: "x"},
		value: {expires_in: 3600, scopes: [SIWC.planScope], refreshInMs: 3_420_000},
	};
	const m = (x: unknown) => x as SignInMsg;
	const code = (state: string): SignInMsg => ({type: "code", state, code: "c", client: "x"});
	const cases = {
		"first step: the want": () =>
			steps()
				.cmds.map((c) => c.type)
				.join() === "want",
		"a port makes the offer": () =>
			steps({type: "catcher", port: 1455}).cmds.at(-1)?.type === "offer",
		"a second port is dropped": () =>
			steps({type: "catcher", port: 1455}, {type: "catcher", port: 9}).cmds.filter(
				(c) => c.type === "offer",
			).length === 1,
		"the right state trades": () =>
			steps({type: "catcher", port: 1455}, m(offered), code("s1")).cmds.at(-1)?.type === "trade",
		"a wrong state ends it": () =>
			steps({type: "catcher", port: 1455}, m(offered), code("other")).state.at === "ending",
		"a second code is dropped": () =>
			steps({type: "catcher", port: 1455}, m(offered), code("s1"), code("s1")).cmds.filter(
				(c) => c.type === "trade",
			).length === 1,
		"a denial with another state is not ours": () =>
			steps({type: "catcher", port: 1455}, m(offered), {
				type: "denied",
				state: "x",
				error: "access_denied",
			}).state.at === "waiting",
		"a code after the end is dropped": () =>
			steps({type: "catcher", port: 1455}, m(offered), {type: "end"}, code("s1")).cmds.every(
				(c) => c.type !== "trade",
			),
		"a trade that lands after the end keeps it ending": () =>
			steps({type: "catcher", port: 1455}, m(offered), code("s1"), {type: "end"}, m(traded)).state
				.at === "ending",
		"signed sets the refresh timer": () =>
			JSON.stringify(
				steps({type: "catcher", port: 1455}, m(offered), code("s1"), m(traded)).subs,
			).includes("refresh_due"),
		"an old turn's timer does nothing": () =>
			steps({type: "catcher", port: 1455}, m(offered), code("s1"), m(traded), {
				type: "refresh_due",
				turn: 7,
			}).state.at === "signed",
		"no renewal key: the person is asked again, one round on": () => {
			const r = steps(
				{type: "catcher", port: 1455},
				m(offered),
				code("s1"),
				m(traded),
				{type: "refresh_due", turn: 0},
				m({
					type: "refresh_err",
					cmd: {type: "refresh", turn: 0},
					error: {_tag: "no_renewal", why: "no refresh token"},
				}),
			);
			const last = r.cmds.at(-1) as {type?: string; round?: number} | undefined;
			return (
				r.state.at === "asking" && r.state.round === 1 && last?.type === "want" && last.round === 1
			);
		},
		"a refused refresh ends it": () =>
			steps(
				{type: "catcher", port: 1455},
				m(offered),
				code("s1"),
				m(traded),
				{type: "refresh_due", turn: 0},
				m({
					type: "refresh_err",
					cmd: {type: "refresh", turn: 0},
					error: {_tag: "refused", why: "invalid_grant"},
				}),
			).state.at === "ending",
		"the state never holds a token field": () => {
			const s = steps({type: "catcher", port: 1455}, m(offered), code("s1"), m(traded)).state;
			return !/token|access|refresh_token|verifier/i.test(Object.keys(s).join());
		},
	};
	return Object.entries(cases).map(([name, f]) => ({name, ok: f()}));
};

// ---------------------------------------------------------------- a box

interface Started {
	readonly id: string;
	readonly proc: ChildProcess;
	readonly events: Record<string, unknown>[];
	readonly exited: Promise<number | null>;
}

interface BoxPlan {
	readonly id: string;
	readonly waitMs?: number;
	readonly holdMs?: number;
	readonly client?: string;
	readonly agent?: boolean;
	/** The probe's control: the agent may read the pass (Docker: as root; a Mac: a planted file). */
	readonly control?: boolean;
	/** Way (b): no offline_access, so no refresh token; the person is asked again. */
	readonly renew?: "ask";
	/** Way (c): the person's app lends passes; the box never signs in. */
	readonly passFrom?: "app";
	readonly who?: string;
}

interface Where {
	readonly kind: "process" | "docker";
	readonly ledgerUrl: string;
	readonly ledgerToken: string;
	readonly auth: Auth;
	/** The same server as seen from inside a container: the box's own calls go here. */
	readonly authInBox: Auth;
	readonly ledgerUrlInBox: string;
}

const startBox = (w: Where, p: BoxPlan): Started => {
	const boxDir = join(runDir, `box-${p.id}`);
	const agentDir = join(runDir, `agent-${p.id}`);
	mkdirSync(boxDir, {recursive: true});
	mkdirSync(agentDir, {recursive: true});
	const vars: Record<string, string> = {
		BOX: p.id,
		WHO: p.who ?? WHO,
		RENEW: p.renew ?? "refresh",
		PASS_FROM: p.passFrom ?? "self",
		AUTH: JSON.stringify(w.kind === "docker" ? w.authInBox : w.auth),
		LEDGER_URL: w.kind === "docker" ? w.ledgerUrlInBox : w.ledgerUrl,
		LEDGER_NAME: LEDGER,
		LEDGER_TOKEN: w.ledgerToken,
		WAIT_MS: String(p.waitMs ?? 20_000),
		HOLD_MS: String(p.holdMs ?? 0),
		CLIENT: p.client ?? "",
		MODEL: "fake-mini",
	};
	let proc: ChildProcess;
	if (w.kind === "process") {
		if (p.agent !== false) {
			vars.AGENT_CMD = JSON.stringify([process.execPath, join(here, "box", "agent-probe.mjs")]);
			vars.AGENT_DIR = agentDir;
		}
		if (p.control === true)
			writeFileSync(join(agentDir, "planted.txt"), `fake_at_${"ab".repeat(24)}\n`);
		const env: Record<string, string> = {PATH: process.env.PATH ?? "", HOME: boxDir, ...vars};
		proc = spawn(process.execPath, [join(here, "box.ts")], {
			cwd: boxDir,
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});
	} else {
		if (p.agent !== false) {
			vars.AGENT_CMD = JSON.stringify(["node", "/app/agent-probe.mjs"]);
			vars.AGENT_DIR = "/work/agent";
			if (p.control !== true) vars.AGENT_USER = "agent";
		}
		const args = [
			"run",
			"--rm",
			"--name",
			`exp154-${p.id}-${stamp.slice(-9, -1)}`,
			"--label",
			"exp154=1",
		];
		for (const [k, v] of Object.entries(vars)) args.push("-e", `${k}=${v}`);
		args.push(IMAGE);
		proc = spawn("docker", args, {stdio: ["ignore", "pipe", "pipe"]});
	}
	const out = createWriteStream(join(logs, `box-${p.id}.log`));
	const events: Record<string, unknown>[] = [];
	let buf = "";
	proc.stdout?.on("data", (d: Buffer) => {
		out.write(d);
		buf += d.toString();
		const lines = buf.split("\n");
		buf = lines.pop() ?? "";
		for (const l of lines) {
			try {
				events.push(JSON.parse(l) as Record<string, unknown>);
			} catch {
				events.push({ev: "text", text: l.slice(0, 200)});
			}
		}
	});
	proc.stderr?.on("data", (d: Buffer) => out.write(d));
	const exited = new Promise<number | null>((r) => proc.on("exit", (c) => r(c)));
	return {id: p.id, proc, events, exited};
};

const until = async (b: Started, ev: string, ms = 30_000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		const hit = b.events.find((e) => e.ev === ev);
		if (hit !== undefined) return hit;
		if (b.proc.exitCode !== null && ev !== "ended") break;
		await sleep(20);
	}
	throw new Error(`box ${b.id}: no "${ev}" in ${ms} ms; saw ${JSON.stringify(b.events.slice(-4))}`);
};
const endedOf = async (b: Started, ms = 30_000) => {
	const e = await until(b, "ended", ms);
	await b.exited;
	return e as {ev: "ended"; at: string; why: string; revoked: boolean};
};

// ---------------------------------------------------------------- the leak search

/** Every place a secret could end up, searched for every secret the fake made or saw. */
const leakSearch = (secrets: Record<string, readonly string[]>, rows: string, sayLog: string) => {
	const places: Record<string, string> = {"ledger rows": rows, "app log": sayLog};
	const files: string[] = [];
	const walk = (d: string) => {
		for (const n of readdirSync(d)) {
			const p = join(d, n);
			const st = statSync(p);
			if (st.isDirectory()) walk(p);
			else if (st.size < 64 * 1024 * 1024) files.push(p);
		}
	};
	walk(runDir);
	for (const f of files) places[`file ${relative(runDir, f)}`] = readFileSync(f, "latin1");
	const hits: Record<string, Record<string, number>> = {};
	for (const [kind, list] of Object.entries(secrets)) {
		for (const [place, text] of Object.entries(places)) {
			const n = list.filter((s) => s.length > 8 && text.includes(s)).length;
			if (n > 0) {
				hits[kind] ??= {};
				hits[kind][place.replace(/[0-9a-f]{16,}/g, "<hex>")] = n;
			}
		}
	}
	return {places: Object.keys(places).length, files: files.length, hits};
};

// ---------------------------------------------------------------- the fake run

const fakeRun = (kind: "process" | "docker") =>
	Effect.gen(function* () {
		mkdirSync(logs, {recursive: true});
		const machine = machineChecks();
		for (const c of machine) print(`machine  ${c.ok ? "ok  " : "FAIL"} ${c.name}`);

		const fake: Fake = yield* Effect.promise(() => startFake({expiresIn: 4}));
		yield* Effect.addFinalizer(() => Effect.promise(() => fake.stop()));
		const local = yield* LocalLedger;
		const ledger = yield* Ledger;
		const auth: Auth = {
			authorize: `${fake.base}/api/accounts/authorize`,
			token: `${fake.base}/api/accounts/oauth/token`,
			revoke: `${fake.base}/revoke`,
			api: `${fake.base}/v1`,
		};
		const inBox = (u: string) => u.replace("127.0.0.1", "host.docker.internal");
		const where: Where = {
			kind,
			ledgerUrl: local.url,
			ledgerToken: Redacted.value(local.token),
			auth,
			authInBox: {
				...auth,
				token: inBox(auth.token),
				revoke: inBox(auth.revoke ?? ""),
				api: inBox(auth.api),
			},
			ledgerUrlInBox: inBox(local.url),
		};

		// How the person answers each box's sign-in page.
		const answer = new Map<string, "click" | "ignore" | "phone">();
		const pasted = new Map<string, string>();
		const sayLog: string[] = [];
		const app = yield* runApp({
			who: WHO,
			authorize: auth.authorize,
			say: (e) => sayLog.push(JSON.stringify(e)),
			open: async (url) => {
				// The URL names no box, so the person's answer is picked by the state the app saw for it.
				const state = new URL(url).searchParams.get("state");
				const box = [...app.catchers].find(([, c]) => c.state === state)?.[0] ?? "";
				const how = answer.get(box) ?? "click";
				if (how === "click") return fakeBrowser(url);
				if (how === "phone") return phoneBrowser((cb) => pasted.set(box, cb))(url);
			},
		});
		const toBox = (box: string, row: ToBox, id: string) =>
			ledger
				.send(streams(boxName(box)).inbox, id, {kind: row.kind, writer: "user:other", data: row})
				.pipe(Effect.orDie);
		const results: Record<string, unknown> = {};
		const check = (name: string, ok: boolean, detail: unknown = null) => {
			results[name] = {ok, detail};
			print(
				`${kind.padEnd(8)} ${ok ? "ok  " : "FAIL"} ${name}${detail === null ? "" : `  ${JSON.stringify(detail)}`}`,
			);
		};
		const go = <A>(f: () => Promise<A>) => Effect.promise(f);

		// 1. The whole path: sign in, refresh twice while held, one answer, the agent's look, forget.
		const t0 = Date.now();
		const b1 = startBox(where, {id: "b1", holdMs: 5000});
		const signed = yield* go(() => until(b1, "signed"));
		const signMs = Date.now() - t0;
		const e1 = yield* go(() => endedOf(b1));
		const refreshes = b1.events.filter((e) => e.ev === "refreshed").length;
		const answer1 = b1.events.find((e) => e.ev === "answer") ?? {};
		const agent1 = (b1.events.find((e) => e.ev === "agent") ?? {}) as {
			found?: {found?: Record<string, unknown[]>; looked?: unknown};
		};
		check(
			"signs in, refreshes while held, answers, forgets",
			e1.why === "done" && refreshes >= 1 && answer1.text === "Hi there",
			{
				signMs,
				length: signed.length,
				expires_in: signed.expires_in,
				scopes: signed.scopes,
				refreshes,
				answer: answer1,
				ended: e1,
			},
		);
		const agentHits = agent1.found?.found ?? {};
		check(
			"the agent's commands find no pass and no refresh token",
			(agentHits.access ?? []).length === 0 && (agentHits.refresh ?? []).length === 0,
			agent1.found ?? null,
		);
		const rts = fake.issued().refresh;
		check(
			"ending revoked the pass: every refresh token of the box is dead",
			rts.every((rt) => !fake.live(rt)),
			{
				tokens: rts.length,
			},
		);

		// 2. A wrong verifier is refused; 3. a code used twice is refused, and its pass revoked.
		const direct = async (verifierFor: (v: string) => string) => {
			const {verifier, challenge} = await pkce();
			const q = new URLSearchParams({
				client_id: SIWC.dynamicClient,
				agent_name_hint: "test",
				ext_agent_host_id: `urn:uuid:${crypto.randomUUID()}`,
				response_type: "code",
				redirect_uri: "http://127.0.0.1:1455/auth/callback",
				resource: SIWC.resource,
				scope: SIWC.scope,
				state: "s",
				code_challenge: challenge,
				code_challenge_method: "S256",
				nonce: "n",
			});
			const loc = new URL(
				(await fetch(`${auth.authorize}?${q}`, {redirect: "manual"})).headers.get("location") ?? "",
			);
			const tradeWith = (v: string) =>
				fetch(auth.token, {
					method: "POST",
					headers: {"content-type": "application/x-www-form-urlencoded"},
					body: new URLSearchParams({
						grant_type: "authorization_code",
						client_id: loc.searchParams.get("client_id") ?? "",
						code: loc.searchParams.get("code") ?? "",
						code_verifier: v,
						redirect_uri: "http://127.0.0.1:1455/auth/callback",
						resource: SIWC.resource,
					}),
				}).then(async (r) => ({
					status: r.status,
					body: (await r.json()) as Record<string, unknown>,
				}));
			return {verifier, first: await tradeWith(verifierFor(verifier)), tradeWith};
		};
		const wrong = yield* go(() => direct(() => "x".repeat(43)));
		check(
			"a wrong verifier is refused",
			wrong.first.status === 400 && wrong.first.body.error === "invalid_grant",
			wrong.first,
		);
		const twice = yield* go(() => direct((v) => v));
		const again = yield* go(() => twice.tradeWith(twice.verifier));
		const firstPass = String(twice.first.body.access_token ?? "");
		const stillGood = yield* go(() =>
			fetch(`${auth.api}/responses`, {
				method: "POST",
				headers: {authorization: `Bearer ${firstPass}`, "content-type": "application/json"},
				body: JSON.stringify({input: "hi", store: false, stream: true}),
			}).then((r) => r.status),
		);
		check(
			"a code used twice is refused, and the pass it gave is revoked",
			twice.first.status === 200 &&
				again.status === 400 &&
				again.body.error === "invalid_grant" &&
				stillGood === 401,
			{first: twice.first.status, second: again.body.error, firstPassAfter: stillGood},
		);
		check(
			"S256 is checked: the challenge is sha256 of the verifier",
			(yield* go(() => challengeOf("abc"))) === "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0",
		);

		// 4. A code row with another state, on the ledger, ends the sign-in; the app refuses one too.
		answer.set("b4", "ignore");
		const b4 = startBox(where, {id: "b4", agent: false});
		yield* go(() => until(b4, "url"));
		yield* go(async () => {
			for (let i = 0; i < 100 && app.catchers.get("b4")?.state == null; i++) await sleep(20);
		});
		const port4 = app.catchers.get("b4")?.port ?? 0;
		const appRefused = yield* go(() =>
			fetch(`http://127.0.0.1:${port4}/auth/callback?code=fake_code_x&state=forged`).then(
				(r) => r.status,
			),
		);
		yield* toBox(
			"b4",
			{kind: "code", state: "forged", code: "fake_code_forged", client: null},
			"forged-b4",
		);
		const e4 = yield* go(() => endedOf(b4));
		check(
			"a forged code with another state: the app refuses it, the box ends",
			appRefused === 400 && e4.why === "state_mismatch",
			{
				app: appRefused,
				box: e4.why,
			},
		);

		// 5. The person says no.
		fake.decide(["deny"]);
		const b5 = startBox(where, {id: "b5", agent: false});
		const e5 = yield* go(() => endedOf(b5));
		check("the person says no: denied", e5.why === "denied", e5);

		// 6. Nobody answers.
		answer.set("b6", "ignore");
		const b6 = startBox(where, {id: "b6", waitMs: 1500, agent: false});
		const e6 = yield* go(() => endedOf(b6));
		check("nobody answers: timed out", e6.why === "timed_out", e6);

		// 7. Two boxes at once, each its own sign-in: two clients, two refresh chains, two ports.
		const clientsBefore = new Set(fake.clients);
		const b7 = startBox(where, {id: "b7", holdMs: 2500, agent: false});
		const b8 = startBox(where, {id: "b8", holdMs: 2500, agent: false});
		const [e7, e8] = yield* go(() => Promise.all([endedOf(b7), endedOf(b8)]));
		const newClients = [...fake.clients].filter((c) => !clientsBefore.has(c));
		const ports = sayLog
			.filter((l) => /"catcher","box":"b[78]"/.test(l))
			.map((l) => JSON.parse(l).port);
		check(
			"two boxes at once: both sign in, on two new clients and two ports",
			e7.why === "done" &&
				e8.why === "done" &&
				newClients.length === 2 &&
				new Set(ports).size === 2,
			{
				clients: newClients.length,
				ports,
			},
		);

		// 8. A saved client: the docs say reuse the issued id. Two boxes on it still hold two passes.
		const saved = newClients[0] ?? "";
		const b9 = startBox(where, {id: "b9", holdMs: 3000, client: saved, agent: false});
		const b10 = startBox(where, {id: "b10", holdMs: 3000, client: saved, agent: false});
		const [e9, e10] = yield* go(() => Promise.all([endedOf(b9), endedOf(b10)]));
		const reuse = fake.seen.authorize.slice(-2);
		check(
			"a saved client: no new client, no name hint, two passes that do not spoil each other",
			e9.why === "done" &&
				e10.why === "done" &&
				reuse.every((p) => p.client_id === saved && p.agent_name_hint === undefined) &&
				b9.events.filter((e) => e.ev === "refreshed").length >= 1 &&
				b10.events.filter((e) => e.ev === "refreshed").length >= 1,
			{refreshes: [b9, b10].map((b) => b.events.filter((e) => e.ev === "refreshed").length)},
		);

		// 9. The phone: the callback lands nowhere; the person pastes its URL into the app.
		answer.set("b11", "phone");
		const b11 = startBox(where, {id: "b11", agent: false});
		yield* go(() => until(b11, "url"));
		const cb = yield* go(async () => {
			for (let i = 0; i < 200 && !pasted.has("b11"); i++) await sleep(20);
			return pasted.get("b11") ?? "";
		});
		const tampered = cb.replace(/state=[^&]+/, "state=other");
		const refusedPaste = yield* go(() => app.paste("b11", tampered));
		const okPaste = yield* go(() => app.paste("b11", cb));
		const e11 = yield* go(() => endedOf(b11));
		check(
			"a phone: the pasted callback signs the box in; a tampered one is refused",
			okPaste === "sent" && refusedPaste === "state mismatch" && e11.why === "done",
			{
				tampered: refusedPaste,
				pasted: okPaste,
				ended: e11.why,
			},
		);

		// 10. Told to end while it holds the pass.
		const b12 = startBox(where, {id: "b12", holdMs: 20_000, agent: false});
		yield* go(() => until(b12, "signed"));
		const rt12Before = new Set(fake.issued().refresh);
		yield* toBox("b12", {kind: "end"}, "end-b12");
		const e12 = yield* go(() => endedOf(b12));
		check(
			"told to end: it revokes and forgets at once",
			e12.why === "done" && e12.revoked === true,
			{
				ended: e12,
				liveAfter: [...rt12Before].filter((rt) => fake.live(rt)).length,
			},
		);

		// 11. Killed while it holds the pass: the memory is gone, the refresh token is not revoked.
		const b13 = startBox(where, {id: "b13", holdMs: 20_000, agent: false});
		yield* go(() => until(b13, "signed"));
		const before13 = new Set(fake.issued().refresh);
		const liveBefore = [...before13].filter((rt) => fake.live(rt));
		if (kind === "docker")
			execFileSync("docker", ["kill", "--signal", "KILL", `exp154-b13-${stamp.slice(-9, -1)}`]);
		else b13.proc.kill("SIGKILL");
		yield* go(() => b13.exited);
		yield* go(() => sleep(300));
		// A finding, not a pass or a fail: the pass dies with the box, the grant at the server does not.
		check(
			"finding: killed, no forget runs, and its last refresh token stays live at the server",
			true,
			{
				liveAfterKill: liveBefore.filter((rt) => fake.live(rt)).length,
			},
		);

		// 12. A grant without the plan scope is not kept.
		fake.grant("openid profile email offline_access");
		const before14 = new Set(fake.issued().refresh);
		const b14 = startBox(where, {id: "b14", agent: false});
		const e14 = yield* go(() => endedOf(b14));
		fake.grant(SIWC.scope);
		const got14 = fake.issued().refresh.filter((rt) => !before14.has(rt));
		check(
			"a grant without chatgpt.tokens.use.direct is not kept, and is revoked at once",
			e14.why === "no_scope" && got14.length === 1 && got14.every((rt) => !fake.live(rt)),
			{ended: e14.why, issued: got14.length, liveAfter: got14.filter((rt) => fake.live(rt)).length},
		);

		// 13. 1455 taken (the Codex CLI's port): the app takes another, and the sign-in still works.
		const blocker = createServer();
		const blocked = yield* go(
			() =>
				new Promise<boolean>((r) =>
					blocker.once("error", () => r(false)).listen(SIWC.port, "127.0.0.1", () => r(true)),
				),
		);
		const b15 = startBox(where, {id: "b15", agent: false});
		const e15 = yield* go(() => endedOf(b15));
		blocker.close();
		check(
			"port 1455 taken: another loopback port, signed in",
			e15.why === "done" && sayLog.some((l) => l.includes("port_taken")),
			{
				heldByUs: blocked,
			},
		);

		// 14. The control: the probe must find a pass where one can be read, or its "none" means nothing.
		// In Docker the agent's commands run as root, the box's own user; on a Mac a pass-shaped
		// string is planted in the agent's folder.
		const b16 = startBox(where, {id: "b16", holdMs: 1500, control: true});
		const e16 = yield* go(() => endedOf(b16));
		const agent16 = (b16.events.find((e) => e.ev === "agent") ?? {}) as {
			found?: {found?: Record<string, unknown[]>};
		};
		const hits16 = agent16.found?.found?.access ?? [];
		check(
			"control: the probe finds a pass when it may read one",
			e16.why === "done" && hits16.length > 0,
			{
				as: kind === "docker" ? "root, the box's user: its memory" : "a planted file",
				access: hits16.length,
				// Way (a)'s cost: whoever reads the box's memory finds the renewal key too.
				refresh: (agent16.found?.found?.refresh ?? []).length,
			},
		);

		// ------------------------------------------------ where the renewal key lives: ways (b) and (c)
		// Way (a) is cases 1 to 14: the box holds a refresh token in memory and revokes it at the end.

		// 15. Way (b): no offline_access. No refresh token is issued; when the pass runs out the person
		// is asked again, on the client the first round was issued.
		const rtBefore15 = new Set(fake.issued().refresh);
		const atBefore15 = new Set(fake.issued().access);
		const clientsBefore15 = new Set(fake.clients);
		const b17 = startBox(where, {id: "b17", holdMs: 5000, renew: "ask", agent: false});
		const e17 = yield* go(() => endedOf(b17));
		const signed17 = b17.events.filter((e) => e.ev === "signed");
		const opened17 = sayLog.filter((l) => l.includes('"ev":"opened","box":"b17"')).length;
		const passes17 = fake.issued().access.filter((at) => !atBefore15.has(at));
		const answer17 = b17.events.find((e) => e.ev === "answer") ?? {};
		check(
			"way (b): no refresh token at all; the person is asked again when the pass runs out",
			e17.why === "done" &&
				answer17.text === "Hi there" &&
				signed17.length >= 2 &&
				signed17.every((e) => e.renewal === false) &&
				fake.issued().refresh.every((rt) => rtBefore15.has(rt)) &&
				[...fake.clients].filter((c) => !clientsBefore15.has(c)).length === 1,
			{
				signIns: signed17.length,
				clicks: opened17,
				refreshTokens: fake.issued().refresh.filter((rt) => !rtBefore15.has(rt)).length,
				newClients: [...fake.clients].filter((c) => !clientsBefore15.has(c)).length,
				ended: e17,
			},
		);
		check(
			"finding, way (b): at the end nothing is revoked; the last pass lives out its life",
			true,
			{
				lastPassLiveAfterEnd: passes17.length > 0 && fake.passLive(passes17.at(-1) ?? ""),
			},
		);

		// 16. Way (c): the person's app signs in once, keeps the refresh token on its own machine, and
		// lends each box one sealed pass at a time. Two boxes, several renewals, one click.
		const lenderLog: string[] = [];
		const lender = yield* runLender({
			who: "c",
			auth,
			open: (url) => fakeBrowser(url),
			marginMs: SIWC.marginMs,
			agentName: "fabrika",
			say: (e) => {
				lenderLog.push(JSON.stringify(e));
				sayLog.push(JSON.stringify(e));
			},
		});
		const rtBefore16 = new Set(fake.issued().refresh);
		const b18 = startBox(where, {id: "b18", who: "c", passFrom: "app", holdMs: 5000});
		const b19 = startBox(where, {id: "b19", who: "c", passFrom: "app", holdMs: 5000, agent: false});
		const [e18, e19] = yield* go(() => Promise.all([endedOf(b18), endedOf(b19)]));
		const lentTo = (b: Started) => b.events.filter((e) => e.ev === "lent").length;
		const agent18 = (b18.events.find((e) => e.ev === "agent") ?? {}) as {
			found?: {found?: Record<string, unknown[]>};
		};
		// On a Mac the probe walks the whole run's folder, so case 14's planted file is not this box's.
		const notPlanted = (hits: unknown[] | undefined) =>
			(hits ?? []).filter((h) => !String((h as {where?: unknown}).where).includes("planted.txt"));
		const raw18 = agent18.found?.found ?? {};
		const hits18 = {access: notPlanted(raw18.access), refresh: notPlanted(raw18.refresh)};
		check(
			"way (c): one sign-in on the person's machine lends two boxes passes across expiry",
			e18.why === "done" &&
				e19.why === "done" &&
				[b18, b19].every((b) => b.events.find((e) => e.ev === "answer")?.text === "Hi there") &&
				lender.count.signIns === 1 &&
				lender.count.refreshes >= 1 &&
				lentTo(b18) >= 2 &&
				lentTo(b19) >= 2,
			{lender: lender.count, lentTo: {b18: lentTo(b18), b19: lentTo(b19)}},
		);
		check(
			"way (c): the agent's commands find no pass and no refresh token",
			(hits18.access ?? []).length === 0 && (hits18.refresh ?? []).length === 0,
			{hits: hits18, looked: (agent18.found as {looked?: unknown} | undefined)?.looked ?? null},
		);
		const rows16 = yield* ledger.read(0, 100_000).pipe(Effect.orDie);
		const passRows = rows16.filter((r) => r.kind === "pass");
		check(
			"way (c): the ledger carries only sealed passes, and no refresh token ever reaches a box",
			passRows.length >= 4 &&
				lender.lentPasses.every((at) => !rows16.some((r) => r.data.includes(at))) &&
				fake
					.issued()
					.refresh.filter((rt) => !rtBefore16.has(rt))
					.every((rt) => ![b18, b19].some((b) => JSON.stringify(b.events).includes(rt))),
			{sealedRows: passRows.length},
		);
		const lastLent = lender.lentPasses.at(-1) ?? "";
		const liveAfterEnd = fake.passLive(lastLent);
		const revoked16 = yield* go(() => lender.revoke());
		check(
			"way (c): a box's end leaves its last pass live; the person's revoke kills every pass lent",
			revoked16 && lender.lentPasses.every((at) => !fake.passLive(at)),
			{
				lastPassLiveAfterBoxEnd: liveAfterEnd,
				revoked: revoked16,
				liveAfterRevoke: lender.lentPasses.filter((at) => fake.passLive(at)).length,
			},
		);
		const sealing = yield* go(async () => {
			const a = await makeKeys();
			const b = await makeKeys();
			const sealed = await seal(a.publicKey, "fake_at_x", "b18/0");
			const opens = async (k: typeof a, about: string) =>
				k.open(sealed, about).then(
					() => true,
					() => false,
				);
			return {
				own: await opens(a, "b18/0"),
				otherBox: await opens(b, "b18/0"),
				otherTurn: await opens(a, "b18/1"),
			};
		});
		check(
			"way (c): a sealed pass opens only in its own box, for its own turn",
			sealing.own && !sealing.otherBox && !sealing.otherTurn,
			sealing,
		);

		// 17. Way (c)'s control: the agent as the box's own user (Docker: root) reads the box's memory.
		// It may find the lent pass; it must not find a refresh token, since none was ever there.
		const rtNow = new Set(fake.issued().refresh);
		const lender2 = yield* runLender({
			who: "d",
			auth,
			open: (url) => fakeBrowser(url),
			marginMs: SIWC.marginMs,
			agentName: "fabrika",
			say: (e) => sayLog.push(JSON.stringify(e)),
		});
		const b20 = startBox(where, {
			id: "b20",
			who: "d",
			passFrom: "app",
			holdMs: 1500,
			control: true,
		});
		const e20 = yield* go(() => endedOf(b20));
		const agent20 = (b20.events.find((e) => e.ev === "agent") ?? {}) as {
			found?: {found?: Record<string, unknown[]>};
		};
		const hits20 = agent20.found?.found ?? {};
		const lenderRt = lender2.refreshNow();
		check(
			"way (c) control: the box's own user may find the pass, never a refresh token",
			e20.why === "done" && (hits20.access ?? []).length > 0 && (hits20.refresh ?? []).length === 0,
			{
				as: kind === "docker" ? "root, the box's user: its memory" : "a planted file",
				access: (hits20.access ?? []).length,
				refresh: (hits20.refresh ?? []).length,
				lenderHoldsOne: lenderRt !== null && !rtNow.has(lenderRt),
			},
		);
		yield* go(() => lender2.revoke());

		// The leak search, over everything this run made.
		yield* go(() => sleep(300));
		const rows = yield* ledger.read(0, 100_000).pipe(Effect.orDie);
		const rowText = rows.map((r) => `${r.stream} ${r.kind} ${r.data}`).join("\n");
		const issued = fake.issued();
		const leaks = leakSearch(
			{
				access: issued.access,
				refresh: issued.refresh,
				verifier: issued.verifiers.filter((v) => v.length === 43 && !/^x+$/.test(v)),
				code: issued.codes,
			},
			rowText,
			sayLog.join("\n"),
		);
		const tokenHits = {
			access: leaks.hits.access ?? {},
			refresh: leaks.hits.refresh ?? {},
			verifier: leaks.hits.verifier ?? {},
		};
		check(
			"no pass, refresh token or verifier in ledger rows, logs or any file of the run",
			Object.values(tokenHits).every((h) => Object.keys(h).length === 0),
			{
				placesSearched: leaks.places,
				files: leaks.files,
				tokenHits,
				codesFoundIn: leaks.hits.code ?? {},
			},
		);
		const ledgerRows = rows.filter((r) => r.stream.startsWith("signin/")).length;
		results.counts = {...fake.count, refused: fake.count.refused.length, ledgerRows, machine};
		return results;
	}).pipe(
		Effect.scoped,
		Effect.provide(layerLocal({persist: join(runDir, "ledger"), ledger: LEDGER})),
	);

// ---------------------------------------------------------------- the live runner

/**
 * A real sign-in, with a person at the laptop. Prints only: the URL was opened, the pass's length,
 * expires_in, the scopes, one answer's short text and token counts, and "forgotten".
 */
const liveRun = (where: "local" | "remote", way: "a" | "b" | "c") =>
	Effect.gen(function* () {
		mkdirSync(logs, {recursive: true});
		const local = yield* LocalLedger;
		// The revocation endpoint, from OpenAI's discovery document, as its docs say.
		const discovery = yield* Effect.promise(() =>
			fetch("https://auth.openai.com/.well-known/openid-configuration").then(
				(r) => r.json() as Promise<{revocation_endpoint?: string}>,
				() => ({}) as {revocation_endpoint?: string},
			),
		);
		const auth: Auth = {...openai, revoke: discovery.revocation_endpoint ?? null};
		const say = (e: Record<string, unknown>) => {
			if (e.ev === "opened") process.stdout.write("the sign-in URL was opened in your browser\n");
			if (e.ev === "port_taken")
				process.stdout.write("port 1455 is taken; another loopback port is used\n");
		};
		const openUrl = async (url: string) => {
			execFileSync("open", [url]);
		};
		const lender =
			way === "c"
				? yield* runLender({
						who: WHO,
						auth,
						open: openUrl,
						marginMs: SIWC.marginMs,
						agentName: "fabrika",
						say,
					})
				: null;
		if (lender === null) yield* runApp({who: WHO, authorize: auth.authorize, say, open: openUrl});
		const b = startBox(
			{
				kind: where === "local" ? "process" : "docker",
				ledgerUrl: local.url,
				ledgerToken: Redacted.value(local.token),
				auth,
				authInBox: auth,
				ledgerUrlInBox: local.url.replace("127.0.0.1", "host.docker.internal"),
			},
			{
				id: `live-${stamp.slice(-9, -1)}`,
				waitMs: 300_000,
				agent: false,
				...(way === "b" ? {renew: "ask" as const} : {}),
				...(way === "c" ? {passFrom: "app" as const} : {}),
			},
		);
		const e = yield* Effect.promise(() => endedOf(b, 360_000));
		const s = b.events.find((x) => x.ev === "signed" || x.ev === "lent") as
			| {length?: number; expires_in?: number; scopes?: unknown; renewal?: boolean}
			| undefined;
		if (s !== undefined) {
			process.stdout.write(`pass length: ${s.length}\nexpires_in: ${s.expires_in}\n`);
			if (s.scopes !== undefined) process.stdout.write(`scopes: ${JSON.stringify(s.scopes)}\n`);
			if (s.renewal !== undefined) process.stdout.write(`refresh token given: ${s.renewal}\n`);
		}
		const a = b.events.find((x) => x.ev === "answer") as Record<string, unknown> | undefined;
		if (a !== undefined)
			process.stdout.write(
				a.error === undefined
					? `answer: ${JSON.stringify(a.text)} (input ${a.input_tokens}, output ${a.output_tokens} tokens)\n`
					: `answer failed: ${a.error}\n`,
			);
		const f = b.events.find((x) => x.ev === "forgotten") as {revoked?: boolean} | undefined;
		// Way (c): the box held no renewal key; the person's app revokes its own session at the end.
		const revoked =
			lender === null ? (f?.revoked ?? false) : yield* Effect.promise(() => lender.revoke());
		process.stdout.write(
			f === undefined
				? `the box ended: ${e.why}\n`
				: `forgotten (revoked: ${revoked}, ended: ${e.why})\n`,
		);
	}).pipe(
		Effect.scoped,
		Effect.provide(layerLocal({persist: join(runDir, "ledger"), ledger: LEDGER})),
	);

// ---------------------------------------------------------------- main

const main = async () => {
	for (const k of ["TYPESAFE_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY"]) delete process.env[k];
	if (mode === "live") {
		const where = process.argv.includes("--remote") ? "remote" : "local";
		const at = process.argv.indexOf("--way");
		const way = at > 0 ? process.argv[at + 1] : "a";
		if (way !== "a" && way !== "b" && way !== "c") throw new Error("--way a, b or c");
		await Effect.runPromise(liveRun(where, way));
		return;
	}
	if (mode !== "fake" && mode !== "docker")
		throw new Error("fake, docker, or live --local|--remote");
	const t0 = Date.now();
	const results = await Effect.runPromise(fakeRun(mode === "docker" ? "docker" : "process"));
	const took = Date.now() - t0;
	const failed = Object.entries(results).filter(
		([, v]) => typeof v === "object" && v !== null && "ok" in v && !(v as {ok: boolean}).ok,
	);
	const file = join(
		root,
		"experiments",
		"results",
		`154-sign-in-remote${mode === "docker" ? "-docker" : ""}.json`,
	);
	writeFileSync(
		file,
		`${JSON.stringify({mode, when: new Date().toISOString().slice(0, 10), tookMs: took, results}, null, "\t")}\n`,
	);
	print(
		`${failed.length === 0 ? "all passed" : `${failed.length} FAILED`} in ${(took / 1000).toFixed(1)} s; ${relative(root, file)}`,
	);
	process.exit(failed.length === 0 ? 0 : 1);
};

await main();
