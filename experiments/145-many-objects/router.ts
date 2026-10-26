// The router and the access rule of experiment 145's server, as plain functions: which object a
// request names, and who may open it. No imports but a type, so the Worker (`server.ts`, in
// workerd) and the tests (in Node) run the same code.
//
// Erasable TypeScript only: workerd gets this file with its types stripped.
import type {Who} from "./session.ts";

// ---------------------------------------------------------------- the router

export const KINDS = ["project", "person", "lane"] as const;
export type Kind = (typeof KINDS)[number];
const isKind = (s: string): s is Kind => KINDS.some((k) => k === s);

/** What an id of each kind looks like. A path that fits none reaches no object at all. */
const SHAPE: Record<Kind, RegExp> = {
	project: /^[a-z0-9][a-z0-9-]{0,62}$/,
	// A GitHub user id: the number, never the login, which its owner can change.
	person: /^[1-9][0-9]{0,11}$/,
	// A lane of a project: `<project>~<key>`.
	lane: /^[a-z0-9][a-z0-9-]{0,62}~[a-z0-9_][a-z0-9_.-]{0,99}$/,
};

/** Each kind lives in its own namespace: a person's object can never be reached as a project. */
export const BINDING = {project: "PROJECT", person: "PERSON", lane: "LANE"} as const;

export type Address = {
	readonly kind: Kind;
	readonly id: string;
	/** The object's name, `idFromName`'s input: `<kind>/<id>`. */
	readonly name: string;
	/** The rest of the path: the method, or `door` and its step. */
	readonly rest: readonly string[];
};

/** Which object a request is for, from its path `/<kind>/<id>/<method>`, or none. */
export const objectOf = (url: URL): Address | null => {
	const [, kind = "", id = "", ...rest] = url.pathname.split("/");
	if (!isKind(kind) || !SHAPE[kind].test(id)) return null;
	return {kind, id, name: `${kind}/${id}`, rest};
};

/** The project a project's or a lane's object belongs to; null for a person's. */
export const projectOf = (at: Address): string | null =>
	at.kind === "project" ? at.name : at.kind === "lane" ? `project/${at.id.split("~")[0]}` : null;

// ---------------------------------------------------------------- the rules

/** The rules, in one place; each planted mistake changes one, as the package's `rules.ts` does. */
export type Rules = {
	/** Which object the Worker hands a request to. */
	readonly route: "by-name" | "by-prefix";
	/** Does an object check that the name in the path is its own? */
	readonly nameCheck: "on" | "off";
	readonly person: "own" | "any-user" | "own-and-agents";
	readonly project: "members" | "any-session";
	readonly founder: "own-fact" | "operator";
	readonly removed: "counts" | "ignored";
	readonly doorFacts: "reserved" | "open";
};

export const RULES: Rules = {
	route: "by-name",
	nameCheck: "on",
	person: "own",
	project: "members",
	founder: "own-fact",
	removed: "counts",
	doorFacts: "reserved",
};

/** Each planted mistake changes one rule; the access laws (`access.ts`) must catch each. */
export const PLANTED = {
	/** The Worker cuts a person's id to its first 3 digits: persons 1001 and 1002 share an object. */
	"route-by-prefix": {route: "by-prefix"},
	/** An object takes a request for any name: alone it changes nothing a person can see. */
	"name-check-off": {nameCheck: "off"},
	/** Any logged-in person opens any person's object. */
	"person-any-user": {person: "any-user"},
	/** A person's agents open that person's object. */
	"person-agents": {person: "own-and-agents"},
	/** Any session opens any project. */
	"project-any-session": {project: "any-session"},
	/** One founder for the whole server, from its config, in every project. */
	"founder-from-config": {founder: "operator"},
	/** A removed member keeps their way in. */
	"removed-stays": {removed: "ignored"},
	/** A member may write the door's own facts (register `door`, claim it, invite anyone). */
	"door-open": {doorFacts: "open"},
} as const satisfies Record<string, Partial<Rules>>;
export type Planted = keyof typeof PLANTED;
const isPlanted = (p: string): p is Planted => p in PLANTED;

