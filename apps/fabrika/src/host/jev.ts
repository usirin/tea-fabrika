// Jev for the host, for the tracker's duplicate hint. It is on only when the home holds a key.
//
//   <home>/jev.key            the TypeSafe key, one line, put there by the person, mode 0600
//   Layer.build(hostJev(home))
//   // no file: no Jev, so the tracker asks nothing and writes no hint
//   // a file: the live Jev (packages/pipeline/src/jev-live.ts), at most HOST_CAP a host run
//
// A test's home never has the file, so no test can spend, whatever its environment holds. The
// key is read once, kept as a `Redacted`, and goes out only in Jev's request header.

import {type Cap, liveJev} from "@kampus/pipeline/jev-live";
import {Effect, FileSystem, Layer, Path, Redacted} from "effect";
import {FetchHttpClient} from "effect/http";

/** The file in a home that turns Jev on. */
export const JEV_KEY_FILE = "jev.key";

/**
 * The most one host run spends on Jev. A filing asks at most 20 candidates, about 700 tokens
 * each (experiment 167), so 2,000 calls is about 100 filings, and about $0.06.
 */
export const HOST_CAP: Cap = {calls: 2_000, usd: 0.25};

/** Jev, when the home holds a key; nothing, when it does not. */
export const hostJev = (
	home: string,
): Layer.Layer<never, never, FileSystem.FileSystem | Path.Path> =>
	Layer.unwrap(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const file = (yield* Path.Path).join(home, JEV_KEY_FILE);
			const key = (yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""))).trim();
			if (key === "") return Layer.empty;
			return Layer.provide(liveJev(Redacted.make(key), HOST_CAP), FetchHttpClient.layer);
		}),
	);
