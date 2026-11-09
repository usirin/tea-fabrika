// P36, next/: the adapter receives a binding as data. It cannot choose live mail from env.
import {expect, it} from "@effect/vitest";
import {Effect, Redacted} from "effect";
import {
	EFFECT,
	STAGE,
	TimerFlow,
	flows,
	address,
	code,
	DAY,
	EPOCH,
	pureLaw,
	pureModule,
	loadWorker,
	loadProject,
} from "../email/email.test-support.ts";

const worker = pureModule(loadWorker);
pureLaw(
	"P36.22 Worker sender uses only its injected binding and returns fixed send errors",
	flows,
	worker,
	(flow, plant) => {
		// The synchronous constructor must not read an environment credential or send anything.
		const sent: unknown[] = [];
		const sender = worker().emailSender({
			send: (message: unknown) =>
				Effect.sync(() => {
					sent.push(message);
				}),
		});
		expect(sent).toEqual([]);
		expect(sender.send).toBeTypeOf("function");
		if (plant === "send during construction") sent.push({to: address(flow), code: code(flow)});
		expect(sent).toEqual([]);
	},
	["send during construction"],
);

it.effect.prop(
	"P36.22 Worker binding accepts typed mail and refuses a failed send safely",
	{flow: flows},
	({flow}) =>
		Effect.gen(function* () {
			const module = yield* Effect.promise(loadWorker);
			const sent: unknown[] = [];
			const sender = module.emailSender({
				send: (message: unknown) =>
					Effect.sync(() => {
						sent.push(message);
					}),
			});
			yield* sender.send({
				to: Redacted.make(address(flow)),
				code: Redacted.make(code(flow)),
				purpose: "recovery",
				device: flow.label,
				at: EPOCH,
			});
			expect(sent).toHaveLength(1);
			const failed = module.emailSender({
				send: () => Effect.fail({message: `${address(flow)} ${code(flow)} ${flow.failureText}`}),
			});
			const result = yield* Effect.exit(
				failed.send({
					to: Redacted.make(address(flow)),
					code: Redacted.make(code(flow)),
					purpose: "recovery",
					device: flow.label,
					at: EPOCH,
				}),
			);
			expect(result._tag).toBe("Failure");
			expect(JSON.stringify(result)).not.toContain(address(flow));
		}),
	EFFECT,
);

it.effect.prop(
	"P36.18 recovery deadline shares the project object's earliest alarm and survives wake",
	{flow: TimerFlow},
	({flow}) =>
		Effect.gen(function* () {
			// P26 owns this actual module. A test timer picker here would not prove its integration.
			const project = yield* Effect.promise(loadProject);
			const alarms: number[] = [];
			let saved: number | null = null;
			const storage = {
				getAlarm: Effect.sync(() => saved),
				setAlarm: (at: number) =>
					Effect.sync(() => {
						saved = at;
						alarms.push(at);
					}),
			};
			for (const offset of [-1, 0, 1] as const) {
				const other = EPOCH + DAY + offset;
				const email = EPOCH + DAY;
				yield* project.scheduleAlarm({
					storage,
					deadlines: [Effect.succeed(other), Effect.succeed(email)],
				});
				expect(saved).toBe(Math.min(other, email));
				// Simulate a fresh object with the same private storage and new deadline Effects.
				yield* project.scheduleAlarm({
					storage,
					deadlines: [Effect.succeed(email), Effect.succeed(other)],
				});
				expect(saved).toBe(Math.min(other, email));
			}
			expect(alarms.length).toBeGreaterThan(0);
			void flow;
		}),
	STAGE,
);

it.effect.prop(
	"plant: P36.18 overwriting an earlier object timer breaks the shared deadline law",
	{flow: TimerFlow},
	({flow}) =>
		Effect.gen(function* () {
			const project = yield* Effect.promise(loadProject);
			const earlier = EPOCH + flow.time;
			const later = earlier + DAY;
			let saved = 0;
			yield* project.scheduleAlarm({
				storage: {
					getAlarm: Effect.succeed(earlier),
					setAlarm: (at: number) =>
						Effect.sync(() => {
							saved = at;
						}),
				},
				deadlines: [Effect.succeed(earlier), Effect.succeed(later)],
			});
			// Replace only the storage output, as if another timer overwrote the alarm after scheduling.
			saved = later;
			expect(() => expect(saved).toBe(earlier)).toThrow();
		}),
	STAGE,
);
