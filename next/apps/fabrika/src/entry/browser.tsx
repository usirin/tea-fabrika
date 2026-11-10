// The browser entry, next/ (Tier 1, P14). It only chooses: the layout, the browser services, the
// view registrations and where to mount. Tuval boots the window outside React; React reads it.
import {Id} from "@kampus/libfabrika";
import {mount} from "@kampus/tuval";
import {startWindow, WindowKey} from "@kampus/tuval/browser";
import {Effect, Layer} from "effect";
import {checks, ctx, layoutFor, windowFor} from "./views.ts";

const window = Effect.gen(function* () {
	const layout = layoutFor(new URLSearchParams(location.search).get("layout"));
	const booting = yield* startWindow({layout, ctx, checks, label: "Browser"});
	const live = yield* booting.ready;
	const root = document.getElementById("root");
	if (root === null) return;
	yield* mount(root, {run: live, layout, windowFor, origin: location.origin});
	return yield* Effect.never;
});

// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the page's one script starts the window and keeps it for the tab's life
Effect.runFork(
	Effect.scoped(window).pipe(Effect.provide(Layer.mergeAll(WindowKey.layer, Id.Generator.layer))),
);
