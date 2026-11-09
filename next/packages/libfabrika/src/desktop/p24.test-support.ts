import {generateKeyPairSync, sign as signBytes} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import type {Cmd as TeaCmd, Machine} from "@demlik/tea";
// P24, next/. P21 types from its approved plan, plus transport controls. Delete these stand-ins
// when P21 lands. There is deliberately no menu reducer, signer, selector or authorization rule.
import {Cmd} from "@demlik/tea/effect";
import type {MsgArbitraryTable} from "@demlik/tea/pbt";
import {Context, Deferred, Effect, Layer, Queue, Ref, Schema, Stream} from "effect";
import * as fc from "fast-check";
import {expect} from "vitest";
import {ClientManager} from "../coordination/client-manager.ts";
import {Signed, Saw} from "../coordination/members.ts";
import {Archive} from "../data/archive.ts";
import {Doorbell, Ledger} from "../data/ledger.ts";
import {RecordManager} from "../data/records.ts";
import {SpanSink} from "../data/sink.ts";
import {nodeSql} from "../data/sqlite.ts";
import {checkSshsig, KeyLine} from "../transport/sshsig.ts";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const InputId = Schema.String.check(Schema.isPattern(/^input_[0-7][0-9a-hjkmnp-tv-z]{25}$/));
const GrantId = Schema.String.check(Schema.isPattern(/^grant_[0-7][0-9a-hjkmnp-tv-z]{25}$/));
const RevokeId = Schema.String.check(Schema.isPattern(/^revoke_[0-7][0-9a-hjkmnp-tv-z]{25}$/));
export const TabCount = Schema.TaggedUnion({known: {total: Count}, unknown: {}});
export const MenuRow = Schema.Struct({
	key: Schema.String,
	label: Schema.String,
	where: Schema.String,
	code: Schema.String,
	until: Schema.Number,
	tabs: Count,
	has: Schema.Array(Schema.String),
	as: Schema.Literals(["window", "agent"]),
	digest: Schema.NullOr(Schema.String),
});
export const MenuClient = Schema.Struct({
	key: Schema.String,
	label: Schema.String,
	where: Schema.String,
	as: Schema.Literals(["window", "agent"]),
	tabs: TabCount,
	own: Schema.Boolean,
});
export const MenuPass = Schema.Struct({
	id: Schema.String.check(Schema.isPattern(/^pass_[0-7][0-9a-hjkmnp-tv-z]{25}$/)),
	digest: Schema.String,
	until: Schema.Number,
});
export const MenuIntent = Schema.TaggedUnion({
	approve: {id: GrantId, row: MenuRow},
	remove: {id: RevokeId, client: MenuClient},
});
export const MenuContext = Schema.Struct({
	person: Schema.String,
	ledger: Schema.String,
	own: Schema.String,
	browser: Schema.Boolean,
});
export const PersonChecked = Schema.TaggedUnion({
	checked: {check: Schema.Literals(["touch", "click"])},
	not_checked: {why: Schema.Literal("no")},
});
export const MenuPending = Schema.Struct({
	input: InputId,
	intent: MenuIntent,
	phase: Schema.TaggedUnion({
		checking: {},
		signing: {check: Schema.Literals(["touch", "click", "none"])},
		posting: {check: Schema.Literals(["touch", "click", "none"]), signed: Signed},
	}),
});
export const MenuModel = Schema.Struct({
	context: Schema.NullOr(MenuContext),
	brain: Schema.String,
	rows: Schema.Array(MenuRow),
	clients: Schema.Array(MenuClient),
	pending: Schema.Array(MenuPending),
	passes: Schema.Array(MenuPass),
	error: Schema.NullOr(Schema.String),
});
export const ChangeReply = Schema.TaggedUnion({
	applied: {rev: Schema.Int},
	ignored: {rev: Schema.Int, why: Schema.String},
	refused: {why: Schema.String},
});
export class MenuError extends Schema.TaggedError<MenuError>()("MenuError", {
	why: Schema.Literals([
		"bad_input",
		"bad_sender",
		"check",
		"key",
		"connection",
		"bad_reply",
		"recording",
		"open",
	]),
}) {}
// Reply types come from tea. None is handwritten, even while the upstream file is absent.
export const checkPerson = Cmd.make("menu_check", {
	input: Schema.Struct({input: InputId, intent: MenuIntent}),
	ok: PersonChecked,
	err: ["check"],
});
export const signChange = Cmd.make("menu_sign", {
	input: Schema.Struct({
		input: InputId,
		intent: MenuIntent,
		context: MenuContext,
		check: Schema.Literals(["touch", "click", "none"]),
	}),
	ok: Signed,
	err: ["key"],
});
export const postChange = Cmd.make("menu_post", {
	input: Schema.Struct({input: InputId, signed: Signed}),
	ok: ChangeReply,
	err: ["connection", "bad_reply"],
});
export const denyClient = Cmd.make("menu_deny", {
	input: Schema.Struct({input: InputId, key: Schema.String, saw: Saw}),
	ok: ChangeReply,
	err: ["connection", "bad_reply"],
});
export const refreshMenu = Cmd.make("menu_refresh", {
	input: Schema.Struct({}),
	ok: Schema.Struct({rows: Schema.Array(MenuRow), clients: Schema.Array(MenuClient)}),
	err: ["connection", "bad_reply"],
});
export const openBrowser = Cmd.make("menu_open", {
	input: Schema.Struct({id: MenuPass.fields.id}),
	ok: Schema.Null,
	err: ["open"],
});
export const quitMenu = Cmd.make("menu_quit", {input: Schema.Struct({}), ok: Schema.Null, err: []});
export const FreshMsg = Schema.Union([
	Schema.Struct({type: Schema.Literal("connected"), context: MenuContext}),
	Schema.Struct({type: Schema.Literal("brain"), words: Schema.String}),
	Schema.Struct({type: Schema.Literal("rows"), rows: Schema.Array(MenuRow), at: Schema.Number}),
	Schema.Struct({type: Schema.Literal("clients"), clients: Schema.Array(MenuClient)}),
	Schema.Struct({type: Schema.Literal("approve"), input: InputId, id: GrantId, key: Schema.String}),
	Schema.Struct({type: Schema.Literal("deny"), input: InputId, key: Schema.String}),
	Schema.Struct({type: Schema.Literal("remove"), input: InputId, id: RevokeId, key: Schema.String}),
	Schema.Struct({type: Schema.Literal("enter")}),
	Schema.Struct({type: Schema.Literal("refresh")}),
	Schema.Struct({type: Schema.Literal("open_browser"), pass: MenuPass, at: Schema.Number}),
	Schema.Struct({type: Schema.Literal("quit")}),
]);
export type MenuMsg =
	| typeof FreshMsg.Type
	| ReturnType<typeof checkPerson.ok>
	| ReturnType<typeof checkPerson.err>
	| ReturnType<typeof signChange.ok>
	| ReturnType<typeof signChange.err>
	| ReturnType<typeof postChange.ok>
	| ReturnType<typeof postChange.err>
	| ReturnType<typeof denyClient.ok>
	| ReturnType<typeof denyClient.err>
	| ReturnType<typeof refreshMenu.ok>
	| ReturnType<typeof refreshMenu.err>
	| ReturnType<typeof openBrowser.ok>
	| ReturnType<typeof openBrowser.err>
	| ReturnType<typeof quitMenu.ok>;
