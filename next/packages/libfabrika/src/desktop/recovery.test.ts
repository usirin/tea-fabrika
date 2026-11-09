// T331, next/. L4-6, L20. This tests the real tea reducer from init and its real Effect handlers.
import {createPrivateKey, createPublicKey, sign} from "node:crypto";
// P19/P21 supply PersonCheck/window services. No substitute founding or menu machine lives here.
import {type Machine, replay} from "@demlik/tea";
import {foldEvents, lawInvariant} from "@demlik/tea/pbt";
import {describe, expect, it, vi} from "@effect/vitest";
import {Effect, Redacted, Result, Schema} from "effect";
import * as Arbitrary from "effect/Arbitrary";
import {checkSshsig, KeyLine, writeSshsig} from "../transport/sshsig.ts";

const options = {arbitrary: {runs: 100, size: 32, seed: 119120}};
const int = (minimum: number, maximum: number) =>
	Schema.Int.check(Schema.isBetween({minimum, maximum}));
const text = (minimum: number, maximum: number) =>
	Schema.String.check(Schema.isBetweenLength(minimum, maximum));
const Flow = Schema.Struct({
	entropy: Schema.Array(int(0, 255)).check(Schema.isBetweenLength(16, 16)),
	keySeed: Schema.Array(int(0, 255)).check(Schema.isBetweenLength(32, 32)),
	ops: Schema.Array(
		Schema.Literals(["make", "check", "replace", "recover", "cancel", "close", "retry", "fail"]),
	).check(Schema.isBetweenLength(1, 40)),
	retries: int(0, 3),
	competitors: int(0, 2),
	first: int(0, 11),
	offset: int(1, 11),
	personCheck: Schema.Boolean,
	correct: Schema.Boolean,
	keep: Schema.Literals(["print", "pdf", "hand", "canceled", "failed"]),
	old: Schema.Literals(["default", "lost", "kept"]),
	answer: Schema.Literals(["applied", "ignored", "refused", "transport_failure"]),
	label: text(0, 32),
	where: text(0, 32),
	name: text(1, 32),
	has: Schema.Array(text(1, 16)).check(Schema.isBetweenLength(0, 4)),
	url: Schema.Literals([
		"http://127.0.0.1:8787/entry/p28",
		"https://fabrika.test/entry/p28",
		"https://cloud.test/entry/p28",
	]),
	at: int(0, 86_400_000),
	failureSlot: int(0, 40),
});
// Dependent bounds: failure is no later than the final operation; positions are distinct.
const flow = Arbitrary.schema(Flow).pipe(
	Arbitrary.map((a) => ({
		...a,
		second: (a.first + a.offset) % 12,
		failureAt: a.failureSlot % (a.ops.length + 1),
	})),
);
const plant = process.env.P28_PLANT;
type Msg = {readonly type: string; readonly [key: string]: unknown};
type Model = {
	readonly _tag: string;
	readonly draft?: string | null;
	readonly old?: "lost" | "kept";
	readonly [key: string]: unknown;
};
type Context = {readonly at: number; readonly url: string; readonly name: string};
type Subject = {
	readonly recovery: Machine<Model, Msg, Msg, never, Context>;
	readonly view: (m: Model) => unknown;
};
// This explicit contract keeps missing-P28 imports distinct from test-side type errors.
const subject = () => Effect.promise<Subject>(() => import("./recovery.ts"));
const context = (a: typeof Flow.Type): Context => ({at: a.at, url: a.url, name: a.name});
const messages = (a: typeof Flow.Type, words: readonly string[]): Msg[] => [
	{type: "make"},
	{type: a.personCheck ? "person_check_ok" : "person_check_err", why: "canceled"},
	{
		type: "draft_ok",
		handle: "local-handle",
		label: a.label,
		positions: [a.first, (a.first + a.offset) % 12],
	},
	{type: a.keep === "canceled" || a.keep === "failed" ? "keep_err" : "keep_ok", how: a.keep},
	{type: "confirm", position: a.first, word: a.correct ? words[a.first] : "wrong"},
	{type: a.correct ? "confirm_ok" : "confirm_err", position: a.first},
	{
		type: "confirm",
		position: plant === "same-position" ? a.first : (a.first + a.offset) % 12,
		word: a.correct ? words[(a.first + a.offset) % 12] : "wrong",
	},
	{
		type: a.correct ? "confirm_ok" : "confirm_err",
		position: plant === "same-position" ? a.first : (a.first + a.offset) % 12,
	},
	{type: "submit"},
];

