/**
 * x-ci-plant-1: a comment-only plant for experiment 288, never merged.
 *
 * Line 01 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 02 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 03 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 04 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 05 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 06 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 07 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 08 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 09 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 10 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 11 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 12 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 13 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 14 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 15 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 16 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 17 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 18 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 19 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 20 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 21 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 22 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 23 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 24 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 */
/**
 * Who belongs: signed membership events in, a tree of keys out, as one tea machine named `access`
 * (0037, 0046).
 *
 * **Details**
 *
 * The machine is pure, so the door's rule and the view are one update and never drift. It carries
 * account recovery's calls 6 to 9 and a key per client. Every device the person owns is a master:
 * devices are equal roots, and client keys hang under the device that let them in. A recovery
 * sheet belongs to the person and works once.
 *
 * It never checks a signature: the door does, then hands the event here. The Model is never
 * stored and `Access` is a projection of it, so a later rule re-judges old events.
 *
 * @stability unstable
 */
import { Machine } from "@demlik/tea/effect";
import { Result, Schema } from "effect";

/**
 * Schema for what the person saw when they let a client in.
 *
 * **Details**
 *
 * It holds the code shown, the device's label and location, how the person compared (`compare`,
 * `link` or `command`), what kind of check they made (`touch`, `click` or `none`), and a list of
 * strings in `has`. It is recorded in a grant's signed text and in a denial, and nothing decides
 * on it.
 *
 * @stability unstable
 * @category models
 */
export const Saw = Schema.Struct({
  code: Schema.String,
  label: Schema.String,
  location: Schema.String,
  method: Schema.Literals(["compare", "link", "command"]),
  check: Schema.Literals(["touch", "click", "none"]),
  has: Schema.Array(Schema.String),
});

/**
 * Schema for a grant: a client's key, let in by a person key.
 *
 * **Details**
 *
 * `for` is the person and the signer must be one of their keys. `to` names this ledger, so a grant
 * cannot be replayed on another. `as` says whether the key is a `window`, an `agent` or `hands`.
 * The whole struct is part of the signed text, and `sentAt` is the signer's own clock, never
 * trusted.
 *
 * @stability unstable
 * @category models
 */
export const Grant = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  /** The person; the signer must be one of their keys. */
  for: Schema.String,
  /** This ledger's name, so a grant cannot be replayed on another. */
  to: Schema.String,
  as: Schema.Literals(["window", "agent", "hands"]),
  saw: Saw,
  /** The signer's own clock, never trusted. */
  sentAt: Schema.String,
});

/**
 * Schema for what the person saw when they removed a key.
 *
 * **Details**
 *
 * Like a grant's `saw`, it sits inside the signed text. Its `method` is `panel` or `command`.
 *
 * @stability unstable
 * @category models
 */
export const Took = Schema.Struct({
  label: Schema.String,
  location: Schema.String,
  method: Schema.Literals(["panel", "command"]),
  check: Schema.Literals(["touch", "click", "none"]),
});

/**
 * Schema for a signed event's proof: the signed text, its armored signature, and the signing key.
 *
 * **Details**
 *
 * The door checks the signature before the event reaches the machine, so nothing here verifies it.
 * `passkey` is present when the signature came from a passkey, and holds its origin, relying
 * party, flags and counter.
 *
 * @stability unstable
 * @category models
 */
export const Signed = Schema.Struct({
  text: Schema.String,
  armored: Schema.String,
  signer: Schema.String,
  passkey: Schema.optionalKey(
    Schema.Struct({
      origin: Schema.String,
      rp: Schema.String,
      be: Schema.Boolean,
      bs: Schema.Boolean,
      counter: Schema.Int,
    }),
  ),
});

/**
 * Schema for a removal, the grant's twin: its own id, and the ledger it was meant for.
 *
 * **Details**
 *
 * `key` is the key to stop, `for` the person, and `to` the ledger, so a removal cannot be replayed
 * on another. `saw` records what the person saw, and `sentAt` is the signer's own clock.
 *
 * @stability unstable
 * @category models
 */
export const Revoke = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  for: Schema.String,
  to: Schema.String,
  saw: Took,
  sentAt: Schema.String,
});

/**
 * Schema for what the person saw when a key was added.
 *
 * **Details**
 *
 * `method` says how it came in: `sheet`, `recovery`, `device`, `email` or `command`. `typed` and
 * `kept` apply on a sheet (two words typed back, and the button used), and `old` applies on a
 * recovery (the person's answer about the old device). A writer sends `false` or `null` for the
 * fields that do not apply; nothing checks that they match `method`. It sits inside the signed
 * text.
 *
 * @stability unstable
 * @category models
 */
