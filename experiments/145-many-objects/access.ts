// The access rule's laws, run against a whole server over HTTP, as the package's ledger laws are
// run against each ledger. Each law is a list of steps with the answer it must get; a law passes
// when every step got it. Every planted mistake in `server.ts` must break at least one of them.
import {Effect} from "effect";
import {type Answer, ask, door, httpLayer, type Server} from "./client.ts";
import {
	A,
	agent,
	B,
	C,
	D,
	minted,
	OPERATOR,
	personObject,
	type Running,
	sessionOf,
	user,
} from "./harness.ts";
import type {Who} from "./session.ts";

export interface Law {
	readonly law: string;
	readonly pass: boolean;
	/** Each step that did not get its answer: what it got. */
	readonly saw: readonly string[];
}

type Step = {readonly what: string; readonly answer: Answer; readonly want: (a: Answer) => boolean};

const status =
	(...codes: number[]) =>
	(a: Answer) =>
		codes.includes(a.status);

const lawOf = (law: string, steps: readonly Step[]): Law => {
	const saw = steps
		.filter((s) => !s.want(s.answer))
		.map((s) => `${s.what}: ${s.answer.status} ${JSON.stringify(s.answer.body).slice(0, 120)}`);
	return {law, pass: saw.length === 0, saw};
};

const field = (body: unknown, k: string): unknown =>
	typeof body === "object" && body !== null ? Reflect.get(body, k) : undefined;

