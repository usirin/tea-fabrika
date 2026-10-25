// The door: the one way into a ledger from the network. It turns a request's credential into who
// it is, and the ledger writes that as the writer. What the request says about who wrote it is
// never read: the client's wire has no place for a writer (`trustedArgs`).
//
//   who(token)            {kind: "user", id: "github:42"}                    a person
//                         {kind: "agent", id: "triage", for: "github:42"}    an agent for a person
//                         {ok: false, status: 401 | 403, why}                 refused
//
// Each ledger stands alone and keeps its own members, as facts in its own `door/members` stream.
// Nothing outside it knows who belongs, and a session it gives out opens only it.
//
//   founded {id, name}   the ledger's founder, named by its config (`FOUNDER`), on first login
//   invited {id, name}   a member invites a name; the invite keeps the id the keys service gives
//   joined  {id, name}   that person's first login, by the invite's id
//   removed {id}         a member takes a member (or an invite) off; their sessions end
//
// Access starts from an invitation. A person signs in by the name this ledger knows them by: the
// door finds that name among its own members and open invites, and asks the keys service only
// about those ids (`Keys.byId`). Before the first login the founder is known by id only, from
// config, and goes by the name the keys service gives for that id. Any other name is refused
// without asking anyone, with the same answer as a signature that does not match, so a refusal
// does not tell who is a member. Only a signed-in member's invite asks about a new name
// (`Keys.of`), once: from then on the ledger goes by the id, so a rename at the keys service
// locks nobody out.
//
// How a person proves who they are: an SSH signature (`sshsig.ts`) over a challenge this ledger
// gave out, by a key the keys service lists for them. The door asks one service, `Keys`
// (`keys.ts`), and never asks GitHub, or anything else, itself. Today's answer is GitHub's
// (`keys-github.ts`): a name is a login, the id is `github:<GitHub's numeric id>`. An agent holds
// its own key, and a grant its person's key signed: it names the agent, its key, this ledger and
// an end. A grant makes an agent's session, never a person's.
//
// Two doors, by config:
//
//   shared   the shared ledger: members, SSH proof, sessions (above)
//   local    one laptop: one person from config, proven by a secret the starter holds
//            (`local.ts`), and agent tokens that person mints
//
// With neither, every request is refused: a ledger with no door is closed, not open.
//
// A person's answer needs a person's session. A kind in `PERSON_KINDS` (the owner's answer to an
// ask: an approval, a ruling) is refused from an agent's session on every write, so an agent
// tricked into approving its own work is stopped here, whatever its host does.
//
// workerd runs this file in the ledger's Worker, bundled with the rest of it (worker-options.ts).
// Node runs the same file in the tests, on node:sqlite.
import {Effect, type ManagedRuntime, Option, Schema} from "effect";
import {Keys, type KeysUnreachable, type Signers} from "./keys.ts";
import type {Db, Event, SqlRow, Written} from "./rules.ts";
import {readStream, writeUnguarded} from "./rules.ts";
import {keyOnly, verify} from "./sshsig.ts";

// ---------------------------------------------------------------- who

/**
 * What the door says a credential is: a person (on a shared door, the id the keys service gives,
 * such as `github:<GitHub's numeric user id>`), or an agent and the person it works for. Nothing
 * else may be stamped as a writer.
 */
export type Stamp =
	| {readonly kind: "user"; readonly id: string}
	| {readonly kind: "agent"; readonly id: string; readonly for: string};
type Person = Extract<Stamp, {kind: "user"}>;

/** A writer's text in a row: `user:<id>`, or `agent:<id> for:<person>` (writer.ts reads it). */
export const stampText = (s: Stamp): string =>
	s.kind === "user" ? `user:${s.id}` : `agent:${s.id} for:${s.for}`;

/**
 * A claim's holder: the host's own tag, then the stamp. `h1@user:owner` reads as no writer
 * (`writerOf` splits at the first colon, and `h1@user` is no kind), as a holder always has.
 */
export const holderOf = (host: string, s: Stamp): string => `${host}@${stampText(s)}`;

/**
 * A person's id, as the door takes one from config or from the keys service: no spaces, and no
 * "@", which `hostOf` reads as the end of a host's tag. Up to 200 characters.
 */
