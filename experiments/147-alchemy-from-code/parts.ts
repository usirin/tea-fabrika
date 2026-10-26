// Experiment 147's parts, loaded by `run.ts` once the working folder is in place (see there).
// Each part calls Alchemy's engine as a library from this one running program: `deploy`,
// `destroy`, and `evalStack` with `Plan` and `Apply` for the guard. Results, with every path,
// address and account id scrubbed, go to experiments/results/147-alchemy-from-code.json, one
// entry per part.
import {execFileSync} from "node:child_process";
import {createHash, randomBytes} from "node:crypto";
import {existsSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Alchemy from "alchemy";
import {AlchemyContextLive} from "alchemy/AlchemyContext";
import * as Apply from "alchemy/Apply";
import {ArtifactStore, createArtifactStore} from "alchemy/Artifacts";
import {deploy} from "alchemy/Deploy";
import {destroy} from "alchemy/Destroy";
import * as Drift from "alchemy/Drift";
import * as Interaction from "alchemy/Interaction";
import * as Plan from "alchemy/Plan";
import {evalStack} from "alchemy/Stack";
import {ConfigProvider, Effect, Exit, Layer, Scope} from "effect";
import {hostStack} from "./host.ts";
import {ledgerStack} from "./ledger.ts";
import {watch} from "./net-watch.ts";

const here = dirname(fileURLToPath(import.meta.url));
const resultsFile = join(here, "..", "results", "147-alchemy-from-code.json");
const part = process.argv[2] ?? "host";
const work = process.env.EXP_WORK_DIR ?? process.cwd();
const importAlchemyMs = Number(process.env.EXP_IMPORT_ALCHEMY_MS ?? "0");

// Read once, kept in this process only: used to scrub results and to list leftovers.
const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const token = process.env.CLOUDFLARE_API_TOKEN ?? "";

const scrub = (s: string) => {
	let out = s.split(`/private${work}`).join("<work>").split(work).join("<work>");
	if (account) out = out.split(account).join("<account>");
	return out.replace(/[a-z0-9.-]+\.workers\.dev/g, "<workers.dev>");
};

const now = () => performance.now();
const ms = (t: number) => Math.round(now() - t);

/**
 * What `deploy` asks of its caller, by its type: AlchemyContext, ArtifactStore, FileSystem,
 * Interaction, Path and State. `deploy` builds the rest itself (platform, HTTP client, profiles,
 * credentials store) inside `evalStack`. No telemetry layer, no version check, no CLI renderer.
 */
const engine = Layer.mergeAll(
	AlchemyContextLive,
	Layer.succeed(ArtifactStore, createArtifactStore()),
	Interaction.layerNonInteractive(),
	Alchemy.localState(),
).pipe(Layer.provideMerge(NodeServices.layer));

type Step = {step: string; ms: number; [k: string]: unknown};
const steps: Step[] = [];
const record = (step: string, t: number, extra: Record<string, unknown> = {}) => {
	const row = {step, ms: ms(t), ...extra};
	steps.push(row);
	console.log(scrub(JSON.stringify(row)));
};

type Engine = Layer.Success<typeof engine>;

/** Run one Effect from the already-running program, and time it. */
const timed = async <A, E = unknown>(
	step: string,
	eff: Effect.Effect<A, E, Engine>,
	extra: (a: A) => Record<string, unknown>,
) => {
	const t = now();
	const a = await Effect.runPromise(eff.pipe(Effect.provide(engine)));
	record(step, t, extra(a));
	return a;
};

const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

const save = (entry: Record<string, unknown>) => {
	const all: Record<string, unknown> = existsSync(resultsFile)
		? JSON.parse(readFileSync(resultsFile, "utf8"))
		: {};
	all[part] = JSON.parse(scrub(JSON.stringify(entry)));
	writeFileSync(resultsFile, `${JSON.stringify(all, null, "\t")}\n`);
};

// ---- part 1: our own resource, Fabrika.Host ------------------------------------------------
type HostOut = {pid: number; reloads: number};
const hostPart = async () => {
	const home = join(work, "host");
	const stage = "s147";
	const s = (programs: string[], ledger: "memory" | "local") => hostStack({home, programs, ledger});
	const pid = (o: HostOut) => ({pid: o.pid, reloads: o.reloads});

	const created = await timed<HostOut>(
		"create (first call)",
		deploy({stack: s(["counter"], "memory"), stage}),
		pid,
	);
	await timed<HostOut>("same inputs", deploy({stack: s(["counter"], "memory"), stage}), pid);
	await timed<HostOut>(
		"programs changed",
		deploy({stack: s(["counter", "tsh"], "memory"), stage}),
		pid,
	);
	const replaced = await timed<HostOut>(
		"ledger changed",
		deploy({stack: s(["counter", "tsh"], "local"), stage}),
		(o) => ({...pid(o), oldAlive: alive(created.pid)}),
	);
	process.kill(replaced.pid, "SIGKILL");
	await new Promise((r) => setTimeout(r, 100));
	await timed<HostOut>(
		"SIGKILL, then deploy",
		deploy({stack: s(["counter", "tsh"], "local"), stage}),
		(o) => ({
			...pid(o),
			alive: alive(o.pid),
		}),
	);
	await timed<unknown>(
		"drift repair, from code",
		evalStack(s(["counter", "tsh"], "local"), (st) => Drift.repair(st), {stage}),
		(r) => ({result: r}),
	);
	await timed<unknown>(
		"destroy",
		destroy({stack: s(["counter", "tsh"], "local"), stage}),
		() => ({}),
	);

	// Warm: the same process, five more rounds of create, same inputs, update, destroy.
	for (let round = 1; round <= 5; round++) {
		await timed<HostOut>(
			`warm ${round}: create`,
			deploy({stack: s(["counter"], "memory"), stage}),
			pid,
		);
		await timed<HostOut>(
			`warm ${round}: same inputs`,
			deploy({stack: s(["counter"], "memory"), stage}),
			pid,
		);
		await timed<HostOut>(
			`warm ${round}: programs changed`,
			deploy({stack: s(["counter", "tsh"], "memory"), stage}),
			pid,
		);
		await timed<unknown>(
			`warm ${round}: destroy`,
			destroy({stack: s(["counter", "tsh"], "memory"), stage}),
			() => ({}),
		);
	}
	save({importAlchemyMs, steps, net: watch.hosts()});
};

// ---- part 4a: does a host outlive the process that deployed it? ------------------------------
// host-up deploys and exits; host-down, a new process on the same EXP_WORK, finds and stops it.
const hostUp = async () => {
	const out = await timed<HostOut>(
		"create, then this process exits",
		deploy({
			stack: hostStack({home: join(work, "host"), programs: ["counter"], ledger: "memory"}),
			stage: "s147",
		}),
		(o) => ({pid: o.pid}),
	);
	writeFileSync(join(work, "up.pid"), String(out.pid));
	save({steps});
};
const hostDown = async () => {
	const pid = Number(readFileSync(join(work, "up.pid"), "utf8"));
	const before = alive(pid);
	const stack = hostStack({home: join(work, "host"), programs: ["counter"], ledger: "memory"});
	await timed<HostOut>("same inputs, from a new process", deploy({stack, stage: "s147"}), (o) => ({
		pid: o.pid,
		samePid: o.pid === pid,
	}));
	await timed<unknown>("destroy, from a new process", destroy({stack, stage: "s147"}), () => ({}));
	save({pid, aliveAfterDeployerExited: before, aliveAfterDestroy: alive(pid), steps});
};

// ---- the ledger server: one function, two places --------------------------------------------
const hashOf = (key: string) => createHash("sha256").update(key).digest("hex");
type LedgerStack = ReturnType<typeof ledgerStack>;

/** The one switch: "local" runs in workerd here with no account, "cloud" deploys to Cloudflare. */
const ledgerDeploy = (where: "local" | "cloud", stack: LedgerStack, scope?: Scope.Scope) =>
	deploy({
		stack,
		stage: where,
		dev: where === "local",
		...(scope === undefined ? {} : {scope}),
	});
const ledgerDestroy = (where: "local" | "cloud", stack: LedgerStack) =>
	destroy({stack, stage: where, dev: where === "local"});

/** One call on the ledger's plain HTTP face. Retries while a new address comes up. */
const call = async (
	url: string | undefined,
	key: string,
	method: string,
	args: unknown[],
	tries = 1,
) => {
	if (url === undefined) return {status: 0, body: "no address"};
	for (let i = 1; ; i++) {
		try {
			const res = await fetch(`${url}/${key}/exp147/${method}`, {
				method: "POST",
				body: JSON.stringify(args),
			});
			if (res.ok || i >= tries)
				return {status: res.status, body: await res.json().catch(() => null)};
		} catch (e) {
			if (i >= tries) return {status: 0, body: String(e)};
		}
		await new Promise((r) => setTimeout(r, 1000));
	}
};
const registered = (r: {status: number; body: unknown}) => {
	const b = r.body as {created?: boolean} | null;
	return {status: r.status, created: b?.created ?? null};
};

/** The connections of this process's children (workerd, the bundler), seen by lsof. */
const childSockets = () => {
	const kids = (pid: number): number[] => {
		try {
			const out = execFileSync("pgrep", ["-P", String(pid)], {encoding: "utf8"});
			const direct = out.split("\n").filter(Boolean).map(Number);
			return direct.flatMap((p) => [p, ...kids(p)]);
		} catch {
			return [];
		}
	};
	const pids = kids(process.pid);
	if (pids.length === 0) return {pids: 0, remote: []};
	try {
		const out = execFileSync("lsof", ["-nP", "-a", "-i", "-p", pids.join(",")], {encoding: "utf8"});
		const remote = out
			.split("\n")
			.filter((l) => l.includes("->"))
			.map((l) => l.split("->")[1]?.split(" ")[0] ?? "");
		return {pids: pids.length, remote: [...new Set(remote)]};
	} catch {
		return {pids: pids.length, remote: []};
	}
};

// ---- part 2a and 3b: the ledger server in workerd, no Cloudflare credentials at all ---------
const devPart = async () => {
	for (const k of Object.keys(process.env)) if (k.startsWith("CLOUDFLARE_")) delete process.env[k];
	const key = randomBytes(16).toString("hex");
	const stack = ledgerStack({name: "tf-exp-147-ledger", keyHash: hashOf(key), retain: false});
	const facts: Record<string, unknown> = {
		cloudflareEnv: Object.keys(process.env).filter((k) => k.startsWith("CLOUDFLARE_")),
	};

	// Without a scope of ours: does the local Worker still answer after deploy returns?
	const a = await timed<{url: string | undefined}>(
		"dev deploy, no scope (first call)",
		ledgerDeploy("local", stack),
		() => ({}),
	);
	facts.noScopeAfterReturn = registered(await call(a.url, key, "register", ["triage", "exp147"]));
	await timed<unknown>("dev destroy", ledgerDestroy("local", stack), () => ({}));

	// With a scope of ours: workerd lives until we close it.
	const scope = Effect.runSync(Scope.make());
	const b = await timed<{url: string | undefined}>(
		"dev deploy, our scope",
		ledgerDeploy("local", stack, scope),
		() => ({}),
	);
	facts.first = registered(await call(b.url, key, "register", ["triage", "exp147"]));
	facts.again = registered(await call(b.url, key, "register", ["triage", "exp147"]));
	facts.childSockets = childSockets();
	await timed<unknown>(
		"dev same inputs, our scope",
		ledgerDeploy("local", stack, scope),
		() => ({}),
	);
	facts.afterRedeploy = registered(await call(b.url, key, "register", ["triage", "exp147"]));
	await Effect.runPromise(Scope.close(scope, Exit.void));
	facts.afterScopeClosed = registered(await call(b.url, key, "register", ["triage", "exp147"]));
	await timed<unknown>("dev destroy", ledgerDestroy("local", stack), () => ({}));

	// Warm: three more rounds in the same process.
	for (let round = 1; round <= 3; round++) {
		const s = Effect.runSync(Scope.make());
		const t0 = now();
		const c = await timed<{url: string | undefined}>(
			`warm ${round}: dev deploy`,
			ledgerDeploy("local", stack, s),
			() => ({}),
		);
		// `created: false` here means the row from before the last destroy is still there.
		const r = registered(await call(c.url, key, "register", ["triage", `round${round}`], 10));
		record(`warm ${round}: deploy to first answer`, t0, {answered: r});
		await timed<unknown>(
			`warm ${round}: dev same inputs`,
			ledgerDeploy("local", stack, s),
			() => ({}),
		);
		await Effect.runPromise(Scope.close(s, Exit.void));
		await timed<unknown>(`warm ${round}: dev destroy`, ledgerDestroy("local", stack), () => ({}));
	}
	// A rename in workerd, retain off: on Cloudflare this is a replace that drops the storage.
	const s1 = Effect.runSync(Scope.make());
	await timed<unknown>(
		"dev deploy, before the rename",
		ledgerDeploy("local", stack, s1),
		() => ({}),
	);
	const renamed = ledgerStack({
		name: "tf-exp-147-ledger-renamed",
		keyHash: hashOf(key),
		retain: false,
	});
	const plan = await Effect.runPromise(
		evalStack(
			renamed,
			(compiled) => Effect.map(Plan.make(compiled), (p) => Plan.describePlan(p).resources),
			{stage: "local", dev: true},
		).pipe(Effect.provide(engine)),
	);
	facts.localRenamePlan = plan.map((r) => `${r.logicalId}: ${r.action}`);
	const d = await timed<{url: string | undefined}>(
		"dev rename (retain off)",
		ledgerDeploy("local", renamed, s1),
		() => ({}),
	);
	facts.localRenameKeptRow = registered(
		await call(d.url, key, "register", ["triage", "exp147"], 10),
	);
	await Effect.runPromise(Scope.close(s1, Exit.void));
	await timed<unknown>("dev destroy", ledgerDestroy("local", renamed), () => ({}));

	facts.net = watch.hosts();
	facts.anyCloudflare = watch.hosts().some((h) => h.includes("cloudflare"));
	save({importAlchemyMs, facts, steps});
};

// ---- Cloudflare's own API, for the listing that confirms cleanup -----------------------------
const PREFIX = "tf-exp-147-";
const cf = async (path: string, method = "GET") => {
	const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
		method,
		headers: {authorization: `Bearer ${token}`},
	});
	return (await res.json()) as {success: boolean; result: unknown};
};
const ours = async () => {
	const scripts = ((await cf("/workers/scripts")).result as {id: string}[]).map((s) => s.id);
	const spaces = (await cf("/workers/durable_objects/namespaces?per_page=1000")).result as {
		id: string;
		script: string | null;
		name: string;
	}[];
	return {
		scripts: scripts.filter((s) => s.startsWith(PREFIX)),
		namespaces: spaces
			.filter((n) => (n.script ?? n.name ?? "").startsWith(PREFIX))
			.map((n) => `${n.script ?? "(no script)"} / ${n.name}`),
		otherScripts: scripts.filter((s) => !s.startsWith(PREFIX)).length,
		otherNamespaces: spaces.filter((n) => !(n.script ?? n.name ?? "").startsWith(PREFIX)).length,
	};
};
/** Delete by hand what Alchemy forgot (a retained Worker), found by listing, by prefix only. */
const sweep = async () => {
	const found = await ours();
	for (const s of found.scripts) {
		if (!s.startsWith(PREFIX)) continue;
		const r = await cf(`/workers/scripts/${s}?force=true`, "DELETE");
		console.log(`swept ${s}: ${r.success}`);
	}
	return found.scripts;
};