export type MenuCmd =
	| ReturnType<typeof checkPerson>
	| ReturnType<typeof signChange>
	| ReturnType<typeof postChange>
	| ReturnType<typeof denyClient>
	| ReturnType<typeof refreshMenu>
	| ReturnType<typeof openBrowser>
	| ReturnType<typeof quitMenu>;
// Values come from the enclosing Schema property. Tea uses fast-check for message ordering.
export const messageTable = (value: {
	row: typeof MenuRow.Type;
	client: typeof MenuClient.Type;
	pass: typeof MenuPass.Type;
	signed: typeof Signed.Type;
}): MsgArbitraryTable<MenuMsg> => {
	const input = "input_01jc9q4w7zef0b5r2t6v0xkb4d";
	const intent = MenuIntent.cases.approve.make({
		id: "grant_01jc9q4w7zef0b5r2t6v0xkb4d",
		row: value.row,
	});
	const context = MenuContext.make({
		person: "person-test",
		ledger: "cloud-ledger",
		own: "own-cloud",
		browser: true,
	});
	const check = checkPerson({input, intent});
	const signing = signChange({input, intent, context, check: "click"});
	const posting = postChange({input, signed: value.signed});
	const denial = denyClient({
		input,
		key: value.row.key,
		saw: {
			code: value.row.code,
			label: value.row.label,
			where: value.row.where,
			how: "compare",
			check: "click",
			has: value.row.has,
		},
	});
	const refresh = refreshMenu({});
	const open = openBrowser({id: value.pass.id});
	const quit = quitMenu({});
	const reply = ChangeReply.cases.applied.make({rev: 1});
	return {
		connected: fc.constant({type: "connected", context}),
		brain: fc.constant({type: "brain", words: "Unavailable"}),
		rows: fc.constant({type: "rows", rows: [value.row], at: 0}),
		clients: fc.constant({type: "clients", clients: [value.client]}),
		approve: fc.constant({type: "approve", input, id: intent.id, key: value.row.key}),
		deny: fc.constant({type: "deny", input, key: value.row.key}),
		remove: fc.constant({
			type: "remove",
			input,
			id: "revoke_01jc9q4w7zef0b5r2t6v0xkb4e",
			key: value.client.key,
		}),
		enter: fc.constant({type: "enter"}),
		refresh: fc.constant({type: "refresh"}),
		open_browser: fc.constant({type: "open_browser", pass: value.pass, at: 0}),
		quit: fc.constant({type: "quit"}),
		menu_check_ok: fc.constant(
			checkPerson.ok(check, PersonChecked.cases.checked.make({check: "click"}), 1),
		),
		menu_check_err: fc.constant(checkPerson.err(check, {_tag: "check"}, 1)),
		menu_sign_ok: fc.constant(signChange.ok(signing, value.signed, 1)),
		menu_sign_err: fc.constant(signChange.err(signing, {_tag: "key"}, 1)),
		menu_post_ok: fc.constant(postChange.ok(posting, reply, 1)),
		menu_post_err: fc.constant(postChange.err(posting, {_tag: "connection"}, 1)),
		menu_deny_ok: fc.constant(denyClient.ok(denial, reply, 1)),
		menu_deny_err: fc.constant(denyClient.err(denial, {_tag: "bad_reply"}, 1)),
		menu_refresh_ok: fc.constant(
			refreshMenu.ok(refresh, {rows: [value.row], clients: [value.client]}, 1),
		),
		menu_refresh_err: fc.constant(refreshMenu.err(refresh, {_tag: "connection"}, 1)),
		menu_open_ok: fc.constant(openBrowser.ok(open, null, 1)),
		menu_open_err: fc.constant(openBrowser.err(open, {_tag: "open"}, 1)),
		menu_quit_ok: fc.constant(quitMenu.ok(quit, null, 1)),
	};
};
export type Stage = "local" | "cloud";
export type MenuStageMsg =
	| {readonly type: "stage"; readonly stage: Stage; readonly msg: MenuMsg}
	| {readonly type: "quit"};
