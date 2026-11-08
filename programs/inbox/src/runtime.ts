import type {Watchable, MessageDelivery, MessageReceipt, MessageRefused} from "@kampus/fabrika-old";
import type {Effect} from "effect";
import {Context} from "effect";
import type {InboxState, InboxMsg} from "./inbox.ts";

export class InboxRuntime extends Context.Service<
	InboxRuntime,
	Watchable<InboxState> & {
		readonly send: (msg: InboxMsg) => Effect.Effect<void>;
		readonly deliver: (
			value: typeof MessageDelivery.Type,
		) => Effect.Effect<MessageReceipt, MessageRefused>;
		readonly open: (row: string | null) => Effect.Effect<void>;
		readonly leave: Effect.Effect<void>;
	}
>()("inbox/Runtime") {}
