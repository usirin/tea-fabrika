// T293, next/. Real P12 stage via P14's launcher; only the test's socket proxy injects faults.
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Id, Layout} from "@kampus/libfabrika";
import {Effect, Schema} from "effect";
import {chromium, type BrowserContext, type Page, type WebSocketRoute} from "playwright";
import {startP12Stage} from "./p14.test-support.ts";

export class NotesStageDown extends Schema.TaggedError<NotesStageDown>()("NotesStageDown", {
	message: Schema.String,
}) {}
const Frame = Schema.Struct({
	id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number])),
	method: Schema.optionalKey(Schema.String),
	params: Schema.optionalKey(Schema.Json),
	result: Schema.optionalKey(Schema.Json),
	error: Schema.optionalKey(Schema.Json),
});
const parse = Schema.decodeUnknownOption(Schema.fromJsonString(Frame));
export type NotesLayout = "full" | "side-by-side" | "stacked" | "2x2";
const suffix = (value: bigint): string => {
	let uuid = (7n << 76n) | (2n << 62n) | value;
	let text = "";
	for (let i = 0; i < 26; i++) {
		text = `${"0123456789abcdefghjkmnpqrstvwxyz"[Number(uuid & 31n)]}${text}`;
		uuid >>= 5n;
	}
	return text;
};
const TileId = Id.make("tile");
export const startNotesStage = Effect.fn("test.notesStage")(function* (
	options: {readonly layout?: NotesLayout} = {},
) {
	const home = yield* Effect.acquireRelease(
		Effect.sync(() => mkdtempSync(join(tmpdir(), "fh."))),
		(path) => Effect.sync(() => rmSync(path, {recursive: true, force: true})),
	);
	// This fixture never launches a stage against a person's existing home.
	let tile = 0n;
	const leaf = () =>
		Layout.cases.tile.make({
			id: Schema.decodeUnknownSync(TileId)(`tile_${suffix(++tile)}`),
			name: "notes:1",
			keep: "failed",
		});
	const split = (dir: "row" | "column", a: typeof Layout.Type, b: typeof Layout.Type) =>
		Layout.cases.split.make({
			dir,
			parts: [
				{percent: 50, inner: a},
				{percent: 50, inner: b},
			],
		});
	const shape = options.layout ?? "full";
	const layout =
		shape === "full"
			? leaf()
			: shape === "side-by-side"
				? split("row", leaf(), leaf())
				: shape === "stacked"
					? split("column", leaf(), leaf())
					: split("row", split("column", leaf(), leaf()), split("column", leaf(), leaf()));
	// Plan gap: P14's launcher lists only home and port. The layout matrix needs it to compile
	// this test-owned wiring input. It must not silently ignore layout and claim these shots pass.
	const stage = yield* startP12Stage({home, port: 0, layout});
	const browser = yield* Effect.acquireRelease(
		// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright launches Chromium through a Promise
		Effect.tryPromise({
			try: () => chromium.launch(),
			catch: (e) => new NotesStageDown({message: String(e)}),
		}),
		(b) => {
			// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright closes Chromium through a Promise
			return Effect.tryPromise({
				try: () => b.close(),
				catch: (e) => new NotesStageDown({message: String(e)}),
			}).pipe(Effect.orDie);
		},
	);
	const contexts: BrowserContext[] = [];
	const requests: Array<{client: number; method: string; params: Schema.Json}> = [];
	const replies: Array<{client: number; method: string; result: Schema.Json}> = [];
	const sockets = new Map<number, WebSocketRoute>();
	const servers = new Map<number, WebSocketRoute>();
	const waiting = new Map<string | number, (reply: typeof Frame.Type) => void>();
	let count = 0n;
	const faults = new Map<
		number,
		{hold: boolean; lose: boolean; read: boolean; held: Array<() => void>}
	>();
	const open = Effect.fn("test.notesWindow")(function* () {
		// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright creates a browser context through a Promise
		const context = yield* Effect.tryPromise({
			try: () => browser.newContext(),
			catch: (e) => new NotesStageDown({message: String(e)}),
		});
		const client = contexts.length;
		contexts.push(context);
		const fault = {hold: false, lose: false, read: false, held: [] as Array<() => void>};
		faults.set(client, fault);
		// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright installs a WebSocket proxy through a Promise
		yield* Effect.tryPromise({
			try: () =>
				context.routeWebSocket("**/*", (socket) => {
					sockets.set(client, socket);
					const server = socket.connectToServer();
					servers.set(client, server);
					const methods = new Map<string | number, string>();
					socket.onMessage((message) => {
						const frame = parse(String(message));
						if (frame._tag === "Some" && frame.value.method !== undefined) {
							const {id, method, params} = frame.value;
							requests.push({client, method, params: params ?? null});
							if (id !== undefined) methods.set(id, method);
							if (fault.read && method === "ledger.read") {
								socket.send(
									JSON.stringify({
										jsonrpc: "2.0",
										id,
										error: {code: -32000, message: "test read unavailable"},
									}),
								);
								return;
							}
						}
						server.send(message);
					});
					server.onMessage((message) => {
						const frame = parse(String(message));
						if (frame._tag === "Some" && frame.value.id !== undefined) {
							const resume = waiting.get(frame.value.id);
							if (resume !== undefined) {
								waiting.delete(frame.value.id);
								resume(frame.value);
								return;
							}
						}
						const method =
							frame._tag === "Some" && frame.value.id !== undefined
								? methods.get(frame.value.id)
								: undefined;
						if (frame._tag === "Some" && method !== undefined && frame.value.result !== undefined)
							replies.push({client, method, result: frame.value.result});
						if (method === "process.send" && fault.lose) {
							fault.lose = false;
							socket.close({code: 1012, reason: "test lost answer"});
							return;
						}
						if (method === "process.send" && fault.hold) {
							fault.held.push(() => socket.send(message));
							return;
						}
						socket.send(message);
					});
				}),
			catch: (e) => new NotesStageDown({message: String(e)}),
		});
		// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright opens a page through a Promise
		const page = yield* Effect.tryPromise({
			try: () => context.newPage(),
			catch: (e) => new NotesStageDown({message: String(e)}),
		});
		// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright navigates the compiled stage client through a Promise
		yield* Effect.tryPromise({
			try: () => page.goto(stage.url),
			catch: (e) => new NotesStageDown({message: String(e)}),
		});
		return {page, context, client};
	});
	// This uses the admitted context's real server connection. It adds no server route.
	const read = Effect.fn("test.notesRead")((client: number, stream: string, after: number) =>
		Effect.callback<Schema.Json, NotesStageDown>((resume) => {
			const server = servers.get(client);
			if (server === undefined) {
				resume(Effect.fail(new NotesStageDown({message: "No admitted socket"})));
				return;
			}
			const id = `request_${suffix(++count)}`;
			waiting.set(id, (frame) =>
				resume(
					frame.result === undefined
						? Effect.fail(new NotesStageDown({message: "Ledger read failed"}))
						: Effect.succeed(frame.result),
				),
			);
			server.send(
				JSON.stringify({jsonrpc: "2.0", id, method: "ledger.read", params: {stream, after}}),
			);
			return Effect.sync(() => {
				waiting.delete(id);
			});
		}),
	);
	const grant = Effect.fn("test.notesGrant")(function* (page: Page) {
		// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright reads the displayed public fingerprint through a Promise
		const fingerprint = yield* Effect.tryPromise({
			try: () => page.getByLabel("Fingerprint").textContent(),
			catch: (e) => new NotesStageDown({message: String(e)}),
		});
		if (fingerprint === null || fingerprint.trim() === "")
			return yield* new NotesStageDown({message: "Missing admission fingerprint"});
		yield* stage.grant(fingerprint.trim());
	});
	return {
		home,
		read,
		stage,
		open,
		grant,
		requests,
		replies,
		hold: (client: number, value: boolean) => {
			const f = faults.get(client);
			if (f) f.hold = value;
		},
		release: (client: number) => {
			const f = faults.get(client);
			if (f) {
				f.hold = false;
				for (const send of f.held.splice(0)) send();
			}
		},
		loseAnswer: (client: number) => {
			const f = faults.get(client);
			if (f) f.lose = true;
		},
		failReads: (client: number, value: boolean) => {
			const f = faults.get(client);
			if (f) f.read = value;
		},
		disconnect: (client: number) =>
			sockets.get(client)?.close({code: 1012, reason: "test reconnect"}),
	};
});
