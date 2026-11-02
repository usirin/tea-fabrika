# How do makers show a page someone else wrote, and what does today's markdown tile teach?

Read 2026-11-01. **This is reading, plus one probe.** The probe ran a desk page and a sandboxed
frame in the app's own Electron (45.2.1, on a Mac), outside the app; its script is
[`188-artifacts/probe.mjs`](./188-artifacts/probe.mjs) and its answers are in
[`results/188-artifacts.json`](./results/188-artifacts.json). Everything else is what public
docs, two specs and today's code say. It feeds [artifacts](../docs/direction/artifacts.md), a
proposed note, and a private page, "Artifact guidelines".

**The answer.** The makers agree. A page someone else wrote never runs in the host's own origin:
it runs in a frame of its own, sandboxed, under a strict policy. It talks to the host through one
message channel. It draws with the host's colors, which the host pushes in. Claude's artifacts do
exactly this, on a separate domain, and so do VS Code, Figma, ChatGPT's apps, Observable, GitHub
and CodePen. The probe showed today's app can do it too, with one more scheme and one line in
the desk's policy, and it showed the easy way, a `srcdoc` frame, cannot work: the frame takes the
desk's policy, and the page's own script never runs. Today's markdown tile, the closest thing the
app has, follows half of this and has no answer for the rest:

- **It follows:** what it is told replaces what it shows; it reaches nothing outside; a link goes
  to the person's own browser; it draws with the app's tokens.
- **It cannot do:** run a page's own script, since it is safe by drawing React elements only; keep
  any earlier text, since each one replaces the last.

```text
how each tool shows a page someone else wrote, one line each
Claude      one self-contained page, a sandboxed *.claudeusercontent.com origin, a strict CSP, versions
VS Code     a webview: "isolated contexts", scripts off by default, postMessage, theme as CSS variables
Figma       a "null origin iframe", postMessage, --figma-color-* variables that update live
ChatGPT     a "double-nested iframe" on a sandbox subdomain, JSON-RPC over postMessage, a theme signal
Observable  "a sandboxed iframe running on a per-user domain"
GitHub      Mermaid in an iframe on its Viewscreen service; a notebook as static HTML, no script
CodePen     previews on another domain, or it is "one massive XSS"
Jupyter     no frame: script output hidden until the person trusts the notebook
Raycast     no HTML at all: declared React parts, drawn natively
Obsidian    no sandbox: "Community plugins can access files on your computer"
Linear      no answer on sandboxes; on AI: "AI doesn't replace the workbench"
```

Which version: the tools are outside the repo. "Today's code" means today's version
(`apps/fabrika` and `programs/`, on main). The sketches in the note are for both: today's version
first, as asked, and `next/` after.

## What was read

About 45 public pages, two specs (HTML and CSP 3), seven files of today's code and four
direction notes. Quotes are short and checked against the page as fetched. A claim found only on
a secondary page is marked **secondary**. One found nowhere is marked **not found**. Two research
agents read most of the makers' pages; every quote the note leans on was checked again by hand
(see "What it cannot tell us").

## The page someone else wrote

- **Claude Code's artifacts.** "An artifact is a capture of work: one self-contained page with no
  backend, so it can't serve multiple routes." It is served "under a strict Content Security
  Policy (CSP)", and "The viewer on claude.ai loads each artifact from a sandboxed
  `*.claudeusercontent.com` origin." Its fetches reach "only the page's own origin and the Google
  Fonts hosts"; scripts come from five CDN hosts; "The page can't start a download itself"; 16
  MiB at most. "Each publish becomes a version", "Anyone with the page open sees the update in
  place", and a publish built on an older copy is refused: "Claude Code refuses a publish built
  on that copy." "A new artifact is visible only to you." What a page may call is declared: "the
  page can't call connectors outside that declaration", and "The page never sees anyone's
  credentials". On design: "Claude treats your design system as higher precedence than its own
  choices". [a1]
- **Claude's own help page.** "An artifact is anything Claude makes for you that you'd put in
  front of someone." Claude makes one when it is "significant and self-contained, typically over
  15 lines." [a2]
- **VS Code webviews.** "Webviews run in isolated contexts that cannot directly access local
  resources." "JavaScript is disabled in webviews by default". "An extension can send data to its
  webviews using `webview.postMessage()`." VS Code "adds a special class to the `body` element"
  for light and dark, and theme colors come in as CSS variables. [v1]
