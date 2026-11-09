// P24, next/. Every reducer below is imported from product code. P21 stand-ins are types only.
import {applyCell} from "@demlik/tea";
import type {Cmd as TeaCmd} from "@demlik/tea";
import {arbGuidedSequence, arbMsg, arbMsgSequence, propertyInvariant} from "@demlik/tea/pbt";
import {describe, expect, it} from "@effect/vitest";
import {Effect, Schema} from "effect";
import * as fc from "fast-check";
import {runs, SEED, LedgerName} from "../build/p24.test-support.ts";
import {Grant, Revoke, Signed} from "../coordination/members.ts";
import {grantText, revokeText} from "../coordination/text.ts";
import {syncTest} from "../testing.ts";
import {
	checkPerson,
	ChangeReply,
	MenuClient,
	MenuContext,
	MenuIntent,
	MenuModel,
	MenuPass,
	MenuRow,
	messageTable,
	PersonChecked,
	postChange,
	refreshMenu,
	signChange,
	twoMenus,
	type Item,
	type Links,
	type MenuMsg,
	type MenuStageCmd,
	type MenuStageMsg,
	type Model,
	type ParentMachine,
	type Stage,
} from "./p24.test-support.ts";

const input = "input_01jc9q4w7zef0b5r2t6v0xkb4d";
const grant = "grant_01jc9q4w7zef0b5r2t6v0xkb4d";
const input2 = "input_01jc9q4w7zef0b5r2t6v0xkb4e";
const revoke = "revoke_01jc9q4w7zef0b5r2t6v0xkb4e";
const ctx: Links = {
	links: [
		{
			stage: "local",
			url: "http://127.0.0.1:3310",
			context: {person: "person-test", ledger: "local-ledger", own: "own-local", browser: true},
		},
		{
			stage: "cloud",
			url: "https://cloud.invalid",
			context: {person: "person-test", ledger: "cloud-ledger", own: "own-cloud", browser: true},
		},
	],
};
const wrap = (stage: Stage, msg: MenuMsg): Extract<MenuStageMsg, {type: "stage"}> => ({
	type: "stage",
	stage,
	msg,
});
const row = (value: typeof MenuRow.Type) => ({...value, until: 1000000});
const stageModel = (model: Model, stage: Stage) => {
	const found = model.stages.find((s) => s.stage === stage);
	expect(found, `missing ${stage} child`).toBeDefined();
	return found!.model;
};
const isolated = (prev: Model, next: Model, msg: MenuStageMsg, cmds: readonly MenuStageCmd[]) => {
	if (msg.type === "quit") {
		expect(cmds).toEqual([{type: "menu_quit"}]);
		return;
	}
	const other = msg.stage === "local" ? "cloud" : "local";
	expect(stageModel(next, other)).toEqual(stageModel(prev, other));
	for (const cmd of cmds) {
		expect(cmd.type).toBe("menu_stage");
		expect(cmd).toHaveProperty("stage", msg.stage);
	}
};
const qualified = (items: readonly Item[]) => {
	expect(items.filter((i) => i.id === "quit")).toHaveLength(1);
	for (const item of items.filter((i) => i.id !== "quit")) {
		expect(["local", "cloud"]).toContain(item.stage);
		expect(item.words).toContain(item.stage === "local" ? "Local" : "Cloud");
	}
};
const trace = (machine: ParentMachine, messages: readonly MenuStageMsg[]) => {
	let [model] = machine.init(null, ctx);
	const cmds: MenuStageCmd[] = [];
	for (const msg of messages) {
		const [next, emitted] = applyCell<Model, MenuStageMsg, MenuStageCmd & TeaCmd>(
			machine,
			model,
			msg,
		);
		isolated(model, next, msg, emitted);
		model = next;
		cmds.push(...emitted);
	}
	return {model, cmds};
};
const setup = (value: typeof MenuRow.Type): readonly Extract<MenuStageMsg, {type: "stage"}>[] =>
	ctx.links.flatMap((link) => [
		wrap(link.stage, {type: "connected", context: link.context}),
		wrap(link.stage, {type: "rows", rows: [row(value)], at: 0}),
	]);