export const isPersonId = (s: unknown): s is string => typeof s === "string" && PERSON_ID.test(s);
const PERSON_ID = /^[^\s@]{1,200}$/;

/**
 * The host's own tag in a holder, as the host named itself to `claim`. A stamp has no "@" in it
 * (`isPersonId`, and an agent's name never has one), so the last "@" ends the host's tag.
 * A holder written past no door (an RPC caller, the node:sqlite ledger) comes back whole.
 */
export const hostOf = (holder: string): string => {
	const m = /^(.+)@(user:[^\s@]+|agent:[^\s@]+ for:[^\s@]+)$/.exec(holder);
	return m?.[1] ?? holder;
};

// ---------------------------------------------------------------- names

/** The door's own name: no request may write under it. */
export const DOOR = "door";
/** The members' facts. Readable by any credential; written only by the door. */
export const MEMBERS = "door/members";
/** The SSH signature namespace (`ssh-keygen -Y sign -n fabrika-ledger`). */
export const NAMESPACE = "fabrika-ledger";
/** An inbox message under this id is a dead letter sent back (`dead-letters.ts`): a person's act. */
export const REDRIVE = "redrive:";

export const isDoorStream = (s: string): boolean => s === DOOR || s.startsWith(`${DOOR}/`);

/**
 * The kinds only a person writes: a person's answer to what the machine asked them. The door
 * refuses each from an agent's session, in any stream: no agent approves, rules or answers for
 * its person.
 *
 *   answered   the owner's answer to an ask (packages/pipeline/src/asks/ledger.ts): a plan's
 *              approval, a ruling, a stuck task's way on, a yes or a no on a build
 *
 * The one list. A program says who writes each of its facts in a `Writes` table, and the type holds
 * that table to this list: a fact marked `person` does not compile until its kind is here.
 */
export const PERSON_KINDS = ["answered"] as const;
export type PersonKind = (typeof PERSON_KINDS)[number];

export const isPersonKind = (kind: string): kind is PersonKind =>
	(PERSON_KINDS as readonly string[]).includes(kind);

/**
 * Who may write each of a program's facts, by kind: `person` for a kind in `PERSON_KINDS`, `anyone`
 * for the rest. A program keeps one beside its facts, `satisfies Writes<Fact["type"]>`: a new fact
 * has no row until someone says who writes it, and `person` there does not compile until the door
 * refuses that kind from an agent.
 */
export type Writes<K extends string> = {
	readonly [k in K]: k extends PersonKind ? "person" : "anyone";
};

