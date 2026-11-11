import { layer as nodeServices } from "@effect/platform-node/NodeServices";
import {
  Cause,
  Clock,
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Option,
  PubSub,
  Random,
  Schedule,
  Scope,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { isAgentName } from "../../host/door.ts";
import { type Ended, type RunningOf, start } from "../../program/program.ts";
import type { Storage } from "../../program/storage.ts";
import {
  type AgentState,
  type Summoned,
  SummonManager,
  SummonRefused,
  type Talk,
  type TurnNews,
} from "../../shell/summon.ts";
import { AGENTS } from "../acp/harness.ts";
import type { acpInRepo } from "../acp/program.ts";
import type { Transcript } from "../acp/transcript.ts";
import { type Name, openNames } from "./names.ts";

// The host's summoned agents: each name with its `acp` run, in the person's repository, kept
// across a host restart. tsh's `summon`, `dismiss`, `agents` and each `turn` job speak to it
// (../../shell/summon.ts).
//
//   const manager = yield* SummonManager;     // summonManager({storage, folder}) in the host's layer
//   yield* manager.summon({agent: "fake", settings: ["fake-large", "high"], name: "scout", by})
//   // acp starts in the repo, opens a session (no model called), sets fake-large and high, keeps scout
//   manager.turn("scout", "read a.txt", null)
//   // told {turn: 1}, status "Read a.txt · 1 tool · 0s", said "a.txt: ...", result {stop: "end_turn"}
//
// A setting word is sorted into the harness's own lists, which its session offers: one word goes
// to whichever list has it, two are a model then an effort. A word in neither is refused with the
// lists, before any paid turn (S4). Each edit the agent asks for waits for the person
// (`--permissions ask`); the harness's fence keeps writes outside the repository closed.
//
// A host started again opens each kept name again in the background, in the same session: the
// agent keeps running between turns (T1), and opening a session calls no model. One that will not
// open is `down`, with its why, and a turn to it says so.

/** The words no agent is named: they mean a group, or the person. */
const RESERVED = ["all", "here", "everyone", "me"];

/** How long a harness may take to open its session, and a cancel to end its turn. */
const OPENING = Duration.seconds(60);
const CANCELLING = Duration.seconds(10);

type Acp = RunningOf<typeof acpInRepo>;

/** What the acp run of a name says, as it says it. */
type Heard =
  | { readonly _tag: "told"; readonly turn: number }
  | { readonly _tag: "down"; readonly why: string }
  | { readonly _tag: "said"; readonly text: string }
  | {
      readonly _tag: "result";
      readonly turn: number;
      readonly stop: string;
      readonly cost: number | null;
      /** The turn's tokens, as the harness reported them. `null`: it reported none. */
      readonly input: number | null;
      readonly output: number | null;
    }
  | { readonly _tag: "ask"; readonly ask: string; readonly title: string; readonly answer: string };

interface Opened {
  readonly models: readonly string[];
  readonly efforts: readonly string[];
  readonly model: string | null;
}

/** A name's agent while the host runs. */
interface Live {
  name: Name;
  readonly scope: Scope.Closeable;
  readonly heard: PubSub.PubSub<Heard>;
  /** This start's latest turn, for a job attached after its agent reopened. */
  readonly history: Heard[];
  /** One turn at a time: a turn holds it from its prompt to its result. */
  readonly permit: Semaphore.Semaphore;
  /** Done once its session is open, with what it offers, or failed with why it would not open. */
  readonly opened: Deferred.Deferred<Opened, SummonRefused>;
  /** Done once its settings are set too, and a turn may start; failed with why it is down. */
  readonly ready: Deferred.Deferred<void, SummonRefused>;
  acp: Acp | null;
  state: AgentState;
  /** The turn running now, by the number acp gave it. */
  turn: number | null;
  cost: number | null;
  /** Why it is down. */
  why: string | null;
}

const refuse = (why: string) => Effect.fail(new SummonRefused({ why }));

/**
 * acp's program, and the agents' SDKs it brings: loaded at the first summon, as most hosts summon
 * none and every host started pays for what it loads (apps/fabrika's bundles.test.ts holds this).
 * It can fail: a host that outlives a rebuild can find its files gone.
 */
const acpCode = Effect.tryPromise({
  try: () => import("../acp/program.ts"),
  catch: (e) => new SummonRefused({ why: `acp would not load: ${String(e)}` }),
});

/** A name's agent as `agents` lists it. */
const summonedOf = (live: Live): Summoned => ({
  name: live.name.name,
  agent: live.name.agent,
  model: live.name.model,
  effort: live.name.effort,
  folder: live.name.folder,
  since: live.name.since,
  by: live.name.by,
  state: live.state,
  cost: live.cost,
});

/** Why a name cannot be summoned, or `null`: it can. */
const badName = (name: string): string | null => {
  if (name !== name.toLowerCase() && isAgentName(name.toLowerCase())) {
    return `${name}: an agent's name is in lower case: ${name.toLowerCase()}`;
  }

  if (RESERVED.includes(name)) {
    return `${name} means a group or you: pick another name`;
  }

  if (!isAgentName(name)) {
    return `${JSON.stringify(name)} is not a name: lower-case letters, digits, dots, dashes and underscores, 64 at most, starting with a letter or digit`;
  }

  return null;
};

/** The setting words sorted into a model and an effort, by the lists the harness offers. */
const sorted = (
  agent: string,
  words: readonly string[],
  o: Opened,
): { readonly model: string | null; readonly effort: string | null } | string => {
  const lists = `${agent}'s models: ${o.models.join(", ") || "none"}; efforts: ${o.efforts.join(", ") || "none"}`;
  const [one, two] = words;

  if (one === undefined) {
    return { model: null, effort: null };
  }

  if (two === undefined) {
    if (o.models.includes(one)) {
      return { model: one, effort: null };
    }

    if (o.efforts.includes(one)) {
      return { model: null, effort: one };
    }

    return `${one} is not a model or an effort ${agent} offers. ${lists}`;
  }

  if (!o.models.includes(one)) {
    return `${one} is not a model ${agent} offers. ${lists}`;
  }

  if (!o.efforts.includes(two)) {
    return `${two} is not an effort ${agent} offers. ${lists}`;
  }

  return { model: one, effort: two };
};

/** The status of turn `n`, from acp's transcript: what it does now, its tools, its seconds. */
const statusOf = (s: Transcript | null, n: number | null, ms: number): string => {
  const tools = s === null || n === null ? [] : s.tools.filter((t) => t.turn === n);
  const running = tools.findLast((t) => t.status === "pending" || t.status === "in_progress");
  const doing = (s?.asks.length ?? 0) > 0 ? "asking you" : running === undefined ? "thinking" : running.title;
  const count = tools.length === 0 ? [] : [`${tools.length} tool${tools.length === 1 ? "" : "s"}`];
  return [doing, ...count, `${Math.floor(ms / 1000)}s`].join(" · ");
};

/**
 * The summoned agents as they change: every summon, dismiss and change of state, for a host that
 * shows them (the app's top bar). Given beside `SummonManager` by `summonManager`.
 */
export class SummonedNow extends Context.Service<
  SummonedNow,
  {
    readonly changes: Stream.Stream<readonly Summoned[]>;
    /** What Tab offers for talk: the agents, each harness's last settings, the names now. */
    readonly talk: Stream.Stream<Talk>;
  }
>()("@kampus/fabrika-old/SummonedNow") {}

/** One summon or ended turn, as a record keeps it. What the harness did not say is `null`. */
export interface SummonRecord {
  readonly name: string;
  readonly agent: string;
  readonly folder: string;
  readonly run: string;
  readonly model: string | null;
  readonly effort: string | null;
  readonly by: string;
  readonly input: number | null;
  readonly output: number | null;
  readonly cost: number | null;
  readonly at: number;
}

/**
 * The git working tree a folder is in, by its real top folder, or `null` when it is in none or
 * cannot be read. Links resolve and a subfolder gives its tree's top, so two spellings of one
 * project give one root; another clone or worktree gives its own. git is asked, never guessed.
 */
const rootOf = (folder: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const real = yield* fs.realPath(folder);
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* spawner.spawn(
      ChildProcess.make("git", ["-C", real, "rev-parse", "--show-toplevel"], {
        // Only what git needs: an inherited GIT_DIR or GIT_WORK_TREE would answer for another tree.
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/" },
        extendEnv: false,
      }),
    );
    const [out, code] = yield* Effect.all([handle.stdout.pipe(Stream.decodeText(), Stream.mkString), handle.exitCode], {
      concurrency: "unbounded",
    });
    const top = out.trim();
    return Number(code) === 0 && top !== "" ? yield* fs.realPath(top) : null;
  }).pipe(
    Effect.scoped,
    Effect.orElseSucceed(() => null),
    Effect.provide(nodeServices),
  );

