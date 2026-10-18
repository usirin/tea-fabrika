import {runTsh} from "../../../packages/tsh/src/main.ts";
import {refOf} from "../stages/traced.ts";
import {FABRIKA_VIEWING} from "../trace/viewing.ts";
import {programsOf} from "./fabrika-list.ts";

// fabrika's tsh, the one `bin/tsh` and `pnpm tsh` start: tsh handed
// fabrika's programs (./fabrika-list.ts), its trace rules, and a title that
// shows a GitHub ticket or pull request by its number.
process.exitCode = await runTsh({
	list: programsOf(process.env),
	viewing: FABRIKA_VIEWING,
	short: refOf,
});
