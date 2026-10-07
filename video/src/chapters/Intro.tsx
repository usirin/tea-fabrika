import { Sequence, useCurrentFrame } from "remotion";
import {
  Backdrop,
  Caption,
  CounterRow,
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
import { CHAPTERS, INTRO_SECONDS } from "../timeline";

/** The 20-second opening. See STORYBOARD.md, "Intro". */

const TITLE = seconds(5);
const NUMBERS = seconds(9.5);
const MAP = seconds(INTRO_SECONDS) - TITLE - NUMBERS;

const NUMBER_CAPTIONS = [
  "58 commits and 37 experiments, in two days.",
  "One question: could the loop that takes a ticket to working code be plain code?",
];
const MAP_CAPTION = "Ten parts, one per blog post. No sound needed. Just read along.";

const Fade: React.FC<{ total: number; children: React.ReactNode }> = ({ total, children }) => {
  const frame = useCurrentFrame();
  return <div style={{ position: "absolute", inset: 0, opacity: fadeInOut(frame, total) }}>{children}</div>;
};

/** All ten chapter titles, numbered, so the viewer sees the whole road first. */
const ChapterMap: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gridAutoFlow: "column",
        gridTemplateRows: "repeat(5, auto)",
        columnGap: 80,
        rowGap: 26,
        width: 1600,
      }}
    >
      {CHAPTERS.map((c, i) => {
        const o = enter(frame, seconds(0.15) + i * 3);
        return (
          <div key={c.id} style={{ display: "flex", gap: 24, alignItems: "baseline", opacity: o }}>
            <span style={{ fontFamily: font.mono, fontSize: type.label, color: color.accent, width: 56, flexShrink: 0 }}>
              {String(c.number).padStart(2, "0")}
            </span>
            <span style={{ fontSize: type.label + 2, color: color.text, lineHeight: 1.25 }}>{c.title}</span>
          </div>
        );
      })}
    </div>
  );
};

export const Intro: React.FC = () => {
  const first = seconds(captionSeconds(NUMBER_CAPTIONS[0]!));
  return (
    <Backdrop>
      <Sequence durationInFrames={TITLE}>
        <Fade total={TITLE}>
          <TitleCard
            kicker="tea-fabrika"
            title="The machine owns the loop"
            subtitle="Rebuilding an agent pipeline as a plain state machine."
          />
        </Fade>
      </Sequence>
      <Sequence from={TITLE} durationInFrames={NUMBERS}>
        <Fade total={NUMBERS}>
          <VisualArea>
            <CounterRow
              start={seconds(0.2)}
              items={[
                { to: 58, label: "commits" },
                { to: 37, label: "experiments", accent: true },
                { to: 2, label: "days" },
              ]}
            />
          </VisualArea>
        </Fade>
        <Sequence durationInFrames={first} layout="none">
          <Caption text={NUMBER_CAPTIONS[0]!} durationInFrames={first} />
        </Sequence>
        <Sequence from={first} durationInFrames={NUMBERS - first} layout="none">
          <Caption text={NUMBER_CAPTIONS[1]!} durationInFrames={NUMBERS - first} />
        </Sequence>
      </Sequence>
      <Sequence from={TITLE + NUMBERS} durationInFrames={MAP}>
        <Fade total={MAP}>
          <VisualArea>
            <ChapterMap />
          </VisualArea>
        </Fade>
        <Caption text={MAP_CAPTION} durationInFrames={MAP} />
      </Sequence>
    </Backdrop>
  );
};
