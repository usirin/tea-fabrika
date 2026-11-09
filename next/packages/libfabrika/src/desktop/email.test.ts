// P36, next/: the real tea child starts at init. Its parent is P28, which is not on main yet.
import {expect, it} from "@effect/vitest";
import {Effect} from "effect";
import {
	DAY,
	EPOCH,
	EFFECT,
	PURE,
	RecoveryFlow,
	added,
	binding,
	canceled,
	input,
	pureLaw,
	pureModule,
	loadParent,
	parentAnswers,
	type Flow,
} from "../email/email.test-support.ts";

// No input text is put in the saved tea model. Only a secret-holder reference crosses messages.
const email = pureModule(() => import("./email.ts"));
pureLaw(
	"P36.10 email child waits, displays the due time, and cancel asks for no finger",
	RecoveryFlow,
	email,
	(flow, plant) => {
		const machine = email().Email;
		let [model] = machine.init({cloud: true, binding: binding()});
		const messages = [
			{type: "recover"},
			{type: "issued", challenge: {id: input(1), until: EPOCH + 600000}},
			{type: "requested", pending: {id: input(200), until: EPOCH + DAY, add: added(flow)}},
		];
		for (const msg of messages) [model] = machine.update(model, msg);
		expect(model.view).toEqual({_tag: "waiting", request: input(200), until: EPOCH + DAY});
		for (const offset of [-1, 0, 1] as const) {
			[model] = machine.update(model, {type: "tick", at: EPOCH + DAY + offset});
			expect(model.view._tag).toBe("waiting"); // Only a brain answer grants admission.
		}
		const [next, commands] = machine.update(model, {type: "cancel", fact: canceled(input(200))});
		const kinds =
			plant === "finger on cancel"
				? ["person_check"]
				: commands.map((cmd: {readonly type: string}) => cmd.type);
		expect(kinds).not.toContain("person_check");
		expect(kinds).toContain("email_cancel");
		expect(next.view._tag).toBe("waiting");
		const [done] = machine.update(next, {type: "canceled", request: input(200)});
		expect(done.view._tag).toBe("canceled");
	},
	["finger on cancel"],
);

pureLaw(
	"P36.10 local setup keeps the sheet path and offers no email action",
	RecoveryFlow,
	email,
	(flow, plant) => {
		const machine = email().Email;
		const [start] = machine.init({cloud: plant === "offer email locally", binding: binding()});
		const [next, commands] = machine.update(start, {type: "recover", label: flow.label});
		expect(next.view._tag).toBe("off");
		expect(commands).toEqual([]);
	},
	["offer email locally"],
);

it.effect.prop(
	"P36.26 P28 parent steps email and performs its old-device question before PersonCheck",
	{flow: RecoveryFlow},
	({flow}) =>
		Effect.gen(function* () {
			// Deliberately import the real upstream parent. Stand-in answers do not prove this wiring.
			const parent = yield* Effect.promise(loadParent);
			const {calls, services} = parentAnswers(flow);
			const [model] = parent.Recovery.init({cloud: true});
			const [next, commands] = parent.Recovery.update(model, {
				type: "email",
				msg: {type: "code", secret: "secret-holder-ref"},
			});
			for (const command of commands) yield* parent.recoveryHandlers(services)(command);
			expect(calls).toEqual(["old", "check"]);
			expect(next.email).toBeDefined();
		}),
	EFFECT,
);

// Schema-driven order generation exercises every child message from its actual init.
it.prop(
	"P36.10 unrelated generated messages never make a waiting request done",
	{flow: RecoveryFlow},
	({flow}: {flow: Flow}) => {
		const machine = email().Email;
		let [model] = machine.init({cloud: true, binding: binding()});
		[model] = machine.update(model, {
			type: "requested",
			pending: {id: input(200), until: EPOCH + DAY, add: added(flow)},
		});
		for (const operation of flow.ops) {
			[model] = machine.update(model, {type: "tick", at: EPOCH + flow.time, operation});
			expect(model.view._tag).toBe("waiting");
		}
		const [done] = machine.update(model, {type: "completed", request: input(200)});
		expect(done.view._tag).toBe("done");
		// Plant: injecting a completion as a timer answer must violate the waiting assertion.
		expect(done.view._tag).not.toBe("waiting");
	},
	PURE,
);