export type MenuStageCmd =
	| {readonly type: "menu_stage"; readonly stage: Stage; readonly cmd: MenuCmd}
	| {readonly type: "menu_quit"};
export const MenuStages = Schema.Struct({
	stages: Schema.Array(
		Schema.Struct({
			stage: Schema.Literals(["local", "cloud"]),
			url: Schema.NonEmptyString,
			ledger: Schema.NonEmptyString,
			model: MenuModel,
		}),
	),
});
export type Model = typeof MenuStages.Type;
export type Links = {
	readonly links: readonly {
		readonly stage: Stage;
		readonly url: string;
		readonly context: typeof MenuContext.Type;
	}[];
};
export type ParentMachine = Machine<Model, MenuStageMsg, MenuStageCmd & TeaCmd, never, Links>;
export type Item = {
	readonly words: string;
	readonly id?: string;
	readonly key?: string;
} & (
	| {readonly _tag: "status" | "row" | "client" | "error"; readonly stage: Stage}
	| {readonly _tag: "action"; readonly id: "open_browser"; readonly stage: Stage}
	| {readonly _tag: "action"; readonly id: "quit"; readonly stage?: never}
);

export class MenuConnection extends Context.Service<
	MenuConnection,
	{
		readonly watch: Effect.Effect<
			{
				readonly rows: readonly (typeof MenuRow.Type)[];
				readonly clients: readonly (typeof MenuClient.Type)[];
			},
			MenuError
		>;
		readonly news: Stream.Stream<any, MenuError>;
		readonly deny: (value: {
			readonly key: string;
			readonly saw: typeof Saw.Type;
		}) => Effect.Effect<typeof ChangeReply.Type, MenuError>;
		readonly post: (value: typeof Signed.Type) => Effect.Effect<typeof ChangeReply.Type, MenuError>;
	}
