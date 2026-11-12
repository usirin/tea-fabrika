import { Machine } from "@demlik/tea/effect";
import { Schema } from "effect";
import { LedgerError } from "../../ledger/Ledger.ts";
import { Entry, valueFor } from "../../ledger/Log.ts";
import { ProcessId } from "../../ProcessId.ts";
import { ExitReason } from "../ExitReason.ts";

/**
 * Every text a client gives that lands in a brain line: at most 256 characters, counted as
 * `string.length`, so no brain line can reach the ledger's per-line limit.
 *
 * @internal
 */
export const Text = Schema.NonEmptyString.check(Schema.isMaxLength(256));

/** @internal */
export const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
/** @internal */
export const Code = Schema.Struct({ program: Text, hash: Text });
/** @internal */
export const Owner = Schema.TaggedUnion({ brain: {}, process: { process: ProcessId } });

/** @internal */
export const Recipient = Schema.TaggedUnion({
  process: { process: ProcessId },
  client: { client: Text, session: ProcessId },
});

/** @internal */
export const Start = Schema.TaggedUnion({
  /** `requester` is who asked for a child (P42); the boot's start and old rows have none. */
  first: { id: Text, name: Text, code: Code, requester: Schema.optionalKey(Recipient) },
  again: { id: Text, name: Text, code: Code, after: ProcessId, reason: Text },
});
/** @internal */
export type Start = typeof Start.Type;

/** @internal */
export const State = Schema.TaggedUnion({
  live: { process: ProcessId, code: Code },
  ended: { process: ProcessId, code: Code, reason: ExitReason },
  down: { process: ProcessId, code: Code, reason: Text, crashes: Count, until: Schema.Int },
});

/** @internal */
export const ProcessEvent = Schema.TaggedUnion({
  registered: { name: Text, program: Text, owner: Owner },
  started: { process: ProcessId, name: Text, program: Text, hash: Text, requester: Schema.optionalKey(Recipient) },
  exited: { process: ProcessId, reason: ExitReason },
  restarted: { process: ProcessId, after: ProcessId, name: Text, reason: Text, build: Text },
  down: { process: ProcessId, reason: Text, crashes: Count, until: Schema.Int },
  monitored: { ref: Text, process: ProcessId, to: Recipient },
  demonitored: {
    ref: Text,
    to: Recipient,
    reason: Schema.Literals(["canceled", "watcher_exited"]),
  },
});

type To = typeof Recipient.Type;

const canonical = (to: To): To =>
  to._tag === "process"
    ? Recipient.cases.process.make({ process: to.process })
    : Recipient.cases.client.make({ client: to.client, session: to.session });

/**
 * The canonical (recipient, ref) key a watch is held under.
 *
 * @internal
 */
export const watchKey = (to: To, ref: string): string => JSON.stringify([canonical(to), ref]);

/**
 * The one id a DOWN for (recipient, ref) in that watch's `round` is written under.
 *
 * @internal
 */
export const signalId = (to: To, ref: string, round: number): string =>
  JSON.stringify(["DOWN", canonical(to), ref, round]);

const watched = { ref: Text, process: ProcessId, to: Recipient, round: Count };

/** `round` counts this (recipient, ref)'s monitored events, so a monitor after a cancel is new. */
const Watch = Schema.TaggedUnion({ live: watched, canceled: watched });

const Life = Schema.Struct({
  name: Schema.String,
  state: State,
  request: Start,
  from: Entry,
  rev: Schema.Number,
  /** The reason it exited with, kept when a later `down` replaces its state. */
  exited: Schema.optionalKey(ExitReason),
});
/** @internal */
export type Life = typeof Life.Type;

const Model = Schema.Struct({
  names: Schema.ReadonlyMap(Schema.String, ProcessEvent.cases.registered),
  lives: Schema.ReadonlyMap(Schema.String, Life),
  watches: Schema.ReadonlyMap(Schema.String, Watch),
  current: Schema.ReadonlyMap(Schema.String, Schema.String),
  restarts: Schema.ReadonlyMap(Schema.String, Schema.Array(Schema.Number)),
});
/** @internal */
export type Model = typeof Model.Type;

