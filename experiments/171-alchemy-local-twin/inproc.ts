// Experiment 171, question 7 and the in-process half of question 3: one Node process that loads
// Alchemy once, the way a test file or the host itself would.
//
//   - Miniflare in this process, as the tests run it today (`new Miniflare(ledgerOptions(...))`):
//     start to first answer, then dispose. Five rounds.
//   - Alchemy's local stage in this process: deploy with a scope of ours to first answer, close
//     the scope (workerd stops), deploy again with the same inputs. Five rounds. Is the URL kept?
//   - Two stacks at once in this one process, each with its own `.alchemy/` (AlchemyContext):
//     do both answer, each with its own data?
//
//   INPROC_HOME=<temp folder> INPROC_WORKER=<built worker file> node inproc.ts
// Prints one JSON line.
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {layer as NodeServices} from "@effect/platform-node/NodeServices";
import {Ledger} from "@kampus/fabrika";
import {layerHttp} from "@kampus/fabrika/http";
import {ledgerOptions} from "@kampus/fabrika/local";
import {AlchemyContext} from "alchemy/AlchemyContext";
import {ArtifactStore, createArtifactStore} from "alchemy/Artifacts";
import {deploy} from "alchemy/Deploy";
import * as Interaction from "alchemy/Interaction";
import {Effect, Exit, Layer, Redacted, Scope} from "effect";
import {Miniflare} from "miniflare";
import {twinStack} from "./stack.ts";

const home = process.env.INPROC_HOME ?? "";
const worker = process.env.INPROC_WORKER ?? "";
const secret = Redacted.make(
	`fabrika_l_${createHash("sha256").update(home).digest("hex").slice(0, 32)}`,
);
const ms = (t: number) => Math.round(performance.now() - t);

/** Ask until it answers: the first answer through the door (a 401 with no credential). */
const firstAnswer = async (url: string) => {
	for (;;) {
		const s = await fetch(`${url}/exp171/readLast`, {method: "POST", body: "[]"}).then(
			(r) => r.status,
			() => 0,
		);
		if (s !== 0) return s;
		await new Promise((r) => setTimeout(r, 10));
	}
};

// ---- Miniflare in this process, as the tests run it.
const miniflare: number[] = [];
for (let i = 0; i < 5; i++) {
	const t = performance.now();
	const mf = new Miniflare(ledgerOptions({persist: false, direct: 0}));
	await mf.ready;
	await firstAnswer((await mf.unsafeGetDirectURL()).origin);
	miniflare.push(ms(t));
	await mf.dispose();
}

// ---- Alchemy's local stage in this process.
const engineAt = (dotAlchemy: string) =>
	Layer.mergeAll(
		Layer.succeed(AlchemyContext, {dotAlchemy, dev: true, adopt: false}),
		Layer.succeed(ArtifactStore, createArtifactStore()),
		Interaction.layerNonInteractive(),
	).pipe(Layer.provideMerge(NodeServices));

const stackAt = (name: string, port: number) =>
	twinStack({name, person: "owner", secret, port, main: {kind: "prebuilt", file: worker}});

const up = async (name: string, port: number, dotAlchemy: string) => {
	const scope = Effect.runSync(Scope.make());
	const out = await Effect.runPromise(
		deploy({stack: stackAt(name, port), stage: "local", dev: true, scope}).pipe(
			Effect.provide(engineAt(dotAlchemy)),
		),
	);
	return {scope, url: out.url ?? ""};
};
const down = (scope: Scope.Closeable) => Effect.runPromise(Scope.close(scope, Exit.void));

const write = (url: string, n: number) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const l = yield* Ledger;
			yield* l.register("exp171", "");
			for (let i = 0; i < n; i++)
				yield* l.append("exp171/inbox", "any", {kind: "note", writer: "", data: {i}});
			return (yield* l.readStream("exp171/inbox")).length;
		}).pipe(Effect.scoped, Effect.provide(layerHttp({url, ledger: "exp171", token: secret}))),
	);

/** workerd processes under this one, from ps: does closing our scope stop workerd? */
const workerds = () =>
	execFileSync("ps", ["-A", "-o", "ppid=,comm="], {encoding: "utf8"})
		.split("\n")
		.filter((l) => l.trim().startsWith(`${process.pid} `) && l.includes("workerd")).length;
/** Does anything still listen on the port? */
const listening = (url: string) =>
	fetch(`${url}/exp171/readLast`, {
		method: "POST",
		body: "[]",
		signal: AbortSignal.timeout(500),
	}).then(
		(r) => r.status,
		() => 0,
	);

type Round = {
	upMs?: number;
	answerMs?: number;
	downMs?: number;
	workerdAfterClose?: number;
	portAfterClose?: number;
	failed?: string;
};
const port = 19500 + Math.floor(Math.random() * 300);
// The same fixed port each round: what the host would want across a restart.
const samePort: Round[] = [];
// A new port each round: the restart's own time, past the port.
const newPort: Round[] = [];
for (const [rounds, portOf] of [
	[samePort, () => port],
	[newPort, (i: number) => port + 10 + i],
] as const)
	for (let i = 0; i < 3; i++) {
		try {
			const t = performance.now();
			const a = await up("tf-exp-171-in", portOf(i), join(home, "a", ".alchemy"));
			const upMs = ms(t);
			await firstAnswer(a.url);
			const answerMs = ms(t);
			const t2 = performance.now();
			await down(a.scope);
			const downMs = ms(t2);
			await new Promise((r) => setTimeout(r, 300));
			rounds.push({
				upMs,
				answerMs,
				downMs,
				workerdAfterClose: workerds(),
				portAfterClose: await listening(a.url),
			});
		} catch (e) {
			rounds.push({failed: String(e).split("\n")[0]?.slice(0, 200) ?? ""});
		}
	}
const alchemy = {samePort, newPort, workerdAtEnd: workerds()};

// ---- Two stacks at once, each with its own `.alchemy/`.
let two: unknown;
try {
	const t3 = performance.now();
	const [x, y] = await Promise.all([
		up("tf-exp-171-x", port + 1, join(home, "x", ".alchemy")),
		up("tf-exp-171-y", port + 2, join(home, "y", ".alchemy")),
	]);
	const upMs = ms(t3);
	const rows = {x: await write(x.url, 3), y: await write(y.url, 7)};
	await Promise.all([down(x.scope), down(y.scope)]);
	two = {upMs, rows, distinctUrls: x.url !== y.url};
} catch (e) {
	two = {failed: String(e).split("\n")[0]?.slice(0, 200)};
}

process.stdout.write(`${JSON.stringify({miniflare, alchemy, two})}\n`);
// Alchemy's proxies outlive our scopes (above): end the process, and with it what it started.
process.exit(0);