>()("@kampus/libfabrika/MenuConnection") {}
export class PersonCheck extends Context.Service<
	PersonCheck,
	{readonly ask: (why: string) => Effect.Effect<typeof PersonChecked.Type, MenuError>}
>()("@kampus/libfabrika/PersonCheck") {}
export class PersonKey extends Context.Service<
	PersonKey,
	{
		readonly line: Effect.Effect<typeof KeyLine.Type>;
		readonly sign: (bytes: Uint8Array) => Effect.Effect<Uint8Array>;
	}
>()("@kampus/libfabrika/PersonKey") {}

export const personKey = () => {
	const pair = generateKeyPairSync("ed25519");
	const raw = Buffer.from(pair.publicKey.export({format: "jwk"}).x ?? "", "base64url");
	const field = (body: Buffer) => {
		const n = Buffer.alloc(4);
		n.writeUInt32BE(body.length);
		return Buffer.concat([n, body]);
	};
	const line = Schema.decodeUnknownSync(KeyLine)(
		`ssh-ed25519 ${Buffer.concat([field(Buffer.from("ssh-ed25519")), field(raw)]).toString("base64")}`,
	);
	return {
		line,
		layer: Layer.succeed(PersonKey, {
			line: Effect.succeed(line),
			sign: (bytes) => Effect.sync(() => new Uint8Array(signBytes(null, bytes, pair.privateKey))),
		}),
	};
};