// The keys service is the one place a person's keys live. Every key it lists for a member may sign
// in; nothing here pins one. A key taken off there stops letting anyone in once the service's own
// answer is new (GitHub's is kept a few minutes: `keys-github.ts`), and every session it opened
// has ended (`SESSION_MS`). So a session is short, and an agent's session never outlives its
// person's.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/**
 * How long a person's session lasts on a shared door, by default: 4 hours. A key taken off at the
 * keys service works at most this long after (plus that service's cache). Shorter means more
 * logins, each one an SSH signature and a question to the keys service; 4 hours is two logins in a
 * working day.
 */
export const SESSION_MS = 4 * HOUR;
/** How long a local door's agent token lasts: one laptop, minted by the secret's holder. */
export const LOCAL_AGENT_MS = 30 * 24 * HOUR;
/** How long a challenge may wait for its signature. */
export const CHALLENGE_MS = 5 * MINUTE;

// ---------------------------------------------------------------- answers

export type Refused = {readonly ok: false; readonly status: number; readonly why: string};
export type Let<T> = {readonly ok: true; readonly value: T} | Refused;

const refuse = (status: number, why: string): Refused => ({ok: false, status, why});
const letIn = <T>(value: T): Let<T> => ({ok: true, value});

// ---------------------------------------------------------------- config

export type DoorConfig =
	| {readonly kind: "closed"}
	| {readonly kind: "local"; readonly person: string; readonly secretHash: string}
	/**
	 * `founder`: the id of the person who made the ledger, as the keys service gives it
	 * (`github:<n>`). `origin`: the server's public origin, as challenges and grants name it before
	 * the object's name (null: the request's own). `sessionMs`: `SESSION_MS` unless the env says
	 * otherwise. Where keys come from is not here: that is the `Keys` Layer's own config.
	 */
	| {
			readonly kind: "shared";
			readonly founder: string;
			readonly origin: string | null;
			readonly sessionMs: number;
	  };

/**
 * The Worker's env, as the door reads it. Anything missing or malformed closes the door, but for
 * `SESSION_MS`: left out, it is the default.
 */
export const configOf = (env: Record<string, unknown>): DoorConfig => {
	const s = (k: string) => (typeof env[k] === "string" ? (env[k] as string) : "");
	/** A length of time in ms: the default when left out, null when it does not read. */
	const ms = (k: string, fallback: number, min: number): number | null =>
		s(k) === ""
			? fallback
			: /^[0-9]{1,12}$/.test(s(k)) && Number(s(k)) >= min
				? Number(s(k))
				: null;
	if (
		s("DOOR") === "local" &&
		isPersonId(s("LOCAL_PERSON")) &&
		/^[0-9a-f]{64}$/.test(s("LOCAL_SECRET_HASH"))
	)
		return {kind: "local", person: s("LOCAL_PERSON"), secretHash: s("LOCAL_SECRET_HASH")};
	const sessionMs = ms("SESSION_MS", SESSION_MS, MINUTE);
	if (
		s("DOOR") === "shared" &&
		isPersonId(s("FOUNDER")) &&
		sessionMs !== null &&
		(s("ORIGIN") === "" || /^https?:\/\/[^/\s]+$/.test(s("ORIGIN")))
	)
		return {kind: "shared", founder: s("FOUNDER"), origin: s("ORIGIN") || null, sessionMs};
	return {kind: "closed"};
};

/**
 * A name a person logs in or is invited by, as the door takes it: up to 100 characters, no
 * spaces (a grant names it on one line). Which names are someone's is the keys service's
 * answer: on GitHub's, a login.
 */
export const isName = (s: unknown): s is string => typeof s === "string" && NAME.test(s);
const NAME = /^\S{1,100}$/;

// ---------------------------------------------------------------- members

type MemberFact =
	| {kind: "founded" | "invited" | "joined"; id: string; name: string}
	| {kind: "removed"; id: string};

export type Members = {
	readonly founded: boolean;
	/** Person's id → the name they went by when they joined. */
	readonly members: ReadonlyMap<string, string>;
	/** Person's id → the name they went by when invited. */
	readonly invited: ReadonlyMap<string, string>;
};

const PersonId = Schema.String.check(Schema.isPattern(PERSON_ID));
/** A member fact's data: `{id, name}`, and `{id}` for `removed`. */
const readCame = Schema.decodeUnknownOption(
	Schema.fromJsonString(
		Schema.Struct({id: PersonId, name: Schema.String.check(Schema.isPattern(NAME))}),
	),
);
const readRemoved = Schema.decodeUnknownOption(
	Schema.fromJsonString(Schema.Struct({id: PersonId})),
);

const factOf = (kind: string, data: string): MemberFact | null => {
	if (kind === "removed") {
		const d = readRemoved(data);
		return Option.isSome(d) ? {kind, id: d.value.id} : null;
	}
	if (kind !== "founded" && kind !== "invited" && kind !== "joined") return null;
	const d = readCame(data);
	return Option.isSome(d) ? {kind, id: d.value.id, name: d.value.name} : null;
};

/** The members, folded from `door/members` in order. */
export const membersOf = (rows: readonly SqlRow[]): Members => {
	let founded = false;
	const members = new Map<string, string>();
	const invited = new Map<string, string>();
	for (const r of rows) {
		// Only the door writes here; a row that does not read is skipped, never trusted.
		const f = factOf(String(r.kind), String(r.data));
		if (f === null) continue;
		if (f.kind === "founded") {
			founded = true;
			members.set(f.id, f.name);
		} else if (f.kind === "invited") {
			if (!members.has(f.id)) invited.set(f.id, f.name);
		} else if (f.kind === "joined") {
			if (invited.delete(f.id)) members.set(f.id, f.name);
		} else {
			members.delete(f.id);
			invited.delete(f.id);
		}
	}
	return {founded, members, invited};
};

/**
 * Who this ledger knows by `name`: its members and open invites who went by it when they came,
 * in any case (on GitHub a login is one name in any case). Only these are asked about at a login.
 * The name only finds them; the signature proves which, if any, is the one signing.
 */
export const knownBy = (m: Members, name: string): Known[] => {
	const n = name.toLowerCase();
	return [...m.members, ...m.invited]
		.filter(([, was]) => was.toLowerCase() === n)
		.map(([id, was]) => ({id, name: was}));
};

/** A person this ledger knows: their id, and the name it knows them by. */
export type Known = {readonly id: string; readonly name: string};

/**
 * The one refusal for a login by a name this ledger does not know, and by a key not listed for the
 * person it knows by that name: the answer does not tell who is a member.
 */
export const NOT_PROVEN = "not signed by a key of anyone this ledger knows by that name";

// ---------------------------------------------------------------- texts that get signed

/** The challenge a person or an agent signs to log in. */
export const challengeText = (o: {address: string; nonce: string; expires: number}): string =>
	`fabrika ledger login\nledger: ${o.address}\nnonce: ${o.nonce}\nexpires: ${o.expires}\n`;

export type Grant = {
	readonly address: string;
	readonly agent: string;
	/** The agent's own public key, a key line. */
	readonly key: string;
	/** The name the person logs in by (`isName`): on GitHub's keys service, their login. */
	readonly for: string;
	readonly expires: number;
};

/** What a person signs to let an agent in: `ssh-keygen -Y sign -n fabrika-ledger` over this. */
export const grantText = (g: Grant): string =>
	`fabrika agent grant\nledger: ${g.address}\nagent: ${g.agent}\nkey: ${g.key}\nfor: ${g.for}\nexpires: ${g.expires}\n`;

/** An agent's name: lower-case letters, digits, dots, dashes and underscores. */
export const isAgentName = (s: unknown): s is string =>
	typeof s === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(s);

/** A grant's text, read back; null unless it is exactly what `grantText` writes. */
export const grantOf = (text: string): Grant | null => {
	const m =
		/^fabrika agent grant\nledger: (\S+)\nagent: (\S+)\nkey: (ssh-ed25519 \S+)\nfor: (\S+)\nexpires: ([0-9]{1,15})\n$/.exec(
			text,
		);
	if (m === null) return null;
	const [, address = "", agent, key = "", name, expires] = m;
	const line = keyOnly(key);
	if (!isAgentName(agent) || !isName(name) || line === null || line !== key) return null;
	const g: Grant = {address, agent, key: line, for: name, expires: Number(expires)};
	return grantText(g) === text ? g : null;
};

// ---------------------------------------------------------------- tokens

const hex = (b: ArrayBuffer) =>
	[...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** SHA-256 of a token, as hex: what the ledger keeps. A token itself is never stored. */
export const hashOf = async (token: string): Promise<string> =>
	hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));