/**
 * The guard: plan first, look at the plan, apply only if it neither replaces nor deletes the
 * ledger's Worker. Built from `evalStack`, `Plan.make` and `Apply.apply`, the three calls
 * `deploy` itself is made of (alchemy src/Deploy.ts).
 */
class LedgerAtRisk extends Error {}
const guardedDeploy = (stack: LedgerStack, stage: "local" | "cloud") =>
	evalStack(
		stack,
		(compiled) =>
			Effect.flatMap(Plan.make(compiled), (plan) => {
				const rows = Plan.describePlan(plan).resources;
				const risky = rows.filter(
					(r) =>
						r.resourceType === "Cloudflare.Worker" &&
						(r.action === "replace" || r.action === "delete" || r.action === "orphaned"),
				);
				return risky.length > 0
					? Effect.die(new LedgerAtRisk(risky.map((r) => `${r.logicalId}: ${r.action}`).join(", ")))
					: Apply.apply(plan);
			}),
		{stage, dev: stage === "local"},
	);

// ---- part 2b and the retain test: the same stack, live on Cloudflare -------------------------
const livePart = async () => {
	if (!account || !token)
		throw new Error("live needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN");
	// Credentials from code: take them out of the environment and hand them to the stack as a
	// ConfigProvider through its `secrets` option, so no env, no profile and no login is used.
	for (const k of Object.keys(process.env)) if (k.startsWith("CLOUDFLARE_")) delete process.env[k];
	const secrets = ConfigProvider.layer(
		Effect.map(ConfigProvider.ConfigProvider, (below) =>
			ConfigProvider.orElse(
				ConfigProvider.fromUnknown({CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account}),
				below,
			),
		),
	);
	const facts: Record<string, unknown> = {before: await ours()};
	const key1 = randomBytes(16).toString("hex");
	const key2 = randomBytes(16).toString("hex");
	const A = `${PREFIX}ledger-a`;
	const B = `${PREFIX}ledger-b`;
	const at = (name: string, key: string, retain: boolean) =>
		ledgerStack({name, keyHash: hashOf(key), retain, secrets});
	const urls: Record<string, string | undefined> = {};
	try {
		const a = await timed<{url: string | undefined}>(
			"live create (first call)",
			ledgerDeploy("cloud", at(A, key1, true)),
			() => ({}),
		);
		urls.a = a.url;
		facts.first = registered(await call(a.url, key1, "register", ["triage", "exp147"], 30));
		facts.again = registered(await call(a.url, key1, "register", ["triage", "exp147"]));
		await timed<unknown>("live same inputs", ledgerDeploy("cloud", at(A, key1, true)), () => ({}));
		await timed<unknown>(
			"live same inputs, again",
			ledgerDeploy("cloud", at(A, key1, true)),
			() => ({}),
		);
		await timed<unknown>(
			"live update (a new key hash binding)",
			ledgerDeploy("cloud", at(A, key2, true)),
			() => ({}),
		);
		facts.afterUpdate = registered(await call(a.url, key2, "register", ["triage", "exp147"], 15));

		// The guard reads the plan for a rename and refuses it before anything is applied.
		const t = now();
		const guarded = await Effect.runPromiseExit(
			guardedDeploy(at(B, key2, true), "cloud").pipe(Effect.provide(engine)),
		);
		record("guarded rename: plan, then refuse", t, {
			refused: Exit.isFailure(guarded) && String(guarded.cause).includes("Ledger: replace"),
		});
		facts.afterGuard = await ours();

		// Unguarded, with retain: the rename goes through.
		const b = await timed<{url: string | undefined}>(
			"live rename with retain (replace)",
			ledgerDeploy("cloud", at(B, key2, true)),
			() => ({}),
		);
		urls.b = b.url;
		facts.afterRename = await ours();
		facts.oldNameStillHolds = registered(
			await call(a.url, key2, "register", ["triage", "exp147"], 15),
		);
		facts.newNameStartsEmpty = registered(
			await call(b.url, key2, "register", ["triage", "exp147"], 30),
		);
		// Retain also skips the delete on `destroy`: Alchemy drops its row and B keeps running.
		await timed<unknown>(
			"live destroy, retain on",
			ledgerDestroy("cloud", at(B, key2, true)),
			() => ({}),
		);
		facts.afterRetainedDestroy = await ours();
		// No row, but the Worker is still there: does Alchemy refuse, adopt, or start over?
		const again = await Effect.runPromiseExit(
			ledgerDeploy("cloud", at(B, key2, false)).pipe(Effect.provide(engine)),
		);
		facts.redeployRetained = Exit.isSuccess(again) ? "ok" : String(again.cause).slice(0, 300);
		if (Exit.isFailure(again)) throw new Error("redeploy of a retained Worker failed");
		facts.retainedKeptRow = registered(
			await call(b.url, key2, "register", ["triage", "exp147"], 15),
		);
		await timed<unknown>(
			"live same inputs, retain off",
			ledgerDeploy("cloud", at(B, key2, false)),
			() => ({}),
		);
		await timed<unknown>(
			"live destroy, retain off",
			ledgerDestroy("cloud", at(B, key2, false)),
			() => ({}),
		);
		facts.afterDestroy = await ours();
	} finally {
		await Effect.runPromise(
			Effect.ignore(ledgerDestroy("cloud", at(B, key2, true)).pipe(Effect.provide(engine))),
		).catch(() => undefined);
		facts.swept = await sweep();
		facts.afterSweep = await ours();
		facts.net = watch.hosts().filter((h) => !h.includes("workers.dev"));
		save({importAlchemyMs, facts, steps});
		console.log(scrub(JSON.stringify(facts.afterSweep)));
	}
};