export const replayChange = Effect.fn("test.p24.replayChange")(function* (options: {
	readonly signMenuChange: (value: any) => Effect.Effect<typeof Signed.Type, unknown, PersonKey>;
	readonly Door: any;
	readonly grant: any;
	readonly revoke: any;
	readonly ledger: string;
}) {
	const key = personKey();
	const db = yield* Effect.acquireRelease(
		Effect.sync(() => new DatabaseSync(":memory:")),
		(db) => Effect.sync(() => db.close()),
	);
	const sql = nodeSql(db);
	const records = RecordManager.memory(64 * 1024);
	const ledger = Ledger.sql(sql, {reader: "p24"}).pipe(
		Layer.provide(Layer.succeed(Doorbell, {ring: () => Effect.void})),
	);
	const founder = {
		name: "P24",
		person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
		keys: [key.line],
		window: null,
		by: key.line,
		build: "p24",
	};
	const clients = ClientManager.layer(founder).pipe(Layer.provideMerge(ledger));
	const env = Layer.mergeAll(
		clients,
		SpanSink.layer(sql, {object: "project"}),
		records,
		Archive.memory,
	);
	const settings = {
		founder,
		sql,
		name: options.ledger,
		url: "https://cloud.invalid",
		origins: ["https://cloud.invalid"],
		versions: [1],
		location: "test",
		build: "p24",
		waiting: {most: 100, ttl: 600000},
		ping: {min: 10000, max: 60000},
		inputCap: 1000,
		spentCap: 1000,
		nextProcess: () => Effect.succeed("process_01m6v5270hetdrt4r8h9vvjwjs"),
		deliver: () => Effect.void,
		notify: () => Effect.void,
		inputs: {schema: Schema.Json, log: Schema.Json, personOnly: [], raw: []},
		facts: {personOnly: []},
	};
	const context = {person: founder.person, ledger: options.ledger, own: key.line, browser: true};
	const intents = [
		MenuIntent.cases.approve.make({
			id: "grant_01jc9q4w7zef0b5r2t6v0xkb4d",
			row: {
				key: options.grant.key,
				code: options.grant.saw.code,
				label: options.grant.saw.label,
				where: options.grant.saw.where,
				has: options.grant.saw.has,
				until: 1000000,
				tabs: 1,
				as: options.grant.as,
				digest: null,
			},
		}),
		MenuIntent.cases.remove.make({
			id: "revoke_01jc9q4w7zef0b5r2t6v0xkb4e",
			client: {
				key: options.grant.key,
				label: options.revoke.saw.label,
				where: options.revoke.saw.where,
				as: "window",
				tabs: TabCount.cases.unknown.make({}),
				own: false,
			},
		}),
	];
	for (const intent of intents) {
		const signed = yield* options
			.signMenuChange({intent, context, check: "click"})
			.pipe(Effect.provide(key.layer));
		expect(
			yield* checkSshsig({...signed, space: "fabrika-client", signers: [key.line]}),
		).toHaveProperty("signer");
		const local = options.Door.layer({...settings, name: `${options.ledger}-other`}).pipe(
			Layer.provide(env),
		);
		const remote = options.Door.layer(settings).pipe(Layer.provide(env));
		const access: Effect.Effect<
			{grant: (value: typeof Signed.Type) => Effect.Effect<unknown, unknown>},
			never,
			unknown
		> = options.Door;
		const at = (layer: Layer.Layer<unknown, unknown>): Effect.Effect<unknown, unknown> =>
			Effect.flatMap(access, (door) => door.grant(signed)).pipe(Effect.provide(layer));
		expect(yield* at(local)).toMatchObject({_tag: "refused", why: "wrong_ledger"});
		expect(yield* at(remote)).toMatchObject({_tag: "applied"});
		expect(yield* at(local)).toMatchObject({_tag: "refused", why: "wrong_ledger"});
	}
});

export const twoMenus = Effect.fn("test.p24.twoMenus")(function* () {
	const posts = yield* Ref.make<readonly {stage: Stage; signed: typeof Signed.Type}[]>([]);
	const checks = yield* Queue.unbounded<Deferred.Deferred<typeof PersonChecked.Type>>();
	const connection = Effect.fnUntraced(function* (stage: Stage) {
		const news = yield* Queue.unbounded<any, MenuError>();
		const closed = yield* Ref.make(false);
		yield* Effect.addFinalizer(() => Ref.set(closed, true));
		const service: typeof MenuConnection.Service = {
			watch: Effect.succeed({rows: [], clients: []}),
			news: Stream.fromQueue(news),
			deny: () => Effect.succeed(ChangeReply.cases.applied.make({rev: 1})),
			post: (signed) =>
				Ref.update(posts, (all) => [...all, {stage, signed}]).pipe(
					Effect.as(ChangeReply.cases.applied.make({rev: 1})),
				),
		};
		return {
			layer: Layer.succeed(MenuConnection, service),
			service,
			closed: Ref.get(closed),
			publish: (value: any): Effect.Effect<boolean> => Queue.offer(news, value),
			fail: Queue.fail(news, new MenuError({why: "connection"})),
		};
	});
	const local = yield* connection("local"),
		cloud = yield* connection("cloud");
	return {
		local,
		cloud,
		posted: Ref.get(posts),
		checkLayer: Layer.succeed(PersonCheck, {
			ask: () =>
				Effect.gen(function* () {
					const check = yield* Deferred.make<typeof PersonChecked.Type>();
					yield* Queue.offer(checks, check);
					return yield* Deferred.await(check);
				}),
		}),
		answerCheck: (_input: string, answer: typeof PersonChecked.Type) =>
			Queue.take(checks).pipe(
				Effect.flatMap((check) => Deferred.succeed(check, answer)),
				Effect.asVoid,
			),
	};
});
