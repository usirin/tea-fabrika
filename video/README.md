# The video

A 9½-minute visual version of [the blog series](../blog/README.md), made with
[Remotion](https://www.remotion.dev) (React + TypeScript). No voiceover: the
captions tell the story. [STORYBOARD.md](./STORYBOARD.md) has every caption
and every visual.

## Setup

Node 20 or newer, pnpm, and ffmpeg. Remotion downloads its own headless
browser the first time it renders.

```sh
cd video
pnpm install
```

`video/` is its own pnpm workspace, so this does not touch the repo root.

## Render

Everything renders into `out/`, which git ignores.

```sh
# The whole video, 1920x1080 at 30 fps
npx remotion render Series out/series.mp4

# One chapter on its own: Intro, Ch01 ... Ch10, Outro
npx remotion render Ch01 out/ch01.mp4

# One frame as a PNG, to check a layout
npx remotion still Ch01 out/ch01-640.png --frame=640
```

`pnpm render` is a shortcut for the first one. `pnpm studio` opens Remotion
Studio, where you can scrub through any composition.

## Where things are

| Path | What it is |
|---|---|
| `src/timeline.ts` | The one table of chapter lengths |
| `src/Root.tsx` | Registers `Series` and one composition per part |
| `src/design/` | Colours, type, spacing, timing, and the shared components |
| `src/design/Chapter.tsx` | Lays out a chapter: header, scenes, takeaway |
| `src/chapters/` | Intro, Ch01 to Ch10, Outro |

A chapter whose captions run longer than its row in `src/timeline.ts`, or a
caption longer than two lines, fails the render with a message saying what to
cut.