- **Figma plugins.** "your plugin UI lives inside a null origin iframe". "A `figma-light` or
  `figma-dark` class will be added to the `<html>` element in the iframe content", and with
  `themeColors: true` "the CSS variables in the plugin iframe will dynamically update with new
  color values." Its storage is "stored privately for stability, not security." [s1] [s2] [s4]
- **ChatGPT's apps.** "Widgets run inside an isolated iframe with a strict Content Security
  Policy." "OpenAI renders Apps inside a double-nested iframe." It talks "through the MCP Apps
  bridge (JSON-RPC over `postMessage`)". Its widget state is not "durable storage". Makers "should
  not redefine system colors." [s5] [s6] [s8] [s9]
- **Observable.** "the Observable sandbox is implemented as a sandboxed iframe running on a
  per-user domain", which "prevents notebook code from accessing your session credentials". [s10]
- **GitHub.** For Mermaid, "we inject an iframe into the page, pointing the `src` attribute to the
  Viewscreen service": "User-supplied content is locked away in an iframe". A notebook's
  "custom JavaScript plots, will not work in your repository on GitHub." The domain it uses is
  **not found** in a first-party page. [s11] [s12] [s13]
- **CodePen.** "If we were executing the code you write on codepen.io itself, that's essentially
  one massive XSS vulnerability." [s16]
- **Jupyter**, the other way: trust, not a frame. It stores "a signature of each trusted
  notebook", and "Javascript and HTML output will not be displayed until they are regenerated".
  [s14]
- **Raycast**, the opposite choice: "everything is rendered natively in Raycast. There isn't any
  HTML or CSS involved." "Think of it as a design system." [s17] [s18]
- **Obsidian**, no sandbox: "Obsidian cannot reliably restrict plugins to specific permissions or
  access levels." [s19]
- **Versions of a foreign page:** **not found** in any of the ten makers above but Claude.

## The web's own rules

- **HTML, 7.1.7 Policy containers.** For a frame's `about:srcdoc` document: "Return a clone of
  parentPolicyContainer." For a `blob:` URL: "a clone of response's URL's blob URL entry's
  environment's policy container." So a page put in by `srcdoc` or a blob takes the desk's own
  policy. [h1]
- **web.dev, sandboxed iframes.** "The framed document is loaded into a unique origin, which means
  that all same-origin checks will fail." With both `allow-scripts` and `allow-same-origin` on a
  same-origin frame, "the framed page can reach up into the parent, and remove the sandbox
  attribute entirely." "the parent document can broker communication between them by posting
  messages". [s20]
- **web.dev, hosting user data.** "While user content is isolated from the main site, it isn't
  isolated from other user content." A unique site per piece of content fixes that. [s21]
- **Electron's checklist.** "You should enable the sandbox in all renderers." "You should be
  validating the `sender` of **all** IPC messages by default", since "All Web Frames can in
  theory send IPC messages to the main process, including iframes". "You should serve local pages
  from a custom protocol instead of the `file://` protocol." [e1]
- **WCAG 2.2.** H64: a frame's title is "a label for the frame so users can determine which frame
  to enter". 2.1.2: "Keyboard focus is not considered trapped when the user can navigate away from
  a component using only a keyboard interface". [s22] [s24]

## How Linear builds

Linear has no page on sandboxes. What bears on an artifact is how it builds anything:

| Linear says | For an artifact |
|---|---|
| "AI doesn't replace the workbench, it's a powerful new tool to place on top of it." "Humans stay in the loop" [l1] | The page sits beside the work, in a tile; a person reads it |
| "A chat interface is a very weak and generic form." [l1] | An agent shows a page, not a long answer |
| "You can take almost every action in Linear without lifting your fingers off of the keyboard" [l2] | The desk's keys keep working inside a page |
| "we eliminated the option of sending bugs to the backlog." [l3] | A page that does not draw is a bug, with the frame's own error shown |
| "Simple first, then powerful" [l4] | One page, one shape, no settings |
| "Don't invent terms if possible" [l4] | Use the word people know: artifact |
| "Design projects so that they can be completed in 1–3 weeks" [l5] | Draw, then versions, then the theme pushed live: three steps |
| "We consider speed a core feature of the product" [l6] | A new version shows in place, with no flash |

## Today's markdown tile

