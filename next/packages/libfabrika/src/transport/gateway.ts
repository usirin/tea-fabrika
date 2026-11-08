import {Effect, Result, Schema, Semaphore} from "effect";
import {Answer, type Attached, Wait} from "./wire.ts";
const Waited = Schema.TaggedUnion({ready: {rev: Schema.Number}, parked: {}});

const Request = Schema.Struct({
	jsonrpc: Schema.Literal("2.0"),
	id: Schema.Union([Schema.String, Schema.Number]),
	method: Schema.String,
	params: Schema.Unknown,
});
const Read = Schema.Struct({
	stream: Schema.String,
	after: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
type Options<E> = {
	readonly reader: string;
	readonly session: string;
	readonly ping: () => number | null;
	readonly read: () => typeof Attached.Type;
	readonly save: (a: typeof Attached.Type) => void;
	readonly send: (text: string) => void;
	readonly close: (code: number) => void;
	readonly wait: (
		stream: string,
		after: number,
		reader: string,
	) => Effect.Effect<typeof Waited.Type, E>;
	readonly call: (method: string, params: unknown) => Effect.Effect<typeof Answer.Type, E>;
};

export const connection = <E>(options: Options<E>) => {
	const turn = Semaphore.makeUnsafe(1);
	const respond = (id: string | number, answer: typeof Answer.Type) => {
		if (answer._tag === "parked") return;
		options.send(
			JSON.stringify(
				answer._tag === "ok"
					? {jsonrpc: "2.0", id, result: answer.result}
					: {
							jsonrpc: "2.0",
							id,
							error: {code: -32000, message: answer.why, data: {why: answer.why}},
						},
			),
		);
	};
	const remove = (wait: typeof Wait.Type, rev: number) => {
		const now = options.read();
		if (
			now._tag !== "online" ||
			!now.waits.some((w) => w.id === wait.id && w.stream === wait.stream && w.after === wait.after)
		)
			return;
		options.save({...now, waits: now.waits.filter((w) => w.id !== wait.id)});
		respond(wait.id, Answer.cases.ok.make({result: {rev}}));
	};
	const parked = Effect.fnUntraced(function* (id: string | number, params: unknown) {
		const now = options.read();
		if (now._tag !== "online") return respond(id, Answer.cases.refused.make({why: "no_hello"}));
		const decoded = Schema.decodeUnknownResult(Read)(params);
		if (Result.isFailure(decoded))
			return respond(id, Answer.cases.refused.make({why: "bad_input"}));
		const wait = Wait.make({id, ...decoded.success});
		const next = {...now, waits: [...now.waits, wait]};
		if (
			now.waits.some((w) => w.id === id) ||
			next.waits.length > 64 ||
			new TextEncoder().encode(JSON.stringify(next)).length > 16_384
		)
			return respond(id, Answer.cases.refused.make({why: "too_many_waits"}));
		options.save(next);
		const answer = yield* options.wait(wait.stream, wait.after, options.reader);
		if (answer._tag === "ready") remove(wait, answer.rev);
	});
	const ordinary = Effect.fnUntraced(function* (request: typeof Request.Type) {
		const now = options.read();
		if (now._tag !== "online" && !["initialize", "door.knock"].includes(request.method))
			return respond(request.id, Answer.cases.refused.make({why: "no_hello"}));
		if (now._tag === "online") options.save({...now, busy: true});
		const answer = yield* options.call(request.method, request.params);
		respond(request.id, answer);
		const latest = options.read();
		if (latest._tag === "online") options.save({...latest, busy: false});
	});
	return {
		frame: Effect.fn("gateway.frame")(function* (text: string) {
			const parsed = Result.try({try: () => JSON.parse(text), catch: () => null});
			if (Result.isFailure(parsed)) return;
			const decoded = Schema.decodeUnknownResult(Request)(parsed.success);
			if (Result.isFailure(decoded)) return;
			const request = decoded.success;
			if (request.method === "ledger.wait") return yield* parked(request.id, request.params);
			yield* ordinary(request).pipe(turn.withPermit);
		}),
		ring: Effect.fn("gateway.ring")((stream: string, rev: number) =>
			Effect.sync(() => {
				const now = options.read();
				if (now._tag === "online")
					for (const wait of now.waits)
						if (wait.stream === stream && rev > wait.after) remove(wait, rev);
			}),
		),
		wake: Effect.fn("gateway.wake")(() =>
			Effect.sync(() => {
				const now = options.read();
				if (now._tag === "online" && now.busy) options.close(1012);
			}),
		),
		probe: Effect.fn("gateway.probe")((session: string) =>
			Effect.sync(() => {
				return session === options.session && options.read()._tag === "online"
					? options.ping()
					: null;
			}),
		),
	};
};
