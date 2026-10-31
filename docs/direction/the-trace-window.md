# The trace window: how it looks

**Proposed, 2026-10-30.** How the trace program's window (`programs/trace`) is drawn, and why.
It is the answer to one test: would Linear ship this window as part of a new product?

The whole idea, in one block:

```tsx
// A sketch of src/window.tsx. One tile, two parts, one scroll box.
<section className="trace-view">
	<header className="tr-head">
		<h2>seq --to 3 | tally | trace</h2>
		<p>running · 26 ms · 3 spans · 3 steps</p>   {/* facts, no labels */}
		<Legend />                                   {/* only with two programs or more */}
		<code title={fullId}>81da5aa</code>          {/* short id, full on hover */}
	</header>
	<div className="tr-body peeking">
		<Waterfall />   {/* the rows: name, bar, how long, nothing else */}
		<Peek />        {/* beside it from 880px, under it below; sticky, closes on Esc */}
	</div>
</section>

// The step detail, diff first, as Redux DevTools' Diff tab:
// add 2
// count total · step 2 of 3 · +11 ms
// Changes      /total 1 → 3
// Msg          type "add"
//              n    2
// State after  total 3          (a changed line is marked)
// run tally:9499d113
```

![A step open beside the waterfall, in one tile](../../programs/trace/docs/trace-step-one-tile.png)

## The rules

1. The content leads. No how-to text in the window, no labels the content already says.
2. Sentence case everywhere. No ALL CAPS, no `--` headers.
3. An empty section is not drawn. A section that is always empty says nothing.
4. A value is a tree, one key per line, never raw JSON.
5. A step shows what changed first, then the Msg, then the state after.
6. The detail opens beside the waterfall when there is room, and under it when not.
7. The first read chooses the job, so the tile is never half empty.
8. Color means one thing: which program. Red means one thing: something went wrong.
9. Mono is for typed things only: the command line, ids, paths, keys and values.
10. Keys work without being taught on screen. Esc closes the detail.

## Element by element

| Element | Was | Linear, and the trace tools | Now |
|---|---|---|---|
| Header | Title, then "3 spans · 3 steps · 26 ms", the legend, then `trace <32 chars>` | Honeycomb and Grafana put the root name and the trace id in the header. Linear keeps headers quiet | Title in mono, then the state word in its color and the facts, then the legend, then a 7 character id with the full id on hover |
| Legend | Always drawn, even for one program | Datadog draws one on its flame graph; most tools teach color by the row label | Drawn only with two programs or more. Hidden under 420px |
| Time axis | Ticks plus a header cell that said `name` | Jaeger draws 5 tick labels | At most 5 ticks after 0, first tick `0`. The `name` header is for screen readers only |
| Rows | A note on every row: the run id, `step N` | Linear's "display properties" show only what helps the scan | Notes only where they add something: "3 steps", "1 tool call", "no span" |
| Carets | `▾` and `▸` text glyphs | Linear uses one quiet chevron icon | One svg chevron, turned when open |
| Bars and dots | Bars on a grid, events as dots | Jaeger and Honeycomb: events as small marks on the bar | Kept. Dots are darker on the bar, 4px, so they read on every hue |
| Errors | Red swatch | Honeycomb: red row. Jaeger: small red icon. Grafana: tint plus icon | Red swatch plus the word "error" by the name, so it does not depend on color alone |
| Step detail | Opened inline under the row: a bold header, Msg as JSON, "What changed", state before and after as JSON, "Cmds: None." | Redux DevTools: Action, Diff, State tabs; the Diff shows only changed paths. Elm's debugger: Message and Model trees | Title is the step's name. Sub line: machine, step n of N, time. Changes first, then Msg and State after as trees, the changed lines marked. Cmds only when there are some |
| Changes | Old value struck through | Redux DevTools strikes the old value, then `=>` | Old value muted, not struck, then `→`. A struck `1` read as `±` in the shots. Screen readers hear "became" |
| Span detail | Service and name in one line, then "Tags", "Events: None." | Jaeger: Attributes, Resource, Events as sections; Honeycomb: side panel | Title is the row's name ("tally"); the span's own name goes in the sub line. Job and run facts as a key and value list. Tags and Events only when there are some |
| Where the detail sits | One table row under the chosen row, pushing the rest down | Linear's side peek; Honeycomb and LangSmith side panel; Chrome DevTools and Datadog bottom panel | Beside the waterfall at 880px wide and up, under it below. It stays in sight as the tile scrolls (`position: sticky`) |
| Empty area under the rows | A short waterfall left most of the tile blank, and no detail was chosen | Honeycomb and LangSmith select the root span on open | The first read chooses the job, so its facts fill the side |
| How-to paragraph | "Click a row, or use ↑ ↓ to move..." under the rows | Linear lists keys behind `?`, not in the content | Removed. Keys stay in `aria-keyshortcuts` and the close button's tooltip |
| Empty record | One sentence with the full 32 character id inside it | Linear: short empty states (not verified on an official page) | A centered title, one line, and `trace 7e1a0c3` on its own line, the full id on hover |
| Waiting, reading, unread | One plain sentence each | Same | Same centered shape: "No trace yet", "Reading the record", "This record cannot be read" with its reason, in red |
| Narrow tiles | One layout | Langfuse hides names and labels as the timeline gets small | Under 880px the detail moves under. Under 560px the row notes go. Under 420px the legend goes |
| Status bar `takes id, any` | Drawn by the frame | Linear would not show a type name a person never uses | Not changed here: the bottom line is the frame's (`apps/fabrika/src/window/frame.ts`). See the open questions |

