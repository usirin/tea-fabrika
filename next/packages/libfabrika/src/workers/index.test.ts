import {expect, it} from "@effect/vitest";
import {Effect} from "effect";
import {workerLoader} from "./index.ts";

const unexpected = () => {
	throw new Error("unknown program reached Worker Loader");
};

it.effect("an unknown program is refused before the Worker Loader is called", () =>
	Effect.gen(function* () {
		const loader = workerLoader({get: unexpected, load: unexpected}, {});
		expect(yield* Effect.flip(loader.load("missing", "process-test"))).toMatchObject({
			_tag: "ProgramDown",
			why: "no_program",
		});
	}),
);
