// Who belongs: signed events in, a grant tree out (p28), as one tea machine, `access` (0037, 0046).
// Pure, so the door's rule and the view are one update and never drift. Tier 1, P9, building
// account recovery's calls 6 to 9 and a key per client. Every device the person owns is a master:
// devices are equal roots, and only tabs and agents hang under the device that let them in. The
// sheet belongs to the person and works once.
//
// It never checks a signature: the door does, then hands the event here. The Model is never
// stored and `Access` is a projection of it, so a later rule re-judges old events.
import { Machine } from "@demlik/tea/effect";
import { Result, Schema } from "effect";

/** What the person saw when they let a tab or an agent in. Recorded, never trusted. */
export const Saw = Schema.Struct({
  code: Schema.String,
  label: Schema.String,
  location: Schema.String,
  method: Schema.Literals(["compare", "link", "command"]),
  check: Schema.Literals(["touch", "click", "none"]),
  has: Schema.Array(Schema.String),
});

/** A tab's or an agent's key, let in by a person key. In the signed text whole. */
export const Grant = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  /** The person; the signer must be one of their keys. */
  for: Schema.String,
  /** This ledger's name, so a grant cannot be replayed on another. */
  to: Schema.String,
  as: Schema.Literals(["window", "agent"]),
  saw: Saw,
  /** The signer's own clock, never trusted. */
  sentAt: Schema.String,
});

/** What the person saw when they removed a key. In the signed text, as a grant's `saw` is. */
export const Took = Schema.Struct({
  label: Schema.String,
  location: Schema.String,
  method: Schema.Literals(["panel", "command"]),
  check: Schema.Literals(["touch", "click", "none"]),
});

/** The signed text, the signature, and the key that signed. The door checked it before. */
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

/** A removal, the grant's twin: its own id, and the ledger it was meant for (flag 5). */
export const Revoke = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  for: Schema.String,
  to: Schema.String,
  saw: Took,
  sentAt: Schema.String,
});

/** What the person saw when a key was added. In the signed text. */
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

/** What joins: a new device (its person key and window key) or a new sheet. */
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
export type MemberEvent = typeof MemberEvent.Type;

/** Rank `email`, the brain's own key, waits for P36. */
const Rank = Schema.Literals(["person", "window", "agent", "recovery"]);
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

export type Access = {
  /** From `founded`, never changed. Empty before the founding. */
  readonly person: string;
  readonly name: string;
  readonly keys: ReadonlyMap<string, Member>;
  /** Recovery keys that signed once. */
  readonly spent: ReadonlySet<string>;
};

/** Why an event changes nothing. */
export const Reason = Schema.Literals(["not_member", "not_allowed", "used", "replaced", "revoked"]);
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

export type Folded = typeof Model.Type;
type Founded = typeof Model.cases.founded.Type;

const Msg = Schema.Struct({ type: Schema.Literal("fold"), event: MemberEvent });

/** The id an event is kept under: its own, and the fixed `founded` for the founding. */
export const eventId = (event: MemberEvent): string =>
  MemberEvent.match(event, {
    founded: () => "founded",
    granted: ({ grant }) => grant.id,
    denied: ({ id }) => id,
    revoked: ({ revoke }) => revoke.id,
    added: ({ add }) => add.id,
  });

/** The key that signed an event, if it is signed. */
export const signedBy = (event: MemberEvent): string | null =>
  MemberEvent.match(event, {
    founded: () => null,
    denied: () => null,
    granted: ({ signed }) => signed.signer,
    revoked: ({ signed }) => signed.signer,
    added: ({ signed }) => signed.signer,
  });

/** The key an event is about. */
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

/** A window or an agent let in by a live person key. */
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
 * Who belongs, one signed event at a time. No Cmds: `AccessFold.ts` steps it with `applyCell`, and
 * `ClientManager.write` answers with its reply, so the door and the view never drift.
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

/** The public view of a Model: derived, never machine input. Empty strings before the founding. */
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

/** Who a dialing key is: a live window or agent with every key above it live. Person and recovery
 *  keys never dial. The same shape as transport's `Who`; wiring joins them. */
export const admitted = (
  members: Access,
  key: string,
):
  | { readonly key: string; readonly person: string; readonly as: "window" | "agent" }
  | { readonly reason: "not_granted" } => {
  const known = members.keys.get(key);

  if (known === undefined || !known.live || !chainLive(members, key)) {
    return { reason: "not_granted" };
  }

  if (known.rank !== "window" && known.rank !== "agent") {
    return { reason: "not_granted" };
  }

  return { key, person: members.person, as: known.rank };
};