## Why, with sources

- **The content leads.** Linear's 2026 refresh: "not every element of the interface should carry
  equal visual weight", and "structure should be felt not seen".
  [Behind the latest design refresh](https://linear.app/now/behind-the-latest-design-refresh),
  [How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui).
- **Keys behind `?`, not in the content.**
  [Linear's shortcut help](https://linear.app/changelog/2021-03-25-keyboard-shortcuts-help),
  [Navigating Linear](https://linear.app/enablement/guide/navigating-linear).
- **Empty things hidden.** Linear hides empty groups unless asked.
  [Display options](https://linear.app/docs/display-options).
- **Side peek.** Linear's Peek opens a quick look beside a list.
  [Peek](https://linear.app/docs/peek) (read from a search snippet; the page did not load).
  Honeycomb and LangSmith open span detail in a side panel.
  [Honeycomb](https://docs.honeycomb.io/investigate/analyze/explore-traces/),
  [LangSmith](https://docs.langchain.com/langsmith/view-traces.md).
  Chrome DevTools and Datadog put it below.
  [Chrome](https://developer.chrome.com/docs/devtools/performance/reference),
  [Datadog](https://docs.datadoghq.com/tracing/trace_explorer/trace_view/).
  Jaeger offers both.
  [Jaeger's VirtualizedTraceView](https://github.com/jaegertracing/jaeger-ui/blob/main/packages/jaeger-ui/src/components/TracePage/TraceTimelineViewer/VirtualizedTraceView.tsx).
- **Diff first.** Redux DevTools' Diff tab shows only changed paths, and says when nothing
  changed. [JSONDiff.tsx](https://github.com/reduxjs/redux-devtools/blob/main/packages/redux-devtools-inspector-monitor/src/tabs/JSONDiff.tsx).
  Replay marks changed values in place.
  [Replay framework panels](https://docs.replay.io/reference/replay-devtools/framework-panels).
- **Values as trees.** Elm's debugger draws the Msg and the Model as trees, and keeps no diff.
  [Expando.elm](https://github.com/elm/browser/blob/master/src/Debugger/Expando.elm),
  [Main.elm](https://github.com/elm/browser/blob/master/src/Debugger/Main.elm).
- **Five ticks, events as marks.**
  [Jaeger's TimelineHeaderRow](https://github.com/jaegertracing/jaeger-ui/blob/main/packages/jaeger-ui/src/components/TracePage/TraceTimelineViewer/TimelineHeaderRow/TimelineHeaderRow.tsx),
  [Jaeger's SpanBar](https://github.com/jaegertracing/jaeger-ui/blob/main/packages/jaeger-ui/src/components/TracePage/TraceTimelineViewer/SpanBar.tsx).
- **Color by program, red for errors.** Honeycomb colors by service and paints error rows red;
  Grafana tints the row and adds an icon.
  [Honeycomb](https://docs.honeycomb.io/investigate/analyze/explore-traces/),
  [Grafana Tempo](https://grafana.com/docs/grafana/latest/explore/trace-integration/).
- **Hide labels as space goes.** Langfuse's timeline hides names and labels when zoomed out.
  [Langfuse responsive timeline](https://langfuse.com/changelog/2026-08-28-responsive-timeline).

## Where it differs from Linear, and why

- **Mono for the title.** Linear sets titles in Inter Display. Here the title is a command line a
  person typed, so it stays mono, as [popovers.md](./popovers.md) rules for typed things.
- **A legend at all.** Linear has nothing like it. A waterfall's colors need one once there are
  two programs; most trace tools teach it by the row label instead, which is the doubt below.
- **No keycap hints on screen.** Linear shows keycaps in tooltips (seen in the app, not on an
  official page). Here only the close button's tooltip says "Close", and the rest is in
  `aria-keyshortcuts`. The desk has no per-program `?` list yet.
- **Old values not struck.** Redux DevTools strikes them. A struck `1` read as `±` at this size,
  so the old value is muted instead.

## Clashes for the owner

- **tmux and Tuval tiling.** A tile is a tile: the detail never opens a new tile or a popover. It
  lives inside the trace's own tile, beside or under the rows. In 2x2 and side by side tiles the
  detail sits under the rows and needs a scroll to read whole.
- **popovers.md.** That note draws keys with the Mac's glyphs inside popovers, and tmux's
  `C-b a` in the bars. The trace window is neither. It shows no keys, so nothing clashes today;
  a future `?` list for program keys would need to pick one spelling.
- **One scroll box per tile.** The detail stays in sight with `position: sticky`, not a second
  scroll bar, to keep the frame's rule that only the tile scrolls.

## Open questions

- Should `C-b ?` list the focused program's own keys (↑ ↓ ← → Enter Esc)? Yes or no.
- Should the frame hide `any` from the status bar's `takes id, any`? Yes or no.
- Should the legend go, and the swatch by each name teach the color alone? Yes or no.
- In a narrow tile, should the detail cover the rows (as Linear's peek does) instead of sitting
  under them? Yes or no.

## What this cannot tell us

- The Linear details marked "not verified" (keycap tooltips, empty state copy, a sentence case
  rule for section headers) come from using the app, not from an official page.
- The shots cover one small job (`seq --to 3 | tally | trace`). A job with fifty spans, deep
  nesting or a long agent run was not drawn. Row density and the 5 tick axis may not hold there.
- No person has used the window yet. The rules are a read of Linear and the trace tools, not a
  measure of what helps.
- Picking the job first is a change to the machine, not only to the look. It is covered by a law
  (`firstReadShowsTheJob`) but a person may want an empty side on open.
