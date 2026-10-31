import {entrypoint} from "../../app/entry.ts";
import {counter} from "./program.ts";

// The counter as Worker Loader takes it.
export const Program = entrypoint(counter);

export default {
	fetch: () => new Response("the counter; call its entrypoint"),
};
