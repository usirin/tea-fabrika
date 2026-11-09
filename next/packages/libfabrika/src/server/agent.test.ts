// P25 E, next/. Every actual law loads the relocated real Door through its test Layer.
import {expect, it} from "@effect/vitest";
import {Effect, Layer, Schema} from "effect";
import {Grant} from "../coordination/members.ts";
import {ProcessManager} from "../coordination/process-manager.ts";
import {first, from, manager, storage, brain} from "../coordination/process.test-support.ts";
import {Start} from "../coordination/process.ts";
import {grantText, revokeText} from "../coordination/text.ts";
import * as Id from "../id.ts";
import {
	fixtureLayer,
	notesFixture,
	clientFixture,
	storeFixture,
	text,
	type DriveModule,
} from "../mcp/mcp.test-support.ts";
import {Save, Small, options} from "../mcp/mcp.test-support.ts";

const fixture = Effect.promise(() => import("./agent.test-support.ts")).pipe(
	Effect.flatMap((m) => m.agentDoorFixture()),
);
const denied = (value: unknown) =>
	expect(value).toMatchObject({_tag: "refused", why: "not_for_agents"});
const authors = (
	rows: ReadonlyArray<{readonly by: string; readonly for: string}>,
	by: string,
	person: string,
) => {
	expect(rows).toHaveLength(1);
	expect(rows[0]).toMatchObject({by, for: person});
};
const psLaw = (
	rows: unknown,
	want: unknown,
	before: ReadonlyArray<unknown>,
	after: ReadonlyArray<unknown>,
) => {
	expect(rows, "P33 owns the process list").toEqual(want);
	expect(after, "ps controls nothing").toEqual(before);
};
it.effect.prop(
	"L17 accepted letters preserve the checked agent and person despite caller claims",
	{save: Save, spoof: Schema.String},
	({save, spoof}) =>
		Effect.gen(function* () {
			const w = yield* fixture;
			const result = yield* w.call("process.send", {
				pid: w.target,
				letter: "letter_0000000000e008000000000000",
				m: {type: "save", value: save},
				sentAt: "2026-11-08T00:00:00Z",
				seen: 0,
				label: spoof,
				as: "person",
			});
			expect(result).toMatchObject({_tag: "ok"});
			authors(yield* w.entries, w.writer, w.person);
			// Reserved identity fields cannot override the checked writer.
			denied(
				yield* w.call("process.send", {
					pid: w.other,
					program: "notes",
					by: spoof,
					for: spoof,
					m: {type: "save", value: save},
				}),
			);
		}),
	options,
);
it.effect.prop(
	"L18 real door refuses unknown methods before ordinary dispatch",
	{method: Schema.String},
	({method}) =>
		Effect.gen(function* () {
			const w = yield* fixture;
			denied(yield* w.call(`future.${method}`, {}));
			expect(yield* w.call("process.info", {})).toMatchObject({_tag: "ok"});
		}),
	options,
);
it.effect.prop(
	"L19 real trusted program beats spoofed notes names and person-only writes",
	{save: Save, label: Schema.String},
	({save, label}) =>
		Effect.gen(function* () {
			const w = yield* fixture;
			denied(
				yield* w.call("process.send", {
					pid: w.other,
					program: "notes",
					target: `notes:${label}`,
					m: {type: "save", value: save},
				}),
			);
			denied(yield* w.call("process.send", {pid: w.target, m: {type: "approve", answer: label}}));
			expect(yield* w.entries).toEqual([]);
			expect(
				yield* w.call("process.send", {
					pid: w.target,
					letter: "letter_0000000000e008000000000001",
					m: {type: "save", value: save},
					sentAt: "2026-11-08T00:00:00Z",
					seen: 0,
				}),
			).toMatchObject({_tag: "ok"});
		}),
	options,
);
it.effect.prop(
	"L20 ps is the current real P33 list and adds no control fact",
	{
		ops: Schema.Array(Schema.Literals(["start", "exit", "restart", "read"])).check(
			Schema.isMaxLength(40),
		),
	},
	({ops}) => {
		const store = storage();
		return Effect.gen(function* () {
			const {processInfo} = yield* Effect.promise(() => import("./process-info.ts"));
			const p = yield* ProcessManager;
			let current: string | null = null;
			let n = 0;
			let name = "";
			const f = yield* clientFixture(),
				calls = yield* storeFixture();
			const driveApi: DriveModule = yield* Effect.promise(() => import("../mcp/drive.ts"));
			for (const op of ["start", ...ops, "read"]) {
				if (op === "start" && current === null) {
					name = `notes:${n}`;
					current = (yield* p.start(first(`start-${n++}`, name), from())).process;
				} else if (op === "exit" && current !== null) {
					yield* p.exit(current, "normal", from());
					current = null;
				} else if (op === "restart" && current !== null) {
					yield* p.exit(current, "crashed", from());
					current = (yield* p.start(
						Start.cases.again.make({
							id: `restart-${n++}`,
							name,
							after: current,
							why: "crashed",
							code: {program: "counter", hash: "build-a"},
						}),
						from(),
					)).process;
				}
				const before = store.rows();
				const want = yield* p.info;
				psLaw(yield* processInfo({}), want, before, store.rows());
				const drive = yield* driveApi
					.driveFor([notesFixture()], {...f.client, ps: Effect.succeed(want)})
					.pipe(Effect.provide(calls.layer));
				psLaw(JSON.parse(text(yield* drive.call("ps", {}))), want, before, store.rows());
			}
		}).pipe(
			Effect.provide(
				Layer.unwrap(
					Effect.map(Id.Generator, (g) => manager(store, brain(), g.next(Id.Process))),
				).pipe(Layer.provide(Id.Generator.layer)),
			),
			Effect.provide(fixtureLayer),
		);
	},
	options,
);
it.effect.prop(
	"L21 signed role wins over hello, knock and tampered signed fields",
	{grant: Grant, claim: Schema.String},
	({grant, claim}) =>
		Effect.gen(function* () {
			const w = yield* fixture;
			// Fixture signs an agent grant, then initializes claiming window. The fixed P8 law
			// checks that same route too. A new knock claim cannot change its role.
			denied(yield* w.call("window.open", {as: claim, role: "person"}));
			const checked = {
				...grant,
				id: "tamper",
				key: w.agent,
				for: w.person,
				to: "exam-project",
				as: "agent" as const,
			};
			expect(
				yield* w.change(grantText({...checked, as: "window"}), "person", grantText(checked)),
			).toMatchObject({_tag: "refused"});
		}),
	options,
);
it.effect.prop(
	"L22 agent signatures cannot grant, approve or revoke, person control can",
	{grant: Grant, n: Small},
	({grant, n}) =>
		Effect.gen(function* () {
			const w = yield* fixture;
			const text = grantText({
				...grant,
				id: `grant-${n}`,
				key: w.agent,
				for: w.person,
				to: "exam-project",
				as: "agent",
			});
			const remove = revokeText({
				id: `remove-${n}`,
				key: w.agent,
				for: w.person,
				to: "exam-project",
				sentAt: grant.sentAt,
				saw: {label: "test", where: "test", how: "panel", check: "touch"},
			});
			for (const t of [text, remove])
				expect(yield* w.change(t, "agent")).toMatchObject({_tag: "refused"});
			denied(yield* w.call("door.approve", {key: w.agent}));
			expect(yield* w.change(text, "person")).toMatchObject({_tag: "applied"});
		}),
	options,
);
it("plant L17: owner substituted as writer", () =>
	expect(() => authors([{by: "owner", for: "person"}], "agent", "person")).toThrow());
it("plant L18/L19: dispatch or spoofed prefix accepts the forbidden request", () =>
	expect(() => denied({_tag: "ok", result: null})).toThrow());
it("plant L20: bridge-owned list starts a process", () => {
	expect(() => psLaw([], [{process: "live"}], [], [])).toThrow();
	expect(() => psLaw([], [], [], ["start"])).toThrow();
});
it("plant L21/L22: claimed role or agent signature authorizes membership", () =>
	expect(() => expect({_tag: "applied"}).toMatchObject({_tag: "refused"})).toThrow());
