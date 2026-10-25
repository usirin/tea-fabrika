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
//   founded {id, login}   the ledger's founder, named by its config (`FOUNDER`), on first login
//   invited {id, login}   a member invites a GitHub login; the invite keeps GitHub's numeric id
//   joined  {id, login}   that person's first login: the id must match, not only the login
//   removed {id}          a member takes a member (or an invite) off; their sessions end
//
// How a person proves who they are: an SSH signature (`sshsig.ts`) over a challenge this ledger
// gave out, by a key GitHub lists for the login (`GET /users/{login}/keys`), and GitHub's numeric
// id for that login (`GET /users/{login}`). An agent holds its own key, and a grant its person's
// key signed: it names the agent, its key, this ledger and an end. A grant makes an agent's
// session, never a person's.
//
// Two doors, by config:
//
//   github   the shared ledger: members, SSH proof, sessions (above)
//   local    one laptop: one person from config, proven by a secret the starter holds
//            (`local.ts`), and agent tokens that person mints
//
// With neither, every request is refused: a ledger with no door is closed, not open.
//
// Erasable TypeScript: workerd loads this file with its types stripped, beside `rules.ts` and
// `sshsig.ts` (worker-options.ts). Node runs the same file in the tests, on node:sqlite.
import type {Db, SqlRow, Written} from "./rules.ts";
import {readStream, writeUnguarded} from "./rules.ts";
import {keyOnly, verify} from "./sshsig.ts";

// ---------------------------------------------------------------- who

/**
 * What the door says a credential is: a person (on a GitHub door, `github:<GitHub's numeric user
 * id>`), or an agent and the person it works for. Nothing else may be stamped as a writer.
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
 * The host's own tag in a holder, as the host named itself to `claim`. A stamp has no "@" in it
 * (a person's id, an agent's name and `github:<n>` never do), so the last "@" ends the host's tag.
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

// GitHub is the one place a person's keys live. Every key GitHub lists for a member's login may
// sign in; nothing here pins one. A key taken off on GitHub stops letting anyone in once the
// door's copy of the list is old (`KEYS_CACHE_MS`), and every session it opened has ended
// (`SESSION_MS`). So a session is short, and an agent's session never outlives its person's.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/**
 * How long a person's session lasts on a GitHub door, by default: 4 hours. A key taken off on
 * GitHub works at most this long after (plus the cache). Shorter means more logins, each one an
 * SSH signature and two GitHub calls; 4 hours is two logins in a working day.
 */
export const SESSION_MS = 4 * HOUR;
/**
 * How long the door keeps a login's id and keys from GitHub, by default: 5 minutes. Long enough
 * that a burst of logins (an app and its agents) asks GitHub once, as GitHub allows only 60 calls
 * an hour without a token; short enough that a key taken off there is gone soon after.
 */
export const KEYS_CACHE_MS = 5 * MINUTE;
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
	 * `founder`: GitHub's numeric id of the person who made the ledger. `origin`: the server's
	 * public origin, as challenges and grants name it before the object's name (null: the
	 * request's own). `sessionMs` and `keysCacheMs`: `SESSION_MS` and `KEYS_CACHE_MS` unless the
	 * env says otherwise.
	 */
	| {
			readonly kind: "github";
			readonly founder: number;
			readonly origin: string | null;
			readonly sessionMs: number;
			readonly keysCacheMs: number;
	  };

