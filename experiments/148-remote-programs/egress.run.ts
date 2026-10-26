// Experiment 148's egress stack for Alchemy's CLI: `alchemy dev egress.run.ts --stage local`.
// The stack is in stack.ts; egress.ts drives it, on the laptop and on Cloudflare.
import {egressStackOf} from "./stack.ts";

export default egressStackOf();