// ---- the CLI on the same stack, for the comparison ------------------------------------------
const cliLive = async () => {
	if (!account || !token)
		throw new Error("cli-live needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN");
	const bin = join(here, "node_modules", ".bin", "alchemy");
	const env = {
		...process.env,
		CI: "1",
		NO_COLOR: "1",
		EXP_KEY_HASH: hashOf(randomBytes(16).toString("hex")),
	};
	const cli = (step: string, args: string[]) => {
		const t = now();
		try {
			execFileSync(
				"nice",
				["-n", "15", bin, ...args, join(here, "cli.run.ts"), "--stage", "cloud"],
				{
					env,
					encoding: "utf8",
					stdio: "pipe",
				},
			);
		} catch (e) {
			const out = e as {stdout?: string; stderr?: string};
			throw new Error(
				scrub(`${step} failed:\n${out.stdout ?? ""}\n${out.stderr ?? ""}`).slice(-3000),
			);
		}
		record(step, t);
	};
	try {
		// Without --yes the CLI refuses in a non-interactive terminal, and changes nothing.
		cli("cli create", ["deploy", "--yes"]);
		cli("cli same inputs", ["deploy", "--yes"]);
		cli("cli same inputs, again", ["deploy", "--yes"]);
	} finally {
		cli("cli destroy", ["destroy", "--yes"]);
		await sweep();
		save({steps, afterSweep: await ours()});
		console.log(scrub(JSON.stringify(await ours())));
	}
};

const cleanPart = async () => {
	if (!account || !token)
		throw new Error("clean needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN");
	const swept = await sweep();
	const left = await ours();
	console.log(scrub(JSON.stringify({swept, left})));
};

const parts: Record<string, () => Promise<void>> = {
	host: hostPart,
	"host-up": hostUp,
	"host-down": hostDown,
	dev: devPart,
	live: livePart,
	"cli-live": cliLive,
	clean: cleanPart,
};
const run = parts[part];
if (!run) throw new Error(`no part ${part}: ${Object.keys(parts).join(", ")}`);
try {
	await run();
} finally {
	// Alchemy's state holds the account id and the address in plain text (experiment 144).
	if (!process.env.EXP_WORK || part === "host-down") rmSync(work, {recursive: true, force: true});
}
