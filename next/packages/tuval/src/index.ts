// Tuval, next/ (Tier 1, P14): the window's core. The parent machine, the fixed layout and its local
// fold, key routing, and the React view that reads the run. The page, the style and the browser
// adapter are subpaths.
export {split, tile, type Tree} from "./desktop/layout.ts";
export {mount, startWindow, type TileWindow} from "./window/main.tsx";
