// P36, next/: real service, test clock, private store and controlled failures.
import {expect} from "@effect/vitest";
import {Deferred, Effect, Fiber, Redacted} from "effect";
import {TestClock} from "effect/testing";
import {
	DAY,
	EPOCH,
	address,
	added,
	binding,
	canceled,
	effectLaw,
	expectRefused,
	pending,
	setup,
	signed,
	tags,
	verified,
	wrong,
	type Edge,
} from "./email.test-support.ts";

effectLaw(
	"P36.05 setup requires a right code and live person signature",
	(h, plant) =>
		Effect.gen(function* () {
			for (const role of ["window", "agent", "recovery", "email", "unknown"] as const) {
				for (let n = 0; n < Math.max(1, h.flow.roles[role === "unknown" ? "person" : role]); n++) {
					const challenge = yield* h.recovery.issueSetup(binding(), Redacted.make(address(h.flow)));
					const value = Redacted.value(h.mails.at(-1)!.code);
					const signer = plant === "window or agent as person" ? "person-0" : `${role}-${n}`;
					yield* expectRefused(
						h.recovery.verifySetup(challenge.id, Redacted.make(value), verified(h, signer)),
					);
				}
			}
			const challenge = yield* h.recovery.issueSetup(binding(), Redacted.make(address(h.flow)));
			const value = Redacted.value(h.mails.at(-1)!.code);
			yield* expectRefused(
				h.recovery.verifySetup(
					challenge.id,
					Redacted.make(plant === "skip code" ? value : wrong(value)),
					verified(h),
				),
			);
			expect(tags(h, "verified")).toEqual([]);
			yield* setup(h);
			expect(tags(h, "verified")).toHaveLength(1);
		}),
	["window or agent as person", "skip code"],
);

effectLaw(
	"P36.09 service alarm uses referee time and can finish when due",
	(h, plant) =>
		Effect.gen(function* () {
			yield* setup(h);
			const {request} = yield* pending(h);
			expect(yield* h.recovery.nextDeadline).toBe(EPOCH + DAY);
			yield* TestClock.setTime(request.until - 1 + (plant === "short wait" ? 1 : 0));
			yield* h.recovery.alarm;
			expect(tags(h, "added")).toEqual([]);
			yield* TestClock.setTime(request.until);
			if (plant !== "never complete") yield* h.recovery.alarm;
			expect(tags(h, "added")).toHaveLength(1);
		}),
	["short wait", "never complete"],
);

effectLaw(
	"P36.10 any live person device cancels without PersonCheck",
	(h, plant) =>
		Effect.gen(function* () {
			yield* setup(h);
			for (let n = 0; n < h.flow.live; n++) {
				const {request} = yield* pending(h, n % h.flow.devices);
				const before = h.checks;
				if (plant === "require a finger") yield* h.dependencies.personCheck;
				const answer =
					plant === "only founder" && n > 0
						? {_tag: "refused"}
						: yield* h.recovery.cancel(canceled(request.id, `person-${n}`));
				expect(answer._tag).toBe("applied");
				expect(h.checks).toBe(before);
				yield* TestClock.setTime(request.until);
				yield* h.recovery.alarm;
				expect(tags(h, "added")).toEqual([]);
			}
		}),
	["require a finger", "only founder"],
);

effectLaw(
	"P36.12 cancel and completion have one durable order",
	(h, plant) =>
		Effect.gen(function* () {
			yield* setup(h);
			const {request} = yield* pending(h);
			yield* TestClock.setTime(request.until);
			h.pause();
			const alarm = yield* Effect.forkChild(h.recovery.alarm);
			yield* Deferred.await(h.signEntered);
			const answer = yield* h.recovery.cancel(canceled(request.id));
			expect(answer._tag).toBe("applied");
			if (plant === "check cancel only before signing")
				h.rows.splice(
					h.rows.findIndex(
						(row) =>
							typeof row.fact === "object" &&
							row.fact !== null &&
							"_tag" in row.fact &&
							row.fact._tag === "canceled",
					),
					1,
				);
			yield* Deferred.succeed(h.signRelease, undefined);
			yield* Fiber.join(alarm);
			expect(tags(h, "added")).toEqual([]);
			yield* h.reopen;
			yield* h.recovery.alarm;
			expect(tags(h, "added")).toEqual([]);
		}),
	["check cancel only before signing"],
);

