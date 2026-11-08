import {Clock, Effect, Schema, Semaphore} from "effect";
import type {Storage} from "../program/storage.ts";
import {Writer, writerText} from "./writer.ts";

export const DirectMessage = Schema.Struct({
	id: Schema.String,
	pos: Schema.Int,
	thread: Schema.String,
	by: Writer,
	to: Writer,
	at: Schema.Finite,
	said: Schema.NullOr(Schema.Finite),
	text: Schema.String,
	replyTo: Schema.NullOr(Schema.String),
	ticket: Schema.NullOr(Schema.Int),
});
export type DirectMessage = typeof DirectMessage.Type;
export const MessageDelivery = Schema.Struct({
	id: Schema.String.check(Schema.isMinLength(1)),
	to: Writer,
	thread: Schema.optionalKey(Schema.String),
	text: Schema.String.check(Schema.isMinLength(1)),
	replyTo: Schema.optionalKey(Schema.NullOr(Schema.String)),
	ticket: Schema.optionalKey(Schema.NullOr(Schema.Int)),
	said: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
});
export const MessageReceipt = Schema.TaggedUnion({
	queued: {id: Schema.String},
	delivered: {id: Schema.String},
});
export type MessageReceipt = typeof MessageReceipt.Type;
export class MessageRefused extends Schema.TaggedError<MessageRefused>()("refused", {
	why: Schema.String,
}) {}
export const MessageQuery = Schema.Struct({
	after: Schema.Finite,
	limit: Schema.Int.check(Schema.isBetween({minimum: 1, maximum: 1000})),
});
export const NativeDelivery = Schema.Struct({
	...MessageDelivery.fields,
	to: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9._-]*$/)),
});
const RoomState = Schema.Struct({
	messages: Schema.Array(DirectMessage),
	read: Schema.Array(Schema.String),
});
export const RoomManager = {
	make: ({storage}: {readonly storage: Storage}) =>
		Effect.gen(function* () {
			const handle = yield* storage.open("rooms", {});
			let state = (yield* handle.read("dm", "local", RoomState)) ?? {messages: [], read: []};
			const store = handle.store("dm", "local", RoomState);
			const lock = yield* Semaphore.make(1);
			const listeners = new Set<(message: DirectMessage) => void>();
			const receipts = new Set<(by: Writer, id: string) => void>();
			const save = (next: typeof RoomState.Type) =>
				Effect.tryPromise({
					try: () => store.save(next),
					catch: () => new MessageRefused({why: "The message could not be saved"}),
				}).pipe(
					Effect.tap(() =>
						Effect.sync(() => {
							state = next;
						}),
					),
				);
			return {
				followReceipt: (listener: (by: Writer, id: string) => void) => {
					receipts.add(listener);
					return () => receipts.delete(listener);
				},
				follow: (listener: (message: DirectMessage) => void) => {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				for: (caller: unknown) => {
					const by = Schema.decodeUnknownSync(Writer)(caller);
					const same = (writer: Writer) => writerText(writer) === writerText(by);
					return {
						receipt: (id: string): MessageReceipt | null =>
							state.messages.some((m) => same(m.by) && m.id === id)
								? state.read.includes(`${writerText(by)}/${id}`)
									? MessageReceipt.cases.delivered.make({id})
									: MessageReceipt.cases.queued.make({id})
								: null,
						send: (raw: unknown) =>
							lock.withPermit(
								Effect.gen(function* () {
									const value = yield* Schema.decodeUnknownEffect(MessageDelivery)(raw).pipe(
										Effect.mapError(() => new MessageRefused({why: "The message does not fit"})),
									);
									const old = state.messages.find((m) => same(m.by) && m.id === value.id);
									if (old !== undefined) {
										if (
											writerText(old.to) !== writerText(value.to) ||
											old.text !== value.text ||
											old.replyTo !== (value.replyTo ?? null)
										)
											return yield* new MessageRefused({
												why: "This message ID already belongs to another message",
											});
										return state.read.includes(`${writerText(by)}/${old.id}`)
											? MessageReceipt.cases.delivered.make({id: old.id})
											: MessageReceipt.cases.queued.make({id: old.id});
									}
									const at = yield* Clock.currentTimeMillis;
									const participants =
										by.kind === "user" && value.to.kind === "user"
											? [by.id, value.to.id].sort()
											: [
													by.kind === "agent" && "for" in by ? by.for : by.id,
													value.to.kind === "agent" ? value.to.id : by.id,
												];
									const thread = value.thread ?? `dm/${participants.join("/")}`;
									const message = {
										...value,
										pos: state.messages.length + 1,
										by,
										thread,
										at,
										said: value.said ?? null,
										replyTo: value.replyTo ?? null,
										ticket: value.ticket ?? null,
									};
									yield* save({...state, messages: [...state.messages, message]});
									yield* Effect.logInfo("dm_queued").pipe(
										Effect.annotateLogs({
											id: message.id,
											by: writerText(by),
											to: writerText(message.to),
											replyTo: message.replyTo,
										}),
									);
									for (const listener of listeners) listener(message);
									return MessageReceipt.cases.queued.make({id: message.id});
								}),
							),
						read: (raw: unknown) =>
							lock.withPermit(
								Effect.gen(function* () {
									const query = yield* Schema.decodeUnknownEffect(MessageQuery)(raw).pipe(
										Effect.mapError(
											() => new MessageRefused({why: "The message query does not fit"}),
										),
									);
									const messages = state.messages
										.filter((m) => (same(m.by) || same(m.to)) && m.pos > query.after)
										.slice(0, query.limit);
									const read = [
										...new Set([
											...state.read,
											...messages
												.filter((m) => same(m.to))
												.map((m) => `${writerText(m.by)}/${m.id}`),
										]),
									];
									if (read.length !== state.read.length) {
										const received = messages.filter(
											(m) => same(m.to) && !state.read.includes(`${writerText(m.by)}/${m.id}`),
										);
										yield* save({...state, read});
										for (const message of received)
											for (const listener of receipts) listener(message.by, message.id);
									}
									return messages;
								}),
							),
					};
				},
			};
		}),
};
export type RoomService = Effect.Success<ReturnType<typeof RoomManager.make>>;
