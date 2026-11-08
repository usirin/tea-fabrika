// Today's real-app exam. A missing cell is a failure, never a successful partial capture.
export const states = ["empty", "glance-open", "glance-reply", "reply-failed", "inbox-tile", "look-open", "ask-answering", "stop-selected", "long-content", "long-list-later", "tracker-glance", "host-reconnect"] as const;
export const layouts = ["one", "side", "stacked", "2x2", "small", "small-side", "small-stacked", "small-2x2", "text-200", "minimum", "reflow-320"] as const;
export const looks = ["dark", "light"] as const;
export type State = typeof states[number];
export type Layout = typeof layouts[number];
export type Look = typeof looks[number];
export const shotName = (state: State, layout: Layout, look: Look) => `${state}-${layout}-${look}.png`;
export const cells = layouts.flatMap((layout) => looks.flatMap((look) => states.map((state) => shotName(state, layout, look))));
