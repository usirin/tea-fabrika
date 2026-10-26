import {Ledger} from "@kampus/fabrika";
import {Duration, Effect} from "effect";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {door, httpLayer, layerObject} from "./client.ts";
import {restore} from "./desk.ts";
import {fill, personId, projectName} from "./fill.ts";
import {A, agent, OPERATOR, personObject, type Running, startServer, user} from "./harness.ts";
import {moveObject, moveServer, objectsOf} from "./move.ts";
import {countOf} from "./programs.ts";

const LEASE_MS = 4_000;
let from: Running;
let to: Running;
let filled: Awaited<ReturnType<typeof fill>>;
let moved: Effect.Success<ReturnType<typeof moveServer>>;

beforeAll(async () => {
	from = await startServer({persist: true});
	to = await startServer({persist: true});
	filled = await fill(from, {projects: 3, people: 4, saves: 5, messages: 4, leaseMs: LEASE_MS});
	const [f, t] = await Promise.all([from.as(user(OPERATOR)), to.as(user(OPERATOR))]);
	moved = await Effect.runPromise(moveServer(f, t).pipe(Effect.provide(httpLayer)));
	movedAt = Date.now();
});
let movedAt = 0;
afterAll(async () => {
	await Promise.all([from.drop(), to.drop()]);
});

describe("moving a whole server", () => {
	it("every object the index names moves, and every object's hash matches", () => {
		expect([...moved.objects.map((m) => m.object)].sort()).toEqual(filled.objects);
		expect(moved.allSame).toBe(true);
		expect(moved.sameIndex).toBe(true);
		// Every table came along: the counter's events, the tree's names, monitors, links, jobs.
		const p0 = moved.objects.find((m) => m.object === projectName(0));
		for (const t of ["events", "leases", "jobs", "names", "monitors", "links", "door_self"])
			expect(p0?.tables[t] ?? 0).toBeGreaterThan(0);
	});

	it("the new server answers as the old one did, to sessions it minted itself", async () => {
		const read = async <A, E>(
			e: Effect.Effect<A, E, Ledger>,
			server: Running,
			who: string,
			at: string,
		) => {
			const s = await server.as(who.includes(".") ? agent(A, "builder") : user(who));
			return Effect.runPromise(e.pipe(Effect.provide(layerObject(s, at))));
		};
		const builder = `${A}.builder`;
		expect(await read(countOf, to, builder, projectName(0))).toBe(4);
		expect(await read(countOf, to, builder, "lane/f0~build")).toBe(4);
		const p = personId(0);
		expect(await read(restore, to, p, personObject(p))).toEqual(
			await read(restore, from, p, personObject(p)),
		);
		// The members came along: A founded f0 and invited B.
		const m = await Effect.runPromise(
			door(await to.as(user(A)), projectName(0), "members").pipe(Effect.provide(httpLayer)),
		);
		expect(m.body).toEqual({founder: A, ids: [A, "github:1002"]});
	});

	it("a lease copied over still ends on the new server: its alarm came along", async () => {
		// The move ended while the lease was still live, so its end was not copied: the new server wrote it.
		expect(movedAt).toBeLessThan(filled.lease.expiresAt);
		const wait = Math.max(0, filled.lease.expiresAt - Date.now()) + 1_500;
		await Effect.runPromise(Effect.sleep(Duration.millis(wait)));
		const last = await Effect.runPromise(
			Effect.gen(function* () {
				const l = yield* Ledger;
				return (yield* l.readLast("soon", 1))[0]?.kind;
			}).pipe(Effect.provide(layerObject(await to.as(agent(A, "builder")), projectName(0)))),
		);
		expect(last).toBe("lease_expired");
	});

	it("a batch sent twice is refused, and a write after the copy shows in the hash", async () => {
		const [f, t] = await Promise.all([from.as(user(OPERATOR)), to.as(user(OPERATOR))]);
		const again = await Effect.runPromise(
			door(t, projectName(1), "import", {
				table: "events",
				columns: ["pos"],
				rows: [[1]],
				from: 0,
			}).pipe(Effect.provide(httpLayer)),
		);
		expect(JSON.stringify(again.body)).toContain("out of order");
		// A person writes to the old server after their object was copied.
		const p = personId(1);
		await Effect.runPromise(
			Effect.gen(function* () {
				const l = yield* Ledger;
				yield* l.register("late", "app");
			}).pipe(Effect.provide(layerObject(await from.as(user(p)), personObject(p)))),
		);
		const hashes = await Effect.runPromise(
			Effect.all(
				[f, t].map((s) => door(s, personObject(p), "digest")),
				{concurrency: "unbounded"},
			).pipe(Effect.provide(httpLayer)),
		);
		expect(JSON.stringify(hashes[0]?.body)).not.toBe(JSON.stringify(hashes[1]?.body));
	});

	it("moving onto a server that has the object already is refused, not merged", async () => {
		const [f, t] = await Promise.all([from.as(user(OPERATOR)), to.as(user(OPERATOR))]);
		const r = await Effect.runPromise(
			moveObject(f, t, projectName(2)).pipe(
				Effect.map(() => "moved"),
				Effect.catchTag("MoveError", (e) => Effect.succeed(e.message)),
				Effect.provide(httpLayer),
			),
		);
		expect(r).toContain("out of order");
		expect((await Effect.runPromise(objectsOf(t).pipe(Effect.provide(httpLayer)))).length).toBe(
			filled.objects.length,
		);
	});
});