effectLaw(
	"P36.12 cancellation after completion returns the first completion",
	(h, plant) =>
		Effect.gen(function* () {
			yield* setup(h);
			const {request} = yield* pending(h);
			yield* TestClock.setTime(request.until);
			const completed = yield* h.recovery.alarm;
			expect(completed).toHaveLength(1);
			const answer = yield* h.recovery.cancel(canceled(request.id));
			expect(answer).toEqual(completed[0]);
			const canceledRows = tags(h, "canceled");
			expect(
				plant === "append cancel after completion"
					? [...canceledRows, canceled(request.id)]
					: canceledRows,
			).toEqual([]);
			expect(tags(h, "added")).toHaveLength(1);
		}),
	["append cancel after completion"],
);

effectLaw(
	"P36.10 windows, agents, recovery, email and unknown keys cannot cancel",
	(h, plant) =>
		Effect.gen(function* () {
			yield* setup(h);
			const {request} = yield* pending(h);
			const checks = h.checks;
			for (const role of ["window", "agent", "recovery", "email", "unknown"]) {
				yield* expectRefused(
					h.recovery.cancel(
						canceled(request.id, plant === "let any key cancel" ? "person-0" : `${role}-0`),
					),
				);
			}
			expect(h.checks).toBe(checks);
			expect(tags(h, "canceled")).toEqual([]);
		}),
	["let any key cancel"],
);

effectLaw(
	"P36.13 consumed code survives a failed append through a durable receipt",
	(h, plant) =>
		Effect.gen(function* () {
			yield* setup(h);
			const challenge = yield* h.recovery.issueRecovery(binding());
			const value = Redacted.value(h.mails.at(-1)!.code);
			h.fixture.fail("append", "append failed once");
			const first = yield* Effect.exit(
				h.recovery.request(
					challenge.id,
					Redacted.make(value),
					added(h.flow),
					signed(binding().person),
				),
			);
			expect(first._tag).toBe("Failure");
			yield* h.reopen;
			const receipt = yield* h.recovery.request(
				challenge.id,
				Redacted.make(value),
				added(h.flow),
				signed(binding().person),
			);
			expect(receipt.add.id).toBe(added(h.flow).id);
			expect(tags(h, "requested")).toHaveLength(1);
			if (plant === "strand consumed code") yield* expectRefused(Effect.succeed(receipt));
			yield* TestClock.setTime(receipt.until);
			yield* h.recovery.alarm;
			expect(tags(h, "added")).toHaveLength(1);
		}),
	["strand consumed code"],
);

effectLaw(
	"P36.22 failed send, storage or crypto never becomes a successful fact",
	(h, plant) =>
		Effect.gen(function* () {
			const cases: ReadonlyArray<Edge> = [
				"send",
				"store.read",
				"store.write",
				"store.commit",
				"hash",
			];
			for (const edge of cases) {
				h.fixture.fail(edge, `${h.flow.failureText}${address(h.flow)}`.slice(0, 160));
				const result = yield* Effect.exit(
					h.recovery.issueSetup(binding(), Redacted.make(address(h.flow))),
				);
				expect(plant === "catch as success" ? "Success" : result._tag).toBe("Failure");
				expect(tags(h, "verified")).toEqual([]);
				expect(tags(h, "requested")).toEqual([]);
				expect(tags(h, "added")).toEqual([]);
			}
			yield* setup(h);
			const {request} = yield* pending(h);
			yield* TestClock.setTime(request.until);
			h.fixture.fail("sign", h.flow.failureText);
			yield* expectRefused(h.recovery.alarm);
			expect(tags(h, "added")).toEqual([]);
			// A transient failure is recoverable, not a permanent success or a permanently lost request.
			yield* h.reopen;
			yield* h.recovery.alarm;
			expect(tags(h, "added")).toHaveLength(1);
		}),
	["catch as success"],
);
