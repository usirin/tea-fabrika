# Artifacts

**Proposed 2026-11-01.** Nothing is decided yet. Decided before this study: an artifact is like
Claude's artifacts, one page an agent writes, shown beside the work; and the first one is built
on today's program API.

Built from [experiment 188](../../experiments/188-artifacts.md), which read how about fifteen
makers and two specs show a page someone else wrote and checked today's markdown tile against
them, and a private page, "Artifact guidelines". Neither is a measurement, except one probe in
the experiment that ran the frame in the app's own Electron. It answers the question
[the GUI is an Electron app first](./the-gui-is-electron-first.md) left for "the first such
window": "A window someone else wrote may need its own sandboxed frame".

```ts
// A sketch, today's version (programs/artifact): the markdown program's shape, told a page.
export const Page = Schema.Struct({
	title: Schema.String, // the page's own <title>; the frame's title too (WCAG H64)
	html: Schema.String, // the whole page, one file, at most 16 MiB
	version: Schema.Number, // 1, 2, 3: one per publish
});
const Publish = Schema.Struct({
	html: Schema.String,
	on: Schema.NullOr(Schema.Number), // the version it was built on; null for the first
});

export const artifact = defineProgram({
	name: "artifact",
	description: "Shows one page an agent wrote, in a sandboxed frame of its own. Each publish is a version.",
	flags: {html: flag(Schema.UndefinedOr(Schema.String), "A page to show first.")},
	inputs: {
		publish: input(Publish, "A new version: it shows in place, or is refused if built on an old one."),
		quit: input(Schema.Struct({}), "The window quits: the program ends."),
	},
	outputs: {},
	machines: {pages: kind({machine: pages, state: Pages /* every version, and the last refusal */})},
	view: {machine: "pages", data: Page, of: (s) => s.versions[s.versions.length - 1]},
	main: /* as markdown's: serve publish and quit until quit */,
});
```

```text
one publish traced, then a stale one, then the prefix
artifact_publish {html, on: null}   the run's update        version 1 kept; the view is {title, html, version: 1}
                                    the host                 the view goes to the page on run:artifact:1a2b
                                    the desk                 <iframe sandbox="allow-scripts" title="Deploy failures"
                                                              src="fabrika-artifact://shell/">
                                    the shell                says ready; the desk posts {type: "page", html, tokens};
                                                              the shell writes it in
artifact_publish {html, on: 1}      the run's update        version 2; the desk loads the shell again and posts it
artifact_publish {html, on: 1}      the run's update        refused: built on 1, the page is at 2; nothing changes
ctrl+b l, focus in the frame        the shell                sends {type: "key", keys: "ctrl+b"}; the desk's prefix runs
the status region says              "Deploy failures, version 2"
```

`artifact_publish` is the input's MCP name, by the rule in
[tracker views are programs](./tracker-views-are-programs.md): "MCP tool names follow from input
names".

## Which version