const command = (cmds: readonly MenuStageCmd[], stage: Stage, type: string) => {
	const found = cmds.find(
		(c) => c.type === "menu_stage" && c.stage === stage && c.cmd.type === type,
	);
	expect(found, `${stage} ${type} was never emitted`).toBeDefined();
	if (found?.type !== "menu_stage") throw new Error("expected stage command");
	return found.cmd;
};

describe("P24 two ledgers", () => {
	it.effect.prop(
		"menu actions and Cmds keep their stage and step the real child",
		{row: MenuRow, client: MenuClient},
		(value) =>
			Effect.gen(function* () {
				const {menuStagesMachine}: {menuStagesMachine: ParentMachine} = yield* Effect.promise(
					() => import("./menu-stages.ts"),
				);
				const {menuMachine} = yield* Effect.promise(() => import("./menu.ts"));
				const messages: MenuStageMsg[] = [
					...setup(value.row),
					...ctx.links.flatMap(({stage}) => [
						wrap(stage, {type: "clients", clients: [value.client]}),
						wrap(stage, {type: "approve", input, id: grant, key: value.row.key}),
						wrap(stage, {type: "deny", input: input2, key: value.row.key}),
						wrap(stage, {type: "refresh"}),
					]),
				];
				propertyInvariant(
					menuStagesMachine,
					ctx,
					arbMsgSequence(fc.constantFrom(...messages), {maxLength: 60, size: "max"}),
					({prev, next, msg, cmds}) => {
						expect.hasAssertions();
						isolated(prev, next, msg, cmds);
						if (msg.type === "stage") {
							const [expected] = applyCell(menuMachine, stageModel(prev, msg.stage), msg.msg);
							expect(stageModel(next, msg.stage)).toEqual(expected);
						}
						return true;
					},
					{seed: SEED, numRuns: 100},
				);
			}),
		runs,
	);
	it.effect.prop(
		"pending checks cannot cross ledgers, including same-key and delayed replies",
		{row: MenuRow, check: PersonChecked},
		({row: value, check}) =>
			Effect.gen(function* () {
				const {menuStagesMachine}: {menuStagesMachine: ParentMachine} = yield* Effect.promise(
					() => import("./menu-stages.ts"),
				);
				const approve = wrap("cloud", {type: "approve", input, id: grant, key: value.key});
				const initial = trace(menuStagesMachine, [...setup(value), approve]);
				const cmd = command(initial.cmds, "cloud", "menu_check");
				if (cmd.type !== "menu_check") return yield* Effect.die("wrong check Cmd");
				const reply = checkPerson.ok(cmd, check, 1);
				const lists = fc
					.shuffledSubarray(
						[
							wrap("local", reply),
							wrap("local", {type: "refresh"}),
							approve,
							wrap("local", {type: "rows", rows: [], at: 2}),
						],
						{minLength: 0, maxLength: 4},
					)
					.map((middle) => [
						...setup(value),
						approve,
						...middle,
						wrap("cloud", reply),
						wrap("cloud", reply),
					]);
				propertyInvariant(
					menuStagesMachine,
					ctx,
					lists,
					({prev, next, msg, cmds}) => {
						isolated(prev, next, msg, cmds);
						return true;
					},
					{seed: SEED, numRuns: 100},
				);
				const wrong = trace(menuStagesMachine, [...setup(value), approve, wrap("local", reply)]);
				expect(stageModel(wrong.model, "cloud").pending).toEqual(
					stageModel(initial.model, "cloud").pending,
				);
				expect(
					wrong.cmds.filter((c) => c.type === "menu_stage" && c.cmd.type === "menu_sign"),
				).toEqual([]);
				const right = trace(menuStagesMachine, [
					...setup(value),
					approve,
					wrap("cloud", reply),
					wrap("cloud", reply),
				]);
				expect(
					right.cmds.filter((c) => c.type === "menu_stage" && c.cmd.type === "menu_sign"),
				).toHaveLength(check._tag === "checked" ? 1 : 0);
			}),
		runs,
	);
	it.effect.prop(
		"changed links cancel captured signing and late replies cannot redirect it",
		{row: MenuRow, context: MenuContext},
		({row: value, context}) =>
			Effect.gen(function* () {
				const {menuStagesMachine}: {menuStagesMachine: ParentMachine} = yield* Effect.promise(
					() => import("./menu-stages.ts"),
				);
				const approve = wrap("cloud", {type: "approve", input, id: grant, key: value.key});
				const first = trace(menuStagesMachine, [...setup(value), approve]);
				const cmd = command(first.cmds, "cloud", "menu_check");
				if (cmd.type !== "menu_check") return yield* Effect.die("wrong check Cmd");
				const replacement = {...context, ledger: "replacement-ledger"};
				const late = wrap(
					"cloud",
					checkPerson.ok(cmd, PersonChecked.cases.checked.make({check: "click"}), 2),
				);
				const sequence = [
					...setup(value),
					approve,
					wrap("cloud", {type: "connected", context: replacement}),
					late,
				];
				propertyInvariant(
					menuStagesMachine,
					ctx,
					fc.constant(sequence),
					({prev, next, msg, cmds}) => {
						expect(next.stages).toHaveLength(2);
						isolated(prev, next, msg, cmds);
						if (stageModel(prev, "cloud").context?.ledger === "replacement-ledger")
							expect(
								cmds.filter((c) => c.type === "menu_stage" && c.cmd.type === "menu_sign"),
							).toEqual([]);
						return true;
					},
					{seed: SEED, numRuns: 100},
				);
				const after = trace(menuStagesMachine, sequence);
				expect(stageModel(after.model, "cloud").pending).toEqual([]);
				expect(
					after.cmds.filter((c) => c.type === "menu_stage" && c.cmd.type === "menu_sign"),
				).toEqual([]);
			}),
		runs,
	);
	it.effect.prop(
		"every displayed row says Local or Cloud; same key stays two rows",
		{row: MenuRow},
		({row: value}) =>
			Effect.gen(function* () {
				const {
					menuStagesMachine,
					menuStagesView,
				}: {menuStagesMachine: ParentMachine; menuStagesView: (model: Model) => readonly Item[]} =
					yield* Effect.promise(() => import("./menu-stages.ts"));
				const {model} = trace(menuStagesMachine, setup(value));
				const items = menuStagesView(model);
				qualified(items);
				expect(
					items
						.filter((i) => i._tag === "row" && i.key === value.key)
						.map((i) => i.stage)
						.sort(),
				).toEqual(["cloud", "local"]);
				propertyInvariant(
					menuStagesMachine,
					ctx,
					arbMsgSequence(fc.constantFrom(...setup(value)), {maxLength: 60, size: "max"}),
					({next}) => {
						qualified(menuStagesView(next));
						return true;
					},
					{seed: SEED, numRuns: 100},
				);
			}),
		runs,
	);
	it.effect.prop(
		"a pass is single-use only in its creating stage, including its expiry boundary",
		{row: MenuRow, pass: MenuPass},
		({row: value, pass}) =>
			Effect.gen(function* () {
				const {menuStagesMachine}: {menuStagesMachine: ParentMachine} = yield* Effect.promise(
					() => import("./menu-stages.ts"),
				);
				const live = {...pass, until: 1000};
				const matching = {...row(value), digest: pass.digest};
				for (const at of [999, 1000, 1001]) {
					const messages = [
						...setup(value),
						wrap("cloud", {type: "open_browser", pass: live, at: 0}),
						wrap("local", {type: "rows", rows: [matching], at}),
						wrap("cloud", {
							type: "rows",
							rows: [matching, {...matching, key: `${matching.key}-other`}],
							at,
						}),
						wrap("cloud", {type: "rows", rows: [matching], at}),
					];
					const result = trace(menuStagesMachine, messages);
					const signed = result.cmds.filter(
						(c) => c.type === "menu_stage" && c.cmd.type === "menu_sign",
					);
					expect(signed).toHaveLength(at < 1000 ? 1 : 0);
					for (const cmd of signed)
						expect(cmd).toMatchObject({
							stage: "cloud",
							cmd: {check: "none", context: {ledger: "cloud-ledger"}},
						});
					propertyInvariant(
						menuStagesMachine,
						ctx,
						fc.constant(messages),
						({prev, next, msg, cmds}) => {
							isolated(prev, next, msg, cmds);
							return true;
						},
						{seed: SEED, numRuns: 100},
					);
				}
			}),
		runs,
	);
	it.effect.prop(
		"presence counts remain stage-specific and failed probes remain unknown",
		{client: MenuClient, total: Schema.Int.check(Schema.isBetween({minimum: 0, maximum: 100}))},
		({client, total}) =>
			Effect.gen(function* () {
				const {
					menuStagesMachine,
					menuStagesView,
				}: {menuStagesMachine: ParentMachine; menuStagesView: (model: Model) => readonly Item[]} =
					yield* Effect.promise(() => import("./menu-stages.ts"));
				const messages = ctx.links.map((link) =>
					wrap(link.stage, {type: "connected", context: link.context}),
				);
				const {model} = trace(menuStagesMachine, [
					...messages,
					wrap("local", {type: "clients", clients: [{...client, tabs: {_tag: "known", total}}]}),
					wrap("cloud", {type: "clients", clients: [{...client, tabs: {_tag: "unknown"}}]}),
				]);
				expect(stageModel(model, "local").clients[0]?.tabs).toEqual({_tag: "known", total});
				expect(stageModel(model, "cloud").clients[0]?.tabs).toEqual({_tag: "unknown"});
				expect(
					menuStagesView(model).find((i) => i._tag === "client" && i.stage === "cloud")?.words,
				).toContain("unknown");
				propertyInvariant(
					menuStagesMachine,
					ctx,
					arbMsgSequence(
						fc.constantFrom(
							...messages,
							wrap("local", {
								type: "clients",
								clients: [{...client, tabs: {_tag: "known", total}}],
							}),
							wrap("cloud", {type: "clients", clients: [{...client, tabs: {_tag: "unknown"}}]}),
						),
						{maxLength: 60, size: "max"},
					),
					({prev, next, msg, cmds}) => {
						isolated(prev, next, msg, cmds);
						return true;
					},
					{seed: SEED, numRuns: 100},
				);
			}),
		runs,
	);
	it.effect.prop(
		"saved cuts preserve the stage, captured intent and original Cmd replies",
		{row: MenuRow, client: MenuClient, pass: MenuPass, signed: Signed},
		({row: value, client, pass, signed}) =>
			Effect.gen(function* () {
				const {
					menuStagesMachine,
					MenuStages: codec,
				}: {menuStagesMachine: ParentMachine; MenuStages: Schema.Codec<Model>} =
					yield* Effect.promise(() => import("./menu-stages.ts"));
				const outside = [
					...setup(value),
					wrap("cloud", {type: "approve", input, id: grant, key: value.key}),
					wrap("local", {type: "clients", clients: [{...client, own: false}]}),
					wrap("local", {type: "remove", input: input2, id: revoke, key: client.key}),
					wrap("cloud", {type: "refresh"}),
				];
				const guided = arbGuidedSequence(
					menuStagesMachine,
					ctx,
					{
						outside: {stage: fc.constantFrom(...outside)},
						answers: {
							menu_stage: {
								draw: fc.constant(PersonChecked.cases.checked.make({check: "click"})),
								make: (cmd, check) => {
									if (cmd.cmd.type === "menu_check")
										return wrap(cmd.stage, checkPerson.ok(cmd.cmd, check, 1));
									if (cmd.cmd.type === "menu_refresh")
										return wrap(
											cmd.stage,
											refreshMenu.ok(cmd.cmd, {rows: [row(value)], clients: [client]}, 1),
										);
									if (cmd.cmd.type === "menu_sign")
										return wrap(cmd.stage, signChange.ok(cmd.cmd, signed, 1));
									if (cmd.cmd.type === "menu_post")
										return wrap(
											cmd.stage,
											postChange.ok(cmd.cmd, ChangeReply.cases.applied.make({rev: 1}), 1),
										);
									return wrap(cmd.stage, {type: "refresh"});
								},
							},
						},
					},
					{maxLength: 60, size: "max"},
				);
				fc.assert(
					fc.property(
						fc.oneof(
							guided,
							arbMsgSequence(
								arbMsg(messageTable({row: row(value), client, pass, signed})).chain((msg) =>
									fc.constantFrom(wrap("local", msg), wrap("cloud", msg)),
								),
								{maxLength: 60, size: "max"},
							),
						),
						(msgs) => {
							syncTest(menuStagesMachine, ctx, {
								msgs,
								encode: Schema.encodeSync(codec),
								decode: Schema.decodeUnknownSync(codec),
								equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
								seed: SEED,
							});
							// Plant: losing the stage at a saved cut must fail with the real init/reducer.
							expect(() =>
								syncTest(menuStagesMachine, ctx, {
									msgs,
									encode: () => ({stages: []}),
									decode: Schema.decodeUnknownSync(codec),
									equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
									seed: SEED,
								}),
							).toThrow();
						},
					),
					{seed: SEED, numRuns: 100},
				);
			}),
		runs,
	);
	it.effect.prop(
		"one failed watch leaves the other scoped connection usable",
		{row: MenuRow},
		({row: value}) =>
			Effect.gen(function* () {
				const fixture = yield* twoMenus();
				const {startMenuStages} = yield* Effect.promise(() => import("./menu-stages.ts"));
				// Reconcile this binding before build: the plan names per-link layers but leaves their
				// injection into startMenuStages unspecified. These layers answer transports only.
				const run = yield* startMenuStages(ctx.links, {
					local: fixture.local.layer,
					cloud: fixture.cloud.layer,
					personCheck: fixture.checkLayer,
				});
				yield* fixture.cloud.fail;
				yield* fixture.local.publish({_tag: "snapshot", value: {rows: [row(value)], clients: []}});
				yield* Effect.yieldNow;
				expect(yield* fixture.local.closed).toBe(false);
				yield* run.idle();
				expect(stageModel(run.getState(), "local").rows).toEqual([row(value)]);
			}),
		runs,
	);
	it.effect.prop(
		"signed changes bind the exact ledger before another door receives them",
		{grant: Grant, revoke: Revoke, ledger: LedgerName},
		(value) =>
			Effect.gen(function* () {
				// Real P21 signer and P17 door are required, never replaced with a test signature.
				const {signMenuChange} = yield* Effect.promise(() => import("./menu-cmds.ts"));
				const {Door} = yield* Effect.promise(() => import("../door/door.ts"));
				const {replayChange} = yield* Effect.promise(() => import("./p24.test-support.ts"));
				yield* replayChange({
					signMenuChange,
					Door,
					grant: value.grant,
					revoke: value.revoke,
					ledger: value.ledger,
				});
				// Existing text codecs independently prove that changing `to` changes the real signed bytes.
				expect(grantText({...value.grant, to: value.ledger})).not.toBe(
					grantText({...value.grant, to: `${value.ledger}-other`}),
				);
				expect(revokeText({...value.revoke, to: value.ledger})).not.toBe(
					revokeText({...value.revoke, to: `${value.ledger}-other`}),
				);
			}),
		runs,
	);
	it.prop(
		"plants: cross-stage rows, unqualified views and redirected signatures are caught",
		{model: MenuModel, row: MenuRow},
		({model, row: value}) => {
			const before: Model = {
				stages: ctx.links.map((link) => ({...link, ledger: link.context.ledger, model})),
			};
			const crossed: Model = {
				stages: before.stages.map((s) => ({...s, model: {...s.model, rows: [row(value)]}})),
			};
			expect(() => isolated(before, crossed, wrap("cloud", {type: "refresh"}), [])).toThrow();
			expect(() =>
				qualified([
					// @ts-expect-error Plant: a request without its stage cannot cross the view contract.
					{_tag: "row", key: value.key, words: value.label},
					{_tag: "action", id: "quit", words: "Quit"},
				]),
			).toThrow();
			const captured = MenuIntent.cases.approve.make({id: grant, row: row(value)});
			const cmd = signChange({
				input,
				intent: captured,
				context: ctx.links[1]!.context,
				check: "click",
			});
			expect(() =>
				expect({...cmd, context: ctx.links[0]!.context}).toMatchObject({
					context: {ledger: "cloud-ledger"},
				}),
			).toThrow();
		},
		runs,
	);
});
