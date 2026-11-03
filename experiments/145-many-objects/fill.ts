// A server with something in every table, for question 5's move: projects with members, a counter
// in each, a supervisor with a child, a monitor, a link and a spend; a lane; desks in many persons'
// objects; and a lease that ends soon, so the move must carry its alarm too.
import {Ledger} from "@kampus/fabrika-old";
import {Effect} from "effect";
import {door, httpLayer, layerObject} from "./client.ts";
import {deskOf, openDesk} from "./desk.ts";
import {A, agent, B, OPERATOR, personObject, type Running, user} from "./harness.ts";
import {runCounter} from "./programs.ts";

export interface Fill {
	readonly projects: number;
	readonly people: number;
	readonly saves: number;
	readonly messages: number;
	/** The lease on `soon` in the first project ends this long after the fill. */
	readonly leaseMs: number;
}

/** A tree on one object: a supervisor that traps exits, its child, a watcher that monitors and links it, a spend. */
const tree = Effect.gen(function* () {
	const l = yield* Ledger;
	const rs = yield* l.register("sup:1", "fill");
	const rw = yield* l.register("watcher:1", "fill");
	const cs = yield* l.claim("sup:1", "h-sup", rs.rev, 600_000);
	const cw = yield* l.claim("watcher:1", "h-watch", rw.rev, 600_000);
	yield* l.trapExit(cs.fence, true);
	yield* l.setLimits("sup:1", {usd: 5, children: 4}, "fill");
	yield* l.startChild(cs.fence, "sup:1-child", null, {usd: 1});
	yield* l.monitor(cw.fence, "ref-1", "sup:1");
	yield* l.link(cw.fence, "sup:1");
	yield* l.hold(cs.fence, "turn-1", {usd: 0.25, tokens: 1000});
	yield* l.charge(cs.fence, "turn-1", {usd: 0.1, tokens: 400});
});

const soon = (ms: number) =>
	Effect.gen(function* () {
		const l = yield* Ledger;
		const r = yield* l.register("soon", "fill");
		return yield* l.claim("soon", "h-soon", r.rev, ms);
	});

export const projectName = (i: number) => `project/f${i}`;
export const personId = (i: number) => `github:${2001 + i}`;

/** Fill `s`; answers the names of every object it made. */
export const fill = async (s: Running, o: Fill) => {
	const op = await s.as(user(OPERATOR));
	const run = <A, E>(
		e: Effect.Effect<A, E, Ledger>,
		server: Parameters<typeof layerObject>[0],
		at: string,
	) => Effect.runPromise(e.pipe(Effect.provide(layerObject(server, at))));
	const projects = Array.from({length: o.projects}, (_, i) => i);
	await Promise.all(
		projects.map(async (i) => {
			const name = projectName(i);
			const [founder, other] = i % 2 === 0 ? [A, B] : [B, A];
			const asFounder = await s.as(user(founder));
			await Effect.runPromise(
				Effect.gen(function* () {
					yield* door(op, name, "create", {founder});
					yield* door(asFounder, name, "invite", {id: other});
				}).pipe(Effect.provide(httpLayer)),
			);
			const builder = await s.as(agent(founder, "builder"));
			await run(runCounter(`host-${i}`, o.messages), builder, name);
			await run(tree, builder, name);
		}),
	);
	const lane = `lane/f0~build`;
	await run(runCounter("host-lane", o.messages), await s.as(agent(A, "builder")), lane);
	const people = Array.from({length: o.people}, (_, i) => personId(i));
	await Promise.all(
		people.map(async (p) => {
			await run(
				Effect.gen(function* () {
					const d = yield* openDesk("app-1");
					for (let k = 0; k < o.saves; k++) yield* d.save(deskOf(2, 3 + (k % 5)), `save-${k}`);
				}),
				await s.as(user(p)),
				personObject(p),
			);
		}),
	);
	const lease = await run(soon(o.leaseMs), await s.as(agent(A, "builder")), projectName(0));
	return {
		objects: [...projects.map(projectName), lane, ...people.map(personObject)].sort(),
		lease,
	};
};
