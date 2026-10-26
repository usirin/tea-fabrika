// Question 6's spike: one object per lane. A `Ledger` that sends each call to the object of the
// name it names, `lane/<project>~<the name's first segment>`, through the server's router. The
// package's ledger laws then run on it, to see exactly which calls break.
//
// A call that names a name goes to that name's object. A call that names only a fence
// (`monitor`, `link`, `startChild`, `hold`...) goes to the fence's object, found one of two ways:
//
//   "table"  fences stay bare numbers, and the client remembers which object answered each claim.
//            Every object counts its own log from 1, so two objects hand out the same numbers:
//            the table keeps the last, and an object takes another object's fence as its own
//            when the numbers match.
//   "home"   section 9's first change, done in the client: the fence a program sees carries its
//            object. It is the object's fence times 2^20, plus a 20-bit hash of the object's
//            name. A fence from another object is sent as -1, which holds nowhere.
//
// Neither builds section 9's other two changes: a parent index in place of a read across
// objects (`read` with no prefix is refused), and writes across names as messages (a fenced
// write or an OTP call into another object is answered by that object as it is, which refuses).
// Every answer below comes from an object, never from this file, except the refused `read`.
import {fromRaw, Ledger, LedgerUnreachable, type Raw} from "@kampus/fabrika";
import {Effect, Layer} from "effect";
import {HttpClient} from "effect/http";
import {httpLayer, rawObject, type Server} from "./client.ts";

export type FenceMode = "table" | "home";

/** The laws that broke, as measured: with fences by table, and with fences that carry their home. */
export const TABLE_BREAKS = ["2a", "18", "21", "22", "23", "24", "25", "26", "27", "29", "30"];
/** With fences by table, law 28 breaks on some runs: when two objects handed out the same number. */
export const TABLE_SOMETIMES = ["28"];
export const HOME_BREAKS = ["2a", "18", "21", "22", "23", "24", "25", "26", "27", "29", "30"];

/** The lane key of a name: its first segment, in the router's lane alphabet; `_` for none. */
export const keyOf = (name: string) =>
	(name.split("/")[0] || "_")
		.toLowerCase()
		.replace(/[^a-z0-9_.-]/g, ".")
		.slice(0, 100);

const BITS = 2 ** 20;
/** A 20-bit hash of an object's name (FNV-1a, cut to 20 bits). */
const homeHash = (object: string) => {
	let h = 0x811c9dc5;
	for (let i = 0; i < object.length; i++) {
		h ^= object.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h % BITS;
};

export const layerLanes = (server: Server, project: string, mode: FenceMode) =>
	Layer.effect(
		Ledger,
		Effect.gen(function* () {
			const http = yield* HttpClient.HttpClient;
			const raws = new Map<string, Raw>();
			const at = (object: string) => {
				const known = raws.get(object);
				if (known !== undefined) return known;
				const made = rawObject(server, object, http);
				raws.set(object, made);
				return made;
			};
			const laneOf = (name: string) => `lane/${project}~${keyOf(name)}`;
			/** Where a fence with no known object goes: an object that holds no lease. */
			const NOWHERE = `lane/${project}~_`;

			const table = new Map<number, string>();
			const homes = new Map<number, string>();
			/** The fence a program sees for an object's fence. */
			const shown = (object: string, fence: number) => {
				if (mode === "table") {
					table.set(fence, object);
					return fence;
				}
				homes.set(homeHash(object), object);
				return fence * BITS + homeHash(object);
			};
			/** The object a shown fence came from, or NOWHERE. */
			const homeOf = (fence: number) =>
				(mode === "table" ? table.get(fence) : homes.get(fence % BITS)) ?? NOWHERE;
			/** The fence to send to `object`: its own number, or one that holds nowhere. */
			const fenceAt = (object: string, fence: number) => {
				if (mode === "table") return fence;
				return homes.get(fence % BITS) === object ? Math.floor(fence / BITS) : -1;
			};
			/** A fence-only call: at the fence's object. */
			const byFence = <A>(
				fence: number,
				go: (raw: Raw, fence: number) => Effect.Effect<A, LedgerUnreachable>,
			) => {
				const object = homeOf(fence);
				return go(at(object), fenceAt(object, fence));
			};

			const raw: Raw = {
				register: (name, writer) => at(laneOf(name)).register(name, writer),
				append: (stream, expected, event, fence) => {
					const object = laneOf(stream);
					const f = fence === null ? null : fenceAt(object, fence);
					return at(object).append(stream, expected, event, f);
				},
				claim: (name, holder, expectedRev, ttlMs) => {
					const object = laneOf(name);
					return at(object)
						.claim(name, holder, expectedRev, ttlMs)
						.pipe(Effect.map((r) => (r.ok ? {...r, fence: shown(object, r.fence)} : r)));
				},
				renew: (name, fence, ttlMs) => {
					const object = laneOf(name);
					return at(object).renew(name, fenceAt(object, fence), ttlMs);
				},
				cancel: (name, writer) => at(laneOf(name)).cancel(name, writer),
				exit: (name, fence, reason, why, suspect, writer) => {
					const object = laneOf(name);
					return at(object).exit(name, fenceAt(object, fence), reason, why, suspect, writer);
				},
				monitor: (fence, ref, target) => byFence(fence, (r, f) => r.monitor(f, ref, target)),
				demonitor: (fence, ref) => byFence(fence, (r, f) => r.demonitor(f, ref)),
				link: (fence, other) => byFence(fence, (r, f) => r.link(f, other)),
				unlink: (fence, other) => byFence(fence, (r, f) => r.unlink(f, other)),
				trapExit: (fence, on) => byFence(fence, (r, f) => r.trapExit(f, on)),
				startChild: (fence, child, after, limits) =>
					byFence(fence, (r, f) => r.startChild(f, child, after, limits)),
				exitChild: (fence, child, incarnation, signal, why) =>
					byFence(fence, (r, f) => r.exitChild(f, child, incarnation, signal, why)),
				processInfo: (name) => at(laneOf(name)).processInfo(name),
				hold: (fence, id, cost) => byFence(fence, (r, f) => r.hold(f, id, cost)),
				charge: (fence, id, cost) => byFence(fence, (r, f) => r.charge(f, id, cost)),
				setLimits: (name, limits, writer) => at(laneOf(name)).setLimits(name, limits, writer),
				usage: (name) => at(laneOf(name)).usage(name),
				// Section 9's second change, a parent index, is not built: no read across objects.
				read: (fromPos, limit, prefix) =>
					prefix === null
						? Effect.fail(new LedgerUnreachable({method: "read", message: "a read across objects"}))
						: at(laneOf(prefix)).read(fromPos, limit, prefix),
				readStream: (stream, fromRev, limit) =>
					at(laneOf(stream)).readStream(stream, fromRev, limit),
				readLast: (stream, count) => at(laneOf(stream)).readLast(stream, count),
				lease: (name) => {
					const object = laneOf(name);
					return at(object)
						.lease(name)
						.pipe(Effect.map((l) => (l === null ? null : {...l, fence: shown(object, l.fence)})));
				},
				watch: (stream) => at(laneOf(stream)).watch(stream),
			};
			return fromRaw(raw);
		}),
	).pipe(Layer.provide(httpLayer));
