import type { ReactNode } from "react";
import { Sequence, useCurrentFrame } from "remotion";
import { chapter, type ChapterId } from "../timeline";
import { Backdrop, VisualArea } from "./components/Backdrop";
import { assertCaptionFits, Caption } from "./components/Caption";
import { ChapterHeader } from "./components/ChapterHeader";
import { Takeaway } from "./components/Takeaway";
import { captionSeconds, FPS, fadeInOut, seconds } from "./timing";

/** Frames, relative to the scene's start, where each of its captions begins. */
export type Cues = {
  /** Frame caption `i` comes up at. Use it to sync an animation to a line. */
  readonly at: (i: number) => number;
  /** The scene's last frame + 1. */
  readonly end: number;
};

/**
 * One visual with the narration lines that run over it. The scene lasts as
 * long as its captions take to read (about 3 words a second), plus `hold`.
 */
export type Scene = {
  readonly captions: readonly string[];
  /** Extra seconds after the last caption, for a visual that needs to land. */
  readonly hold?: number;
  /** Seconds before the first caption, for a visual that should speak first. */
  readonly lead?: number;
  readonly visual: (cues: Cues) => ReactNode;
};

export const HEADER_SECONDS = 3.5;
export const TAKEAWAY_MIN_SECONDS = 4;
const SCENE_FADE = seconds(0.4);

const captionFrames = (text: string): number => seconds(captionSeconds(text));

const cueTable = (scene: Scene): { starts: number[]; total: number } => {
  const starts: number[] = [];
  let t = seconds(scene.lead ?? 0);
  for (const c of scene.captions) {
    starts.push(t);
    t += captionFrames(c);
  }
  return { starts, total: t + seconds(scene.hold ?? 0) };
};

/** How long a list of scenes runs, in frames. */
export const scenesFrames = (scenes: readonly Scene[]): number =>
  scenes.reduce((sum, s) => sum + cueTable(s).total, 0);

/** Lays a chapter out: the header card, then each scene, then the takeaway, which takes the time that is left. */
export const planChapter = (id: ChapterId, scenes: readonly Scene[]) => {
  const row = chapter(id);
  const budget = seconds(row.seconds);
  const header = seconds(HEADER_SECONDS);
  const body = scenesFrames(scenes);
  const takeaway = budget - header - body;
  if (takeaway < seconds(TAKEAWAY_MIN_SECONDS)) {
    const over = (seconds(TAKEAWAY_MIN_SECONDS) - takeaway) / FPS;
    throw new Error(
      `${id} runs ${over.toFixed(1)}s over its ${row.seconds}s in timeline.ts. Cut caption words or scenes; do not change the table.`,
    );
  }
  return { row, header, body, takeaway, budget };
};

const SceneView: React.FC<{ scene: Scene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { starts, total } = cueTable(scene);
  const cues: Cues = {
    at: (i) => {
      const s = starts[i];
      if (s === undefined) throw new Error(`Scene has no caption ${i}`);
      return s;
    },
    end: total,
  };
  return (
    <>
      <div style={{ position: "absolute", inset: 0, opacity: fadeInOut(frame, total, SCENE_FADE) }}>
        <VisualArea>{scene.visual(cues)}</VisualArea>
      </div>
      {scene.captions.map((c, i) => (
        <Sequence key={i} from={starts[i] ?? 0} durationInFrames={captionFrames(c)} layout="none">
          <Caption text={c} durationInFrames={captionFrames(c)} />
        </Sequence>
      ))}
    </>
  );
};

const Fade: React.FC<{ total: number; children: ReactNode }> = ({ total, children }) => {
  const frame = useCurrentFrame();
  return <div style={{ position: "absolute", inset: 0, opacity: fadeInOut(frame, total, SCENE_FADE) }}>{children}</div>;
};

/**
 * A whole chapter: header card, scenes in order, takeaway card. Its length is
 * the chapter's row in timeline.ts; it fails loudly if the scenes do not fit.
 */
export const Chapter: React.FC<{ id: ChapterId; scenes: readonly Scene[]; takeaway: string }> = ({
  id,
  scenes,
  takeaway,
}) => {
  for (const s of scenes) s.captions.forEach(assertCaptionFits);
  const plan = planChapter(id, scenes);
  let from = plan.header;
  return (
    <Backdrop>
      <Sequence durationInFrames={plan.header}>
        <Fade total={plan.header}>
          <ChapterHeader number={plan.row.number} title={plan.row.title} />
        </Fade>
      </Sequence>
      {scenes.map((scene, i) => {
        const len = cueTable(scene).total;
        const at = from;
        from += len;
        return (
          <Sequence key={i} from={at} durationInFrames={len}>
            <SceneView scene={scene} />
          </Sequence>
        );
      })}
      <Sequence from={plan.header + plan.body} durationInFrames={plan.takeaway}>
        <Fade total={plan.takeaway}>
          <Takeaway text={takeaway} />
        </Fade>
      </Sequence>
    </Backdrop>
  );
};

/** A chapter not built yet: its header card for the whole of its row. */
export const ChapterStub: React.FC<{ id: ChapterId }> = ({ id }) => {
  const row = chapter(id);
  return (
    <Backdrop>
      <ChapterHeader number={row.number} title={row.title} />
    </Backdrop>
  );
};