The closest thing today's app has: a program told text, drawn in a tile.

| What | Today | Where |
|---|---|---|
| What it is told | a markdown text on input `text`, or flag `--text` | `programs/markdown/src/index.ts:42` |
| A new text | replaces the one shown; nothing earlier is kept | `programs/markdown/src/index.ts:28` |
| Its view | the text read into a tree, read again by the window's schema | `programs/markdown/src/index.ts:57`, `apps/fabrika/src/window/windows.tsx:46` |
| Safe how | "Safe by its shape, not by cleaning a string": React elements, raw HTML left out | `programs/markdown/README.md:42` |
| A link | `target="_blank"`: main refuses the window, an http or https URL goes to the browser | `programs/markdown/src/window.tsx:79`, `apps/fabrika/src/main.ts:149` |
| The desk's policy | `script-src 'self' 'wasm-unsafe-eval'`, nothing else, no frame | `apps/fabrika/src/files.ts:33` |
| Frames in the app | none: no `iframe`, no `srcdoc`, no `dangerouslySetInnerHTML` anywhere | a search of `apps/`, `programs/`, `packages/` |
| The window | sandboxed, context isolation, every way out refused, hello only from the top frame | `apps/fabrika/src/main.ts:146`, `:197`, `:218` |
| What the plan said | "A window someone else wrote may need its own sandboxed frame, as VS Code does with its webviews" | `docs/direction/the-gui-is-electron-first.md:134` |

The same tile, checked against the note's seven principles:

| Principle | Today's markdown tile |
|---|---|
| A1 one page, told whole | follows: each text told replaces the one shown |
| A2 its own origin | has no answer: it runs no script, so it needs none |
| A3 closed, and declared | follows: it reaches nothing; a link goes out through main |
| A4 one typed channel | follows: its window sends only `quit` |
| A5 every publish a version | breaks: each text replaces the last, and nothing is kept |
| A6 the app's tokens | half: the page is in the app's tokens; code blocks keep GitHub's dark dimmed colors |
| A7 keys and a screen reader | follows, with no frame: `q`, `j`, `k` go to its own window |

## The probe

A desk page with today's policy plus `frame-src fabrika-artifact:`, and one static shell page on
a second scheme, `fabrika-artifact://shell/`, under its own policy (`script-src 'unsafe-inline'
https://cdnjs.cloudflare.com; connect-src 'none'`). The desk loads the shell in
`<iframe sandbox="allow-scripts">` and posts an agent's page to it; the shell writes it in.

| Asked | Answer |
|---|---|
| The page's own inline script runs | yes |
| It reads `parent.document` | blocked |
| It moves the top window | blocked |
| `fetch` to the web | blocked by `connect-src 'none'` |
| A script from a host not listed | blocked |
| `localStorage` | throws: the frame's origin is opaque |
| The app's bridge (`window.fabrika`) | not there |
| The origin the desk sees on a message | `"null"` |
| The same page as `srcdoc` | its script never runs: "Executing inline script violates … `script-src 'self' 'wasm-unsafe-eval'`" |
| Ctrl-B with focus in the frame reaches the desk | **not settled**: the probe could not put focus in the frame |

- **The keys row is open.** In a window with no focus, a click sent with `sendInputEvent` did not
  move focus into the frame (`document.hasFocus()` was false), so the key landed in the desk. The
  app's own Playwright run (`apps/fabrika/e2e.ts`) clicks in a real window; it settles this.
- **The page's `location.origin` reads `fabrika-artifact://shell`,** but every check uses the
  opaque origin, which the desk sees as `"null"`. Code that trusts `location.origin` is wrong.
- **The probe ran outside the app,** in a scratch copy of its shape. The app was not changed.

## What this tells us for fabrika

- An artifact needs its own origin. The probe and the HTML spec agree that `srcdoc` and `blob:`
  cannot work under the desk's policy. One more scheme with one static shell page does.
- Main stays a thin relay. The shell is a static file; the page itself travels in the program's
  view, as markdown's text does, and the desk posts it into the frame.
- The makers' common shape is small: a sandbox, one channel, the host's tokens. Versions are the
  one part nobody but Claude documents, and Tier 1 already plans "each note's saved versions, with
  a check against stale saves".
- The plan puts "pages that run code in a box" in Tier 7 (`docs/plan/tiers.md`). Doing it now, in
  today's version, moves it forward. That is the owner's call.

