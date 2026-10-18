import {runTsh} from "../../../packages/tsh/src/main";
import {refOf} from "../stages/traced";
import {FABRIKA_VIEWING} from "../trace/viewing";
import {programsOf} from "./fabrika-list";

// fabrika's tsh, the one `bin/tsh` and `pnpm tsh` start: tsh handed
// fabrika's programs (./fabrika-list.ts), its trace rules, and a title that
// shows a GitHub ticket or pull request by its number.
process.exitCode = await runTsh({
	list: programsOf(process.env),
	viewing: FABRIKA_VIEWING,
	short: refOf,
});
