/**
 * Fault requests and bounded history checks, without outside effects.
 * @stability unstable
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Id from "../Id.ts";
import { ProcessEvent } from "../processes/Process.ts";
import { ProcessId } from "../ProcessId.ts";

const Count = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const Positive = Count.check(Schema.isGreaterThanOrEqualTo(1));
const Text = Schema.NonEmptyString;

/**
 * An experiment's identity, shared by its requests and answers.
 *
 * @stability unstable
 * @category schemas
 */
export const ExperimentId = Id.make("chaos");

/**
 * A checked checklist binding at the time the experiment starts.
 *
 * @stability unstable
 * @category schemas
 */
export const Target = Schema.Struct({
  program: Schema.Literal("fabrika/checklist"),
  name: Text,
  process: ProcessId,
  client: Text,
  key: Text,
});
/**
 * The decoded Target value.
 *
 * @stability unstable
 * @category models
 */
export type Target = typeof Target.Type;

/**
 * The faults a trusted adapter may perform. Keys here are public identities.
 *
 * @stability unstable
 * @category schemas
 */
export const Fault = Schema.TaggedUnion({
  drop_socket: { client: Text },
  drop_answer: { client: Text },
  delay: { client: Text, ms: Positive },
  abort: { target: Schema.Literals(["connection", "process", "project"]), name: Text },
  abort_all: {},
  fail_step: { process: ProcessId, times: Schema.Literals([1, 3]) },
  revoke_key: { client: Text, key: Text },
});
/**
 * The decoded Fault value.
 *
 * @stability unstable
 * @category models
 */
export type Fault = typeof Fault.Type;

/**
 * Required experiment inputs. No rate or cap is supplied implicitly.
 *
 * @stability unstable
 * @category schemas
 */
export const Start = Schema.Struct({
  id: ExperimentId,
  seed: Positive.check(Schema.isLessThanOrEqualTo(0xffffffff)),
  target: Target,
  most: Positive,
  gap: Positive,
});

/**
 * One fault request, identified within its experiment.
 *
 * @stability unstable
 * @category schemas
 */
export const Fire = Schema.Struct({ id: ExperimentId, ordinal: Positive, target: Target, fault: Fault });
/**
 * The decoded Fire value.
 *
 * @stability unstable
 * @category models
 */
export type Fire = typeof Fire.Type;

/**
 * The actual process hit, with the ledger revision preceding the fault.
 *
 * @stability unstable
 * @category schemas
 */
export const Hit = Schema.Struct({ name: Text, process: ProcessId, after: Count });
/**
 * The decoded Hit value.
 *
 * @stability unstable
 * @category models
 */
export type Hit = typeof Hit.Type;

/**
 * A refusal is data. An unknown hit supplies no process recovery claim.
 *
 * @stability unstable
 * @category schemas
 */
export const Fired = Schema.TaggedUnion({
  fired: { hit: Schema.NullOr(Hit) },
  refused: { reason: Schema.Literals(["off", "bad_target", "not_granted", "stale", "unreachable"]) },
});
/**
 * The decoded Fired value.
 *
 * @stability unstable
 * @category models
 */
export type Fired = typeof Fired.Type;

/**
 * Counts over the observed inbox interval, without an inferred prefix or suffix.
 *
 * @stability unstable
 * @category schemas
 */
export const Counts = Schema.Struct({ letters: Count, doubled: Count, gaps: Count });

/**
 * A public restart fact, with its ledger reference and arrival clock.
 *
 * @stability unstable
 * @category schemas
 */
export const Restart = Schema.Struct({
  ref: Text,
  rev: Positive,
  arrivedAt: Schema.Int,
  name: Text,
  after: ProcessId,
  process: ProcessId,
});

/**
 * A bounded check. Its two stream boundaries are separate snapshots.
 *
 * @stability unstable
 * @category schemas
 */
export const Report = Schema.Struct({
  ...Counts.fields,
  stream: Text,
  boundary: Count,
  processStream: Text,
  processBoundary: Count,
  restarts: Schema.Array(Restart),
});
/**
 * The decoded Report value.
 *
 * @stability unstable
 * @category models
 */
export type Report = typeof Report.Type;

/**
 * Evidence for the first replacement of an actual hit.
 *
 * @stability unstable
 * @category schemas
 */
export const Recovery = Schema.Struct({ ref: Text, rev: Positive, arrivedAt: Schema.Int, process: ProcessId });

/**
 * Count IDs and distinct positions; bodies and global revisions do not decide.
 *
 * @stability unstable
 * @category checking
 */
export const checkHistory = (
  letters: ReadonlyArray<{ readonly id: string; readonly pos: number }>,
): typeof Counts.Type => {
  const ids = new Set<string>();
  const positions = new Set<number>();
  let minimum = Infinity;
  let maximum = -Infinity;

  for (const letter of letters) {
    ids.add(letter.id);
    positions.add(letter.pos);
    minimum = Math.min(minimum, letter.pos);
    maximum = Math.max(maximum, letter.pos);
  }

  return {
    letters: letters.length,
    doubled: letters.length - ids.size,
    gaps: letters.length === 0 ? 0 : maximum - minimum + 1 - positions.size,
  };
};

type RestartEntry = {
  readonly id: string;
  readonly stream: string;
  readonly rev: number;
  readonly arrivedAt: number;
  readonly body: unknown;
};

const RestartBody = ProcessEvent.cases.restarted.mapFields(({ _tag, ...fields }) => fields);

const RecordedRestart = Schema.TaggedStruct("restarted", {
  id: Text,
  stream: Text,
  rev: Positive,
  arrivedAt: Schema.Int,
  body: RestartBody,
});

const decodeRestart = Schema.decodeUnknownOption(RecordedRestart);

/**
 * Project only public restart facts from their registered name's stream.
 *
 * @stability unstable
 * @category checking
 */
export const restarts = (entries: ReadonlyArray<RestartEntry>): ReadonlyArray<typeof Restart.Type> =>
  entries.flatMap((entry) => {
    const event = decodeRestart(entry);

    if (Option.isNone(event) || entry.stream !== `processes/${event.value.body.name}`) {
      return [];
    }

    return [
      {
        ref: entry.id,
        rev: entry.rev,
        arrivedAt: entry.arrivedAt,
        name: event.value.body.name,
        after: event.value.body.after,
        process: event.value.body.process,
      },
    ];
  });

/**
 * A fire answer alone proves no recovery. Revision order breaks equal-clock ties.
 *
 * @stability unstable
 * @category checking
 */
export const recovery = (hit: Hit | null, entries: ReadonlyArray<RestartEntry>): typeof Recovery.Type | null => {
  if (hit === null) {
    return null;
  }

  const first = restarts(entries)
    .filter((row) => row.name === hit.name && row.after === hit.process && row.rev > hit.after)
    .sort((left, right) => left.rev - right.rev)[0];
  return first === undefined
    ? null
    : { ref: first.ref, rev: first.rev, arrivedAt: first.arrivedAt, process: first.process };
};
