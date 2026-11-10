// Experiment 249 spike, next/, never merged. Deploys the probe Worker to Alchemy's local provider
// (local workerd, nothing deployed, no network out) and runs S10's parts against the `Probe` object.
//   node spike/s10.ts [laws] [sync] [iso] [burst] [bench]      OUT=<file> for the raw JSON lines
import {appendFileSync, mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import * as Cloudflare from "@alchemy.run/cloudflare";
import {NodeServices} from "@effect/platform-node";
import * as Alchemy from "alchemy";
import {AlchemyContext} from "alchemy/AlchemyContext";
import {ArtifactStore, createArtifactStore} from "alchemy/Artifacts";
import {deploy} from "alchemy/Deploy";
import * as Interaction from "alchemy/Interaction";
import {localState} from "alchemy/State/LocalState";
import {Effect, Layer} from "effect";

process.env.DO_NOT_TRACK = "1";
const parts = process.argv.slice(2);
const want = (name: string) => parts.length === 0 || parts.includes(name);
const home = mkdtempSync(join(tmpdir(), "s10-"));
process.env.ALCHEMY_HOME = join(home, "alchemy-home");
const port = Number(process.env.SPIKE_PORT ?? 18941);
process.env.SPIKE_PORT = String(port);
const url = `http://127.0.0.1:${port}`;
const out = process.env.OUT;
const RUNS = Number(process.env.RUNS ?? 5);
const TURNS = Number(process.env.TURNS ?? 1000);

const say = (probe: string, value: unknown) => {
	const text = `${JSON.stringify({probe, value})}\n`;
	process.stdout.write(text);

	if (out !== undefined) {
		appendFileSync(out, text);
	}
};

const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

const call = async (name: string, method: string, ...args: ReadonlyArray<unknown>) => {
	try {
		const reply = await fetch(url, {
			method: "POST",
			body: JSON.stringify({object: "probe", name, method, args}),
			signal: AbortSignal.timeout(Number(process.env.CALL_MS ?? 8000)),
		});
		const text = await reply.text();

		try {
			const parsed = JSON.parse(text);
			return "value" in parsed ? parsed.value : parsed;
		} catch {
			return {status: reply.status, text: text.slice(0, 300)};
		}
	} catch (error) {
		return {hung: String(error).slice(0, 80)};
	}
};

const ROUTES = ["S", "Sb", "E", "E2", "Es", "W"] as const;
const median = (values: ReadonlyArray<number>) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

/** Reads a trace: a turn that starts inside another, and a peek that lands inside one. */
const judge = (trace: ReadonlyArray<string>, rows: ReadonlyArray<readonly [number, string]>) => {
	let depth = 0;
	let overlaps = 0;
	let peeksInside = 0;

	for (const event of trace) {
		if (event.startsWith("enter")) {
			if (depth > 0) {
				overlaps++;
			}

			depth++;
		} else if (event.startsWith("exit")) {
			depth--;
		} else if (event.startsWith("peek") && depth > 0) {
			peeksInside++;
		}
	}

	const numbers = rows.map(([n]) => n);
	return {
		overlaps,
		peeksInside,
		rows: rows.length,
		twice: numbers.length - new Set(numbers).size,
		leftOpen: depth,
	};
};

const main = Effect.gen(function* () {
	const scope = yield* Effect.scope;
	const engine = Layer.mergeAll(
		Layer.succeed(AlchemyContext, {dotAlchemy: join(home, ".alchemy"), dev: true, adopt: false}),
		Layer.succeed(ArtifactStore, createArtifactStore()),
		Interaction.layerNonInteractive(),
	);
	const worker = yield* Effect.promise(() => import("./worker.ts"));
	const stack = Alchemy.Stack(
		"spike",
		{providers: Cloudflare.providers(), state: Alchemy.localState()},
		Effect.gen(function* () {
			const spike = yield* worker.default.pipe(
				Layer.build,
				Effect.flatMap(() => worker.Spike),
			);
			return {url: spike.url};
		}),
	);
	yield* deploy({stack: stack as never, stage: "local", dev: true, scope}).pipe(
		Effect.provide(localState()),
		Effect.provide(engine),
	);
	yield* Effect.promise(async () => {
		for (let n = 0; n < 150; n++) {
			const booted = await call("boot", "report");

			if (booted !== null && typeof booted === "object" && "trace" in booted) {
				break;
			}

			await pause(200);
		}

		if (want("laws")) {
			for (const route of ROUTES) {
				const first = await call(`law-${route}-0`, "law", route, 0);
				const results = [first];

				for (let index = 1; index < (first.laws ?? 1); index++) {
					results.push(await call(`law-${route}-${index}`, "law", route, index));
				}

				for (const result of results) {
					say("law", {route, ...result});
				}

				say("laws", {
					route,
					passed: results.filter((result) => result.ok === true).length,
					of: results.length,
				});
			}
		}

		if (want("sync")) {
			for (const route of ROUTES) {
				say("sync", {route, ...(await call(`sync-${route}`, "sync", route))});
				await pause(300);
			}
		}

		if (want("iso")) {
			const kinds = {
				S: ["none"],
				Sb: ["none"],
				E: ["none", "yield", "micro", "kv", "sleep", "fetch"],
				E2: ["none", "yield", "micro", "kv", "sleep", "fetch"],
				Es: ["none", "yield", "micro", "kv", "sleep", "fetch"],
				W: ["none", "yield", "micro", "kv", "sleep", "fetch"],
			} as const;

			for (const route of ROUTES) {
				for (const kind of kinds[route]) {
					const name = `iso-${route}-${kind}@${port}`;
					await call(name, "report");
					// Alone first: three turns one after another on a quiet object of its own.
					const solo: Array<unknown> = [];

					for (let i = 0; i < 3; i++) {
						solo.push(await call(`solo-${route}-${kind}@${port}`, "turn", route, kind, `s${i}`));
					}

					const calls: Array<Promise<unknown>> = [];

					for (let i = 0; i < 6; i++) {
						calls.push(call(name, "turn", route, kind, `t${i}`));
						calls.push(call(name, "peek", route));
					}

					const answers = await Promise.all(calls);
					let report = await call(name, "report");
					let recovered: unknown = "n/a";

					if (report?.trace === undefined) {
						// A stuck object: wait, then ask once more, to see whether it comes back by itself.
						await pause(20_000);
						report = await call(name, "report");
						recovered = report?.trace !== undefined;
					}

					const turns = answers.filter((_, i) => i % 2 === 0);
					const peeks = answers.filter((_, i) => i % 2 === 1);
					const tally = (list: ReadonlyArray<unknown>) => {
						const counts: Record<string, number> = {};

						for (const item of list) {
							const key =
								item === "ok" || typeof item === "number"
									? "ok"
									: JSON.stringify(item).slice(0, 140);
							counts[key] = (counts[key] ?? 0) + 1;
						}

						return counts;
					};
					say("iso", {
						route,
						kind,
						solo: tally(solo),
						recovered,
						turns: tally(turns),
						peeks: tally(peeks),
						...(report?.trace === undefined
							? {report}
							: {...judge(report.trace, report.rows), trace: report.trace.join(" | ")}),
					});
				}
			}
		}

		if (want("burst")) {
			for (const route of ROUTES) {
				for (const kind of route === "S" || route === "Sb"
					? ["none"]
					: ["none", "micro", "sleep"]) {
					const name = `burst-${route}-${kind}@${port}`;
					const answers = await call(name, "burst", route, kind, 6);
					const report = await call(name, "report");
					say("burst", {
						route,
						kind,
						answers,
						...(report?.trace === undefined
							? {report}
							: {...judge(report.trace, report.rows), trace: report.trace.join(" | ")}),
					});
				}
			}
		}

		if (want("bench")) {
			// One empty call per route measures the trip to the object, which every number carries once.
			for (const route of ROUTES) {
				const name = `bench-${route}`;
				await call(name, "bench", route, 0, 200);
				const inside: Array<number> = [];
				const outside: Array<number> = [];
				const trips: Array<number> = [];

				for (let run = 0; run < RUNS; run++) {
					const t0 = performance.now();
					await call(name, "bench", route, 1_000_000 + run, 0);
					trips.push(performance.now() - t0);
					const t1 = performance.now();
					const answer = await call(name, "bench", route, 1000 + run * TURNS, TURNS);
					outside.push(performance.now() - t1);
					inside.push(answer?.ms ?? -1);

					if (answer?.ms === undefined) {
						say("bench.error", {route, answer});
					}
				}

				const perTurn = outside.map((ms, i) => ((ms - trips[i]!) / TURNS) * 1000);
				say("bench", {
					route,
					runs: RUNS,
					turns: TURNS,
					microsPerTurn: {
						median: Math.round(median(perTurn) * 10) / 10,
						min: Math.round(Math.min(...perTurn) * 10) / 10,
						max: Math.round(Math.max(...perTurn) * 10) / 10,
					},
					insideClockMs: inside,
					outsideMs: outside.map((ms) => Math.round(ms)),
				});
			}
		}
	});
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

Effect.runPromise(main).then(
	() => {
		rmSync(home, {recursive: true, force: true});
		process.exit(0);
	},
	(error) => {
		say("failed", String(error?.stack ?? error).slice(0, 3000));
		rmSync(home, {recursive: true, force: true});
		process.exit(1);
	},
);