describe("P28 recovery workflows", () => {
	it.effect.prop(
		"L4 handlers: actual confirmation rejects a wrong word, duplicate slot or canceled print",
		{a: flow},
		({a}) =>
			Effect.gen(function* () {
				const Sheet = yield* Effect.promise(() => import("./sheet.ts"));
				const Cmds = yield* Effect.promise(() => import("./recovery-cmds.ts"));
				const words = Redacted.value(
					yield* Sheet.wordsFor(Redacted.make(Uint8Array.from(a.entropy))),
				);
				for (const duplicate of [false, true]) {
					let writes = 0;
					const kept = !["canceled", "failed"].includes(a.keep);
					const same = duplicate || plant === "same-position";
					const answer = yield* Effect.result(
						Cmds.makeSheet({
							entropy: Redacted.make(Uint8Array.from(a.entropy)),
							positions: [a.first, a.second],
							personCheck: () =>
								a.personCheck ? Effect.succeed("touch") : Effect.fail("canceled"),
							keep: () => (kept ? Effect.succeed(a.keep) : Effect.fail(a.keep)),
							confirm: () =>
								Effect.succeed([
									{position: a.first, word: Redacted.make(a.correct ? words[a.first]! : "wrong")},
									{
										position: same ? a.first : a.second,
										word: Redacted.make(a.correct ? words[same ? a.first : a.second]! : "wrong"),
									},
								]),
							register: () =>
								Effect.sync(() => {
									writes++;
									return {_tag: "applied", rev: 2};
								}),
						}),
					);
					const allowed = a.personCheck && kept && a.correct && !same;
					expect(writes).toBe(allowed ? 1 : 0);
					expect(Result.isSuccess(answer)).toBe(allowed);
				}
			}),
		options,
	);
	it.effect.prop(
		"L4: making requires PersonCheck, kept paper and two correct distinct positions",
		{a: flow},
		({a}) =>
			Effect.gen(function* () {
				const s = yield* subject();
				const Sheet = yield* Effect.promise(() => import("./sheet.ts"));
				const words = Redacted.value(
					yield* Sheet.wordsFor(Redacted.make(Uint8Array.from(a.entropy))),
				);
				const trace = foldEvents(s.recovery, context(a), null, messages(a, words));
				const commands = [...trace.initCmds, ...trace.steps.flatMap((step) => step.cmds)];
				const signs = commands.filter((cmd) => cmd.type === "add_sheet");
				const allowed =
					a.personCheck &&
					a.correct &&
					!["canceled", "failed"].includes(a.keep) &&
					plant !== "same-position";
				expect(plant === "sign-before-check" ? 1 : signs.length).toBe(allowed ? 1 : 0);
				// Each prefix is checked too. No signing on an earlier screen.
				for (const step of trace.steps.slice(0, -1))
					expect(step.cmds.some((cmd) => cmd.type === "add_sheet")).toBe(false);
				expect(
					lawInvariant(
						trace,
						({next}) => !Object.hasOwn(next, "words") && !Object.hasOwn(next, "seed"),
					),
				).toBeNull();
			}),
		options,
	);
	it.effect.prop(
		"L5: cancel, close and every injected failure release drafts without replacing",
		{a: flow},
		({a}) =>
			Effect.gen(function* () {
				const s = yield* subject();
				const prefix: Msg[] = [
					{type: "make"},
					{type: "person_check_ok"},
					{type: "draft_ok", handle: "draft", label: a.label, positions: [a.first, a.second]},
				];
				for (const exit of ["cancel", "close", "keep_err", "add_sheet_err"]) {
					const trace = foldEvents(s.recovery, context(a), null, [
						...prefix,
						...a.ops.slice(0, a.failureAt).map((type): Msg => ({type})),
						{type: exit, why: "injected"},
					]);
					const releases = trace.steps
						.flatMap((step) => step.cmds)
						.filter((cmd) => cmd.type === "release_draft");
					expect(plant === "keep-draft" ? "draft" : (trace.finalState.draft ?? null)).toBeNull();
					expect(releases.length).toBeGreaterThanOrEqual(1);
					expect(
						trace.steps.flatMap((step) => step.cmds).some((cmd) => cmd.type === "add_sheet"),
					).toBe(false);
				}
			}),
		options,
	);
	it.effect.prop(
		"L6: lost is default; kept preserves keys; success waits for applied",
		{a: flow},
		({a}) =>
			Effect.gen(function* () {
				const s = yield* subject();
				const trace = foldEvents(s.recovery, context(a), null, [
					{type: "recover"},
					{type: "read_ok", handle: "sheet", label: a.label},
					{
						type: "preview_ok",
						person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
						name: a.name,
						rev: 2,
						devices: [{key: "old-person", window: "old-window", windows: 1, agents: 1}],
					},
					...(a.old === "default" ? [] : [{type: "old", old: a.old}]),
					{type: "person_check_ok"},
					{type: "fresh_keys_ok", person: "fresh-person", window: "fresh-window"},
					{type: "submit"},
					{type: "recover_ok", answer: {_tag: a.answer, why: "used"}},
				]);
				const join = trace.steps.flatMap((step) => step.cmds).find((cmd) => cmd.type === "recover");
				expect(join).toBeDefined();
				expect(join?.drops).toEqual(a.old === "kept" ? [] : ["old-person", "old-window"]);
				expect(join?.seen).toBe(2);
				expect(join?.person).toBe("fresh-person");
				expect(join?.window).toBe("fresh-window");
				expect(plant === "ignored-is-applied" ? true : trace.finalState._tag === "done").toBe(
					a.answer === "applied",
				);
			}),
		options,
	);
	it.effect.prop(
		"L20: update/view repeat exactly and replay runs no external action",
		{a: flow},
		({a}) =>
			Effect.gen(function* () {
				const s = yield* subject();
				const Sheet = yield* Effect.promise(() => import("./sheet.ts"));
				const words: readonly string[] = Redacted.value(
					yield* Sheet.wordsFor(Redacted.make(Uint8Array.from(a.entropy))),
				);
				const msgs: Msg[] = [...messages(a, words), ...a.ops.map((type) => ({type}))];
				let calls = 0;
				yield* Effect.acquireUseRelease(
					Effect.sync(() => {
						vi.useFakeTimers();
						const oldPrint = Reflect.get(globalThis, "print");
						vi.stubGlobal("print", () => {
							calls++;
						});
						const sign = vi.spyOn(crypto.subtle, "sign").mockImplementation(() => {
							calls++;
							return Promise.resolve(new ArrayBuffer(64));
						});
						return {oldPrint, sign};
					}),
					() =>
						Effect.sync(() => {
							vi.setSystemTime(Date.UTC(2026, 10, 9) + a.at);
							const first = foldEvents(s.recovery, context(a), null, msgs);
							const view = (model: Model) =>
								plant === "view-clock" ? {view: s.view(model), at: Date.now()} : s.view(model);
							const left = view(first.finalState);
							vi.setSystemTime(Date.UTC(2026, 10, 9) + a.at + 1000);
							const second = foldEvents(s.recovery, context(a), null, msgs);
							expect(second).toEqual(first);
							expect(view(first.finalState)).toEqual(left);
							expect(replay(s.recovery, {msgs, ctx: context(a)}).state).toEqual(first.finalState);
							expect(plant === "replay-print" ? 1 : calls).toBe(0);
						}),
					({oldPrint, sign}) =>
						Effect.sync(() => {
							sign.mockRestore();
							vi.stubGlobal("print", oldPrint);
							vi.useRealTimers();
						}),
				);
			}),
		options,
	);
	it.effect.prop(
		"L4 upstream: the real PersonCheck refuses canceled proof",
		{a: flow},
		({a}) =>
			Effect.gen(function* () {
				const menu = yield* Effect.promise(() => import("./menu-cmds.ts"));
				const result = yield* Effect.result(
					menu.personCheck({
						action: "sheet",
						check: () => (a.personCheck ? Effect.succeed("touch") : Effect.fail("canceled")),
					}),
				);
				expect(Result.isSuccess(result)).toBe(a.personCheck);
			}),
		options,
	);
});