export const AddSaw = Schema.Struct({
  method: Schema.Literals(["sheet", "recovery", "device", "email", "command"]),
  check: Schema.Literals(["touch", "click", "none"]),
  location: Schema.String,
  has: Schema.Array(Schema.String),
  /** On a sheet: the person typed two words back. */
  typed: Schema.Boolean,
  /** On a sheet: the button they used. */
  kept: Schema.NullOr(Schema.Literals(["print", "pdf", "hand"])),
  /** On a recovery: their answer about the old device. */
  old: Schema.NullOr(Schema.Literals(["lost", "kept"])),
});

/**
 * Schema for what an addition brings in: a new device or a new recovery sheet.
 *
 * **Details**
 *
 * A `person` case carries the device's person key and its window key, and may carry passkey
 * enrollment proof. A `recovery` case carries the sheet's key. The case tag is the rank the key
 * joins with.
 *
 * @stability unstable
 * @category models
 */
export const Adds = Schema.TaggedUnion({
  person: {
    key: Schema.String,
    window: Schema.String,
    passkey: Schema.optionalKey(
      Schema.Struct({
        credential: Schema.String,
        rp: Schema.String,
        origin: Schema.String,
        be: Schema.Boolean,
        bs: Schema.Boolean,
        nonce: Schema.String,
        proof: Schema.String,
      }),
    ),
  },
  recovery: { key: Schema.String, v: Schema.Literal(1) },
});

/**
 * Schema for an addition: a new device or sheet joins, and some of the person's keys stop at the
 * same moment.
 *
 * **Details**
 *
 * `drops` lists keys that stop now, forever, with all they let in. The signing key is never
 * dropped by its own addition. A new sheet also ends every other live sheet, whatever `drops`
 * says. The struct is part of the signed text.
 *
 * @stability unstable
 * @category models
 */
export const Add = Schema.Struct({
  id: Schema.String,
  for: Schema.String,
  to: Schema.String,
  adds: Adds,
  /** The person's keys that stop now, forever, with all they let in. */
  drops: Schema.Array(Schema.String),
  saw: AddSaw,
  sentAt: Schema.String,
});

/**
 * Schema for one membership event: the founding, a grant, a denial, a removal or an addition.
 *
 * **Details**
 *
 * Only `founded` and `denied` carry no signature: `denied` records a refused attempt, with the
 * key that wrote it in `by`. A `founded` event is kept under the fixed id `founded`, so a second
 * founding changes nothing.
 *
 * @stability unstable
 * @category models
 */
export const MemberEvent = Schema.TaggedUnion({
  founded: {
    id: Schema.String,
    name: Schema.String,
    keys: Schema.Array(Schema.String),
    window: Schema.NullOr(Schema.String),
  },
  granted: { grant: Grant, signed: Signed },
  denied: { id: Schema.String, key: Schema.String, saw: Saw, by: Schema.String },
  revoked: { revoke: Revoke, signed: Signed },
  added: { add: Add, signed: Signed },
});
/**
 * The decoded type of `MemberEvent`.
 *
 * @stability unstable
 * @category models
 */
export type MemberEvent = typeof MemberEvent.Type;

/** Rank `email`, the brain's own key, waits for P36. */
const Rank = Schema.Literals(["person", "window", "agent", "hands", "recovery"]);
type Rank = typeof Rank.Type;

/** A key's one standing, with the rank and place it joined with. Only a sheet is spent or
 *  replaced, and a sheet hangs under nothing. */
const Key = Schema.TaggedUnion({
  live: { rank: Rank, under: Schema.NullOr(Schema.String) },
  revoked: { rank: Rank, under: Schema.NullOr(Schema.String) },
  /** A sheet that let a device in: it works once. */
  spent: { rank: Schema.Literal("recovery"), under: Schema.Null },
  /** A sheet a newer sheet ended. */
  replaced: { rank: Schema.Literal("recovery"), under: Schema.Null },
});
type Key = typeof Key.Type;
type Keys = ReadonlyMap<string, Key>;

/** A key as the view shows it. */
type Member = { readonly rank: Rank; readonly live: boolean; readonly under: string | null };

/**
 * The public view of who belongs: the person, the name, every key with its rank and place, and the
 * recovery keys that are spent.
 *
 * **Details**
 *
 * It is derived from the machine's Model by `members`, never stored and never machine input.
 * `under` is the key that let a key in, or null for a root. A key that stopped stays in the map
 * with `live` false.
 *
 * @stability unstable
 * @category models
 */
