import {createServer} from "node:http";
import type {AddressInfo} from "node:net";
import {Clock, Deferred, Duration, Effect, Exit, Fiber, Redacted, Ref, type Scope} from "effect";
import {TestClock} from "effect/testing";
import {describe, expect, it} from "vitest";
import {DoorRefused, layerHttp, type Renewing, renewing, type Session} from "./http.ts";
import {Ledger} from "./ledger.ts";

// A session that renews (`renewing`), against a login that is a fake: it counts, and answers
// what the test says. The clock is Effect's TestClock, moved by hand, so 4 hours take no time.
// The same over a real door, on the ledger server's twin, is in apps/fabrika/src/host/shared.test.ts.

const HOUR = 3_600_000;
const MINUTE = 60_000;
const who = {kind: "user", id: "github:7"} as const;

/** The n-th session: its token is `t<n>`, and it ends `length` ms from now on the test's clock. */
const sessionAt = (n: number, now: number, length: number): Session => ({
	token: Redacted.make(`t${n}`),
	who,
	expires: now + length,
});

/** A fake login: each call is one more session of `length`, or what `answer` says instead. */
const fakeLogin = (length: number) =>
	Effect.gen(function* () {
		const count = yield* Ref.make(0);
		const answer = yield* Ref.make<DoorRefused | null>(null);
		const login = Effect.gen(function* () {
			const n = yield* Ref.updateAndGet(count, (c) => c + 1);
			const refused = yield* Ref.get(answer);
			if (refused !== null) return yield* Effect.fail(refused);
			return sessionAt(n, yield* Clock.currentTimeMillis, length);
		});
		return {login, count: Ref.get(count), answer: (a: DoorRefused | null) => Ref.set(answer, a)};
	});

/** A token in the clear, to compare: these are the fake's own. */
const plain = <E>(token: Effect.Effect<Redacted.Redacted<string>, E>) =>
	Effect.map(token, Redacted.value);

