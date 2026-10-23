// tsh with the small programs and `acp`, for packages/fabrika/src/agents/acp/kill.test.ts. Since
// experiment 114 fabrika's own bin lists the small programs alone, and the pipeline's lists its
// whole suite; this test needs neither, only `acp` in a real tsh it can kill. It is also the
// smallest app on fabrika's public names: a list, handed to `runTsh` as its `Programs`.
//
//   node fixtures/acp-tsh/tsh.ts --json -c 'acp --agent fake --folder <dir> ...'
import {Shell} from "@kampus/fabrika";
import {acpEntry} from "@kampus/fabrika/agents/acp";
import {runTsh} from "@kampus/fabrika/shell";
import {Effect} from "effect";

const programs = Shell.programList([...Shell.SMALL, acpEntry]);
process.exitCode = await Effect.runPromise(
	runTsh().pipe(Effect.provideService(Shell.Programs, programs)),
);
