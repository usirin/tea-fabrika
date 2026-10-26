// Experiment 148's stack for Alchemy's CLI: `alchemy dev stack.run.ts --stage local`. The stack
// itself is in stack.ts, shared with the driver's live part.
import {stackOf} from "./stack.ts";

export default stackOf({boxes: true});
