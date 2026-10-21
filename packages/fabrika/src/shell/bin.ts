import {runTsh} from "./main.ts";
import {programList} from "./programs.ts";
import {SMALL} from "./small.ts";

// tsh with the small programs alone (./small.ts): a shell with its own
// coreutils and nothing else. A suite of programs ships its own bin that hands
// tsh its list instead.
process.exitCode = await runTsh({list: programList(SMALL)});