/**
 * The host's summoned agents, kept in `storage`, working in the repository `folder`: the
 * `SummonManager`, and `SummonedNow` beside it.
 */
export const summonManager = (options: {
  readonly storage: Storage;
  readonly folder: string;
  /**
   * Keep a record of each summon and each ended turn, as the host's records keep them (the app's
   * host/records.ts): what a name meant at that time, and what the turn cost as the harness said.
   */
  readonly record?: ((kind: "summon" | "turn", row: SummonRecord) => Effect.Effect<void>) | undefined;
}): Layer.Layer<SummonManager | SummonedNow> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const { storage, folder } = options;
      const record = options.record ?? (() => Effect.void);
      const scope = yield* Effect.scope;
      const kept = yield* openNames(storage);
      const live = new Map<string, Live>();
      /** Names being summoned now, not yet kept: a second summon of one is refused. */
      const pending = new Set<string>();

      const now = yield* SubscriptionRef.make<readonly Summoned[]>([]);
      /** Each harness's models and efforts, from its last open, for Tab after `summon claude `. */
      const offers = new Map<string, readonly string[]>();
      const talkNow = yield* SubscriptionRef.make<Talk>({ agents: AGENTS, offers: {}, names: [] });
      /** Say the agents again, as they are now, to whoever shows them. */
      const changed = () => {
        const all = [...live.values()].map(summonedOf);
        Effect.runSync(SubscriptionRef.set(now, all));
        Effect.runSync(
          SubscriptionRef.set(talkNow, {
            agents: AGENTS,
            offers: Object.fromEntries(offers),
            names: all.map((a) => a.name),
          }),
        );
      };
      const setState = (l: Live, state: Live["state"]) => {
        l.state = state;
        changed();
      };
      const put = (name: string, l: Live) => {
        live.set(name, l);
        changed();
      };

      /**
       * Start a name's acp run, and hear it. Answers at once; `opened` is done once its session is
       * open. A run keeps the flags it was first started with, so no setting is a flag: each is set
       * after the session opens (`settle`), at every start. It runs in `at`, the name's own folder,
       * or its project's root when that folder spells the root another way (a link, a subfolder).
       */
      const open = (name: Name, at: string = name.folder) =>
        Effect.gen(function* () {
          const { acpInRepo } = yield* acpCode;
          const own = yield* Scope.fork(scope);
          const heard = yield* PubSub.unbounded<Heard>();
          const l: Live = {
            name,
            scope: own,
            heard,
            history: [],
            permit: yield* Semaphore.make(1),
            opened: yield* Deferred.make<Opened, SummonRefused>(),
            ready: yield* Deferred.make<void, SummonRefused>(),
            acp: null,
            state: "opening",
            turn: null,
            cost: null,
            why: null,
          };
          const hear = (h: Heard) => {
            if (h._tag === "told") {
              l.history.length = 0;
              l.turn = h.turn;
              setState(l, "turn");
            } else if (h._tag === "ask") {
              setState(l, h.answer === "waiting" ? "asking" : "turn");
            } else if (h._tag === "result") {
              l.turn = null;
              l.cost = h.cost ?? l.cost;
              setState(l, "idle");
            }

            l.history.push(h);
            PubSub.publishUnsafe(heard, h);
          };
          const started = yield* start(
            acpInRepo,
            {
              agent: name.agent as (typeof AGENTS)[number],
              folder: at,
              model: undefined,
              effort: undefined,
              // Codex has no asks of its own to wait on: it runs read-only in a person's repo.
              mode: name.agent === "codex" ? "read-only" : undefined,
              permissions: "ask",
              reopen: undefined,
              budget: undefined,
            },
            {
              opened: (o) => {
                offers.set(name.agent, [...o.models, ...o.efforts]);
                changed();
                Deferred.doneUnsafe(l.opened, Exit.succeed({ models: o.models, efforts: o.efforts, model: o.model }));
              },
              told: (t) => hear({ _tag: "told", turn: t.turn }),
              said: (text) => hear({ _tag: "said", text }),
              result: (r) =>
                hear({
                  _tag: "result",
                  turn: r.turn,
                  stop: r.stop,
                  cost: r.cost,
                  input: r.input,
                  output: r.output,
                }),
              ask: (a) => hear({ _tag: "ask", ask: a.ask, title: a.title, answer: a.answer }),
            },
            { id: name.run, storage },
          ).pipe(Effect.provide(nodeServices), Scope.provide(own));

          if (started.kind !== "running") {
            yield* Scope.close(own, Exit.void);
            return yield* refuse(`${name.agent} would not start: ${started.why}`);
          }

          l.acp = started;
          // A run that ends on its own is down: it opens no more turns.
          yield* started.run.ended.pipe(
            Effect.flatMap((end) =>
              Effect.sync(() => {
                if (live.get(name.name) !== l) {
                  return;
                }

                l.why = whyOf(end) ?? `${name.agent} ended`;
                setState(l, "down");
                const down = Exit.fail(new SummonRefused({ why: l.why }));
                Deferred.doneUnsafe(l.opened, down);
                Deferred.doneUnsafe(l.ready, down);
                hear({ _tag: "down", why: l.why });
              }),
            ),
            Effect.forkIn(own),
          );
          return l;
        });

      /** Stop a name's run and let go of it. */
      const close = (l: Live) =>
        Effect.gen(function* () {
          if (live.get(l.name.name) === l) {
            live.delete(l.name.name);
          }

          changed();
          yield* Scope.close(l.scope, Exit.void);
          yield* PubSub.shutdown(l.heard);
          yield* storage.remove(l.name.run).pipe(Effect.mapError((e) => new SummonRefused({ why: e.message })));
        });

      /** Ask a name's turn to end cancelled, and wait until it has. */
      const cancelTurn = (l: Live, accepted = false) =>
        Effect.gen(function* () {
          if (l.acp === null || l.state === "down" || (!accepted && l.state !== "turn" && l.state !== "asking")) {
            return;
          }

          const ended = yield* PubSub.subscribe(l.heard);
          yield* l.acp.run.tell("cancel", "now").pipe(Effect.ignore);
          yield* Stream.fromSubscription(ended).pipe(
            Stream.filter((h) => h._tag === "result" || h._tag === "down"),
            Stream.take(1),
            Stream.runDrain,
            Effect.timeout(CANCELLING),
            Effect.ignore,
          );
        }).pipe(Effect.scoped);

      /** Wait for a name's session to open: what it offers, or why it would not open. */
      const opening = (l: Live) =>
        Deferred.await(l.opened).pipe(
          Effect.timeout(OPENING),
          Effect.catch((e) =>
            refuse(
              e instanceof SummonRefused
                ? e.why
                : `${l.name.agent} did not open a session in ${Duration.format(OPENING)}`,
            ),
          ),
        );

      /**
       * Set a model and an effort on a name's open session, by acp's own inputs, and answer what
       * the harness says is set. Refused when it did not take one.
       */
      const settle = (l: Live, o: Opened, words: { readonly model: string | null; readonly effort: string | null }) =>
        Effect.gen(function* () {
          const set = { model: o.model, effort: null as string | null };
          const acp = l.acp;

          if (acp === null || (words.model === null && words.effort === null)) {
            return set;
          }

          const heard = yield* PubSub.unbounded<{
            readonly model: string | null;
            readonly effort: string | null;
          }>();
          const sub = yield* PubSub.subscribe(heard);
          const unlisten = acp.run.listen("settings", (now) => {
            PubSub.publishUnsafe(heard, now);
          });
          yield* Effect.addFinalizer(() => Effect.sync(unlisten));

          for (const [input, value] of [
            ["model", words.model],
            ["effort", words.effort],
          ] as const) {
            if (value === null) {
              continue;
            }

            yield* acp.run.tell(input, value).pipe(Effect.ignore);
            const now = yield* PubSub.take(sub).pipe(
              Effect.timeout(OPENING),
              Effect.catch(() => refuse(`${l.name.agent} did not set its ${input}`)),
            );
            set.model = now.model;
            set.effort = now.effort;

            if ((input === "model" ? now.model : now.effort) !== value) {
              return yield* refuse(`${l.name.agent} did not take the ${input} ${value}`);
            }
          }

          return set;
        }).pipe(Effect.scoped);

      /** A name is ready for turns: idle, or down with why. */
      const readied = (l: Live, done: Exit.Exit<void, SummonRefused>) =>
        Effect.sync(() => {
          if (Exit.isFailure(done)) {
            const why = Cause.findErrorOption(done.cause);
            l.why = Option.isSome(why) ? why.value.why : `${l.name.agent} would not open`;
            setState(l, "down");
          } else if (l.state === "opening") {
            setState(l, "idle");
          }

          Deferred.doneUnsafe(l.ready, done);
        });

      /** A kept name that does not open: listed down with why, its saved folder as it was. */
      const downOf = (name: Name, failure: SummonRefused) =>
        Effect.gen(function* () {
          const down: Live = {
            name,
            scope: yield* Scope.fork(scope),
            heard: yield* PubSub.unbounded<Heard>(),
            history: [],
            permit: yield* Semaphore.make(1),
            opened: yield* Deferred.make<Opened, SummonRefused>(),
            ready: yield* Deferred.make<void, SummonRefused>(),
            acp: null,
            state: "down",
            turn: null,
            cost: null,
            why: failure.why,
          };
          Deferred.doneUnsafe(down.opened, Exit.fail(failure));
          Deferred.doneUnsafe(down.ready, Exit.fail(failure));
          put(name.name, down);
        });

      // A host started again: each kept name opens again, in the background, with its settings.
      // One summoned in another project stays down: it is never reopened here, and its folder is
      // never rewritten, so the project it was for still finds it. A project is its git root, so a
      // folder spelled another way (a link, a subfolder, a trailing slash) is still this one.
      const own = yield* Effect.cached(rootOf(folder));

      for (const name of kept.now().names) {
        const root = name.folder === folder ? folder : yield* rootOf(name.folder);

        if (root === null || (root !== folder && root !== (yield* own))) {
          yield* downOf(
            name,
            new SummonRefused({
              why:
                root === null
                  ? `${name.name} was summoned in a folder that is no longer a git repository: open its project again to use it`
                  : `${name.name} was summoned in another project: open that project to use it`,
            }),
          );
          continue;
        }

        const l = yield* open(name, root).pipe(Effect.result);

        if (l._tag === "Failure") {
          yield* downOf(name, l.failure);
          continue;
        }

        const agent = l.success;
        put(name.name, agent);
        yield* opening(agent).pipe(
          Effect.flatMap((o) => settle(agent, o, { model: name.model.resolved, effort: name.effort.set })),
          Effect.exit,
          Effect.flatMap((done) => readied(agent, Exit.asVoid(done))),
          Effect.forkIn(agent.scope),
        );
      }

      const log = (message: string, fields: Record<string, unknown>) =>
        Effect.logInfo(message).pipe(Effect.annotateLogs(fields));

      const manager: SummonManager["Service"] = {
        summon: ({ agent, settings, name, by }) =>
          Effect.gen(function* () {
            const bad = badName(name);

            if (bad !== null) {
              return yield* refuse(bad);
            }

            const taken = live.get(name);

            if (taken !== undefined) {
              return yield* refuse(
                `${name} is already ${taken.name.agent} ${taken.name.model.resolved ?? "with its default model"}, summoned by ${taken.name.by}: dismiss ${name} first`,
              );
            }

            if (pending.has(name)) {
              return yield* refuse(`${name} is being summoned now`);
            }

            if (!(AGENTS as readonly string[]).includes(agent)) {
              return yield* refuse(`no agent named ${agent}: ${AGENTS.join(", ")}`);
            }

            pending.add(name);
            return yield* Effect.gen(function* () {
              const hex = (yield* Random.nextIntBetween(0, 0xffffffff)).toString(16);
              const since = yield* Clock.currentTimeMillis;
              const first: Name = {
                name,
                agent,
                run: `acp:${name}-${hex.padStart(8, "0")}`,
                model: { typed: null, resolved: null },
                effort: { typed: null, set: null },
                folder,
                since,
                by,
              };
              const l = yield* open(first);
              const gone = (why: string) => close(l).pipe(Effect.andThen(refuse(why)));
              const o = yield* opening(l).pipe(Effect.catch((e) => gone(e.why)));
              const words = sorted(agent, settings, o);

              if (typeof words === "string") {
                return yield* gone(words);
              }

              const set = yield* settle(l, o, words).pipe(Effect.catch((e) => gone(e.why)));
              l.name = {
                ...first,
                model: { typed: words.model, resolved: set.model },
                effort: { typed: words.effort, set: set.effort },
              };

              if (!(yield* kept.take(l.name))) {
                return yield* gone(`${name} was summoned meanwhile: dismiss ${name} first`);
              }

              put(name, l);
              yield* readied(l, Exit.void);
              yield* log("summoned", {
                by,
                name,
                agent,
                model_typed: words.model ?? "",
                model: set.model ?? "",
                effort_typed: words.effort ?? "",
                effort: set.effort ?? "",
                folder,
                run: l.name.run,
              });
              yield* record("summon", {
                name,
                agent,
                folder,
                run: l.name.run,
                model: set.model ?? null,
                effort: set.effort ?? null,
                by,
                input: null,
                output: null,
                cost: null,
                at: since,
              });
              return summonedOf(l);
            }).pipe(Effect.ensuring(Effect.sync(() => pending.delete(name))));
          }),

        dismiss: (name, by) =>
          Effect.gen(function* () {
            const l = live.get(name);

            if (l === undefined) {
              return yield* refuse(`no agent named ${name} is summoned`);
            }

            const cut = l.state === "turn" || l.state === "asking" ? l.turn : null;
            yield* cancelTurn(l);
            yield* kept.free(name);
            yield* close(l);
            yield* log("dismissed", { by, name, run: l.name.run, cut: cut ?? "" });
            return { cut };
          }),

        list: Effect.sync(() => [...live.values()].map(summonedOf)),
        identify: (name, turn) =>
          Effect.gen(function* () {
            const l = live.get(name);

            if (l === undefined || !l.history.some((h) => h._tag === "told" && h.turn === turn)) {
              return yield* refuse(`${name}: turn ${turn} is no longer available`);
            }

            return { run: l.name.run };
          }),

        turn: (name, prompt, room, resume) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const l = live.get(name);

              if (l === undefined) {
                return yield* refuse(`no agent named ${name} is summoned`);
              }

              yield* Deferred.await(l.ready).pipe(
                Effect.mapError((e) => new SummonRefused({ why: `${name} is down: ${e.why}` })),
              );
              yield* Effect.acquireRelease(l.permit.take(1), () => l.permit.release(1));
              const acp = l.acp;

              if (acp === null || live.get(name) !== l) {
                return yield* refuse(`${name} was dismissed`);
              }

              if (l.state === "down") {
                return yield* refuse(`${name} is down: ${l.why}`);
              }

              if (resume !== undefined && resume.run !== l.name.run) {
                return yield* refuse(`${name} is a different agent now: this job belongs to ${resume.run}`);
              }

              const heard = yield* PubSub.subscribe(l.heard);
              const past = resume === undefined ? [] : [...l.history];
              const began = yield* Clock.currentTimeMillis;
              let mine: number | null = resume?.turn ?? null;

              if (resume === undefined) {
                yield* Effect.acquireRelease(
                  Effect.gen(function* () {
                    const word = yield* acp.run
                      .tell("prompt", prompt)
                      .pipe(Effect.catchTag("MailboxFull", () => Effect.succeed("full")));

                    if (word !== "queued") {
                      return yield* refuse(`${name} took nothing: ${word}`);
                    }
                  }),
                  // Until told, this stream owns the accepted prompt of this exact run.
                  () => (mine === null ? cancelTurn(l, true) : Effect.void),
                );
                yield* log("turn_told", {
                  name,
                  agent: l.name.agent,
                  run: l.name.run,
                  room: room ?? "",
                });
              }

              let ended: Extract<Heard, { _tag: "result" }> | null = null;
              const since = Effect.map(Clock.currentTimeMillis, (now) => now - began);
              const news = Stream.concat(
                Stream.fromIterable(past),
                Stream.fromSubscription(heard).pipe(Stream.filter((h) => !past.includes(h))),
              ).pipe(
                Stream.mapEffect((h) =>
                  h._tag === "down"
                    ? refuse(h.why)
                    : Effect.map(since, (ms): readonly TurnNews[] => {
                        if (h._tag === "told") {
                          if (mine !== null) {
                            return [];
                          }

                          mine = h.turn;
                          return [{ _tag: "told", turn: h.turn }];
                        }

                        if (mine === null) {
                          return [];
                        }

                        if (h._tag === "said") {
                          return [{ _tag: "said", text: h.text }];
                        }

                        if (h._tag === "ask") {
                          return h.answer === "waiting"
                            ? [{ _tag: "ask", ask: h.ask, title: h.title }]
                            : [{ _tag: "answered", ask: h.ask, allow: h.answer === "allowed" }];
                        }

                        if (h.turn !== mine) {
                          return [];
                        }

                        ended = h;
                        return [{ _tag: "result", stop: h.stop, ms, cost: h.cost }];
                      }),
                ),
                Stream.flatMap((all) => Stream.fromIterable(all)),
                Stream.takeUntil((n) => n._tag === "result"),
                // What the name meant as the turn began, and what the turn cost as it ended.
                Stream.tap((n) =>
                  n._tag === "told"
                    ? log("turn_began", {
                        name,
                        agent: l.name.agent,
                        run: l.name.run,
                        turn: n.turn,
                        room: room ?? "",
                        at: began,
                      })
                    : n._tag === "result"
                      ? log(
                          "turn_ended",
                          // What the harness did not report stays out of the line, never a 0.
                          present({
                            name,
                            run: l.name.run,
                            turn: mine,
                            stop: n.stop,
                            ms: n.ms,
                            input: ended?.input ?? null,
                            output: ended?.output ?? null,
                            cost: n.cost,
                          }),
                        ).pipe(
                          Effect.andThen(
                            record("turn", {
                              name,
                              agent: l.name.agent,
                              folder: l.name.folder,
                              run: l.name.run,
                              model: l.name.model.resolved,
                              effort: l.name.effort.set,
                              by: l.name.by,
                              input: ended?.input ?? null,
                              output: ended?.output ?? null,
                              cost: n.cost ?? null,
                              at: began,
                            }),
                          ),
                        )
                      : Effect.void,
                ),
              );
              const status = Stream.fromSchedule(Schedule.spaced(Duration.millis(500))).pipe(
                Stream.mapEffect(() =>
                  Effect.map(since, (ms): TurnNews | null =>
                    mine === null
                      ? null
                      : {
                          _tag: "status",
                          text: statusOf(acp.run.machines.transcript.state() as Transcript | null, mine, ms),
                        },
                  ),
                ),
                Stream.filter((n): n is TurnNews => n !== null),
                Stream.changesWith((a, b) => a._tag === "status" && b._tag === "status" && a.text === b.text),
              );
              return Stream.merge(news, status, { haltStrategy: "left" });
            }),
          ),

        cancel: (name, mine) =>
          Effect.suspend(() => {
            const l = live.get(name);

            if (
              l === undefined ||
              (mine !== undefined && (l.turn !== mine.turn || (mine.run !== undefined && l.name.run !== mine.run)))
            ) {
              return Effect.void;
            }

            return cancelTurn(l);
          }),

        answer: (name, ask, allow, by) =>
          Effect.suspend(() => {
            const acp = live.get(name)?.acp;

            if (acp === undefined || acp === null) {
              return Effect.void;
            }

            return acp.run
              .tell(allow ? "allow" : "refuse", ask)
              .pipe(Effect.ignore, Effect.andThen(log("ask_answered", { name, ask, allow: String(allow), by })));
          }),
      };
      return Context.make(SummonManager, manager).pipe(
        Context.add(SummonedNow, {
          changes: SubscriptionRef.changes(now),
          talk: SubscriptionRef.changes(talkNow),
        }),
      );
    }),
  );

/** A log line's fields, each one known: a field that is `null` is left out. */
const present = (fields: Readonly<Record<string, unknown>>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== undefined));

/** Why a run failed, in its own words: its declared failure's message. */
const whyOf = (end: Ended<unknown>): string | null => {
  if (end.kind !== "failed") {
    return null;
  }

  const declared = Cause.findErrorOption(end.cause);

  if (Option.isNone(declared)) {
    return null;
  }

  const { message } = declared.value as { readonly message?: unknown };
  return typeof message === "string" ? message : null;
};
