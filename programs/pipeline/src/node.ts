import {existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {Ledger, type Writer} from "@kampus/fabrika-old";
import {laneLayer, runLane} from "@kampus/pipeline/stages/pipeline/layer";
import {Effect, Layer} from "effect";
import {LaneRunner} from "./index.ts";

// `@tea-fabrika/pipeline/node`: a lane on this machine, in the host's process.
//
//   <home>/pipeline.json   the repository, its remote and which host, read when a lane starts
//   briefs                 the plain files of ../briefs; a bundle keeps its copy beside itself
//   person                 who typed the line: its ticket must be theirs, and the lane writes for them
//
// A home that has no such file refuses the lane, in the tile, and nothing else changes.

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** What is beside the bundle, or else what is beside this file. */
const briefsFolder = () => (existsSync(here("./briefs")) ? here("./briefs") : here("../briefs"));

/** The ignorer as the app's bundle holds it. `undefined`: not bundled, so the step's own default. */
const ignorerFile = () => (existsSync(here("./ignorer.mjs")) ? here("./ignorer.mjs") : undefined);

/** Whoever a writer writes for: its person, or itself when it has none. */
const personOf = (writer: Writer): string => ("for" in writer ? writer.for : writer.id);

/**
 * Runs lanes from the home the host was started on, for `writer`. Each lane gets its own services,
 * made for that run: a lane's step and spend belong to it alone.
 */
export const laneRunner = (writer: Writer): Layer.Layer<LaneRunner, never, Ledger> =>
	Layer.effect(
		LaneRunner,
		Effect.gen(function* () {
			const ledger = yield* Ledger;
			return {
				run: (n, say) =>
					Effect.gen(function* () {
						const home = process.env.FABRIKA_HOME;
						if (home === undefined || home === "") {
							yield* say("pipeline runs in the app: this host was started on no home.");
							return;
						}
						const ignorer = ignorerFile();
						yield* runLane(n, say).pipe(
							Effect.provide(
								laneLayer({
									home,
									briefs: briefsFolder(),
									person: personOf(writer),
									...(ignorer === undefined ? {} : {ignorer}),
								}),
							),
							Effect.provideService(Ledger, ledger),
						);
					}),
			};
		}),
	);
