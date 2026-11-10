// Who belongs: signed facts in, a grant tree out (p28). Pure, so the door's rule and the view are
// one function and never drift. Tier 1, P9, building account recovery's calls 6 to 9 and a key per
// client. Every device the person owns is a master: devices are equal roots, and only tabs and
// agents hang under the device that let them in. The sheet belongs to the person and works once.
//
// It never checks a signature: the door does, then hands the fact here. `Members` is a projection,
// never stored, so a later rule re-judges old facts.
import {Result, Schema} from "effect";

/** What the person saw when they let a tab or an agent in. Recorded, never trusted. */
export const Saw = Schema.Struct({
	code: Schema.String,
	label: Schema.String,
	where: Schema.String,
	how: Schema.Literals(["compare", "link", "command"]),
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
	where: Schema.String,
	how: Schema.Literals(["panel", "command"]),
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
	how: Schema.Literals(["sheet", "recovery", "device", "email", "command"]),
	check: Schema.Literals(["touch", "click", "none"]),
	where: Schema.String,
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
	recovery: {key: Schema.String, v: Schema.Literal(1)},
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

export const MemberFact = Schema.TaggedUnion({
	founded: {
		id: Schema.String,
		name: Schema.String,
		keys: Schema.Array(Schema.String),
		window: Schema.NullOr(Schema.String),
	},
	granted: {grant: Grant, signed: Signed},
	denied: {id: Schema.String, key: Schema.String, saw: Saw, by: Schema.String},
	revoked: {revoke: Revoke, signed: Signed},
	added: {add: Add, signed: Signed},
});
export type MemberFact = typeof MemberFact.Type;

/** Rank `email`, the brain's own key, waits for P36. */
type Rank = "person" | "window" | "agent" | "recovery";

type Key = {readonly rank: Rank; readonly live: boolean; readonly under: string | null};

export type Members = {
	/** From `founded`, never changed. */
	readonly person: string;
	readonly name: string;
	readonly keys: ReadonlyMap<string, Key>;
	/** Recovery keys that signed once. */
	readonly spent: ReadonlySet<string>;
};

/** Why a fact changes nothing. */
export const Why = Schema.Literals(["not_member", "not_allowed", "used", "replaced", "revoked"]);
export type Why = typeof Why.Type;

/** Who belongs so far, plus what the rule needs that `Members` does not show. */
export type Folded = {
	readonly members: Members;
	/** Sheets a newer sheet ended. */
	readonly replaced: ReadonlySet<string>;
	/** The id of every fact folded, so the same fact twice changes nothing. */
	readonly ids: ReadonlySet<string>;
};

export const EMPTY: Folded = {
	members: {person: "", name: "", keys: new Map(), spent: new Set()},
	replaced: new Set(),
	ids: new Set(),
};

/** The id a fact is kept under: its own, and the fixed `founded` for the founding. */
export const factId = (fact: MemberFact): string =>
	MemberFact.match(fact, {
		founded: () => "founded",
		granted: ({grant}) => grant.id,
		denied: ({id}) => id,
		revoked: ({revoke}) => revoke.id,
		added: ({add}) => add.id,
	});

/** The key that signed a fact, if it is signed. */
export const signedBy = (fact: MemberFact): string | null =>
	MemberFact.match(fact, {
		founded: () => null,
		denied: () => null,
		granted: ({signed}) => signed.signer,
		revoked: ({signed}) => signed.signer,
		added: ({signed}) => signed.signer,
	});

/** The key a fact is about. */
export const subject = (fact: MemberFact): string | null =>
	MemberFact.match(fact, {
		founded: () => null,
		denied: ({key}) => key,
		granted: ({grant}) => grant.key,
		revoked: ({revoke}) => revoke.key,
		added: ({add}) => add.adds.key,
	});

/** A change to the keys and the sheets, made on copies. */
class Change {
	readonly keys: Map<string, Key>;
	readonly spent: Set<string>;
	readonly replaced: Set<string>;
	readonly folded: Folded;

	constructor(folded: Folded) {
		this.folded = folded;
		this.keys = new Map(folded.members.keys);
		this.spent = new Set(folded.members.spent);
		this.replaced = new Set(folded.replaced);
	}

	/** Adds a key, unless it is already there: a key's rank and place never change. */
	add(key: string, rank: Rank, under: string | null): this {
		if (!this.keys.has(key)) {
			this.keys.set(key, {rank, live: true, under});
		}

		return this;
	}

	/** Stops a key forever. */
	stop(key: string): this {
		const known = this.keys.get(key);

		if (known !== undefined) {
			this.keys.set(key, {...known, live: false});
		}

		return this;
	}

	done(id: string, person = this.folded.members): Folded {
		return {
			members: {person: person.person, name: person.name, keys: this.keys, spent: this.spent},
			replaced: this.replaced,
			ids: new Set(this.folded.ids).add(id),
		};
	}
}

const refuse = (why: Why): Result.Result<Folded, Why> => Result.fail(why);

/** How a signer stands: refused with a why, or its rank. */
const standing = (folded: Folded, signer: string, person: string): Result.Result<Rank, Why> => {
	const {members, replaced} = folded;
	const known = members.keys.get(signer);

	if (person !== members.person || known === undefined) {
		return Result.fail("not_member");
	}

	if (members.spent.has(signer)) {
		return Result.fail("used");
	}

	if (replaced.has(signer)) {
		return Result.fail("replaced");
	}

	if (!known.live) {
		return Result.fail("revoked");
	}

	return Result.succeed(known.rank);
};

/** Whether a key may join as `rank`: new, or already there, live and of that rank. */
const joins = (folded: Folded, key: string, rank: Rank): Result.Result<void, Why> => {
	const known = folded.members.keys.get(key);

	if (known === undefined) {
		return Result.succeed(undefined);
	}

	if (!known.live) {
		return Result.fail("revoked");
	}

	return known.rank === rank ? Result.succeed(undefined) : Result.fail("not_allowed");
};

/**
 * The one rule: what a fact does to who belongs, or why it does nothing. The fold skips what it
 * refuses, and `ClientManager.write` answers with it, so the door and the view never drift.
 */
export const allows = (folded: Folded, fact: MemberFact): Result.Result<Folded, Why> => {
	const id = factId(fact);

	// The same fact again changes nothing, wherever it comes.
	if (folded.ids.has(id)) {
		return Result.succeed(folded);
	}

	const founded = folded.members.person !== "";
	return MemberFact.match(fact, {
		founded: ({id: person, name, keys, window}) => {
			if (founded) {
				return refuse("not_allowed");
			}

			const change = new Change(folded);

			for (const key of keys) {
				change.add(key, "person", null);
			}

			const [first] = keys;

			if (window !== null && first !== undefined) {
				change.add(window, "window", first);
			}

			return Result.succeed(change.done(id, {...folded.members, person, name}));
		},
		denied: () => (founded ? Result.succeed(new Change(folded).done(id)) : refuse("not_member")),
		granted: ({grant, signed}) =>
			Result.flatMap(standing(folded, signed.signer, grant.for), (rank) => {
				if (rank !== "person") {
					return refuse("not_allowed");
				}

				return Result.map(joins(folded, grant.key, grant.as), () =>
					new Change(folded).add(grant.key, grant.as, signed.signer).done(id),
				);
			}),
		revoked: ({revoke, signed}) =>
			Result.flatMap(standing(folded, signed.signer, revoke.for), (rank) => {
				if (rank !== "person" || revoke.key === signed.signer) {
					return refuse("not_allowed");
				}

				const known = folded.members.keys.get(revoke.key);

				if (known === undefined) {
					return refuse("not_member");
				}

				if (!known.live) {
					return refuse("revoked");
				}

				return Result.succeed(new Change(folded).stop(revoke.key).done(id));
			}),
		added: ({add, signed}) =>
			Result.flatMap(standing(folded, signed.signer, add.for), (rank) => {
				const signer = signed.signer;
				const bySheet = rank === "recovery";

				if (rank !== "person" && !(bySheet && add.adds._tag === "person")) {
					return refuse("not_allowed");
				}

				const joined = Adds.match(add.adds, {
					person: ({key, window}) =>
						Result.map(joins(folded, key, "person"), () =>
							new Change(folded).add(key, "person", null).add(window, "window", key),
						),
					recovery: ({key}) =>
						Result.map(joins(folded, key, "recovery"), () => {
							const change = new Change(folded).add(key, "recovery", null);

							// One live sheet: a new one ends every other, whatever `drops` says (flag 7).
							for (const [other, k] of folded.members.keys) {
								const live = k.live && !folded.members.spent.has(other);

								if (k.rank === "recovery" && other !== key && live) {
									change.stop(other);
									change.replaced.add(other);
								}
							}

							return change;
						}),
				});
				return Result.map(joined, (change) => {
					for (const key of add.drops) {
						if (key !== signer) {
							change.stop(key);
						}
					}

					if (bySheet) {
						change.stop(signer);
						change.spent.add(signer);
					}

					return change.done(id);
				});
			}),
	});
};

/** Every fact in order, each one taken or refused by `allows`. */
export const foldMembers = (facts: ReadonlyArray<MemberFact>): Members =>
	facts.reduce((folded, fact) => Result.getOrElse(allows(folded, fact), () => folded), EMPTY)
		.members;

/** Every key above `key` live, walking `under` to a root. A loop counts as not live. */
const chainLive = (members: Members, key: string): boolean => {
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
	members: Members,
	key: string,
):
	| {readonly key: string; readonly person: string; readonly as: "window" | "agent"}
	| {readonly why: "not_granted"} => {
	const known = members.keys.get(key);

	if (known === undefined || !known.live || !chainLive(members, key)) {
		return {why: "not_granted"};
	}

	if (known.rank !== "window" && known.rank !== "agent") {
		return {why: "not_granted"};
	}

	return {key, person: members.person, as: known.rank};
};
