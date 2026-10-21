import type {Layer} from "effect";
import {acpEntry} from "../../agents/acp/program.ts";
import {type ProgramList, programList} from "../../shell/programs.ts";
import {SMALL} from "../../shell/small.ts";
import type {Ledger} from "../asks/ledger.ts";
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
// (./desk.ts). `ledger`: the one operate keeps its lanes and claims in; one
// in memory when left out.

/** Every program fabrika's tsh lists: the small ones, acp (an ACP client), ship, review, build and operate; the desk's when given one. */
export function programsOf(
	config: Config,
	scripted?: string,
	desk?: DeskSession,
	ledger?: Layer.Layer<Ledger>,
): ProgramList {
	return programList([
		...SMALL,
		acpEntry,
		...(scripted === undefined || scripted === "" ? [] : [scriptedBuildEntry(scripted)]),
		...fabrikaEntries(config, undefined, undefined, ledger),
		...(desk === undefined ? [] : deskEntries(desk)),
	]);
}
