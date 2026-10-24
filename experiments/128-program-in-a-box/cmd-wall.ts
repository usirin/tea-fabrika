// Experiment 128, the second wall: a tea Cmd that runs on the host.
//
// Inside the box, a machine runs with tea's own `run(machine, {interpret})`. The interpret entry
// of a keyed Cmd is `outside(def)`: it checks the Cmd with the def's own input schema, sends it
// out as a `cmd` frame on the same stdio channel, and waits for its answer. The host checks it
// again, runs the real handler, the one that holds the key, and answers `ok` or `err`; tea
// checks an `ok` with the def's own `ok` schema when it settles. No schema is written for the
// wall: each Cmd brings its own.
//
//   const stamp = Cmd.define("stamp", {input: Text, ok: Stamped, err: ["refused"]});
//   run(machine, {interpret: {count_words: countHere, stamp: outside(stamp)}})   // in the box
//   startBoxed(place, entry, flags, {}, {stamp: realStamp})                      // on the host

import type {CmdDef, CmdInput, CmdValue, Tagged} from "@demlik/tea";
import {Context, Deferred, Effect, Exit, Layer} from "effect";
import type {Answer, Up} from "./wall.ts";

/** What the host needs of a Cmd's def to check what crosses: its name, tags and schemas. */
export type Keyed = Pick<
	CmdDef<string, CmdInput, unknown, Tagged>,
	"cmdType" | "errTags" | "schema"
>;

type Checker = Keyed["schema"]["ok"];
type Checked =
	| {readonly kind: "ok"; readonly value: unknown}
	| {readonly kind: "no"; readonly why: string};

/** A value read with one of the def's own schemas: the value as it hands it on, or why not. */
const check = (schema: Checker, value: unknown): Checked => {
	const read = schema["~standard"].validate(value);
	if (read instanceof Promise) return {kind: "no", why: "a schema that needs a Promise"};
	if (read.issues === undefined) return {kind: "ok", value: read.value};
	return {kind: "no", why: read.issues.map((i) => i.message).join("; ")};
};

/** The channel out of the box, inside it: send one Cmd's input, wait for its answer. */
export class Outside extends Context.Service<
	Outside,
	{readonly send: (name: string, input: unknown) => Effect.Effect<Answer>}
>()("exp128/Outside") {}

/**
 * The interpret entry for a Cmd that runs on the host. A Cmd its own input schema refuses
 * never crosses: that is a bug in the machine, so it dies here. An answer the host refused
 * dies too; an `err` with a tag the def does not declare dies, as tea's own check would.
 */
export const outside =
	<N extends string, I extends CmdInput, O, E extends Tagged>(def: CmdDef<N, I, O, E>) =>
	(cmd: CmdValue<N, I, O, E>): Effect.Effect<O, E, Outside> =>
		Effect.gen(function* () {
			const input = check(def.schema.input, cmd);
			if (input.kind === "no")
				return yield* Effect.die(new Error(`${def.cmdType} not sent: ${input.why}`));
			const answer = yield* (yield* Outside).send(def.cmdType, input.value);
			switch (answer.kind) {
				case "ok":
					// The value as it came; tea reads it with the def's `ok` schema when it settles.
					return answer.value as O;
				case "err":
					if ((def.errTags as readonly string[]).includes(answer.tag))
						return yield* Effect.fail({_tag: answer.tag} as E);
					return yield* Effect.die(new Error(`${def.cmdType}: undeclared tag ${answer.tag}`));
				case "no":
					return yield* Effect.die(new Error(`${def.cmdType}: the host said no: ${answer.why}`));
			}
		});

/** Where each answer goes, by its Cmd's id, on the box's side. */
export type Waiting = Map<number, (answer: Answer) => void>;

/** Inside the box: `Outside` over the channel. Each Cmd gets an id; its answer comes back by it. */
export const outsideLayer = (write: (frame: Up) => Effect.Effect<void>, waiting: Waiting) =>
	Layer.sync(Outside, () => {
		let next = 0;
		return Outside.of({
			send: (name, input) =>
				Effect.suspend(() => {
					const id = next++;
					return Effect.gen(function* () {
						const answered = yield* Deferred.make<Answer>();
						waiting.set(id, (a) => Deferred.doneUnsafe(answered, Exit.succeed(a)));
						yield* write({kind: "cmd", id, name, input});
						return yield* Deferred.await(answered);
					}).pipe(Effect.ensuring(Effect.sync(() => waiting.delete(id))));
				}),
		});
	});

/** The real handlers, on the host, by Cmd name. Each one may hold a key. */
export type Handlers = Readonly<
	Record<string, (cmd: never) => Effect.Effect<unknown, {readonly _tag: string}>>
>;

/**
 * On the host: answer one `cmd` frame. The box is not trusted, so the input is checked again
 * with the def's own schema before the handler sees it, and the handler's value with the
 * `ok` schema before it goes back.
 */
export const answer = (
	cmds: readonly Keyed[],
	handlers: Handlers,
	frame: {readonly id: number; readonly name: string; readonly input: unknown},
): Effect.Effect<Answer> => {
	const {id} = frame;
	const no = (why: string): Answer => ({kind: "no", id, why});
	const def = cmds.find((c) => c.cmdType === frame.name);
	const handler = handlers[frame.name];
	if (def === undefined || handler === undefined)
		return Effect.succeed(no(`${frame.name} does not run outside`));
	const input = check(def.schema.input, frame.input);
	if (input.kind === "no") return Effect.succeed(no(input.why));
	const cmd = {...(input.value as object), type: def.cmdType} as never;
	return handler(cmd).pipe(
		Effect.map((value): Answer => {
			const ok = check(def.schema.ok, value);
			return ok.kind === "ok"
				? {kind: "ok", id, value: ok.value}
				: no(`the host's answer: ${ok.why}`);
		}),
		Effect.catch((e) =>
			Effect.succeed<Answer>(
				(def.errTags as readonly string[]).includes(e._tag)
					? {kind: "err", id, tag: e._tag}
					: no(`undeclared tag ${e._tag}`),
			),
		),
		Effect.catchCause(() => Effect.succeed(no(`${frame.name} broke on the host`))),
	);
};
