import {type ProgramList, programList} from "@tea-fabrika/tsh/programs";
import {SMALL} from "@tea-fabrika/tsh/small";
import {acpEntry} from "../agents/acp/program.ts";
import type {Config} from "./config.ts";
import {fabrikaEntries} from "./fabrika.ts";
import {scriptedBuildEntry} from "./scripted-build.ts";

// The programs fabrika's tsh lists (./fabrika-main.ts starts tsh with them).
// tsh itself lists nothing: it is handed this list, made from one
// repository's config (./config.ts). `scripted`, from `TSH_SCRIPTED`: a
// folder, and `build-scripted` is listed, a build that writes nowhere and
// notes what it does there (./scripted-build.ts). For a test.

/** Every program fabrika's tsh lists: the small ones, acp (an ACP client), ship, review, build and operate. */
export function programsOf(config: Config, scripted?: string): ProgramList {
	return programList([
		...SMALL,
		acpEntry,
		...(scripted === undefined || scripted === "" ? [] : [scriptedBuildEntry(scripted)]),
		...fabrikaEntries(config),
	]);
}