export type Access = {
  /** From `founded`, never changed. Empty before the founding. */
  readonly person: string;
  readonly name: string;
  readonly keys: ReadonlyMap<string, Member>;
  /** Recovery keys that signed once. */
  readonly spent: ReadonlySet<string>;
};

/**
 * Schema for why an event changes nothing.
 *
 * **Details**
 *
 * `not_member` is an unknown signer or person, a removal of a key that was never let in, or an
 * event before the founding. `not_allowed` is a signer of the wrong rank, a key removing itself, or
 * a key that would join with a rank it does not hold. `used` is a recovery sheet that already let a
 * device in. `replaced` is a sheet a newer one ended. `revoked`
 * is a stopped key, as signer or as the key an event is about.
 *
 * @stability unstable
 * @category models
 */
export const Reason = Schema.Literals(["not_member", "not_allowed", "used", "replaced", "revoked"]);
/**
 * The decoded type of `Reason`.
 *
 * @stability unstable
 * @category models
 */
export type Reason = typeof Reason.Type;

/** How the last event went. It never decides what is legal next. */
const Reply = Schema.TaggedUnion({
  accepted: {},
  refused: { reason: Reason },
});
type Reply = typeof Reply.Type;

const ACCEPTED: Reply = Reply.cases.accepted.make({});

/** Who belongs so far. Founding is the state, never a non-empty person string. */
const Model = Schema.TaggedUnion({
  unfounded: { reply: Reply },
  founded: {
    /** From `founded`, never changed. */
    person: Schema.String,
    name: Schema.String,
    keys: Schema.ReadonlyMap(Schema.String, Key),
    /** The id of every event taken, so the same event twice changes nothing. */
    ids: Schema.ReadonlySet(Schema.String),
    reply: Reply,
  },
});

/**
 * The machine's Model: `unfounded` before the founding, then `founded` with the person, the name,
 * every key, the ids of the events taken, and the reply to the last event.
 *
 * **Gotchas**
 *
 * The reply says how the last event went and never decides what is legal next. Read who belongs
 * through `members`, not through this type.
 *
 * @stability unstable
 * @category models
 */
export type Folded = typeof Model.Type;
type Founded = typeof Model.cases.founded.Type;

const Msg = Schema.Struct({ type: Schema.Literal("fold"), event: MemberEvent });

/**
 * Returns the id an event is kept under: its own, and the fixed `founded` for the founding.
 *
 * **Details**
 *
 * The machine remembers every id it took, so the same event twice changes nothing.
 *
 * @stability unstable
 * @category getters
 */
export const eventId = (event: MemberEvent): string =>
  MemberEvent.match(event, {
    founded: () => "founded",
    granted: ({ grant }) => grant.id,
    denied: ({ id }) => id,
    revoked: ({ revoke }) => revoke.id,
    added: ({ add }) => add.id,
  });

/**
 * Returns the key that signed an event, or null for `founded` and `denied`, which carry no
 * signature.
 *
 * @stability unstable
 * @category getters
 */
export const signedBy = (event: MemberEvent): string | null =>
  MemberEvent.match(event, {
    founded: () => null,
    denied: () => null,
    granted: ({ signed }) => signed.signer,
    revoked: ({ signed }) => signed.signer,
    added: ({ signed }) => signed.signer,
  });

/**
 * Returns the key an event is about, or null for `founded`.
 *
 * **Details**
 *
 * For a grant, a removal and a denial it is the key named in the event. For an addition it is the
 * new key of `adds`, not its window.
 *
 * @stability unstable
 * @category getters
 */
export const subject = (event: MemberEvent): string | null =>
  MemberEvent.match(event, {
    founded: () => null,
    denied: ({ key }) => key,
    granted: ({ grant }) => grant.key,
    revoked: ({ revoke }) => revoke.key,
    added: ({ add }) => add.adds.key,
  });

/** A change to the keys, made on a copy: a key's rank and place never change, and a stopped key
 *  never lives again or changes its standing. */
class Change {
  readonly keys: Map<string, Key>;

  constructor(keys: Keys) {
    this.keys = new Map(keys);
  }

  /** Adds a key, unless it is already there. */
  add(key: string, rank: Rank, under: string | null): this {
    if (!this.keys.has(key)) {
      this.keys.set(key, Key.cases.live.make({ rank, under }));
    }

    return this;
  }