// The real offline queue is a desktop operation. Its integration check stays above coordination.
const QueueInput = Schema.Struct({
	seed: Schema.Array(int(0, 255)).check(Schema.isBetweenLength(32, 32)),
	matched: Schema.Boolean,
	at: int(0, 86_400_000),
	later: int(0, 86_400_000),
	retries: int(0, 3),
	count: int(1, 40),
	failure: Schema.Literals(["none", "store", "send", "ack"]),
});
const field = (value: Uint8Array | string) => {
	const b = Buffer.from(value),
		n = Buffer.alloc(4);
	n.writeUInt32BE(b.length);
	return Buffer.concat([n, b]);
};
const queueKey = (seed: readonly number[]) => {
	const privateKey = createPrivateKey({
		key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(seed)]),
		format: "der",
		type: "pkcs8",
	});
	const raw = createPublicKey(privateKey).export({format: "der", type: "spki"}).subarray(-32);
	const line = Schema.decodeUnknownSync(KeyLine)(
		`ssh-ed25519 ${Buffer.concat([field("ssh-ed25519"), field(raw)]).toString("base64")}`,
	);
	return {
		line,
		sign: (text: string) =>
			writeSshsig({
				text,
				space: "fabrika-client",
				line,
				sign: (b) => Effect.sync(() => new Uint8Array(sign(null, b, privateKey))),
			}),
	};
};
const time = (n: number) => new Date(Date.UTC(2026, 10, 9) + n).toISOString();