## What it cannot tell us

- Whether keys typed inside the frame reach the desk. The probe could not settle it; a real
  window can.
- Anything about a real agent's page: no agent wrote one for this study.
- Speed: nothing was timed. A 16 MiB page through the view, the link and a `postMessage` was not
  tried.
- How a screen reader reads the frame. No screen reader was run.
- Linear's quotes were read by a research agent through a page-to-text tool. The four the note
  leans on, and every Claude, web.dev and Figma quote, were checked again by hand; the rest were
  not.
- GitHub's domain for Viewscreen, and why CodeSandbox and StackBlitz use theirs: no first-party
  page was found.

Cost: $0 in API spend. Two research agents read the web, about 185,000 tokens between them; their
dollars were not measured. The probe ran locally.

## Links

- [a1] Claude Code, "Share session output as artifacts", https://code.claude.com/docs/en/artifacts
- [a2] Claude Help Center, "What are artifacts and how do I use them?", https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them
- [v1] VS Code, "Webview API", https://code.visualstudio.com/api/extension-guides/webview
- [e1] Electron, "Security", https://www.electronjs.org/docs/latest/tutorial/security
- [h1] HTML Standard, 7.1.7 Policy containers, https://html.spec.whatwg.org/multipage/browsers.html#policy-containers
- [s1] Figma, "Creating a User Interface", https://developers.figma.com/docs/plugins/creating-ui/
- [s2] Figma, "CSS Variables and Theming", https://developers.figma.com/docs/plugins/css-variables/
- [s4] Figma, "figma.clientStorage", https://developers.figma.com/docs/plugins/api/figma-clientStorage/
- [s5] OpenAI, "Security and privacy", https://developers.openai.com/plugins/guides/security-privacy
- [s6] OpenAI, "Build a ChatGPT UI", https://developers.openai.com/plugins/build/chatgpt-ui
- [s8] OpenAI, "15 lessons building ChatGPT apps", https://developers.openai.com/blog/15-lessons-building-chatgpt-apps
- [s9] OpenAI, "UI guidelines", https://developers.openai.com/plugins/concepts/ui-guidelines
- [s10] Observable, "Data security and privacy", https://observablehq.github.io/documentation/security/data-security-and-privacy
- [s11] GitHub, "Include diagrams in your Markdown files with Mermaid", https://github.blog/engineering/user-experience/include-diagrams-markdown-files-mermaid/
- [s12] GitHub Docs, "Working with non-code files", https://docs.github.com/en/repositories/working-with-files/using-files/working-with-non-code-files
- [s13] GitHub, "Yummy cookies across domains", https://github.blog/engineering/infrastructure/yummy-cookies-across-domains/
- [s14] Jupyter Notebook, "The Jupyter Notebook", https://jupyter-notebook.readthedocs.io/en/latest/notebook.html
- [s16] CodePen, "Changed domains for iframe previews", https://blog.codepen.io/2019/10/03/changed-domains-for-iframe-previews/
- [s17] Raycast, "FAQ", https://developers.raycast.com/misc/faq
- [s18] Raycast, "User Interface", https://developers.raycast.com/api-reference/user-interface
- [s19] Obsidian, "Plugin security", https://obsidian.md/help/plugin-security
- [s20] web.dev, "Play safely in sandboxed IFrames", https://web.dev/articles/sandboxed-iframes
- [s21] web.dev, "Securely hosting user data in modern web applications", https://web.dev/articles/securely-hosting-user-data
- [s22] W3C, "H64: Using the title attribute of the iframe element", https://www.w3.org/WAI/WCAG22/Techniques/html/H64
- [s24] W3C, "Understanding SC 2.1.2: No Keyboard Trap", https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html
- [l1] Linear, "Design for the AI age", https://linear.app/now/design-for-the-ai-age
- [l2] Linear, "Invisible details", https://linear.app/now/invisible-details
- [l3] Linear, "Zero bugs policy", https://linear.app/now/zero-bugs-policy
- [l4] Linear Method, "Introduction", https://linear.app/method/introduction
- [l5] Linear Method, "Scope projects", https://linear.app/method/scope-projects
- [l6] Linear, "Improving performance for large workspaces", https://linear.app/changelog/2021-05-20-improving-performance-for-large-workspaces
- [l7] Linear Method, "Building with momentum", https://linear.app/method/building-with-momentum