  /** Stops a live key forever. */
  revoke(key: string): this {
    const known = this.keys.get(key);

    if (known?._tag === "live") {
      this.keys.set(key, Key.cases.revoked.make({ rank: known.rank, under: known.under }));
    }

    return this;
  }

  /** Ends a live sheet: `spent` once it let a device in, `replaced` when a newer sheet came. */
  end(key: string, standing: "spent" | "replaced"): this {
    const known = this.keys.get(key);

    if (known?._tag === "live" && known.rank === "recovery") {
      this.keys.set(key, Key.cases[standing].make({ rank: "recovery", under: null }));
    }

    return this;
  }
}

const refuse = (reason: Reason): Result.Result<Keys, Reason> => Result.fail(reason);

/** How a signer stands: refused with a reason, or its rank. */
const standing = (model: Founded, signer: string, person: string): Result.Result<Rank, Reason> => {
  const known = model.keys.get(signer);

  if (person !== model.person || known === undefined) {
    return Result.fail("not_member");
  }

  if (known._tag === "spent") {
    return Result.fail("used");
  }

  if (known._tag === "live") {
    return Result.succeed(known.rank);
  }

  return Result.fail(known._tag);
};

/** Whether a key may join as `rank`: new, or already there, live and of that rank. */
const joins = (model: Founded, key: string, rank: Rank): Result.Result<void, Reason> => {
  const known = model.keys.get(key);

  if (known === undefined) {
    return Result.succeed(undefined);
  }

  if (known._tag !== "live") {
    return Result.fail("revoked");
  }

  return known.rank === rank ? Result.succeed(undefined) : Result.fail("not_allowed");
};

type Event<Tag extends keyof typeof MemberEvent.cases> = (typeof MemberEvent.cases)[Tag]["Type"];

/** The founding: person roots, then the window under the first root when both exist. */
const found = ({ id, name, keys, window }: Event<"founded">): Folded => {
  const change = new Change(new Map());

  for (const key of keys) {
    change.add(key, "person", null);
  }

  const [first] = keys;

  if (window !== null && first !== undefined) {
    change.add(window, "window", first);
  }

  const ids = new Set(["founded"]);
  return Model.cases.founded.make({ person: id, name, keys: change.keys, ids, reply: ACCEPTED });
};

/** A client let in by a live person key. */
const grant = (model: Founded, { grant, signed }: Event<"granted">) =>
  Result.flatMap(standing(model, signed.signer, grant.for), (rank) => {
    if (rank !== "person") {
      return refuse("not_allowed");
    }

    const change = new Change(model.keys).add(grant.key, grant.as, signed.signer);
    return Result.map(joins(model, grant.key, grant.as), () => change.keys);
  });

/** Another key stopped by a live person key. */
const revoke = (model: Founded, { revoke, signed }: Event<"revoked">) =>
  Result.flatMap(standing(model, signed.signer, revoke.for), (rank) => {
    if (rank !== "person" || revoke.key === signed.signer) {
      return refuse("not_allowed");
    }

    const known = model.keys.get(revoke.key);

    if (known === undefined) {
      return refuse("not_member");
    }

    if (known._tag !== "live") {
      return refuse("revoked");
    }

    return Result.succeed<Keys>(new Change(model.keys).revoke(revoke.key).keys);
  });

/** A device let in by a person key or a sheet, or a sheet by a person key, then the drops. */
const add = (model: Founded, { add, signed }: Event<"added">) =>
  Result.flatMap(standing(model, signed.signer, add.for), (rank) => {
    const { adds } = add;
    const signer = signed.signer;
    const bySheet = rank === "recovery";

    if (rank !== "person" && !(bySheet && adds._tag === "person")) {
      return refuse("not_allowed");
    }

    return Result.map(joins(model, adds.key, adds._tag), () => {
      const change = new Change(model.keys).add(adds.key, adds._tag, null);

      if (adds._tag === "person") {
        change.add(adds.window, "window", adds.key);
      } else {
        // One live sheet: a new one ends every other, whatever `drops` says (flag 7).
        for (const other of model.keys.keys()) {
          if (other !== adds.key) {
            change.end(other, "replaced");
          }
        }
      }

      for (const key of add.drops) {
        if (key !== signer) {
          change.revoke(key);
        }
      }

      if (bySheet) {
        change.end(signer, "spent");
      }

      return change.keys;
    });
  });