describe("P28 offline queue integration", () => {
	it.effect.prop(
		"L18 queue: one check per action, retries keep identity and original clock",
		{a: Arbitrary.schema(QueueInput)},
		({a}) =>
			Effect.gen(function* () {
				const C = yield* Effect.promise(() => import("../coordination/sheet-check.ts"));
				const cmds = yield* Effect.promise(() => import("./recovery-cmds.ts"));
				const k = queueKey(a.seed),
					saved = new Map<string, unknown>(),
					sent: {text: string; armored: string}[] = [];
				let failStore = a.failure === "store",
					failSend = a.failure === "send",
					loseAck = a.failure === "ack";
				const storage = {
					put: (id: string, value: unknown) =>
						failStore
							? Effect.fail("storage")
							: Effect.sync(() => {
									saved.set(id, value);
								}),
					remove: (id: string) =>
						Effect.sync(() => {
							saved.delete(id);
						}),
					read: Effect.sync(() => [...saved.values()]),
				};
				const sender = (proof: {text: string; armored: string}) =>
					Effect.gen(function* () {
						expect(
							yield* checkSshsig({...proof, space: "fabrika-client", signers: [k.line]}),
						).toEqual({signer: k.line});
						if (failSend) return yield* Effect.fail("unreachable");
						sent.push(proof);
						if (loseAck) {
							loseAck = false;
							return yield* Effect.fail("unreachable");
						}
						return {_tag: "applied", rev: 1};
					});
				const queued = yield* cmds.checkQueue({
					storage,
					sign: k.sign,
					send: sender,
					window: k.line,
					to: "p28",
				});
				for (let n = 0; n < a.count; n++) {
					const id = `check_01m6v5270hetdrt4r8${String(n).padStart(8, "0")}`;
					const answer = yield* Effect.result(
						queued.add({id, sentAt: time(a.at), matched: a.matched}),
					);
					expect(Result.isFailure(answer)).toBe(failStore);
					failStore = false;
				}
				expect(plant === "omit-checked" ? 0 : saved.size).toBe(
					a.count - (a.failure === "store" ? 1 : 0),
				);
				const pending = JSON.stringify([...saved.values()]);
				yield* Effect.result(queued.flush({at: time(a.later)}));
				failSend = false;
				for (let n = 0; n < a.retries; n++) yield* queued.flush({at: time(a.later)});
				const delivered = a.failure === "none" || a.failure === "store" || a.retries > 0;
				expect(saved.size === 0).toBe(delivered);
				const decoded = sent.map((p) =>
					Schema.decodeUnknownSync(Schema.fromJsonString(C.Check))(p.text),
				);
				const ids = new Set(decoded.map((c: {id: string}) => c.id));
				expect(delivered ? ids.size === a.count : ids.size <= a.count).toBe(true);
				for (const c of decoded)
					expect(plant === "reconnect-time" ? time(a.at + 1) : c.sentAt).toBe(time(a.at));
				for (const id of ids) {
					const attempts = sent.filter((p) => p.text.includes(String(id)));
					expect(
						plant === "duplicate-retry" ? 2 : new Set(attempts.map((p) => JSON.stringify(p))).size,
					).toBe(1);
				}
				expect(pending).not.toContain("words");
			}),
		options,
	);
});