/** The rules with these planted mistakes in: a comma-separated list, empty for none. */
export const rulesOf = (planted: string): Rules => {
	const rules: Rules = {...RULES};
	for (const p of planted.split(",").filter(isPlanted)) Object.assign(rules, PLANTED[p]);
	return rules;
};

/** The name of the object the Worker hands a request to: the path's own, unless planted. */
export const routeOf = (rules: Rules, at: Address): string =>
	rules.route === "by-prefix" && at.kind === "person" ? `person/${at.id.slice(0, 3)}` : at.name;

// ---------------------------------------------------------------- the access rule

export type Members = {readonly founder: string | null; readonly ids: readonly string[]};

/** The person a session acts for: the user, or the agent's person. */
export const personOf = (who: Who) => (who.kind === "user" ? who.id : who.for);

/**
 * May `who` open this object? A person's object: that person alone, never an agent. A project's,
 * and its lanes': its members, and the agents working for them.
 */
export const mayOpen = (rules: Rules, at: Address, who: Who, members: Members | null): boolean => {
	if (at.kind === "person") {
		const owner = `github:${at.id}`;
		if (rules.person === "any-user") return who.kind === "user";
		if (rules.person === "own-and-agents") return personOf(who) === owner;
		return who.kind === "user" && who.id === owner;
	}
	if (rules.project === "any-session") return true;
	return members?.ids.includes(personOf(who)) ?? false;
};

/** The stream a project keeps its members on. Only the door writes it. */
export const FACTS = "door/members";

/** One of the door's facts, as the ledger keeps a row: its kind, and its data as JSON text. */
export type Fact = {readonly kind: unknown; readonly data: unknown};

/**
 * The members, folded from a project's own facts: `created` names its founder, then `invited` and
 * `removed`. The founder comes from this project's own `created`, never from the server's config.
 */
export const membersOf = (rows: readonly Fact[], rules: Rules, operator: string): Members => {
	let founder: string | null = null;
	const ids = new Set<string>();
	for (const r of rows) {
		const data: unknown = JSON.parse(String(r.data));
		const id = typeof data === "object" && data !== null ? String(Reflect.get(data, "id")) : "";
		if (r.kind === "created") {
			founder = id;
			ids.add(id);
		} else if (r.kind === "invited") ids.add(id);
		else if (r.kind === "removed" && rules.removed === "counts") ids.delete(id);
	}
	if (rules.founder === "operator") {
		founder = operator;
		ids.add(operator);
	}
	return {founder, ids: [...ids]};
};

/** Only the door writes under `door`: no method may name it. Reads are open to members. */
export const isDoorName = (s: unknown) =>
	typeof s === "string" && (s === "door" || s.startsWith("door/"));

/** Which arguments of each method name a stream or a registered name. */
export const NAMED: Readonly<Record<string, readonly number[]>> = {
	register: [0],
	append: [0],
	claim: [0],
	renew: [0],
	cancel: [0],
	exit: [0],
	setLimits: [0],
	monitor: [2],
	link: [1],
	unlink: [1],
	startChild: [1],
	exitChild: [1],
};

/** The ledger's methods the door offers: all of the package's but its two for tests. */
export const METHODS: ReadonlySet<string> = new Set([
	...Object.keys(NAMED),
	"demonitor",
	"trapExit",
	"hold",
	"charge",
	"usage",
	"processInfo",
	"read",
	"readStream",
	"readLast",
	"lease",
]);

/** Does this call name the door's own names? Then only a planted door lets it through. */
export const touchesDoor = (rules: Rules, method: string, args: readonly unknown[]) =>
	rules.doorFacts === "reserved" && (NAMED[method] ?? []).some((i) => isDoorName(args[i]));
