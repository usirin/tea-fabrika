// Experiment 148's egress round: does Cloudflare's own allow list (`allowedHosts`, with
// `interceptHttps` false and no outbound handler) lock a box to api.anthropic.com without any TLS
// opened on the way? Three boxes (egress-worker.ts) knock on the same doors (box/egress.mjs).
//
//   env -u TYPESAFE_API_KEY nice -n 15 node experiments/148-remote-programs.ts egress local
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node experiments/148-remote-programs.ts egress live
//
// local: workerd and Docker through `alchemy dev`, as the main run. live: deployed from code,
// played, destroyed in a `finally`, then everything with the tf-exp-148 prefix listed and swept.
// No token, no key, no model call. Results go to results/148-remote-programs-egress-<mode>.json,
// with the account id, the workers.dev address and the paths taken out.
//
// Node at the edge, said here: child_process for docker and alchemy dev, dns for one address.
import {execFileSync, spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {lookup} from "node:dns/promises";
import {mkdirSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Alchemy from "alchemy";
import {AlchemyContextLive} from "alchemy/AlchemyContext";
import {ArtifactStore, createArtifactStore} from "alchemy/Artifacts";
import {deploy} from "alchemy/Deploy";
import {destroy} from "alchemy/Destroy";
import * as Interaction from "alchemy/Interaction";
import {ConfigProvider, Effect, Layer} from "effect";
import {build} from "esbuild";
import {cloudOf} from "./cloud.ts";
import {egressStackOf} from "./stack.ts";

const here = import.meta.dirname;
const live = process.argv.includes("live");
const work = process.cwd();
const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const token = process.env.CLOUDFLARE_API_TOKEN ?? "";
for (const k of Object.keys(process.env)) if (k.startsWith("CLOUDFLARE_")) delete process.env[k];
if (live && (!account || !token)) throw new Error("live needs the Cloudflare token and account");

const session = `sess-${randomBytes(16).toString("hex")}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const scrub = (s: string) => {
	let out = s.replace(/[a-z0-9.-]+\.workers\.dev/g, "<workers.dev>");
	for (const [from, to] of [
		[account, "<account>"],
		[work, "<work>"],
		[join(here, "..", ".."), "<repo>"],
	] as const)
		if (from) out = out.split(from).join(to);
	return out;
};
const results: Record<string, unknown> = {date: new Date().toISOString().slice(0, 10)};
const note = (k: string, v: unknown) => {
	results[k] = JSON.parse(scrub(JSON.stringify(v ?? null)));
	console.log(k, scrub(JSON.stringify(v ?? null)).slice(0, 2000));
};

/** The Worker, one file, with `@cloudflare/containers` in it as published. */
const bundle = () =>
	build({
		entryPoints: [join(here, "egress-worker.ts")],
		outfile: join(here, "dist", "egress.mjs"),
		bundle: true,
		platform: "neutral",
		format: "esm",
		target: "es2024",
		conditions: ["workerd", "worker", "browser"],
		mainFields: ["module", "main"],
		external: ["cloudflare:*", "node:*"],
		logLevel: "warning",
	});

/** Each box, by its name in the results, and how the Worker is asked for it. */
const BOXES = {
	rawLocked: "/raw?https=0&early=0",
	rawLockedEarly: "/raw?https=0&early=1",
	rawOpened: "/raw?https=1&early=0",
	locked: "/locked?",
	opened: "/opened?",
	open: "/open?",
};

/** Each box once: start, knock on every door, destroyed. A box that does not answer is retried. */
const play = async (base: string, ip: string) => {
	for (const [box, path] of Object.entries(BOXES)) {
		const tries: unknown[] = [];
		for (let i = 0; i < 3; i++) {
			try {
				const res = await fetch(`${base}${path}&ip=${ip}&run=${box}-${i}`, {
					headers: {authorization: `Bearer ${session}`},
					signal: AbortSignal.timeout(150000),
				});
				const text = await res.text();
				const parse = (s: string) => {
					try {
						return JSON.parse(s) as unknown;
					} catch {
						throw new Error(`${res.status}: ${s.slice(0, 600)}`);
					}
				};
				const body = parse(text) as {status: number; ms: number; tries: string};
				const answer = parse(body.tries);
				note(box, {status: body.status, ms: body.ms, answer});
				break;
			} catch (e) {
				tries.push(String(e).slice(0, 300));
				await wait(15000);
			}
		}
		if (tries.length > 0) note(`${box}Retries`, tries);
	}
};

// ---- local: workerd and Docker, as the main run --------------------------------------------------
const docker = (...args: string[]) =>
	execFileSync("docker", args, {encoding: "utf8"}).split("\n").filter(Boolean);
const OURS = /alchemy-dev\/|workerd-container-snap|workerd-tf-exp-148/;
const dockerNow = (what: "images" | "ps") =>
	new Set(
		(what === "images"
			? docker("images", "-a", "--no-trunc", "--format", "{{.ID}} {{.Repository}}")
			: docker("ps", "-a", "--no-trunc", "--format", "{{.ID}} {{.Names}}")
		)
			.filter((l) => OURS.test(l))
			.map((l) => l.split(" ")[0] ?? ""),
	);

const local = async (ip: string) => {
	const images = dockerNow("images");
	const containers = dockerNow("ps");
	const env: Record<string, string> = {...(process.env as Record<string, string>)};
	delete env.TYPESAFE_API_KEY;
	const dev = spawn(
		join(here, "node_modules", ".bin", "alchemy"),
		["dev", "egress.run.ts", "--stage", "local", "--no-input"],
		{
			cwd: here,
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...env,
				// The egress catch's helper, the build for this laptop's CPU (see the write-up).
				CONTAINER_EGRESS_INTERCEPTOR_IMAGE:
					"cloudflare/proxy-everything@sha256:78c7910f4575a511d928d7824b1cbcaec6b7c4bf4dbb3fafaeeae3104030e73c",
				DO_NOT_TRACK: "1",
				CI: "1",
				ALCHEMY_HOME: join(work, "alchemy-home"),
				SESSION: session,
			},
		},
	);
	let log = "";
	dev.stdout.on("data", (d) => {
		log += d;
	});
	dev.stderr.on("data", (d) => {
		log += d;
	});
	try {
		for (let i = 0; i < 240 && !log.includes("Started in"); i++) await wait(500);
		if (!log.includes("Started in")) throw new Error(`alchemy dev did not start:\n${log}`);
		const url = /https?:\/\/(localhost|127\.0\.0\.1):\d+/.exec(log)?.[0] ?? "http://localhost:1337";
		await play(url, ip);
	} catch (e) {
		note("error", String((e as Error)?.stack ?? e).slice(0, 3000));
	} finally {
		if (dev.pid !== undefined) {
			try {
				process.kill(-dev.pid, "SIGTERM");
			} catch {}
			await wait(3000);
			try {
				process.kill(-dev.pid, "SIGKILL");
			} catch {}
		}
		const newContainers = [...dockerNow("ps")].filter((id) => !containers.has(id));
		for (const id of newContainers) {
			try {
				docker("rm", "-f", id);
			} catch {}
		}
		const newImages = [...dockerNow("images")].filter((id) => !images.has(id));
		for (const id of newImages) {
			try {
				docker("rmi", "-f", id);
			} catch {}
		}
		note("cleanup", {containers: newContainers.length, images: newImages.length});
		note(
			"devLog",
			log
				.split("\n")
				.filter((l) => /error|warn|egress|intercept/i.test(l))
				.slice(0, 40),
		);
		rmSync(join(here, ".alchemy", "local"), {recursive: true, force: true});
		rmSync(work, {recursive: true, force: true});
	}
};

// ---- live: Cloudflare, from code, always destroyed ---------------------------------------------
const cloud = async (ip: string) => {
	const {ours, sweep} = cloudOf(account, token);
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
	const stack = egressStackOf(secrets);
	note("before", await ours());
	try {
		const t = Date.now();
		const out = (await Effect.runPromise(
			deploy({stack, stage: "cloud"}).pipe(Effect.provide(engine)),
		)) as {url?: string};
		note("deploy", {ms: Date.now() - t, url: out.url !== undefined});
		if (out.url === undefined) throw new Error("no workers.dev address");
		const base = out.url.replace(/\/$/, "");
		for (let up = 0; up < 120; up++) {
			const r = await fetch(`${base}/open`).catch(() => null);
			if (r?.status === 401) break;
			await wait(1000);
		}
		await play(base, ip);
	} catch (e) {
		note("error", String((e as Error)?.stack ?? e).slice(0, 3000));
	} finally {
		const t = Date.now();
		const gone = await Effect.runPromiseExit(
			destroy({stack, stage: "cloud"}).pipe(Effect.provide(engine)),
		);
		note("destroy", {ms: Date.now() - t, ok: gone._tag === "Success"});
		note("swept", await sweep());
		note("afterCleanup", await ours());
		// Alchemy's state holds the account id and the address in plain text (experiment 144).
		rmSync(work, {recursive: true, force: true});
	}
};

await bundle();
// An address of api.anthropic.com, from the laptop: the box may have no DNS of its own.
const ip = (await lookup("api.anthropic.com", {family: 4})).address;
note("anthropicIp", ip);
if (live) await cloud(ip);
else await local(ip);
mkdirSync(join(here, "..", "results"), {recursive: true});
writeFileSync(
	join(here, "..", "results", `148-remote-programs-egress-${live ? "live" : "local"}.json`),
	`${JSON.stringify(results, null, "\t")}\n`,
);