const Msg = Schema.Struct({ type: Schema.Literal("recorded"), entry: Entry });

const decodeEvent = Schema.decodeUnknownSync(ProcessEvent);

const put = <V>(map: ReadonlyMap<string, V>, key: string, value: V): ReadonlyMap<string, V> =>
  new Map(map).set(key, value);

/** A lifecycle event names a process the fold has started, or its row is bad. */
const lifeFor = (s: Model, process: string): Life => {
  const life = s.lives.get(process);

  if (life === undefined) {
    throw new LedgerError({ reason: "bad_row" });
  }

  return life;
};

/**
 * The process table's fold: one `recorded` entry at a time. An entry counts only when it is a
 * process event and `by` is the brain's own writer.
 *
 * @internal
 */
export const processTableFor = (by: string) =>
  Machine.make({
    model: Model,
    msg: Msg,
    cmds: [],
    init: () => [
      {
        names: new Map(),
        lives: new Map(),
        watches: new Map(),
        current: new Map(),
        restarts: new Map(),
      },
      [],
    ],
    update: {
      recorded: (s, { entry }) => {
        if (!Object.hasOwn(ProcessEvent.cases, entry._tag) || entry.by !== by) {
          return [s, []];
        }

        const event = decodeEvent(valueFor(entry));

        if (event._tag === "registered") {
          return [{ ...s, names: put(s.names, event.name, event) }, []];
        }

        if (event._tag === "started") {
          const code = { program: event.program, hash: event.hash };
          const life = {
            name: event.name,
            state: State.cases.live.make({ process: event.process, code }),
            request: Start.cases.first.make({
              id: entry.id,
              name: event.name,
              code,
              ...(event.requester === undefined ? {} : { requester: event.requester }),
            }),
            from: entry,
            rev: entry.rev,
          };
          return [
            {
              ...s,
              lives: put(s.lives, event.process, life),
              current: put(s.current, event.name, event.process),
            },
            [],
          ];
        }

        if (event._tag === "monitored") {
          const key = watchKey(event.to, event.ref);
          const round = (s.watches.get(key)?.round ?? 0) + 1;
          const watch = Watch.cases.live.make({
            ref: event.ref,
            process: event.process,
            to: event.to,
            round,
          });
          return [{ ...s, watches: put(s.watches, key, watch) }, []];
        }

        if (event._tag === "demonitored") {
          const key = watchKey(event.to, event.ref);
          const watch = s.watches.get(key);

          if (watch === undefined || watch._tag === "canceled") {
            return [s, []];
          }

          const { ref, process, to, round } = watch;
          const canceled = Watch.cases.canceled.make({ ref, process, to, round });
          return [{ ...s, watches: put(s.watches, key, canceled) }, []];
        }

        const life = lifeFor(s, event.process);

        if (event._tag === "restarted") {
          const request = Start.cases.again.make({
            id: life.request.id,
            name: event.name,
            code: life.state.code,
            after: event.after,
            reason: event.reason,
          });
          const times = [...(s.restarts.get(event.name) ?? []), entry.arrivedAt];
          return [
            {
              ...s,
              lives: put(s.lives, event.process, { ...life, request }),
              restarts: put(s.restarts, event.name, times),
            },
            [],
          ];
        }

        const code = life.state.code;

        if (event._tag === "exited") {
          const state = State.cases.ended.make({ process: event.process, code, reason: event.reason });
          const ended = { ...life, exited: event.reason, state };
          return [{ ...s, lives: put(s.lives, event.process, ended) }, []];
        }

        const state = State.cases.down.make({ ...event, code });
        return [{ ...s, lives: put(s.lives, event.process, { ...life, state }) }, []];
      },
    },
  });
