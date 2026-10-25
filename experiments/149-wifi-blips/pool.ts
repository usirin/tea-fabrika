// Experiment 149's host process: one or many lanes served on this process, each on its own ledger
// (one Durable Object per run), as host A (through the run's proxy) or host B (straight to the
// ledger). The harness (../149-wifi-blips.ts) starts it in its own process group and tells it what
// to do on stdin, one JSON object a line:
//
//   {"do": "serve", "run": "r7", "ledger": "http://127.0.0.1:9001", "object": "x-r7",
//    "name": "lane:7", "ticket": "o/r#7", "world": "http://127.0.0.1:9002"}
//   {"do": "stop", "run": "r7"}
//
// It prints one JSON object a line: {run, at, ...} for every host event, every lane note, and,
// on host A, every change of what the window's Link would show.
//
//   node pool.ts '{"role":"A","variant":"today","ttlMs":30000,"renewEveryMs":10000,"graceMs":0,"periodMs":2000}'
import {createInterface} from "node:readline";
import {type HostEvent, Ledger, serve} from "@kampus/fabrika";
import {layerHttp} from "@kampus/fabrika/http";
import {Effect, Exit, Fiber, Layer} from "effect";
import {type LaneNote, laneProgram, type Variant} from "./lane.ts";
import {LINK_START, type LinkModel, linkUpdate} from "./link.ts";
import {serve as patientServe} from "./patient/host.ts";

interface PoolConfig {
	readonly role: "A" | "B";
	readonly variant: Variant;
	readonly ttlMs: number;
	readonly renewEveryMs: number;
	/** The patient host's grace past the lease's end. Unused by `today`. */
	readonly graceMs: number;
	readonly periodMs: number;
}

interface Serve {
	readonly do: "serve";
	readonly run: string;
	readonly ledger: string;
	readonly object: string;
	readonly name: string;
	readonly ticket: string;
	readonly world: string;
}
type Command = Serve | {readonly do: "stop"; readonly run: string};

const config: PoolConfig = JSON.parse(process.argv[2] ?? "{}");
const out = (o: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(o)}\n`);

const isUnreachable = (e: unknown) =>
	typeof e === "object" && e !== null && "_tag" in e && e._tag === "LedgerUnreachable";

/** The ledger, with every call's answer (or none) told to `seen`. */
const observed = (
	inner: Ledger["Service"],
	seen: (ok: boolean, ms: number, inFlight: number) => void,
): Ledger["Service"] => {
	let inFlight = 0;
	const wrapped: Record<string, unknown> = {...inner};
	for (const [key, f] of Object.entries(inner)) {
		if (key === "watch" || typeof f !== "function") continue;
		const call = f as (...a: unknown[]) => Effect.Effect<unknown, unknown>;
		wrapped[key] = (...args: unknown[]) =>
			Effect.suspend(() => {
				const t = Date.now();
				inFlight++;
				return call(...args).pipe(
					Effect.onExit((exit) =>
						Effect.sync(() => {
							inFlight--;
							const lost =
								Exit.isFailure(exit) &&
								exit.cause.reasons.some((r) => r._tag === "Fail" && isUnreachable(r.error));
							if (!Exit.hasInterrupts(exit)) seen(!lost, Date.now() - t, inFlight);
						}),
					),
				);
			});
	}
	return wrapped as Ledger["Service"];
};

const runs = new Map<string, Fiber.Fiber<unknown, unknown>>();
const holderTag = `${config.role}-${process.pid}`;

const serveRun = (c: Serve) => {
	let link: LinkModel = LINK_START;
	const say = (o: object) => out({run: c.run, role: config.role, at: Date.now(), ...o});
	const ledgerLayer = Layer.effect(
		Ledger,
		Effect.gen(function* () {
			const inner = yield* Ledger;
			if (config.role === "B") return inner;
			return observed(inner, (ok, ms, inFlight) => {
				const before = link.link.state;
				link = linkUpdate(
					link,
					ok ? {type: "answered", ms} : {type: "failed", at: Date.now(), waiting: inFlight},
				);
				if (link.link.state !== before) say({ev: "link", ...link.link});
			});
		}),
	).pipe(Layer.provide(layerHttp({url: c.ledger, ledger: c.object})));
	const listen = (e: HostEvent) => {
		// A save that landed is the lane's pace, not news; the rest is.
		if (e.ev === "write" && "ok" in e && e.ok && e.why === null) return;
		say(e);
	};
	const program = laneProgram({
		run: c.run,
		ticket: c.ticket,
		world: c.world,
		variant: config.variant,
		periodMs: config.periodMs,
		say: (n: LaneNote) => say(n),
	});
	const options = {
		name: c.name,
		holder: `${holderTag}-${c.run}`,
		program,
		ttlMs: config.ttlMs,
		renewEveryMs: config.renewEveryMs,
		listen,
	};
	const served =
		config.variant === "today"
			? serve(options)
			: patientServe({...options, graceMs: config.graceMs, retryRenewMs: 1000});
	const main = served.pipe(
		Effect.andThen(Effect.never),
		Effect.scoped,
		Effect.provide(ledgerLayer),
	);
	const fiber = Effect.runFork(main);
	fiber.addObserver((exit) => {
		if (!Exit.hasInterrupts(exit)) say({ev: "host_died", why: String(exit).slice(0, 300)});
	});
	runs.set(c.run, fiber);
};

const lines = createInterface({input: process.stdin});
lines.on("line", (line) => {
	if (line.trim() === "") return;
	const c: Command = JSON.parse(line);
	if (c.do === "serve") serveRun(c);
	if (c.do === "stop") {
		const fiber = runs.get(c.run);
		runs.delete(c.run);
		if (fiber !== undefined)
			Effect.runFork(
				Fiber.interrupt(fiber).pipe(
					Effect.andThen(Effect.sync(() => out({run: c.run, role: config.role, ev: "stopped"}))),
				),
			);
	}
});
lines.on("close", () => process.exit(0));
out({ready: config.role, pid: process.pid});