/**
 * The Worker's env, as the door reads it. Anything missing or malformed closes the door, but for
 * `SESSION_MS` and `KEYS_CACHE_MS`: left out, they are the defaults.
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
		// No "@" in a person's id: `hostOf` splits a holder at its last one.
		/^[^\s@]+$/.test(s("LOCAL_PERSON")) &&
		/^[0-9a-f]{64}$/.test(s("LOCAL_SECRET_HASH"))
	)
		return {kind: "local", person: s("LOCAL_PERSON"), secretHash: s("LOCAL_SECRET_HASH")};
	const sessionMs = ms("SESSION_MS", SESSION_MS, MINUTE);
	const keysCacheMs = ms("KEYS_CACHE_MS", KEYS_CACHE_MS, 0);
	if (
		s("DOOR") === "github" &&
		/^[1-9][0-9]*$/.test(s("FOUNDER")) &&
		sessionMs !== null &&
		keysCacheMs !== null &&
		(s("ORIGIN") === "" || /^https?:\/\/[^/\s]+$/.test(s("ORIGIN")))
	)
		return {
			kind: "github",
			founder: Number(s("FOUNDER")),
			origin: s("ORIGIN") || null,
			sessionMs,
			keysCacheMs,
		};
	return {kind: "closed"};
};

// ---------------------------------------------------------------- GitHub, as far as the door needs it

/** A GitHub account: its numeric id, which never changes, and its login, which may. */
export type GitHubUser = {readonly id: number; readonly login: string};

export interface GitHub {
	/** `GET /users/{login}`; null: no such login. */
	user(login: string): Promise<GitHubUser | null>;
	/** `GET /users/{login}/keys`: the public keys GitHub lists, as key lines. */
	keys(login: string): Promise<string[]>;
}

/** A GitHub login as GitHub allows it: letters, digits and single dashes, up to 39. */
export const isLogin = (s: unknown): s is string =>
	typeof s === "string" && /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(s);

/**
 * GitHub's REST API, with no token: both calls are public.
 * https://docs.github.com/en/rest/users/users#get-a-user
 * https://docs.github.com/en/rest/users/keys#list-public-keys-for-a-user
 */