/** 32 random bytes, base64url, after a prefix a person can read (and a secret scanner can find). */
export const newToken = (prefix: string): string => {
	const b = crypto.getRandomValues(new Uint8Array(32));
	let bin = "";
	for (const x of b) bin += String.fromCharCode(x);
	return `${prefix}${btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
};

const MIGRATION = [
	// `kind` says what the session opens, and only `person` sessions have no agent: an agent's
	// session can never be read back as a person's.
	`CREATE TABLE IF NOT EXISTS door_sessions (
		hash TEXT PRIMARY KEY,
		kind TEXT NOT NULL CHECK (kind IN ('person', 'agent')),
		person TEXT NOT NULL,
		agent TEXT,
		expires_at INTEGER NOT NULL,
		CHECK ((kind = 'agent') = (agent IS NOT NULL))
	)`,
	"CREATE INDEX IF NOT EXISTS door_sessions_person ON door_sessions (person)",
	`CREATE TABLE IF NOT EXISTS door_challenges (
		nonce TEXT PRIMARY KEY,
		text TEXT NOT NULL,
		expires_at INTEGER NOT NULL
	)`,
];

// ---------------------------------------------------------------- the door

export type LoginAnswer = {readonly token: string; readonly who: Stamp; readonly expires: number};

/**
 * The door. `keys` runs the one question the door asks about a person (`Keys`): the caller builds
 * it once from the Layer it picked, so whatever that Layer keeps (GitHub's cache) lives as long as
 * the door does.
 */
export class Door {
	readonly #db: Db;
	readonly #config: DoorConfig;
	readonly #keys: ManagedRuntime.ManagedRuntime<Keys, never>;
	readonly #now: () => number;
	readonly #wrote: (w: Written) => void;

	constructor(
		db: Db,
		config: DoorConfig,
		keys: ManagedRuntime.ManagedRuntime<Keys, never>,
		o: {now?: () => number; wrote?: (w: Written) => void} = {},
	) {
		this.#db = db;
		this.#config = config;
		this.#keys = keys;
		this.#now = o.now ?? Date.now;
		this.#wrote = o.wrote ?? (() => {});
		db.tx(() => {
			for (const stmt of MIGRATION) db.all(stmt);
		});
	}

	get kind(): DoorConfig["kind"] {
		return this.#config.kind;
	}

	/**
	 * This object's address, as challenges and grants name it: the server's origin, then `object`,
	 * the name the server picked this object by. A server holds many objects (one per project, one
	 * per person), so the name is always part of it: a grant for one object opens no other.
	 */
	address(origin: string, object: string): string {
		const c = this.#config;
		return `${c.kind === "shared" && c.origin !== null ? c.origin : origin}/${object}`;
	}

	members(): Members {
		return membersOf(readStream(this.#db, MEMBERS));
	}

	/** Who a credential is. Every request but the login's own steps goes through here first. */
	async who(token: string | null): Promise<Let<Stamp>> {
		const c = this.#config;
		if (c.kind === "closed") return refuse(403, "this ledger has no door");
		if (token === null || token === "") return refuse(401, "no credential");
		const hash = await hashOf(token);
		if (c.kind === "local" && hash === c.secretHash) return letIn({kind: "user", id: c.person});
		const now = this.#now();
		const row = this.#db.all(
			"SELECT kind, person, agent FROM door_sessions WHERE hash = ? AND expires_at > ?",
			hash,
			now,
		)[0];
		if (row === undefined) return refuse(401, "no such session, or it has ended");
		const person = String(row.person);
		if (c.kind === "shared" && !this.members().members.has(person))
			return refuse(403, "not a member of this ledger");
		if (row.kind === "agent") return letIn({kind: "agent", id: String(row.agent), for: person});
		return letIn({kind: "user", id: person});
	}

	/** A fresh challenge for a login, good once and for `CHALLENGE_MS`. */
	challenge(address: string): Let<{readonly text: string}> {
		if (this.#config.kind !== "shared") return refuse(404, "this ledger's door takes no login");
		const now = this.#now();
		const nonce = newToken("");
		const text = challengeText({address, nonce, expires: now + CHALLENGE_MS});
		this.#db.tx(() => {
			this.#db.all("DELETE FROM door_challenges WHERE expires_at <= ?", now);
			this.#db.all(
				"INSERT INTO door_challenges (nonce, text, expires_at) VALUES (?, ?, ?)",
				nonce,
				text,
				now + CHALLENGE_MS,
			);
		});
		return letIn({text});
	}

	/** Take a challenge back: it must be one this ledger gave out, unused and in time. Used up either way. */
	#spend(text: unknown): Refused | null {
		if (typeof text !== "string") return refuse(400, "no challenge");
		const nonce = /\nnonce: (\S+)\n/.exec(text)?.[1] ?? "";
		const now = this.#now();
		const row = this.#db.tx(() => {
			const r = this.#db.all(
				"SELECT text, expires_at FROM door_challenges WHERE nonce = ?",
				nonce,
			)[0];
			this.#db.all("DELETE FROM door_challenges WHERE nonce = ?", nonce);
			return r;
		});
		if (row === undefined || row.text !== text)
			return refuse(401, "not a challenge this ledger gave out");
		if (Number(row.expires_at) <= now) return refuse(401, "the challenge has ended");
		return null;
	}

	#fact(by: Stamp, kind: MemberFact["kind"], data: object): void {
		const res = writeUnguarded(this.#db, this.#now(), MEMBERS, "any", {
			kind,
			writer: stampText(by),
			data,
		});
		if (res.ok) this.#wrote({stream: MEMBERS, rev: res.rev, pos: res.pos});
	}

	#session(
		kind: "person" | "agent",
		person: string,
		agent: string | null,
		until: number,
	): LoginAnswer {
		const token = newToken(kind === "person" ? "fabrika_p_" : "fabrika_a_");
		return {
			token,
			who:
				kind === "person"
					? {kind: "user", id: person}
					: {kind: "agent", id: agent ?? "", for: person},
			expires: until,
		};
	}

	async #store(a: LoginAnswer, kind: "person" | "agent"): Promise<void> {
		const hash = await hashOf(a.token);
		this.#db.all(
			"INSERT INTO door_sessions (hash, kind, person, agent, expires_at) VALUES (?, ?, ?, ?, ?)",
			hash,
			kind,
			a.who.kind === "user" ? a.who.id : a.who.for,
			a.who.kind === "agent" ? a.who.id : null,
			a.expires,
		);
	}

	/**
	 * One question to the keys service, as a refusal or an answer. Its answer's id is checked here,
	 * as config's is: it ends up in every writer and holder.
	 */
	#ask(
		about: string,
		q: (k: Keys["Service"]) => Effect.Effect<Signers | null, KeysUnreachable>,
		ok: (s: Signers) => boolean,
	): Promise<Let<Signers | null>> {
		return this.#keys.runPromise(
			Keys.use(q).pipe(
				Effect.map(
					(s): Let<Signers | null> =>
						s === null || (isPersonId(s.id) && ok(s))
							? letIn(s)
							: refuse(502, "the keys service gave an id that is no person's, or another's"),
				),
				Effect.catchTag("KeysUnreachable", (e) =>
					Effect.succeed(refuse(502, `could not ask for the keys of ${about}: ${e.why}`)),
				),
			),
		);
	}

	/**
	 * Who this ledger knows by `name`, if `signature` over `text` is by a key the keys service lists
	 * for them. Asks the keys service about those people only, by id: a name it does not know asks
	 * nothing. Before the first login that is the founder, by the name the service gives them now.
	 */
	async #proven(name: unknown, text: string, signature: unknown): Promise<Let<Known>> {
		if (!isName(name)) return refuse(400, "not a name");
		if (typeof signature !== "string") return refuse(400, "no signature");
		const c = this.#config;
		const m = this.members();
		const known = knownBy(m, name);
		const founder = c.kind === "shared" && !m.founded ? c.founder : null;
		const ids = [...known.map((k) => k.id), ...(founder === null ? [] : [founder])];
		for (const id of new Set(ids)) {
			const asked = await this.#ask(
				id,
				(k) => k.byId(id),
				(s) => s.id === id,
			);
			if (!asked.ok) return asked;
			const s = asked.value;
			if (s === null) continue;
			const as = known.find((k) => k.id === id)?.name ?? s.name;
			if (as.toLowerCase() !== name.toLowerCase()) continue;
			if ((await verify(signature, text, NAMESPACE, s.keys)) !== null) return letIn({id, name: as});
		}
		return refuse(401, NOT_PROVEN);
	}

	/** A person's login: a challenge, signed with a key the keys service lists for them. */
	async login(body: {
		name?: unknown;
		challenge?: unknown;
		signature?: unknown;
	}): Promise<Let<LoginAnswer>> {
		if (this.#config.kind !== "shared") return refuse(404, "this ledger's door takes no login");
		const {founder, sessionMs} = this.#config;
		const spent = this.#spend(body.challenge);
		if (spent !== null) return spent;
		const proven = await this.#proven(body.name, String(body.challenge), body.signature);
		if (!proven.ok) return proven;
		const {id, name} = proven.value;
		const m = this.members();
		const me: Person = {kind: "user", id};
		if (!m.members.has(id)) {
			if (!m.founded && id === founder) this.#fact(me, "founded", {id, name});
			else if (m.invited.has(id)) this.#fact(me, "joined", {id, name});
			// Taken off while they signed: as if this ledger never knew them.
			else return refuse(401, NOT_PROVEN);
		}
		const a = this.#session("person", id, null, this.#now() + sessionMs);
		await this.#store(a, "person");
		return letIn(a);
	}

	/**
	 * An agent's login: a grant its person signed (naming the agent, its key, this ledger and an
	 * end), and a challenge the agent signed with that key. It makes an agent's session only, and
	 * only while its person has a live session here: it ends when the grant does, or when that
	 * person's latest session does, whichever is first. Its person logs in again to let it go on.
	 */
	async agentLogin(
		address: string,
		body: {grant?: unknown; granted?: unknown; challenge?: unknown; signature?: unknown},
	): Promise<Let<LoginAnswer>> {
		if (this.#config.kind !== "shared") return refuse(404, "this ledger's door takes no login");
		const spent = this.#spend(body.challenge);
		if (spent !== null) return spent;
		const g = typeof body.grant === "string" ? grantOf(body.grant) : null;
		if (g === null) return refuse(400, "not a grant");
		const now = this.#now();
		if (g.address !== address) return refuse(401, "the grant is for another ledger");
		if (g.expires <= now) return refuse(401, "the grant has ended");
		const proven = await this.#proven(g.for, String(body.grant), body.granted);
		if (!proven.ok) return proven;
		if (!this.members().members.has(proven.value.id))
			return refuse(403, `${g.for} is not a member of this ledger`);
		if (
			typeof body.signature !== "string" ||
			(await verify(body.signature, String(body.challenge), NAMESPACE, [g.key])) === null
		)
			return refuse(401, "the challenge is not signed by the grant's key");
		const person = proven.value.id;
		const live = this.#db.all(
			"SELECT MAX(expires_at) AS until FROM door_sessions WHERE kind = 'person' AND person = ? AND expires_at > ?",
			person,
			now,
		)[0]?.until;
		if (typeof live !== "number")
			return refuse(403, `${g.for} has no session on this ledger: they log in first`);
		const a = this.#session("agent", person, g.agent, Math.min(g.expires, live));
		await this.#store(a, "agent");
		return letIn(a);
	}

	/**
	 * A member invites a name: the one step that asks the keys service about a name this ledger
	 * does not know yet. The invite keeps the id and the name the service gives for it now, so the
	 * person who joins is that one, and signs in by that name, whatever they go by there later.
	 */
	async invite(by: Stamp, name: unknown): Promise<Let<Known>> {
		if (by.kind !== "user") return refuse(403, "only a person invites");
		if (this.#config.kind !== "shared") return refuse(404, "a local ledger has one person");
		if (!isName(name)) return refuse(400, "not a name");
		const asked = await this.#ask(
			name,
			(k) => k.of(name),
			(s) => isName(s.name),
		);
		if (!asked.ok) return asked;
		if (asked.value === null) return refuse(404, `nobody goes by ${name}`);
		const {id} = asked.value;
		const m = this.members();
		const known = m.members.get(id) ?? m.invited.get(id);
		if (known !== undefined) return letIn({id, name: known});
		this.#fact(by, "invited", {id, name: asked.value.name});
		return letIn({id, name: asked.value.name});
	}

	/** A member takes a member, or an invite, off, by the person's id. The last member stays. */
	remove(by: Stamp, id: unknown): Let<{readonly id: string}> {
		if (by.kind !== "user") return refuse(403, "only a person removes");
		if (this.#config.kind !== "shared") return refuse(404, "a local ledger has one person");
		if (!isPersonId(id)) return refuse(400, "not a person's id");
		const m = this.members();
		if (!m.members.has(id) && !m.invited.has(id)) return refuse(404, "not a member or an invite");
		if (m.members.has(id) && m.members.size === 1) return refuse(403, "the last member stays");
		this.#db.tx(() => {
			this.#fact(by, "removed", {id});
			this.#db.all("DELETE FROM door_sessions WHERE person = ?", id);
		});
		return letIn({id});
	}

	/** On a local ledger: the person mints a token for one of their agents. */
	async addAgent(by: Stamp, name: unknown): Promise<Let<LoginAnswer>> {
		if (by.kind !== "user") return refuse(403, "only a person adds an agent");
		if (this.#config.kind !== "local") return refuse(404, "agents log in with a grant here");
		if (!isAgentName(name)) return refuse(400, "not an agent's name");
		const a = this.#session("agent", by.id, name, this.#now() + LOCAL_AGENT_MS);
		await this.#store(a, "agent");
		return letIn(a);
	}
}

// ---------------------------------------------------------------- the wire, stamped

/**
 * What a request may say, per method: its arguments, with no writer and no holder in them (a
 * claim says its host's tag; the door makes the holder). `build` puts the stamp where the ledger's
 * own method takes it. Any method not here is not on the wire.
 */
type Shape = {
	readonly arity: number;
	/** Reads change nothing, and may name the door's streams. */
	readonly read?: true;
	/** Only a person: an agent's credential is refused. */
	readonly person?: true;
	readonly build?: (args: unknown[], who: Stamp) => Let<unknown[]>;
};

const withWriter = (args: unknown[], who: Stamp) => letIn([...args, stampText(who)]);

/**
 * An event as a request sends it, made the ledger's: its writer is the stamp. Every method that
 * carries an event takes it through here (today `append`, which the `Ledger` service's `send` is
 * too), so each refusal below holds on every write.
 */
const eventOf = (event: unknown, who: Stamp): Let<Event> => {
	if (typeof event !== "object" || event === null || Array.isArray(event))
		return refuse(400, "an event is an object");
	const e = event as Record<string, unknown>;
	if ("writer" in e) return refuse(400, "a request does not say its writer: the door does");
	if (Object.keys(e).some((k) => k !== "kind" && k !== "data" && k !== "id"))
		return refuse(400, "an event has kind, data and id only");
	if (typeof e.kind !== "string") return refuse(400, "an event has a kind");
	const id = e.id ?? null;
	if (id !== null && typeof id !== "string") return refuse(400, "an event's id is text");
	if (who.kind !== "user" && typeof id === "string" && id.startsWith(REDRIVE))
		return refuse(403, "only a person sends a dead letter back");
	if (who.kind !== "user" && isPersonKind(e.kind))
		return refuse(403, `only a person writes ${e.kind}: an agent does not answer for its person`);
	return letIn({kind: e.kind, data: e.data, id, writer: stampText(who)});
};

const SHAPES: Record<string, Shape> = {
	register: {arity: 1, build: withWriter},
	append: {
		arity: 4,
		build: ([stream, expected, event, fence], who) => {
			const e = eventOf(event, who);
			return e.ok ? letIn([stream, expected, e.value, fence]) : e;
		},
	},
	claim: {
		arity: 4,
		build: ([name, host, rev, ttl], who) =>
			typeof host === "string" && /^\S{1,200}$/.test(host)
				? letIn([name, holderOf(host, who), rev, ttl])
				: refuse(400, "a claim names its host: some text, no spaces"),
	},
	renew: {arity: 3},
	cancel: {arity: 1, person: true, build: withWriter},
	exit: {arity: 5, build: withWriter},
	monitor: {arity: 3},
	demonitor: {arity: 2},
	link: {arity: 2},
	unlink: {arity: 2},
	trapExit: {arity: 2},
	startChild: {arity: 4},
	exitChild: {arity: 5},
	hold: {arity: 3},
	charge: {arity: 3},
	setLimits: {arity: 2, person: true, build: withWriter},
	processInfo: {arity: 1, read: true},
	usage: {arity: 1, read: true},
	read: {arity: 3, read: true},
	readStream: {arity: 3, read: true},
	readLast: {arity: 2, read: true},
	lease: {arity: 1, read: true},
	alarmAt: {arity: 0, read: true},
	watchers: {arity: 0, read: true},
};

/** Is `method` on the wire at all. */
export const isWireMethod = (method: string): boolean => Object.hasOwn(SHAPES, method);

/**
 * A request's arguments, turned into the ledger method's own, with the writer or the holder from
 * the stamp. Refused: a method not on the wire, the wrong number of arguments (an old client that
 * still sends a writer), an agent on a person's call or with a person's kind (`PERSON_KINDS`), or a
 * write under the door's own name.
 */
export const trustedArgs = (method: string, args: unknown, who: Stamp): Let<unknown[]> => {
	const shape = Object.hasOwn(SHAPES, method) ? SHAPES[method] : undefined;
	if (shape === undefined) return refuse(404, `no method ${method}`);
	if (!Array.isArray(args) || args.length !== shape.arity)
		return refuse(400, `${method} takes ${shape.arity} arguments, and none of them is a writer`);
	if (shape.person && who.kind !== "user") return refuse(403, `only a person may ${method}`);
	if (!shape.read && args.some((a) => typeof a === "string" && isDoorStream(a)))
		return refuse(403, "only the door writes under door/");
	return shape.build ? shape.build(args, who) : letIn(args);
};
