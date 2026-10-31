// Experiment 154's box: one process that signs in to its person's own plan, does one job on the
// pass, and forgets it. On the laptop it is a child process with its own folder; in Docker and on
// Cloudflare it is the same file, bundled (./build.ts), as the container's one process.
//
//   BOX=b1 WHO=a AUTH='{"authorize":...}' LEDGER_URL=... LEDGER_NAME=... LEDGER_TOKEN=... node box.ts
//
// What it prints, one JSON line each, is all a person or a log ever sees of it: the port the URL
// was made for, the pass's length, `expires_in`, the scopes, one answer's short text and token
// counts, what the agent's commands found, and "forgotten". Never a token, a code or a verifier.
//
// Which way the pass comes: RENEW=ask asks without offline_access (way b); PASS_FROM=app runs the
// `lent` machine instead, and the person's app lends sealed passes (way c). Otherwise way (a).
//
// The job, once a pass is held:
//   1. wait HOLD_MS (the fake run uses it to see refreshes happen while a pass is held)
//   2. one Responses call on the pass (store: false, stream: true)
//   3. the agent's commands (AGENT_CMD), each with an environment made from nothing and its own
//      folder; in Docker as another user (AGENT_USER), so the box's memory is not theirs to read
//   4. end: revoke and forget

import {run} from "@demlik/tea/effect";
import {NodeServices} from "@effect/platform-node";
import {Ledger} from "@kampus/fabrika";
import {layerHttp} from "@kampus/fabrika/http";
import {Duration, Effect, Layer, Redacted, Schema} from "effect";
import {ChildProcess, ChildProcessSpawner} from "effect/process";
import {
	Box,
	forgetCell,
	inboxRunner,
	offerCell,
	refreshCell,
	tradeCell,
	wantCell,
} from "./cells.ts";
import {askCell, dropCell, Keys, lentInboxRunner, openCell} from "./lent-cells.ts";
import {lent, lentOver} from "./lent.ts";
import {over, signIn} from "./machine.ts";
import {ask} from "./responses.ts";
import {makeKeys} from "./seal.ts";
import {makeVault, Vault} from "./vault.ts";
import {Auth, boxName} from "./wire.ts";

// Read once, then taken out of this process's environment: nothing the box starts inherits it.
const env = {...process.env};
for (const k of ["LEDGER_TOKEN", "AUTH", "LEDGER_URL", "LEDGER_NAME"]) delete process.env[k];
const need = (k: string) => {
	const v = env[k];
	if (v === undefined || v === "") throw new Error(`box: ${k} is not set`);
	return v;
};

const say = (event: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(event)}\n`);

const box = need("BOX");
const auth = Schema.decodeUnknownSync(Schema.fromJsonString(Auth))(need("AUTH"));
const settings = {
	box,
	who: need("WHO"),
	auth,
	waitMs: Number(env.WAIT_MS ?? 120_000),
	marginMs: Number(env.MARGIN_MS ?? 180_000),
	client: env.CLIENT ? env.CLIENT : null,
	agentName: env.AGENT_NAME ?? "fabrika",
	renew: env.RENEW === "ask" ? ("ask" as const) : ("refresh" as const),
	say,
};
/** `app`: way (c), the person's app lends passes. Otherwise the box signs in (ways a and b). */
const passFrom = env.PASS_FROM === "app" ? "app" : "self";
const holdMs = Number(env.HOLD_MS ?? 0);
const agentCmd: readonly string[] = env.AGENT_CMD ? JSON.parse(env.AGENT_CMD) : [];
const agentUser = env.AGENT_USER ?? "";
const agentDir = env.AGENT_DIR ?? "";

const layer = Layer.mergeAll(
	layerHttp({
		url: need("LEDGER_URL"),
		ledger: need("LEDGER_NAME"),
		token: Redacted.make(need("LEDGER_TOKEN")),
	}),
	Layer.succeed(Vault, makeVault()),
	Layer.succeed(Box, Box.of(settings)),
	Layer.effect(Keys, Effect.promise(makeKeys)),
	NodeServices.layer,
);

/** The agent's commands: an environment made from nothing, its own folder, maybe another user. */
const agent = Effect.gen(function* () {
	if (agentCmd.length === 0) return null;
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
	const [cmd, ...args] =
		agentUser === ""
			? agentCmd
			: ["setpriv", `--reuid=${agentUser}`, `--regid=${agentUser}`, "--clear-groups", ...agentCmd];
	const out = yield* spawner.string(
		ChildProcess.make(cmd ?? "true", args, {
			cwd: agentDir === "" ? undefined : agentDir,
			env: {
				PATH: "/usr/local/bin:/usr/bin:/bin",
				HOME: agentDir === "" ? "/tmp" : agentDir,
				BOX_PID: String(process.pid),
			},
		}),
	);
	try {
		return JSON.parse(out) as unknown;
	} catch {
		return {unread: out.slice(0, 200)};
	}
});

/** Either machine, as the job sees it: where it is, and a way to tell it to end. */
interface Running {
	readonly at: () => string;
	readonly end: Effect.Effect<void>;
	readonly done: Effect.Effect<Record<string, unknown>>;
}

/** Way (a) or (b): the box signs in itself. */
const signInBox = Effect.gen(function* () {
	const runtime = yield* (yield* run(signIn, {
		ctx: undefined,
		interpret: {
			want: wantCell,
			offer: offerCell,
			trade: tradeCell,
			refresh: refreshCell,
			forget: forgetCell,
		},
		subscribe: {inbox: inboxRunner},
		terminal: over,
	})).ready;
	return {
		at: () => runtime.getState().at,
		end: runtime.dispatch({type: "end"}).pipe(Effect.ignore),
		done: runtime.done(),
	} satisfies Running;
});

/** Way (c): the person's app lends the box a pass at a time. */
const lentBox = Effect.gen(function* () {
	const runtime = yield* (yield* run(lent, {
		ctx: undefined,
		interpret: {ask: askCell, open: openCell, drop: dropCell},
		subscribe: {inbox: lentInboxRunner},
		terminal: lentOver,
	})).ready;
	return {
		at: () => runtime.getState().at,
		end: runtime.dispatch({type: "end"}).pipe(Effect.ignore),
		done: runtime.done(),
	} satisfies Running;
});

const main = Effect.gen(function* () {
	const ledger = yield* Ledger;
	const vault = yield* Vault;
	yield* ledger.register(boxName(box), "agent:box");
	const m: Running = passFrom === "app" ? yield* lentBox : yield* signInBox;
	const gone = () => m.at() === "ending" || m.at() === "ended";
	while (!gone() && (yield* vault.held) === null) yield* Effect.sleep(Duration.millis(25));
	if (!gone()) {
		if (holdMs > 0) yield* Effect.sleep(Duration.millis(holdMs));
		const held = gone() ? null : yield* vault.held;
		if (held !== null) {
			const answer = yield* ask(
				auth.api,
				held.access,
				env.MODEL ?? "",
				env.ASK ?? "Say hi in two words.",
			).pipe(Effect.catch((e) => Effect.succeed({error: e.why})));
			say({ev: "answer", ...answer});
			say({
				ev: "agent",
				found: yield* agent.pipe(
					Effect.catch((e) => Effect.succeed({error: String(e).slice(0, 200)})),
				),
			});
			yield* m.end;
		}
	}
	const last = yield* m.done;
	say({ev: "ended", ...last});
}).pipe(Effect.scoped, Effect.provide(layer));

Effect.runPromise(main).then(
	() => process.exit(0),
	(e) => {
		say({ev: "crashed", why: String(e).slice(0, 300)});
		process.exit(1);
	},
);
