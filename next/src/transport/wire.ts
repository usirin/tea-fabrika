import {Option, Schema} from "effect";

// What goes on the pipe, for any peer: a browser tab, a Mac's hands, a test. JSON-RPC 2.0 (T8),
// plus the plain text "ping" and "pong" (T6). No Node and no socket frames: a tab can speak it.
//
//   -> {"jsonrpc":"2.0","id":"hello","method":"initialize","params":{"versions":[1],"has":[],"ping":"30s"}}
//   <- {"jsonrpc":"2.0","id":"hello","result":{"version":1,"ping":"30s"}}
//   -> ping
//   <- pong

/** The versions this brain speaks (T4). The previous one joins when there is one. */
const VERSIONS: readonly number[] = [1];

/** The longest a pong may take before a peer calls the pipe dead (T6). */
export const PONG_WAIT_MS = 10_000;

const MIN_PING_MS = 1_000;
const MAX_PING_MS = 60_000;

/** A hello's params (T1, T4). `key` and `signed` wait for T5. */
const Hello = Schema.Struct({
	versions: Schema.Array(Schema.Int),
	has: Schema.Array(Schema.String),
	ping: Schema.String,
});
type Hello = typeof Hello.Type;

const Welcome = Schema.Struct({version: Schema.Int, ping: Schema.String});

/** The highest version both sides speak, or nothing. */
export const pickVersion = (theirs: readonly number[]): Option.Option<number> => {
	const shared = theirs.filter((v) => VERSIONS.includes(v));
	return shared.length === 0 ? Option.none() : Option.some(Math.max(...shared));
};

/** `"30s"` as milliseconds; anything else is the default. */
export const pingMs = (ping: string): number => {
	const m = /^(\d+)s$/.exec(ping);
	return m?.[1] === undefined ? 30_000 : Number(m[1]) * 1000;
};

/** A peer's asked ping, kept inside the brain's min and max. */
export const clampPing = (ping: string): string =>
	`${Math.min(MAX_PING_MS, Math.max(MIN_PING_MS, pingMs(ping))) / 1000}s`;

/** The brain's answer to a hello, or why it has none. */
export const answerHello = (
	params: unknown,
):
	| {readonly version: number; readonly ping: string}
	| {readonly why: "bad_hello" | "no_version"} => {
	const hello: Option.Option<Hello> = Schema.decodeUnknownOption(Hello)(params);
	if (Option.isNone(hello)) return {why: "bad_hello"};
	const version = pickVersion(hello.value.versions);
	if (Option.isNone(version)) return {why: "no_version"};
	return {version: version.value, ping: clampPing(hello.value.ping)};
};

/** What a peer says first, as text. */
export const helloText = (has: readonly string[], ping: string): string =>
	ask("hello", "initialize", {versions: VERSIONS, has, ping});

const Frame = Schema.Struct({
	jsonrpc: Schema.Literal("2.0"),
	id: Schema.optionalKey(Schema.String),
	method: Schema.optionalKey(Schema.String),
	params: Schema.optionalKey(Schema.Unknown),
	result: Schema.optionalKey(Schema.Unknown),
	error: Schema.optionalKey(
		Schema.Struct({
			code: Schema.Int,
			message: Schema.String,
			data: Schema.optionalKey(Schema.Struct({why: Schema.String})),
		}),
	),
});

/** One message read off the pipe. */
export type Message =
	| {readonly is: "ask"; readonly id: string; readonly method: string; readonly params: unknown}
	| {readonly is: "news"; readonly method: string; readonly params: unknown}
	| {readonly is: "ok"; readonly id: string; readonly result: unknown}
	| {readonly is: "err"; readonly id: string; readonly why: string};

/** Text off the pipe as a message. Anything else is nothing: unknown kinds are ignored (T4). */
export const readMessage = (text: string): Option.Option<Message> =>
	Option.flatMap(
		Schema.decodeUnknownOption(Schema.fromJsonString(Frame))(text),
		(f): Option.Option<Message> => {
			if (f.method !== undefined) {
				return Option.some(
					f.id === undefined
						? {is: "news", method: f.method, params: f.params}
						: {is: "ask", id: f.id, method: f.method, params: f.params},
				);
			}
			if (f.id === undefined) return Option.none();
			if (f.error !== undefined) {
				return Option.some({is: "err", id: f.id, why: f.error.data?.why ?? f.error.message});
			}
			return Option.some({is: "ok", id: f.id, result: f.result});
		},
	);

/** The ping a brain's answer to a hello set, or nothing if it is not one. */
export const readWelcome = (result: unknown): Option.Option<string> =>
	Option.map(Schema.decodeUnknownOption(Welcome)(result), (w) => w.ping);

export const ask = (id: string, method: string, params: unknown): string =>
	JSON.stringify({jsonrpc: "2.0", id, method, params});

export const news = (method: string, params: unknown): string =>
	JSON.stringify({jsonrpc: "2.0", method, params});

export const ok = (id: string, result: unknown): string =>
	JSON.stringify({jsonrpc: "2.0", id, result});

export const err = (id: string, why: string): string =>
	JSON.stringify({jsonrpc: "2.0", id, error: {code: 1, message: why, data: {why}}});
