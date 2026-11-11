// The library's test kit (Tier 1, P11). `syncTest` is saved-state S2: stop at every message, save
// through JSON text, boot from it, and the rest of the run must match the run that never stopped.
// `senderTest` is law p69: every write matches an expected table built from the inputs, never from
// the parents the program returned. Both throw a diagnostic on a difference. Remove `syncTest`
// when tea ships the matching helper.
import { applyCell, type Cmd, type Machine, type Sub } from "@demlik/tea";
import { Result } from "effect";

type Options<S, M> = {
  readonly msgs: ReadonlyArray<M>;
  readonly encode: (model: S) => unknown;
  readonly decode: (raw: unknown) => S;
  readonly equals: (a: unknown, b: unknown) => boolean;
  readonly seed: number;
};

/** Checks every cut, the first and the last included. Never runs a Cmd. */
export const syncTest = <S, M extends { readonly type: string }, C extends Cmd, U extends Sub, Ctx>(
  machine: Machine<S, M, C, U, Ctx>,
  ctx: Ctx,
  { msgs, encode, decode, equals, seed }: Options<S, M>,
): void => {
  const [first] = machine.init(null, ctx);
  const models: Array<S> = [first];
  const cmds: Array<ReadonlyArray<C>> = [];

  for (const msg of msgs) {
    const [next, out] = applyCell<S, M, C>(machine, models.at(-1) ?? first, msg);
    models.push(next);
    cmds.push(out);
  }

  const fail = (cut: number, what: string): never => {
    throw new Error(`syncTest (seed ${seed}): after a save at cut ${cut}, ${what}`);
  };
  /** Boots from the model saved at `cut` and replays the rest against the unbroken run. */
  const resume = (cut: number, model: S, loaded: S): void => {
    let [state] = machine.init(loaded, ctx);

    if (!equals(state, model)) {
      fail(cut, "init(loaded) is not the model that was saved");
    }

    for (let i = cut; i < msgs.length; i++) {
      const msg = msgs[i];

      if (msg === undefined) {
        break;
      }

      const [next, out] = applyCell<S, M, C>(machine, state, msg);

      if (!equals(next, models[i + 1])) {
        fail(cut, `the model after message ${i} differs`);
      }

      if (!equals(out, cmds[i])) {
        fail(cut, `the Cmds of message ${i} differ`);
      }

      state = next;
    }
  };

  for (const [cut, model] of models.entries()) {
    const text = JSON.stringify(encode(model));
    const loaded = Result.try(() => decode(JSON.parse(text)));

    if (Result.isFailure(loaded)) {
      fail(cut, "the saved JSON text does not load");
    } else {
      resume(cut, model, loaded.success);
    }
  }
};

type Who = { readonly key: string; readonly for: string };

type SenderOptions = {
  /** The inputs as the door stamped them: each parent and its writer. */
  readonly inputs: ReadonlyArray<{ readonly parent: string; readonly by: Who }>;
  /** The writes the caller expects, by write id, with the writer each must carry. */
  readonly expected: ReadonlyArray<{ readonly id: string; readonly by: Who }>;
  /** The writes that landed: id, the parent they named, and the writer they carried. */
  readonly writes: ReadonlyArray<{
    readonly id: string;
    readonly parent: string | null;
    readonly by: Who;
  }>;
  /** The process owner, the only writer of an own write. */
  readonly owner: Who;
  readonly seed: number;
};

const same = (a: Who, b: Who): boolean => a.key === b.key && a.for === b.for;

/** Every expected write lands once, with its expected writer; a caused write carries its parent
 *  input's writer, and an own write the owner's. */
export const senderTest = ({ inputs, expected, writes, owner, seed }: SenderOptions): void => {
  const fail = (what: string): never => {
    throw new Error(`senderTest (seed ${seed}): ${what}`);
  };
  const senders = new Map(inputs.map((input) => [input.parent, input.by]));
  const ids = new Set(expected.map((e) => e.id));

  for (const write of writes) {
    if (!ids.has(write.id)) {
      fail(`write ${write.id} was not expected`);
    }
  }

  for (const want of expected) {
    const found = writes.filter((write) => write.id === want.id);

    if (found.length !== 1) {
      fail(`write ${want.id} landed ${found.length} times`);
    }

    const [write] = found;

    if (write === undefined) {
      return fail(`write ${want.id} is missing`);
    }

    if (!same(write.by, want.by)) {
      fail(`write ${want.id} carries the wrong writer`);
    }

    const source = write.parent === null ? owner : senders.get(write.parent);

    if (source === undefined) {
      fail(`write ${want.id} names an unknown parent`);
    } else if (!same(source, write.by)) {
      fail(`write ${want.id} does not carry its parent's writer`);
    }
  }
};
