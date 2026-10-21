// Read the book and the poet's tally. Writes nothing.
import {NodeRuntime} from "@effect/platform-node";
import {layerHttp} from "@tea-fabrika/tea-host/http";
import {getState} from "@tea-fabrika/tea-host/observer";
import {Console, Effect} from "effect";
import {Book, Poet} from "./programs.ts";

const main = Effect.gen(function* () {
	const book = (yield* getState("book", Book)).state;
	const poet = (yield* getState("poet", Poet)).state;
	for (const l of book?.lines ?? []) yield* Console.log(`${l.guest.padEnd(6)}  ${l.line}`);
	yield* Console.log(
		`\n${book?.lines.length ?? 0} lines in the book, ${poet?.written ?? 0} written, $${(poet?.usd ?? 0).toFixed(4)} saved as spent`,
	);
});

NodeRuntime.runMain(
	main.pipe(Effect.provide(layerHttp({url: "http://127.0.0.1:8790", ledger: "teahouse"}))),
);
