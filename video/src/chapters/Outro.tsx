import { Sequence, useCurrentFrame } from "remotion";
import {
  Backdrop,
  Caption,
  TitleCard,
  VisualArea,
  captionSeconds,
  color,
  enter,
  fadeInOut,
  font,
  seconds,
  type,
} from "../design";
import { OUTRO_SECONDS } from "../timeline";

/** The 20-second close. See STORYBOARD.md, "Outro". */

const LESSONS = [
  "A small classifier is great at reading, useless at arithmetic.",
  "An unsure answer usually means the question was bad.",
  "Agents see what their tools let them see, not what the prompt says.",
  "Tests decide better than any judge.",
  "A bill is a fine teacher, if you let it be one.",
];

const LESSON_CAPTIONS = [
  "Two days and 37 experiments later, this is what stuck.",
  "And the state lives in one place. Kill it, and it starts again.",
];
const END_CAPTION = "Still a repro on two toy tickets. The real repo is next.";

const LESSONS_LEN = seconds(11);
const END_LEN = seconds(OUTRO_SECONDS) - LESSONS_LEN;

const Fade: React.FC<{ total: number; children: React.ReactNode }> = ({ total, children }) => {
  const frame = useCurrentFrame();
  return <div style={{ position: "absolute", inset: 0, opacity: fadeInOut(frame, total) }}>{children}</div>;
};

const LessonList: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 34, width: 1500 }}>
      {LESSONS.map((l, i) => {
        const o = enter(frame, seconds(0.3) + i * seconds(0.7));
        return (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 32,
              alignItems: "baseline",
              opacity: o,
              transform: `translateX(${(1 - o) * -16}px)`,
            }}
          >
            <span style={{ fontFamily: font.mono, fontSize: type.label, color: color.accent, width: 44, flexShrink: 0 }}>
              {i + 1}
            </span>
            <span style={{ fontSize: type.body, lineHeight: 1.25 }}>{l}</span>
          </div>
        );
      })}
    </div>
  );
};

export const Outro: React.FC = () => {
  const first = seconds(captionSeconds(LESSON_CAPTIONS[0]!));
  return (
    <Backdrop>
      <Sequence durationInFrames={LESSONS_LEN}>
        <Fade total={LESSONS_LEN}>
          <VisualArea>
            <LessonList />
          </VisualArea>
        </Fade>
        <Sequence durationInFrames={first} layout="none">
          <Caption text={LESSON_CAPTIONS[0]!} durationInFrames={first} />
        </Sequence>
        <Sequence from={seconds(6)} durationInFrames={LESSONS_LEN - seconds(6)} layout="none">
          <Caption text={LESSON_CAPTIONS[1]!} durationInFrames={LESSONS_LEN - seconds(6)} />
        </Sequence>
      </Sequence>
      <Sequence from={LESSONS_LEN} durationInFrames={END_LEN}>
        <Fade total={END_LEN}>
          <TitleCard
            kicker="the machine owns the loop"
            title="Fabrika was v3. This is the start of *v4*."
            subtitle="github.com/usirin/tea-fabrika · the posts live in blog/"
            lift={140}
          />
        </Fade>
        <Sequence from={seconds(2.2)} durationInFrames={seconds(5)} layout="none">
          <Caption text={END_CAPTION} durationInFrames={seconds(5)} />
        </Sequence>
      </Sequence>
    </Backdrop>
  );
};
