// Experiment 100's programs, on the package's exports alone:
//
//   worker      counts its inbox. Three planted bugs: `crashAfter` (it counts the message, saves,
//               then dies), a poison message (its pure reducer throws on it while the flag
//               `poisonBug` is on), and a boot crash (it dies before it reads anything while its
//               name is in the flag `bootCrash`). `trap`: `no` (the ledger takes it down on its
//               parent's shutdown), `graceful` (it traps the shutdown and ends itself), `ignore`
//               (it traps the shutdown and runs on: only the kill at its timeout stops it).
//   the tree    top (one_for_one) over sup:all (one_for_all: a:1..a:3) and sup:rest
//               (rest_for_one with restart backoff: r:1..r:3).
//   watcher:1   experiment 99's watcher, with 100's re-arm backoff (50 ms doubling to 1000 ms).
//   flags       a registered name nobody serves. The harness casts the flags into its inbox; a
//               worker reads the last one when it boots and when a poison message comes. A flag
//               in the ledger, so every host process sees the same one.
import {defineMachine} from "@demlik/tea";
import {ExitMessage, streams} from "@tea-fabrika/tea-host";
import {envelope, Self} from "@tea-fabrika/tea-host/host";
import {type SupervisorSpec, supervisor} from "@tea-fabrika/tea-host/supervisor";
import {defineProgram} from "@tea-fabrika/tea-program";
import {input} from "@tea-fabrika/tea-program/shape";
import {Duration, Effect, Exit, Schedule, Schema, Stream} from "effect";

// ---------------------------------------------------------------- the flags

export const Flags = Schema.Struct({
	/** Names that die at boot: the crash loop. */
	bootCrash: Schema.Array(Schema.String),
	/** The poison bug is in: a poison message throws in the reducer. Off: the bug is fixed. */
	poisonBug: Schema.Boolean,
});
export type Flags = typeof Flags.Type;
export const FLAGS = "flags";
const NO_FLAGS: Flags = {bootCrash: [], poisonBug: true};
const decodeFlags = Schema.decodeUnknownExit(Schema.fromJsonString(Flags));

// ---------------------------------------------------------------- the worker

export const Count = Schema.Struct({count: Schema.Number, cursor: Schema.Number});
export type Count = typeof Count.Type;
type Inc = {readonly type: "inc"; readonly rev: number; readonly poison: boolean};

export const counter = defineMachine({
	types: {model: {} as Count, msg: {} as Inc, ctx: undefined},
	cmds: [],
	init: (loaded) => [loaded ?? {count: 0, cursor: 0}, []],
	update: {
		inc: (s, m) => {
			if (m.rev <= s.cursor) return [s, []];
			if (m.poison) throw new Error("poison message");
			return [{count: s.count + 1, cursor: m.rev}, []];
		},
	},
});

const Body = Schema.Struct({
	crashAfter: Schema.optional(Schema.Boolean),
	poison: Schema.optional(Schema.Boolean),
});
const decodeBody = Schema.decodeUnknownExit(Body);
const decodeExit = Schema.decodeUnknownExit(ExitMessage);

export type Trap = "no" | "graceful" | "ignore";

export const worker = (trap: Trap) =>
	defineProgram({
		name: `worker-${trap}`,
		description:
			"Counts its inbox. Dies after a crashAfter message, throws on a poison one while the bug is in, dies at boot while flagged.",
		inputs: {inbox: input(envelope(Schema.Unknown), "One message, maybe with a planted bug.")},
		outputs: {},
		main: ({inputs}) =>
			Effect.gen(function* () {
				const self = yield* Self;
				// The last flags; a ledger that does not answer for a while reads as no flags.
				const flags = self.reads.readLast(streams(FLAGS).inbox, 1).pipe(
					Effect.retry({times: 10, schedule: Schedule.spaced(Duration.millis(50))}),
					Effect.map((rows) => {
						const last = rows.at(-1);
						const f = last === undefined ? null : decodeFlags(last.data);
						return f !== null && Exit.isSuccess(f) ? f.value : NO_FLAGS;
					}),
					Effect.orElseSucceed(() => NO_FLAGS),
				);
				if ((yield* flags).bootCrash.includes(self.name))
					return yield* Effect.die(`planted boot crash in ${self.name}`);
				if (trap !== "no") yield* self.trapExit(true);
				const handle = yield* self.run(
					counter,
					{schema: Count, cursor: (s) => s.cursor},
					{ctx: undefined},
				);
				const machine = yield* handle.ready;
				yield* inputs.inbox.pipe(
					Stream.runForEach((e) =>
						Effect.gen(function* () {
							if (e.kind === "EXIT" && e.from === "ledger") {
								yield* machine.dispatch({type: "inc", rev: e.rev, poison: false});
								const x = decodeExit(e.body);
								if (Exit.isSuccess(x) && x.value.to === self.incarnation && trap === "graceful")
									yield* self.exit("shutdown", "asked to by its parent");
								return;
							}
							const b = decodeBody(e.body);
							const body = Exit.isSuccess(b) ? b.value : {};
							const poison = body.poison === true && (yield* flags).poisonBug;
							yield* machine.dispatch({type: "inc", rev: e.rev, poison});
							if (body.crashAfter === true)
								return yield* Effect.die(`planted defect after ${e.id}`);
						}),
					),
				);
			}).pipe(Effect.scoped),
	});

// ---------------------------------------------------------------- the tree

export const TRAPS: Readonly<Record<string, Trap>> = {
	"a:1": "no",
	"a:2": "graceful",
	"a:3": "ignore",
	"r:1": "no",
	"r:2": "no",
	"r:3": "ignore",
	"t:1": "no",
};
export const WORKERS = ["a:1", "a:2", "a:3", "r:1", "r:2", "r:3"] as const;
export const SUPERVISORS = ["top", "sup:all", "sup:rest"] as const;
/** Every name the watcher keeps a monitor on. */
export const WATCHED = [...SUPERVISORS, ...WORKERS];
/** The watcher's re-arm backoff: 50 ms, doubling, at most 1000 ms. */
export const RETRY = {retryMs: 50, maxRetryMs: 1000};

export const SPECS = {
	top: {
		strategy: "one_for_one",
		intensity: 3,
		periodMs: 60_000,
		children: [
			{name: "sup:all", restart: "permanent", type: "supervisor"},
			{name: "sup:rest", restart: "permanent", type: "supervisor"},
		],
	},
	"sup:all": {
		strategy: "one_for_all",
		intensity: 3,
		periodMs: 5000,
		children: [
			{name: "a:1", restart: "permanent"},
			{name: "a:2", restart: "permanent", shutdown: 300},
			{name: "a:3", restart: "permanent", shutdown: "brutal_kill"},
		],
	},
	"sup:rest": {
		strategy: "rest_for_one",
		intensity: 3,
		periodMs: 5000,
		backoff: {minMs: 100, maxMs: 800, resetAfterMs: 5000},
		children: [
			{name: "r:1", restart: "permanent"},
			{name: "r:2", restart: "permanent"},
			{name: "r:3", restart: "permanent", shutdown: 100},
		],
	},
} as const satisfies Record<(typeof SUPERVISORS)[number], SupervisorSpec>;

export const supervisorProgram = (name: (typeof SUPERVISORS)[number]) => {
	const sup = supervisor(name, SPECS[name]);
	if (!sup.ok) throw new Error(`${name}: the spec is refused: ${sup.why}`);
	return sup.program;
};