export const githubApi = (get: (url: string, init: RequestInit) => Promise<Response>): GitHub => {
	const call = async (path: string): Promise<unknown> => {
		const res = await get(`https://api.github.com${path}`, {
			headers: {
				accept: "application/vnd.github+json",
				"user-agent": "fabrika-ledger",
				"x-github-api-version": "2022-11-28",
			},
		});
		if (res.status === 404) return null;
		if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${path}`);
		return res.json();
	};
	return {
		async user(login) {
			const u = (await call(`/users/${encodeURIComponent(login)}`)) as {
				id?: unknown;
				login?: unknown;
			};
			if (u === null || typeof u.id !== "number" || !Number.isInteger(u.id) || !isLogin(u.login))
				return null;
			return {id: u.id, login: u.login};
		},
		async keys(login) {
			const ks = await call(`/users/${encodeURIComponent(login)}/keys`);
			if (!Array.isArray(ks)) return [];
			return ks.flatMap((k: {key?: unknown}) => (typeof k.key === "string" ? [k.key] : []));
		},
	};
};

// ---------------------------------------------------------------- members

type MemberFact =
	| {kind: "founded" | "invited" | "joined"; id: number; login: string}
	| {kind: "removed"; id: number};

export type Members = {
	readonly founded: boolean;
	/** GitHub id → login, as it was when they joined. */
	readonly members: ReadonlyMap<number, string>;
	/** GitHub id → login, as it was when invited. */
	readonly invited: ReadonlyMap<number, string>;
};

const factOf = (kind: string, data: string): MemberFact | null => {
	try {
		const d = JSON.parse(data) as {id?: unknown; login?: unknown};
		if (typeof d.id !== "number") return null;
		if (kind === "removed") return {kind, id: d.id};
		if ((kind === "founded" || kind === "invited" || kind === "joined") && isLogin(d.login))
			return {kind, id: d.id, login: d.login};
		return null;
	} catch {
		return null;
	}
};

/** The members, folded from `door/members` in order. */
export const membersOf = (rows: readonly SqlRow[]): Members => {
	let founded = false;
	const members = new Map<number, string>();
	const invited = new Map<number, string>();
	for (const r of rows) {
		// Only the door writes here; a row that does not read is skipped, never trusted.
		const f = factOf(String(r.kind), String(r.data));
		if (f === null) continue;
		if (f.kind === "founded") {
			founded = true;
			members.set(f.id, f.login);
		} else if (f.kind === "invited") {
			if (!members.has(f.id)) invited.set(f.id, f.login);
		} else if (f.kind === "joined") {
			if (invited.delete(f.id)) members.set(f.id, f.login);
		} else {
			members.delete(f.id);
			invited.delete(f.id);
		}
	}
	return {founded, members, invited};
};

const personOf = (id: number): Person => ({kind: "user", id: `github:${id}`});
const githubIdOf = (person: string): number | null => {
	const m = /^github:([1-9][0-9]*)$/.exec(person);
	return m ? Number(m[1]) : null;
};

// ---------------------------------------------------------------- texts that get signed

/** The challenge a person or an agent signs to log in. */
export const challengeText = (o: {address: string; nonce: string; expires: number}): string =>
	`fabrika ledger login\nledger: ${o.address}\nnonce: ${o.nonce}\nexpires: ${o.expires}\n`;

export type Grant = {
	readonly address: string;
	readonly agent: string;
	/** The agent's own public key, a key line. */
	readonly key: string;
	/** The person's GitHub login. */
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
	const [, address = "", agent, key = "", login, expires] = m;
	const line = keyOnly(key);
	if (!isAgentName(agent) || !isLogin(login) || line === null || line !== key) return null;
	const g: Grant = {address, agent, key: line, for: login, expires: Number(expires)};
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

export class Door {
	readonly #db: Db;
	readonly #config: DoorConfig;
	readonly #github: GitHub;
	readonly #now: () => number;
	readonly #wrote: (w: Written) => void;
	readonly #keys = new Map<
		string,
		{readonly at: number; readonly user: GitHubUser | null; readonly keys: readonly string[]}
	>();

	constructor(
		db: Db,
		config: DoorConfig,
		github: GitHub,
		o: {now?: () => number; wrote?: (w: Written) => void} = {},
	) {
		this.#db = db;
		this.#config = config;
		this.#github = github;
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
		return `${c.kind === "github" && c.origin !== null ? c.origin : origin}/${object}`;
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
		if (c.kind === "github") {
			const id = githubIdOf(person);
			if (id === null || !this.members().members.has(id))
				return refuse(403, "not a member of this ledger");
		}
		if (row.kind === "agent") return letIn({kind: "agent", id: String(row.agent), for: person});
		return letIn({kind: "user", id: person});
	}

	/** A fresh challenge for a login, good once and for `CHALLENGE_MS`. */
	challenge(address: string): Let<{readonly text: string}> {
		if (this.#config.kind !== "github") return refuse(404, "this ledger's door takes no login");
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
	 * A login's id and the keys GitHub lists for it, asked again on each login once the copy here is
	 * `keysCacheMs` old. In memory only: an object that wakes up asks again.
	 */
	async #fromGitHub(
		login: string,
	): Promise<{readonly user: GitHubUser | null; readonly keys: readonly string[]}> {
		const ttl = this.#config.kind === "github" ? this.#config.keysCacheMs : 0;
		const now = this.#now();
		const kept = this.#keys.get(login);
		if (kept !== undefined && now - kept.at < ttl) return kept;
		const [user, keys] = await Promise.all([this.#github.user(login), this.#github.keys(login)]);
		const fresh = {at: now, user, keys};
		// Old copies go when the map grows: it never holds more than a few hundred logins.
		if (this.#keys.size >= 256) this.#keys.clear();
		this.#keys.set(login, fresh);
		return fresh;
	}

	/** Which GitHub user `login` is, if `signature` over `text` is by a key GitHub lists for them. */
	async #proven(login: unknown, text: string, signature: unknown): Promise<Let<GitHubUser>> {
		if (!isLogin(login)) return refuse(400, "not a GitHub login");
		if (typeof signature !== "string") return refuse(400, "no signature");
		let user: GitHubUser | null;
		let keys: readonly string[];
		try {
			({user, keys} = await this.#fromGitHub(login));
		} catch (e) {
			return refuse(502, `could not ask GitHub: ${e instanceof Error ? e.message : String(e)}`);
		}
		if (user === null) return refuse(401, "no such GitHub login");
		if ((await verify(signature, text, NAMESPACE, keys)) === null)
			return refuse(401, `not signed by a key GitHub lists for ${login}`);
		return letIn(user);
	}

	/** A person's login: a challenge, signed with a key GitHub lists for them. */
	async login(body: {
		login?: unknown;
		challenge?: unknown;
		signature?: unknown;
	}): Promise<Let<LoginAnswer>> {
		if (this.#config.kind !== "github") return refuse(404, "this ledger's door takes no login");
		const {founder, sessionMs} = this.#config;
		const spent = this.#spend(body.challenge);
		if (spent !== null) return spent;
		const proven = await this.#proven(body.login, String(body.challenge), body.signature);
		if (!proven.ok) return proven;
		const {id, login} = proven.value;
		const m = this.members();
		const me = personOf(id);
		if (!m.members.has(id)) {
			if (!m.founded && id === founder) this.#fact(me, "founded", {id, login});
			else if (m.invited.has(id)) this.#fact(me, "joined", {id, login});
			else return refuse(403, `${login} is not invited to this ledger`);
		}
		const a = this.#session("person", me.id, null, this.#now() + sessionMs);
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
		if (this.#config.kind !== "github") return refuse(404, "this ledger's door takes no login");
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
		const person = personOf(proven.value.id).id;
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

	/** A member invites a GitHub login. The invite keeps the numeric id GitHub has for it now. */
	async invite(by: Stamp, login: unknown): Promise<Let<GitHubUser>> {
		if (by.kind !== "user") return refuse(403, "only a person invites");
		if (this.#config.kind !== "github") return refuse(404, "a local ledger has one person");
		if (!isLogin(login)) return refuse(400, "not a GitHub login");
		let user: GitHubUser | null;
		try {
			user = await this.#github.user(login);
		} catch (e) {
			return refuse(502, `could not ask GitHub: ${e instanceof Error ? e.message : String(e)}`);
		}
		if (user === null) return refuse(404, "no such GitHub login");
		const m = this.members();
		if (!m.members.has(user.id) && !m.invited.has(user.id)) this.#fact(by, "invited", {...user});
		return letIn(user);
	}

	/** A member takes a member, or an invite, off. The last member stays. */
	remove(by: Stamp, person: unknown): Let<{readonly id: string}> {
		if (by.kind !== "user") return refuse(403, "only a person removes");
		if (this.#config.kind !== "github") return refuse(404, "a local ledger has one person");
		const id = typeof person === "string" ? githubIdOf(person) : null;
		if (id === null) return refuse(400, "not a person's id (github:<id>)");
		const m = this.members();
		if (!m.members.has(id) && !m.invited.has(id)) return refuse(404, "not a member or an invite");
		if (m.members.has(id) && m.members.size === 1) return refuse(403, "the last member stays");
		this.#db.tx(() => {
			this.#fact(by, "removed", {id});
			this.#db.all("DELETE FROM door_sessions WHERE person = ?", personOf(id).id);
		});
		return letIn({id: personOf(id).id});
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

const SHAPES: Record<string, Shape> = {
	register: {arity: 1, build: withWriter},
	append: {
		arity: 4,
		build: ([stream, expected, event, fence], who) => {
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
			return letIn([
				stream,
				expected,
				{kind: e.kind, data: e.data, id, writer: stampText(who)},
				fence,
			]);
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
 * still sends a writer), an agent on a person's call, or a write under the door's own name.
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