const run = <A, E>(e: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(e.pipe(Effect.scoped, Effect.provide(TestClock.layer())));

describe("a session that renews", () => {
	it("logs in again 5 minutes before its end, and keeps doing so", async () => {
		const seen = await run(
			Effect.gen(function* () {
				const fake = yield* fakeLogin(4 * HOUR);
				const s = yield* renewing(sessionAt(0, 0, 4 * HOUR), fake.login);
				yield* TestClock.adjust(4 * HOUR - 5 * MINUTE - 1);
				const before = [yield* fake.count, yield* plain(s.current)];
				yield* TestClock.adjust(1);
				const after = [yield* fake.count, yield* plain(s.current)];
				// Past where the first session would have ended, and past the second's renewal too.
				yield* TestClock.adjust(4 * HOUR);
				const later = [yield* fake.count, yield* plain(s.current)];
				return {before, after, later};
			}),
		);
		expect(seen).toEqual({before: [0, "t0"], after: [1, "t1"], later: [2, "t2"]});
	});

	it("on a 401, logs in once for every caller holding the same ended token", async () => {
		const seen = await run(
			Effect.gen(function* () {
				const fake = yield* fakeLogin(4 * HOUR);
				const s = yield* renewing(sessionAt(0, 0, 4 * HOUR), fake.login);
				const stale = yield* s.current;
				const both = yield* Effect.all([s.renew(stale), s.renew(stale)], {concurrency: 2});
				// A caller that comes late with the old token gets the new one, with no login.
				const late = yield* s.renew(stale);
				return {logins: yield* fake.count, tokens: [...both, late].map(Redacted.value)};
			}),
		);
		expect(seen).toEqual({logins: 1, tokens: ["t1", "t1", "t1"]});
	});

	it("a refused login is kept: every call fails with it, and nothing logs in again", async () => {
		const seen = await run(
			Effect.gen(function* () {
				const fake = yield* fakeLogin(4 * HOUR);
				const s = yield* renewing(sessionAt(0, 0, 4 * HOUR), fake.login);
				const removed = new DoorRefused({status: 401, why: "no such member"});
				yield* fake.answer(removed);
				const stale = yield* s.current;
				const first = yield* Effect.flip(s.renew(stale));
				const again = yield* Effect.flip(s.renew(stale));
				const current = yield* Effect.flip(s.current);
				// The timer stops too: a day later, still the one login.
				yield* TestClock.adjust(24 * HOUR);
				return {first, again, current, logins: yield* fake.count};
			}),
		);
		expect(seen.first).toMatchObject({_tag: "DoorRefused", status: 401});
		expect(seen.again).toBe(seen.first);
		expect(seen.current).toBe(seen.first);
		expect(seen.logins).toBe(1);
	});

	it("a login the network ate keeps the old token, and the next 401 tries again", async () => {
		const seen = await run(
			Effect.gen(function* () {
				const fake = yield* fakeLogin(4 * HOUR);
				const s = yield* renewing(sessionAt(0, 0, 4 * HOUR), fake.login);
				const stale = yield* s.current;
				yield* fake.answer(new DoorRefused({status: 0, why: "connect ECONNREFUSED"}));
				const lost = yield* Effect.flip(s.renew(stale));
				const kept = yield* plain(s.current);
				yield* fake.answer(null);
				const healed = yield* plain(s.renew(stale));
				return {lost: lost.status, kept, healed, logins: yield* fake.count};
			}),
		);
		expect(seen).toEqual({lost: 0, kept: "t0", healed: "t2", logins: 2});
	});

	it("a session shorter than its margin is renewed at most once a minute", async () => {
		const seen = await run(
			Effect.gen(function* () {
				// Ten seconds long: as when the laptop's clock runs far ahead of the server's.
				const fake = yield* fakeLogin(10_000);
				yield* renewing(sessionAt(0, 0, 10_000), fake.login);
				yield* TestClock.adjust(10 * MINUTE);
				return yield* fake.count;
			}),
		);
		expect(seen).toBe(10);
	});

	it("stops renewing when its scope closes", async () => {
		const seen = await run(
			Effect.gen(function* () {
				const fake = yield* fakeLogin(4 * HOUR);
				const closed = yield* Deferred.make<void>();
				const holder = yield* Effect.gen(function* () {
					yield* renewing(sessionAt(0, 0, 4 * HOUR), fake.login);
					yield* Deferred.await(closed);
				}).pipe(Effect.scoped, Effect.forkScoped);
				yield* TestClock.adjust(1);
				yield* Deferred.succeed(closed, undefined);
				expect(Exit.isSuccess(yield* Fiber.await(holder))).toBe(true);
				yield* TestClock.adjust(24 * HOUR);
				return yield* fake.count;
			}),
		);
		expect(seen).toBe(0);
	});
});

// Self-fix PR 11b, round 2 (the review's first must-fix). Every answer that is not a 2xx reaches the
// caller as `LedgerUnreachable`, and the pipeline's one wait (packages/pipeline/src/wait.ts) must tell
// slowness from a refusal. So the error keeps the answer's `status`: the HTTP status, or the door's
// own when it refused a new session after a 401. A call with no answer at all has none. The ledger
// here is a plain Node server that answers every call with one status.

/** A Node server on a free port that answers every call `answer()` says: a status, or nothing at all. */
const answering = (answer: () => number | null) =>
	Effect.acquireRelease(
		Effect.callback<ReturnType<typeof createServer>>((resume) => {
			const server = createServer((req, res) => {
				req.resume();
				const status = answer();
				if (status === null) return;
				res.writeHead(status, {"content-type": "text/plain"});
				res.end(status < 300 ? "[]" : `refused with ${status}`);
			});
			server.listen(0, "127.0.0.1", () => resume(Effect.succeed(server)));
		}),
		(server) =>
			Effect.sync(() => {
				server.closeAllConnections();
				server.close();
			}),
	).pipe(Effect.map((server) => `http://127.0.0.1:${(server.address() as AddressInfo).port}`));

/** The error one `readStream` over HTTP fails with, on a server that answers as `answer` says. */
const refusedWith = (
	answer: () => number | null,
	token: Redacted.Redacted<string> | Renewing = Redacted.make("fabrika_a_test"),
) =>
	Effect.gen(function* () {
		const url = yield* answering(answer);
		return yield* Ledger.use((l) => l.readStream("t/inbox")).pipe(
			Effect.flip,
			Effect.provide(layerHttp({url, ledger: "x", token, timeout: Duration.millis(200)})),
		);
	}).pipe(Effect.scoped, Effect.runPromise);

describe("a call the ledger over HTTP does not answer with a 2xx", () => {
	it("keeps the answer's status on `LedgerUnreachable`: 400, 401, 403, 404, 408, 429, 500 and 503 each", async () => {
		for (const status of [400, 401, 403, 404, 408, 429, 500, 503]) {
			const e = await refusedWith(() => status);
			expect(e, String(status)).toMatchObject({_tag: "LedgerUnreachable", status});
			expect(e.message, String(status)).toContain(`refused with ${status}`);
		}
	});

	it("a 401 whose renew the door refused keeps the door's status, not the 401", async () => {
		const removed: Renewing = {
			current: Effect.succeed(Redacted.make("t1")),
			renew: () => Effect.fail(new DoorRefused({status: 403, why: "not a member any more"})),
		};
		const e = await refusedWith(() => 401, removed);
		expect(e).toMatchObject({_tag: "LedgerUnreachable", status: 403});
		expect(e.message).toContain("not a member any more");
	});

	it("a call with no answer in its time has no status: slowness, not a refusal", async () => {
		const e = await refusedWith(() => null);
		expect(e._tag).toBe("LedgerUnreachable");
		expect(e).not.toHaveProperty("status");
	});
});
