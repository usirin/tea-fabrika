import {Shell} from "@kampus/fabrika";
import {acpEntry} from "@kampus/fabrika/agents/acp";
import type {Layer} from "effect";
import type {Ledger} from "../asks/ledger.ts";
import type {Setup} from "../setup.ts";
import type {Config} from "./config.ts";
import {type DeskSession, deskEntries} from "./desk.ts";
import {fabrikaEntries} from "./fabrika.ts";
import {scriptedBuildEntry} from "./scripted-build.ts";

// The programs fabrika's tsh lists (./fabrika-main.ts starts tsh with them).
// tsh itself lists nothing: it is handed this list, made from one
// repository's config (./config.ts). `scripted`, from `TSH_SCRIPTED`: a
// folder, and `build-scripted` is listed, a build that writes nowhere and
// notes what it does there (./scripted-build.ts). For a test. `desk`: the
// owner's desk of this tsh, and `desk`, `desk-demo` and `answer` are listed
// (./desk.ts). `ledger`: the one operate keeps its lanes and leases in, and
// the desk its facts; one in memory when left out. `setup`: the run's picks
// (../setup.ts); left out, every program runs on the config alone.

/** Every program fabrika's tsh lists: the small ones, acp (an ACP client), ship, review, build and operate; the desk's when given one. */
export function programsOf(
	config: Config,
	scripted?: string,
	desk?: DeskSession,
	ledger?: Layer.Layer<Ledger>,
	setup?: Setup,
): Shell.ProgramList {
	return Shell.programList([
		...Shell.SMALL,
		acpEntry,
		...(scripted === undefined || scripted === "" ? [] : [scriptedBuildEntry(scripted)]),
		...fabrikaEntries(config, undefined, undefined, ledger, setup ?? null),
		...(desk === undefined ? [] : deskEntries(desk)),
	]);
}
