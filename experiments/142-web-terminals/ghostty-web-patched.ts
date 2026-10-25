// "ghostty-web-patched" is an esbuild alias, set in the script's build.
import * as ghostty from "ghostty-web-patched";
import {mountWith} from "./ghostty-mount.ts";

// ghostty-web 0.4.0 with ghostty-web-render-on-change.patch: it draws one frame when something
// changed, not on every animation frame. The script applies the patch to a copy in runs/exp-142,
// never to node_modules.
export const mount = mountWith(ghostty);