/** What a fresh event does to a founded Model's keys, or why it does nothing. */
const rule = (model: Founded, event: MemberEvent): Result.Result<Keys, Reason> => {
  if (event._tag === "granted") {
    return grant(model, event);
  }

  if (event._tag === "revoked") {
    return revoke(model, event);
  }

  if (event._tag === "added") {
    return add(model, event);
  }

  if (event._tag === "denied") {
    // A founding under the empty person id still refuses a denial, as it always has.
    return model.person === "" ? refuse("not_member") : Result.succeed(model.keys);
  }

  // A founding is kept under the fixed id `founded`, so a founded Model always holds it.
  return refuse("not_allowed");
};

const replied = (model: Founded, reply: Reply, keys: Keys = model.keys, ids = model.ids): Folded =>
  Model.cases.founded.make({ person: model.person, name: model.name, keys, ids, reply });

/** One event: the same event again first, then the founding or the one rule. */
const fold = (model: Folded, event: MemberEvent): Folded => {
  if (model._tag === "unfounded") {
    if (event._tag === "founded") {
      return found(event);
    }

    const reply = Reply.cases.refused.make({ reason: "not_member" });
    return Model.cases.unfounded.make({ reply });
  }

  const id = eventId(event);

  // The same event again changes nothing, wherever it comes, before any rule.
  if (model.ids.has(id)) {
    return replied(model, ACCEPTED);
  }

  const keys = rule(model, event);

  if (Result.isFailure(keys)) {
    return replied(model, Reply.cases.refused.make({ reason: keys.failure }));
  }

  return replied(model, ACCEPTED, keys.success, new Set(model.ids).add(id));
};

/**
 * Machine that decides who belongs, one signed event at a time.
 *
 * **Details**
 *
 * It takes one `fold` message with an event, and has no Cmds. `AccessFold.ts` steps it with
 * `applyCell`, and `ClientManager.write` answers with its reply, so the door and the view never
 * drift. It starts from a loaded Model when one is given, else `unfounded`, which refuses every
 * event except `founded`.
 *
 * **Gotchas**
 *
 * It never checks a signature, and a refused event leaves the keys as they were.
 *
 * @stability unstable
 * @category machines
 */
export const access = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [],
  init: (loaded) => [loaded ?? Model.cases.unfounded.make({ reply: ACCEPTED }), []],
  update: {
    fold: (model, { event }) => [fold(model, event), []],
  },
});

/**
 * Returns the public view of a Model: derived, never machine input.
 *
 * **Details**
 *
 * Before the founding the person and the name are empty strings and there are no keys.
 *
 * @stability unstable
 * @category combinators
 */
export const members = (model: Folded): Access => {
  if (model._tag === "unfounded") {
    return { person: "", name: "", keys: new Map(), spent: new Set() };
  }

  const keys = new Map<string, Member>();
  const spent = new Set<string>();

  for (const [name, key] of model.keys) {
    keys.set(name, { rank: key.rank, live: key._tag === "live", under: key.under });

    if (key._tag === "spent") {
      spent.add(name);
    }
  }

  return { person: model.person, name: model.name, keys, spent };
};

/** Every key above `key` live, walking `under` to a root. A loop counts as not live. */
const chainLive = (members: Access, key: string): boolean => {
  const passed = new Set<string>();

  for (let at = members.keys.get(key)?.under ?? null; at !== null;) {
    const above = members.keys.get(at);

    if (above === undefined || !above.live || passed.has(at)) {
      return false;
    }

    passed.add(at);
    at = above.under;
  }

  return true;
};

/**
 * Returns who a dialing key is, or `{ reason: "not_granted" }` when it may not dial.
 *
 * **Details**
 *
 * A key is admitted when it is a live client key (a window, an agent or hands) and every key above
 * it, up to a root, is live. Person and recovery keys never dial. The answer has the same shape as
 * transport's `Who`; wiring joins them.
 *
 * **Gotchas**
 *
 * A loop in the `under` chain counts as not live.
 *
 * @stability unstable
 * @category combinators
 */
export const admitted = (
  members: Access,
  key: string,
):
  | { readonly key: string; readonly person: string; readonly as: "window" | "agent" | "hands" }
  | { readonly reason: "not_granted" } => {
  const known = members.keys.get(key);

  if (known === undefined || !known.live || !chainLive(members, key)) {
    return { reason: "not_granted" };
  }

  if (known.rank !== "window" && known.rank !== "agent" && known.rank !== "hands") {
    return { reason: "not_granted" };
  }

  return { key, person: members.person, as: known.rank };
};
