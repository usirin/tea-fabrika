import {entrypoint} from "../app/entry.ts";
import {desk} from "./desk.ts";

// The desk as Worker Loader takes it: the desktop's state is a program like any other (W1).
export const Program = entrypoint(desk);

export default {
	fetch: () => new Response("the desk; call its entrypoint"),
};
