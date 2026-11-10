import {Ledger, streams} from "@kampus/fabrika-old";
import {Effect, Schema} from "effect";
import {LayerReport} from "../window/layers.ts";

/** Today's host binds the writer and connected window, never accepting either from the page. */
export const LayerRecorder = {
	make: Effect.fnUntraced(function* (from: {readonly window: string; readonly by: string}) {
		const ledger = yield* Ledger;
		const name = `window/${from.window}/layers`;
		const inbox = streams(name).inbox;
		const active = new Map<string, LayerReport["change"]["layer"]>();
		const seen = new Set<string>();
		// The caller retries unreachable writes with the original event ID. Never log an error body:
		// a transport failure can quote private input even when the event itself is clean.
		const failed = () => Effect.logWarning("fabrika host: layer recording failed");
		const record = Effect.fnUntraced(function* (report: LayerReport) {
			const fact = yield* Schema.decodeUnknownEffect(LayerReport)(report, {
				onExcessProperty: "error",
			}).pipe(Effect.tapError(failed));
			if (seen.has(fact.id)) return;
			yield* ledger.register(name, from.by).pipe(Effect.tapError(failed));
			yield* ledger
				.send(inbox, fact.id, {
					kind: "layer",
					writer: from.by,
					data: {
						window: from.window,
						instance: fact.instance,
						said: fact.said,
						change: fact.change,
					},
				})
				.pipe(Effect.tapError(failed));
			seen.add(fact.id);
			if (fact.change._tag === "open") active.set(fact.instance, fact.change.layer);
			else active.delete(fact.instance);
		});
		const ended = Effect.fnUntraced(function* () {
			// An ended interval has no observed close reason or writer clock. Say that explicitly.
			for (const [instance, layer] of active) {
				yield* ledger
					.send(inbox, `uncertain/${from.window}/${instance}`, {
						kind: "layer",
						writer: from.by,
						data: {window: from.window, instance, said: null, state: "uncertain", layer},
					})
					.pipe(Effect.tapError(failed));
				active.delete(instance);
			}
		});
		return {record, ended};
	}),
};