- **Today's version (`programs/`, `apps/fabrika`):** first, as asked. One new program,
  `programs/artifact`, and three small changes to the app: a second scheme with one static shell
  page, one word in the desk's policy, and the window listed. See
  [a tryout in today's version](#a-tryout-in-todays-version).
- **`next/`:** the same principles. The plan has "pages that run code in a box" in Tier 7
  ([the tiers](../plan/tiers.md)); where it lands now is [call C1](#c1-which-tier-in-next).

## The shape

### One program, one shell page, one scheme

```ts
// A sketch, today's version (apps/fabrika/src/files.ts). The shell's policy, its own.
export const ARTIFACT = "fabrika-artifact"; // a second scheme, standard and secure, as `fabrika`
export const SHELL_CSP =
	"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; " +
	"font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"; // plus C2's script hosts
// The desk's policy gains one directive: frame-src fabrika-artifact:
```

```ts
// A sketch: what the desk and the shell say to each other, read by a schema at both ends.
type ToShell = {type: "page"; html: string; tokens: Record<string, string>} // tokens: A6
	| {type: "theme"; tokens: Record<string, string>};
type FromShell = {type: "ready"} | {type: "key"; keys: string} // keys: A7
	| {type: "drew"; title: string} | {type: "failed"; why: string};
```

- **The page travels in the view,** as markdown's text does. Main serves only the shell, a static
  file, so it stays a thin relay and holds no page.
- **The frame's origin is opaque.** The sandbox has `allow-scripts` and never
  `allow-same-origin`. In the probe the desk saw a message's origin as `"null"`, and the page's
  `localStorage` threw.
- **Checked by the probe** in experiment 188, on Electron 45.2.1: the page's script ran, and
  `parent.document`, `top` navigation, `fetch` and a script from an unlisted host were all
  blocked. Not checked: the types above, and the keys.

## The seven principles

### A1: one page, told whole

**Lean, 85%.**

- **What it means.** An artifact is one self-contained HTML file: its CSS and script inside it,
  images as data URIs. It has no backend and no second file. Each publish sends the whole page.
- **Why.** Claude: "An artifact is a capture of work: one self-contained page with no backend, so
  it can't serve multiple routes." Relative links "do not resolve, because nothing is deployed
  alongside the page."
- **Linear.** "Simple first, then powerful." One shape, nothing to set up.
- **Elm.** The page is data in the model, and the view hands it on, as markdown's tree.
- **What holds it.** `Page` has one `html` string; the shell has no path to serve but itself, so a
  relative link finds nothing.
- **Doubt.** A page that wants a big data file beside it. Settled by the first real page that
  needs one; until then it inlines or summarises, as Claude asks.
- **Cost.** A page is sent whole on every publish, up to 16 MiB through the link.
- **Today.** Markdown follows: each text told replaces the one shown
  (`programs/markdown/src/index.ts:28`).

### A2: its own origin, never the desk's

**Lean, 90%.**

- **What it means.** A page runs in `<iframe sandbox="allow-scripts">` on the `fabrika-artifact`
  scheme, never as `srcdoc`, a `blob:` URL or markup in the desk.
- **Why.** HTML 7.1.7: a `srcdoc` frame gets "a clone of parentPolicyContainer", so under the
  desk's `script-src 'self'` its script never runs; the probe saw exactly that. Every maker that
  runs foreign script puts it on another origin: Claude on `*.claudeusercontent.com`, Observable
  "on a per-user domain", CodePen or it is "one massive XSS". web.dev: with `allow-scripts` and
  `allow-same-origin` together, "the framed page can reach up into the parent, and remove the
  sandbox attribute entirely."
- **Linear.** No Linear answer: Linear runs no one else's page.
- **Elm.** Elm keeps JavaScript behind ports, outside the program. The frame is that outside.
- **What holds it.** The desk's policy allows frames only from `fabrika-artifact:`; a test reads
  the frame's `sandbox` attribute and fails on `allow-same-origin`; main still answers a hello
  only from the top frame (`apps/fabrika/src/main.ts:218`), as Electron asks: "validating the
  `sender` of **all** IPC messages".
- **Doubt.** Electron with a custom scheme in a sandboxed frame: the probe ran it once, outside
  the app. The app's e2e settles it.
- **Cost.** One scheme, one static file, one directive.
- **Today.** No frame anywhere in the app. Markdown needs none: it runs no script
  (`programs/markdown/README.md:42`).

### A3: closed by default; anything more is declared

**Lean, 80%.**

- **What it means.** A page reaches nothing: no network (`connect-src 'none'`), no storage that
  lasts, no downloads, no new window. A link goes to the person's own browser by the app's one way
  out. Anything more, such as live data or a file to save, is a field the program declares, and
  the desk does the call for the page.
- **Why.** Claude: "the page can't call connectors outside that declaration", "The page never sees
  anyone's credentials", and "The page can't start a download itself." Figma's storage is "not
  security". ChatGPT's widget state is not "durable storage".
- **Linear.** No Linear answer on sandboxes. Its zero-bugs rule says a blocked call that breaks a
  page is a bug to fix, not to hide.
- **Elm.** A program has no effects but the Cmds its runtime runs. A page has none but the ones
  declared.
- **What holds it.** The shell's policy; `localStorage` throws in an opaque origin (probe); main's
  guard refuses every navigation and window (`apps/fabrika/src/main.ts:146`).
- **Doubt.** Which script hosts to allow: [call C2](#c2-script-hosts).
- **Cost.** A page that fetches its own data does not work. An agent puts the data in the page.
- **Today.** Markdown follows: it reaches nothing, and a link goes out through main
  (`programs/markdown/src/window.tsx:79`).

### A4: one channel, typed at both ends

**Lean, 75%.**

- **What it means.** The desk and the shell talk only by `postMessage`, and each side reads every
  message with a schema (`ToShell`, `FromShell`), as the app reads every other message
  (`apps/fabrika/src/messages.ts`). The desk takes a message only when its `source` is that
  frame's window, never by origin, since the origin is `"null"`. The page reaches the program
  only through the program's own inputs.
- **Why.** web.dev: "the parent document can broker communication between them by posting
  messages". VS Code: "An extension can send data to its webviews using
  `webview.postMessage()`." ChatGPT: "JSON-RPC over `postMessage`".
- **Linear.** No Linear answer.
- **Elm.** Ports: a typed message in, a typed message out, decoded before update sees it.
- **What holds it.** The schemas; a test that posts a message from another frame and sees it
  dropped.
- **Doubt.** Whether a page should send the program anything of its own in the first version.
  The lean is no: only `ready`, `drew`, `failed` and `key`.
- **Cost.** A page cannot answer back, as Claude's "Copy as prompt" does, until a declared input
  is added.
- **Today.** Markdown follows: its window sends only `quit`
  (`programs/markdown/src/window.tsx:17`).

### A5: every publish is a version

**Lean, 70%.**

- **What it means.** A publish adds a version and the newest shows in place, in the same tile. A
  publish built on an older version is refused, and says which version it lost to. A person can
  step back through the versions.
- **Why.** Claude: "Each publish becomes a version", "Anyone with the page open sees the update in
  place", and "Claude Code refuses a publish built on that copy." Tier 1 already plans "each
  note's saved versions, with a check against stale saves" ([the tiers](../plan/tiers.md)).
  None of the other makers read for this study documents versions.
- **Linear.** "If you've designed your operations to move fast and learn, then you can correct
  or revert decisions" (Linear Method, "Building with momentum"). A version makes a bold publish
  cheap.
- **Elm.** The model keeps the list; `publish` with a stale `on` returns the same model and a
  refusal.
- **What holds it.** `on` in `Publish`; a law test: for any order of publishes, the shown version
  is the last one taken, and a stale one changes nothing.
- **Doubt.** Where versions live: [call C3](#c3-where-versions-live).
- **Cost.** Every version kept in the run, in memory, until it ends.
- **Today.** Markdown breaks it: each text replaces the last and nothing is kept
  (`programs/markdown/src/index.ts:28`).

### A6: the app's tokens, pushed in

**Lean, 75%.**

- **What it means.** The desk sends the shell the app's tokens, resolved to values, with every
  page and again on every theme change. The shell sets them on the page's `:root` before the page
  draws. A page draws with `var(--surface)`, `var(--text-primary)` and the rest, and sets no theme
  of its own.
- **Why.** Figma: "the CSS variables in the plugin iframe will dynamically update with new color
  values." ChatGPT: makers "should not redefine system colors." Claude: "Claude treats your design
  system as higher precedence than its own choices". The themes note: "A program never sees a
  theme file and never sets a theme" ([people bring their own themes](./themes.md), section 3).
- **Linear.** "One small thing that you won't see or think about but will hopefully feel": a page
  that ignores the theme looks like a hole in the desk.
- **Elm.** The window is the parent and holds the theme, as the themes note says; the frame is a
  child that gets it.
- **What holds it.** A test that changes the theme and reads a token inside the frame. A page
  that sets its own colors is not refused; the agent's instructions ask it not to.
- **Doubt.** A frame cannot read the desk's CSS, so the tokens go as values. Settled by the first
  theme switch with a page open.
- **Cost.** One more message on a theme change.
- **Today.** Markdown is half: the page is drawn in the app's tokens, and code blocks keep GitHub's
  dark dimmed colors (`programs/markdown/README.md`, "The theme is GitHub's dark dimmed").

### A7: the desk's keys and a screen reader still work

**Lean, 70%.**

- **What it means.** The frame's title is the page's own `<title>`. The desk's prefix keys work
  with focus inside the page: the shell sends `ctrl+b` and the key after it to the desk, which
  runs them as if typed on the desk. A person can always leave the page by the keyboard alone.
- **Why.** WCAG H64: a frame's title is "a label for the frame so users can determine which frame
  to enter". WCAG 2.1.2: focus is not trapped "when the user can navigate away from a component
  using only a keyboard interface". Linear: "You can take almost every action in Linear without
  lifting your fingers off of the keyboard".
- **Elm.** The keys are a subscription of the desk; the shell is one more source of them.
- **What holds it.** An e2e step: focus in a page, `ctrl+b l`, and focus moves to the next tile.
- **Doubt.** The probe could not put focus inside the frame, so whether a key typed there reaches
  the desk on its own is not measured. The lean assumes it does not. The e2e step settles it.
- **Cost.** The shell listens for keys, so it must never send a key the desk does not take.
- **Today.** Markdown follows, with no frame: its keys are its own window's (`q`, `j`, `k`).

## The smaller calls

### C1: which tier in `next/`

**No lean, the owner picks.** The plan has it in Tier 7, beside other people's programs. Today's
version gets it now either way.

```text
Tier 2   with the first programs, beside markdown notes
Tier 5   with the agents that write the pages
Tier 7   as planned
```

### C2: script hosts

**Lean, 60%: Claude's five.** A page written for claude.ai then runs here unchanged.

```text
none        inline script only; an agent inlines every library
Claude's    cdnjs, unpkg, jsDelivr /npm/, Tailwind, jQuery (lean)
```

Doubt: the app works offline, and a CDN sees each open. The first page that fails offline settles
it.

### C3: where versions live

**Lean, 65%: in the run today, on the ledger in `next/`.**

```text
the run      lost when the run ends (today, lean)
the ledger   a fact per publish, the page by hash in Blobs ("Today it exists only in notes")
```

### C4: the word

**Lean, 70%: `artifact`.** Linear: "Don't invent terms if possible". People know Claude's word.
The clash: [experiments behind a service](./experiments-behind-a-service.md) uses "artifacts" for
big files a run logs, MLflow's sense. `page` is the other choice.

### C5: one shell origin, or one per page

**Lean, 80%: one.** The sandbox already makes each frame opaque, so two pages share no storage
or cookies. web.dev's per-content site guards those, and an opaque frame has none.

### C6: markdown artifacts

**Lean, 85%: no.** Claude takes `.md` too, but the `markdown` program already draws it, safely,
with no script.

## What the ledger records

Nothing new in today's version. The fact lost: who published which version, and when. In `next/`
the lean is one fact per publish, `{type: "published", version, page: <hash>}`, written by the
agent's key.

## A tryout in today's version

Offered, not filed.

```text
programs/artifact          the program, its window, README, tests         about 250 lines
apps/fabrika/src/files.ts  the scheme, the shell page, its policy          about 40 lines
apps/fabrika/src/main.ts   register and handle the scheme                  about 10 lines
apps/fabrika/src/window    list it in windows.tsx; frame-src in DESK_CSP   about 5 lines
apps/fabrika/e2e.ts        a page drawn, a stale publish, ctrl+b l in it   about 60 lines
```

About 370 lines and 4 to 6 agent hours, a guess at 50%.

## Where this differs from settled notes

- **The tiers** put "pages that run code in a box" in Tier 7. This puts it in today's version now,
  and asks where in `next/` (C1).
- **The GUI is an Electron app first** said a foreign window "may need its own sandboxed frame".
  This says it does, and how.
- **Experiments behind a service** uses "artifacts" for logged files (C4).

## What it costs

About 370 lines in today's version. Each page is sent whole, up to 16 MiB, on every publish. One
more scheme for the app's security review to cover.

## What it cannot tell us

- Whether a key typed in the frame reaches the desk. Not measured.
- How a screen reader reads a page in a frame. No screen reader ran.
- Speed, for a big page through the view and the frame. Nothing was timed.
- What a real agent's page needs. No agent wrote one for this study; the first one will show.
