import * as ghostty from "ghostty-web";
import {mountWith} from "./ghostty-mount.ts";

// ghostty-web 0.4.0 as published: it draws on every animation frame.
export const mount = mountWith(ghostty);
