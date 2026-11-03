// Experiment 199's live part: plan, then deploy the one-object stack, start one standard-4 box,
// let it run 181's sample and the suite under the beat, read its answers, destroy everything, and
// list what is left by the run's prefix. Loaded by the driver after it has moved into a fresh temp
// folder, so Alchemy's state (which holds the account id) never lands in the repo.
//
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node experiments/199-box-live-run.ts plan
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node experiments/199-box-live-run.ts live
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node experiments/199-box-live-run.ts sweep
//
// Results are written with the account id, the workers.dev address and the paths taken out.
import {randomBytes} from "node:crypto";
import {mkdirSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Alchemy from "alchemy";
import {AlchemyContextLive} from "alchemy/AlchemyContext";
import {ArtifactStore, createArtifactStore} from "alchemy/Artifacts";
import {deploy} from "alchemy/Deploy";
import {destroy} from "alchemy/Destroy";
import * as Interaction from "alchemy/Interaction";
import * as Plan from "alchemy/Plan";
import {evalStack} from "alchemy/Stack";
import {ConfigProvider, Effect, Layer} from "effect";
import {cloudOf} from "../148-remote-programs/cloud.ts";
import {buildWorker} from "./build.ts";
import {PREFIX, RUN_CAP_MS, stackOf} from "./stack.ts";

const mode = process.argv[2] ?? "";
const commit = process.env.COMMIT ?? "";
/** The box's sample set ("auto": ship121 if the OS sandbox starts, else lane139), the suite, and a
 * suffix for the results file. The first live run used ship121, all and none. */
const SET = process.env.SET ?? "ship121";
const SUITE = process.env.SUITE ?? "all";
const RUN = process.env.RUN ? `-${process.env.RUN}` : "";
const work = process.cwd();
const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const token = process.env.CLOUDFLARE_API_TOKEN ?? "";
if (!account || !token)
	throw new Error("live needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN");
// From here on the credentials live in this process's memory only. Nothing it starts (Alchemy's
// docker build) inherits them.
for (const k of Object.keys(process.env)) if (k.startsWith("CLOUDFLARE_")) delete process.env[k];

const {ours, sweep} = cloudOf(account, token, PREFIX);
const session = `sess-${randomBytes(16).toString("hex")}`;
const repoRoot = join(import.meta.dirname, "..", "..");
const scrub = (s: string) =>
	s
		.split(account)
		.join("<account>")
		.split(token)
		.join("<token>")
		.split(session)
		.join("<session>")
		.split(work)
		.join("<work>")
		.split(repoRoot)
		.join("<repo>")
		.split(process.env.HOME ?? "/nonexistent-home")
		.join("~")
		.replace(/[a-z0-9.-]+\.workers\.dev/g, "<workers.dev>");
const results: Record<string, unknown> = {date: new Date().toLocaleDateString("en-CA")};
const note = (k: string, v: unknown) => {
	results[k] = JSON.parse(scrub(JSON.stringify(v ?? null)));
	console.log(
		new Date().toISOString().slice(11, 19),
		k,
		scrub(JSON.stringify(v ?? null)).slice(0, 600),
	);
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const engine = Layer.mergeAll(
	AlchemyContextLive,
	Layer.succeed(ArtifactStore, createArtifactStore()),
	Interaction.layerNonInteractive(),
	Alchemy.localState(),
).pipe(Layer.provideMerge(NodeServices.layer));
const secrets = ConfigProvider.layer(
	Effect.map(ConfigProvider.ConfigProvider, (below) =>
		ConfigProvider.orElse(
			ConfigProvider.fromUnknown({
				CLOUDFLARE_API_TOKEN: token,
				CLOUDFLARE_ACCOUNT_ID: account,
				SESSION: session,
			}),
			below,
		),
	),
);
const stack = stackOf(secrets);

/** One line per resource: what it is and what a deploy does to it. */
const linesOf = (p: Plan.Plan) =>
	Object.keys(p.resources)
		.sort()
		.map((id) => {
			const node = p.resources[id];
			// Alchemy beta.84's own printPlan coerces `resource.type`, an Output before deploy, and throws.
			const type = [node?.resource?.Type, node?.resource?.type].find((t) => typeof t === "string");
			return `${node?.action ?? "?"} ${id} (${type ?? "unknown"})`;
		})
		.join("\n");

/** The dry step: what a deploy would make, from the same empty state the deploy starts on. */
const plan = async () => {
	await buildWorker();
	const printed = await Effect.runPromise(
		evalStack(stack, (s) => Plan.make(s).pipe(Effect.map(linesOf)), {
			stage: "cloud",
		}).pipe(Effect.provide(engine)),
	);
	return scrub(printed);
};

/** List price, Cloudflare's containers pricing page (read 2026-11-02), with no included use. */
const PRICE = {vcpuS: 0.00002, gibS: 0.0000025, gbS: 0.00000007};
const listPrice = (boxS: number, activeCpuS: number) => ({
	cpu: activeCpuS * PRICE.vcpuS,
	memory: boxS * 12 * PRICE.gibS,
	disk: boxS * 20 * PRICE.gbS,
	total: activeCpuS * PRICE.vcpuS + boxS * 12 * PRICE.gibS + boxS * 20 * PRICE.gbS,
	// The worst case: all 4 vCPU busy for every second the box was up.
	ceiling: boxS * 4 * PRICE.vcpuS + boxS * 12 * PRICE.gibS + boxS * 20 * PRICE.gbS,
});

type Progress = {
	done?: boolean;
	now?: string | null;
	error?: string | null;
	phases?: Array<{name: string; wallMs?: number; boxCpuS?: number}>;
};

const live = async () => {
	if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("COMMIT must be a full sha");
	const built = await buildWorker();
	note("bundle", built);
	note("plan", (await plan()).split("\n"));
	note("before", await ours());
	let base = "";
	const run = `run:${randomBytes(4).toString("hex")}`;
	const call = async (path: string, init: RequestInit = {}) => {
		const res = await fetch(`${base}${path}${path.includes("?") ? "&" : "?"}run=${run}`, {
			...init,
			headers: {...(init.headers ?? {}), authorization: `Bearer ${session}`},
		});
		const text = await res.text();
		try {
			return {status: res.status, body: JSON.parse(text) as Record<string, unknown>};
		} catch {
			return {status: res.status, body: {text: text.slice(0, 500)} as Record<string, unknown>};
		}
	};
	let begunAt = 0;
	let stoppedAt = 0;
	try {
		const t = Date.now();
		const out = (await Effect.runPromise(
			deploy({stack, stage: "cloud"}).pipe(Effect.provide(engine)),
		)) as {url?: string};
		note("deploy", {ms: Date.now() - t, url: out.url !== undefined});
		if (out.url === undefined) throw new Error("no workers.dev address");
		base = out.url.replace(/\/$/, "");
		note("afterDeploy", await ours());
		for (let up = 0; up < 120; up++) {
			const r = await fetch(`${base}/status`).catch(() => null);
			if (r?.status === 401) break;
			await wait(1000);
		}
		begunAt = Date.now();
		const begun = await call("/begin", {
			method: "POST",
			body: JSON.stringify({commit, set: SET, concurrency: 4, suite: SUITE}),
		});
		note("begin", {ms: Date.now() - begunAt, ...begun});
		let last: Progress | null = null;
		let lastNow: string | null | undefined;
		const polls: Array<{at: number; ok: boolean; now?: string | null; readError?: unknown}> = [];
		// The cap: 45 minutes of box time, a minute short so the destroy is inside it.
		while (Date.now() - begunAt < RUN_CAP_MS - 60_000) {
			await wait(15_000);
			const s = await call("/status").catch((e: unknown) => ({
				status: 0,
				body: {error: String(e)},
			}));
			const text = typeof s.body.progress === "string" ? s.body.progress : null;
			const p = text === null ? null : (JSON.parse(text) as Progress);
			if (p !== null) last = p;
			polls.push({
				at: Date.now() - begunAt,
				ok: p !== null,
				now: p?.now,
				readError: s.body.readError,
			});
			if (p?.now !== lastNow) {
				note("phase", {
					at: Date.now() - begunAt,
					now: p?.now,
					done: p?.phases?.map((x) => [x.name, x.wallMs]),
				});
				lastNow = p?.now;
			}
			const row = s.body.row as {state?: string; ended?: unknown} | undefined;
			if (p?.done === true || row?.state === "done") break;
		}
		note("polls", polls);
		const final = await call("/status");
		note("finalRow", final.body.row);
		const text = typeof final.body.progress === "string" ? final.body.progress : null;
		results.box = JSON.parse(scrub(text ?? JSON.stringify(last)));
		console.log("box", scrub(text ?? JSON.stringify(last)).slice(0, 3000));
		const stopped = await call("/stop", {method: "POST"});
		stoppedAt = Date.now();
		note("stop", stopped.body);
		const after = await call("/status");
		note("afterStop", {running: after.body.running, row: after.body.row});
	} catch (e) {
		note("error", String((e as Error)?.stack ?? e).slice(0, 3000));
	} finally {
		if (begunAt > 0 && stoppedAt === 0) {
			await call("/stop", {method: "POST"}).catch(() => undefined);
			stoppedAt = Date.now();
		}
		const t = Date.now();
		const gone = await Effect.runPromiseExit(
			destroy({stack, stage: "cloud"}).pipe(Effect.provide(engine)),
		);
		note("destroy", {ms: Date.now() - t, ok: gone._tag === "Success"});
		note("afterDestroy", await ours());
		note("swept", await sweep());
		note("afterCleanup", await ours());
		const boxS = begunAt > 0 ? (stoppedAt - begunAt) / 1000 : 0;
		const phases = ((results.box as Progress | undefined)?.phases ?? []) as Array<{
			boxCpuS?: number;
		}>;
		const cpuS = phases.reduce((s, x) => s + (x.boxCpuS ?? 0), 0);
		note("cost", {boxSeconds: boxS, activeCpuSeconds: cpuS, listPrice: listPrice(boxS, cpuS)});
		mkdirSync(join(import.meta.dirname, "..", "results"), {recursive: true});
		writeFileSync(
			join(import.meta.dirname, "..", "results", `199-box-live-run${RUN}.json`),
			`${JSON.stringify(results, null, "\t")}\n`,
		);
		// Alchemy's state holds the account id and the address in plain text (experiment 144).
		rmSync(work, {recursive: true, force: true});
	}
};

try {
	if (mode === "plan") {
		console.log(await plan());
		console.log("before", scrub(JSON.stringify(await ours())));
	} else if (mode === "sweep") {
		console.log("before", scrub(JSON.stringify(await ours())));
		console.log("swept", scrub(JSON.stringify(await sweep())));
		console.log("after", scrub(JSON.stringify(await ours())));
	} else await live();
} catch (e) {
	// Said with the account and the paths taken out: an SDK error can print its own request.
	console.error(scrub(String((e as Error)?.stack ?? e)).slice(0, 3000));
	process.exitCode = 1;
} finally {
	rmSync(work, {recursive: true, force: true});
}