/** Every law, on one server. Each run uses its own project names, so a run may follow another. */
export const accessLaws = (s: Running, tag = "p") =>
	Effect.gen(function* () {
		const as = (who: Who) => sessionOf(s, who);
		const op = yield* as(user(OPERATOR));
		const a = yield* as(user(A));
		const b = yield* as(user(B));
		const c = yield* as(user(C));
		const d = yield* as(user(D));
		const aAgent = yield* as(agent(A, "builder"));
		const bAgent = yield* as(agent(B, "builder"));
		const acme = `project/${tag}-acme`;
		const beta = `project/${tag}-beta`;
		const lane = `lane/${tag}-acme~t1`;
		const call = (server: Server, object: string, method: string, args: unknown[]) =>
			ask(server, `${object}/${method}`, args);
		const readAll = (server: Server, object: string) =>
			call(server, object, "read", [0, 1000, null]);

		// The set-up, as the operator and the founders. Each answer is checked by the laws below.
		const made = [
			yield* door(op, acme, "create", {founder: A}),
			yield* door(op, beta, "create", {founder: B}),
		];
		const invited = [
			yield* door(a, acme, "invite", {id: C}),
			yield* door(a, acme, "invite", {id: D}),
		];
		const removed = yield* door(a, acme, "remove", {id: C});
		// Person A writes in their own object: a name registered, so it has rows.
		const own = yield* call(a, personObject(A), "register", ["notes", A]);

		const laws: Law[] = [];
		laws.push(
			lawOf("1. a person opens their own object", [
				{what: "A registers in A's object", answer: own, want: status(200)},
				{what: "A reads A's object", answer: yield* readAll(a, personObject(A)), want: status(200)},
				{what: "B reads B's object", answer: yield* readAll(b, personObject(B)), want: status(200)},
				{
					what: "A's object knows its own name",
					answer: yield* door(a, personObject(A), "self"),
					want: (r) => r.status === 200 && field(r.body, "name") === personObject(A),
				},
			]),
		);
		const bOwn = yield* readAll(b, personObject(B));
		laws.push(
			lawOf("2. a person never opens another person's object, nor sees its rows", [
				{what: "A reads B's object", answer: yield* readAll(a, personObject(B)), want: status(403)},
				{what: "B reads A's object", answer: yield* readAll(b, personObject(A)), want: status(403)},
				{
					what: "B writes in A's object",
					answer: yield* call(b, personObject(A), "register", ["x", B]),
					want: status(403),
				},
				{
					what: "B's own object holds no row of A's",
					answer: bOwn,
					want: (r) => r.status === 200 && !JSON.stringify(r.body).includes(`"writer":"${A}"`),
				},
			]),
		);
		laws.push(
			lawOf("3. no agent opens a person's object, its own person's included", [
				{
					what: "A's agent reads A's object",
					answer: yield* readAll(aAgent, personObject(A)),
					want: status(403),
				},
				{
					what: "A's agent reads A's desk",
					answer: yield* call(aAgent, personObject(A), "readLast", ["desk/saved", 1]),
					want: status(403),
				},
			]),
		);
		laws.push(
			lawOf("4. a project opens to its members and their agents, and so do its lanes", [
				{
					what: "the operator creates acme",
					answer: made[0] ?? {status: 0, body: null},
					want: status(200),
				},
				{
					what: "the operator creates beta",
					answer: made[1] ?? {status: 0, body: null},
					want: status(200),
				},
				{what: "A reads acme", answer: yield* readAll(a, acme), want: status(200)},
				{what: "A's agent reads acme", answer: yield* readAll(aAgent, acme), want: status(200)},
				{what: "D, invited, reads acme", answer: yield* readAll(d, acme), want: status(200)},
				{what: "B reads beta", answer: yield* readAll(b, beta), want: status(200)},
				{what: "A reads acme's lane", answer: yield* readAll(a, lane), want: status(200)},
			]),
		);
		laws.push(
			lawOf("5. a project stays shut to everyone else, its lanes too", [
				{what: "B reads acme", answer: yield* readAll(b, acme), want: status(403)},
				{what: "B's agent reads acme", answer: yield* readAll(bAgent, acme), want: status(403)},
				{what: "A reads beta", answer: yield* readAll(a, beta), want: status(403)},
				{what: "B reads acme's lane", answer: yield* readAll(b, lane), want: status(403)},
				{what: "the operator reads acme", answer: yield* readAll(op, acme), want: status(403)},
				{what: "C, removed, reads acme", answer: yield* readAll(c, acme), want: status(403)},
			]),
		);
		const acmeMembers = yield* door(a, acme, "members");
		const betaMembers = yield* door(b, beta, "members");
		laws.push(
			lawOf("6. each project has its own founder, and one founder never spreads to another", [
				{
					what: "acme's founder is A",
					answer: acmeMembers,
					want: (r) => r.status === 200 && field(r.body, "founder") === A,
				},
				{
					what: "beta's founder is B",
					answer: betaMembers,
					want: (r) => r.status === 200 && field(r.body, "founder") === B,
				},
				{
					what: "the operator is a member of neither",
					answer: {status: 200, body: [acmeMembers.body, betaMembers.body]},
					want: (r) => !JSON.stringify(r.body).includes(OPERATOR),
				},
				{
					what: "a project is made once",
					answer: yield* door(op, acme, "create", {founder: B}),
					want: status(409),
				},
				{
					what: "nobody but the operator makes one",
					answer: yield* door(a, `project/${tag}-gamma`, "create", {founder: A}),
					want: status(403),
				},
			]),
		);
		laws.push(
			lawOf("7. only the founder invites or removes", [
				{what: "A invites C", answer: invited[0] ?? {status: 0, body: null}, want: status(200)},
				{what: "A invites D", answer: invited[1] ?? {status: 0, body: null}, want: status(200)},
				{what: "A removes C", answer: removed, want: status(200)},
				{
					what: "D, a member, invites B",
					answer: yield* door(d, acme, "invite", {id: B}),
					want: status(403),
				},
				{
					what: "A removes A, the founder",
					answer: yield* door(a, acme, "remove", {id: A}),
					want: status(400),
				},
			]),
		);
		laws.push(
			lawOf("8. nobody writes the door's own facts through the ledger's calls", [
				{
					what: "D registers door",
					answer: yield* call(d, acme, "register", ["door", D]),
					want: status(403),
				},
				{
					what: "D appends to door/members",
					answer: yield* call(d, acme, "append", [
						"door/members",
						"any",
						{kind: "invited", writer: D, data: {id: B}, id: null},
						null,
					]),
					want: status(403),
				},
				{what: "B still cannot read acme", answer: yield* readAll(b, acme), want: status(403)},
			]),
		);
		const other = yield* minted("another secret", user(A), 60_000);
		const old = yield* minted(s.secret, user(A), 1_000, Date.now() - 10_000);
		const forged = yield* minted(s.secret, {kind: "agent", id: `${B}.builder`, for: A}, 60_000);
		laws.push(
			lawOf("9. no session, a forged one or an old one opens nothing", [
				{
					what: "no session",
					answer: yield* readAll({url: s.url, token: ""}, personObject(A)),
					want: status(401),
				},
				{
					what: "signed with another secret",
					answer: yield* readAll({url: s.url, token: other}, personObject(A)),
					want: status(401),
				},
				{
					what: "run out",
					answer: yield* readAll({url: s.url, token: old}, personObject(A)),
					want: status(401),
				},
				{
					what: "an agent named for B, working for A",
					answer: yield* readAll({url: s.url, token: forged}, acme),
					want: status(401),
				},
			]),
		);
		laws.push(
			lawOf("10. a path that names no object reaches none", [
				{
					what: "a login, not an id",
					answer: yield* readAll(a, "person/someone"),
					want: status(404),
				},
				{what: "a leading zero", answer: yield* readAll(a, "person/01001"), want: status(404)},
				{what: "the package's own path", answer: yield* readAll(a, "ledger"), want: status(404)},
				{what: "a kind nobody has", answer: yield* readAll(a, "team/acme"), want: status(404)},
				{
					what: "a method the door does not offer",
					answer: yield* call(a, personObject(A), "alarmAt", []),
					want: status(404),
				},
			]),
		);
		return laws;
	}).pipe(Effect.provide(httpLayer));
