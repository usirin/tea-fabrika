import { useCurrentFrame } from "remotion";
import {
  Chapter,
  Counter,
  FlowDiagram,
  type FlowNode,
  type Scene,
  color,
  enter,
  font,
  layout,
  progress,
  seconds,
  stage,
  type,
  weight,
} from "../design";

/** Part 9: Working with the agent, not through it. See STORYBOARD.md, "Ch09". */

/** Six of the memory notes from post 9, one under each compaction. */
const NOTES = [
  "raise low confidence",
  "use the edit tools",
  "use subagents",
  "best practice over parity",
  "fast is not rushed",
  "size a Jev run first",
];

/**
 * The eleven hours as one line. The conversation's memory fills up and is cut
 * back six times; the notes under the line never move.
 */
const Compactions: React.FC<{ second: number }> = ({ second }) => {
  const frame = useCurrentFrame();
  const W = stage.width;
  const lineY = 300;
  const fillH = 180;
  const n = NOTES.length;
  // Marks spaced evenly: the post gives the count and the span, not each time.
  const markX = (i: number) => ((i + 1) / (n + 1)) * W;
  const sweep = progress(frame, seconds(0.3), seconds(3.6), (t) => t);
  const head = sweep * W;
  // A sawtooth: memory grows from each cut to the next mark.
  const cuts = [0, ...NOTES.map((_, i) => markX(i)), W];
  const pts: string[] = [`0,${lineY}`];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i]!;
    const b = cuts[i + 1]!;
    pts.push(`${a},${lineY - 20}`, `${b},${lineY - fillH}`, `${b},${lineY}`);
  }
  const notesOn = enter(frame, second);
  return (
    <div style={{ position: "relative", width: W, height: stage.height }}>
      <svg width={W} height={stage.height} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <defs>
          <clipPath id="ch09-sweep">
            <rect x={0} y={0} width={head} height={stage.height} />
          </clipPath>
        </defs>
        <polygon points={pts.join(" ")} fill={color.surfaceRaised} clipPath="url(#ch09-sweep)" />
        <line x1={0} y1={lineY} x2={W} y2={lineY} stroke={color.line} strokeWidth={3} />
        {NOTES.map((_, i) => {
          const x = markX(i);
          const on = head >= x ? 1 : 0;
          return (
            <line
              key={i}
              x1={x}
              x2={x}
              y1={lineY - fillH - 20}
              y2={lineY + 16}
              stroke={color.textMuted}
              strokeWidth={3}
              strokeDasharray="8 8"
              opacity={on}
            />
          );
        })}
      </svg>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 16,
          fontFamily: font.mono,
          fontSize: type.label,
          color: color.textMuted,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          opacity: enter(frame, 0),
        }}
      >
        what the agent remembers
      </div>
      {[
        { x: 0, text: "1:49 p.m.", align: "left" as const },
        { x: W, text: "12:53 a.m.", align: "right" as const },
      ].map((t, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: lineY + 24,
            left: t.align === "left" ? 0 : undefined,
            right: t.align === "right" ? 0 : undefined,
            fontFamily: font.mono,
            fontSize: type.label,
            color: color.textMuted,
          }}
        >
          {t.text}
        </div>
      ))}
      {NOTES.map((note, i) => {
        const x = markX(i);
        const w = 210;
        return (
          <div
            key={note}
            style={{
              position: "absolute",
              left: x - w / 2,
              top: lineY + 110,
              width: w,
              height: 150,
              boxSizing: "border-box",
              padding: "16px 14px",
              borderRadius: 14,
              background: color.accentSoft,
              border: `2px solid ${color.accentLine}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              fontSize: type.label - 2,
              lineHeight: 1.2,
              color: color.text,
              opacity: notesOn * enter(frame, second + i * 3),
              transform: `translateY(${(1 - notesOn) * 14}px)`,
            }}
          >
            {note}
          </div>
        );
      })}
    </div>
  );
};

/** A recommendation with its number, and the 25% that holds the doubts. */
const Confidence: React.FC<{ second: number }> = ({ second }) => {
  const frame = useCurrentFrame();
  const card = enter(frame, seconds(0.1));
  const split = progress(frame, seconds(1.8), seconds(0.8));
  const doubts = enter(frame, seconds(2.4));
  const fall = enter(frame, second);
  const barW = 760;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 120, width: stage.width, justifyContent: "center" }}>
      <div style={{ width: 880, opacity: card, transform: `translateY(${(1 - card) * 18}px)` }}>
        <div
          style={{
            padding: "34px 40px",
            borderRadius: layout.radius,
            background: color.surface,
            border: `2px solid ${color.line}`,
          }}
        >
          <div style={{ fontFamily: font.mono, fontSize: type.label - 2, color: color.textMuted, letterSpacing: "0.12em" }}>
            RECOMMEND
          </div>
          <div style={{ marginTop: 12, fontSize: type.body, fontWeight: weight.semibold }}>
            Build on the three small questions
          </div>
          <div style={{ position: "relative", marginTop: 34, height: 60, width: barW }}>
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: barW * 0.75 - 6,
                height: 60,
                borderRadius: 10,
                background: color.line,
                display: "flex",
                alignItems: "center",
                paddingLeft: 22,
                fontFamily: font.mono,
                fontSize: type.label,
                color: color.text,
              }}
            >
              75%
            </div>
            <div
              style={{
                position: "absolute",
                left: barW * 0.75,
                top: split * 110,
                width: barW * 0.25,
                height: 60,
                borderRadius: 10,
                border: `3px dashed ${color.accent}`,
                boxSizing: "border-box",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: font.mono,
                fontSize: type.label,
                color: color.accent,
              }}
            >
              25%
            </div>
          </div>
          <div style={{ height: 110 * split }} />
        </div>
        <div style={{ marginTop: 26, opacity: doubts, paddingLeft: 8 }}>
          <div style={{ fontFamily: font.mono, fontSize: type.label - 2, color: color.accent, marginBottom: 12 }}>
            the doubts
          </div>
          {["tuned on the same tests it scored", "one question never asked"].map((d) => (
            <div key={d} style={{ fontSize: type.label + 2, color: color.textMuted, lineHeight: 1.45 }}>
              · {d}
            </div>
          ))}
        </div>
      </div>
      <div style={{ opacity: fall, width: 480, display: "flex", justifyContent: "center" }}>
        <Counter
          from={75}
          to={40}
          suffix="%"
          start={second + seconds(0.3)}
          dur={1.6}
          accent
          label="after experiment 18"
        />
      </div>
    </div>
  );
};

/** Subagents before and after, and the three jobs the main thread kept. */
const MainThread: React.FC = () => {
  const frame = useCurrentFrame();
  const lineP = progress(frame, seconds(1.4), seconds(0.9));
  const chips = ["decide", "ask one question", "report"];
  return (
    <div style={{ width: stage.width, display: "flex", flexDirection: "column", alignItems: "center", gap: 90 }}>
      <div style={{ display: "flex", justifyContent: "center", gap: 220 }}>
        <Counter to={9} label="subagents, 11 hours before" start={seconds(0.1)} size={150} />
        <Counter to={6} label="subagents, the hour after" start={seconds(0.5)} size={150} accent />
      </div>
      <div style={{ position: "relative", width: 1300, height: 90 }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 43,
            height: 4,
            width: 1300 * lineP,
            background: color.line,
            borderRadius: 2,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            top: -48,
            fontFamily: font.mono,
            fontSize: type.label - 2,
            color: color.textMuted,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            opacity: lineP,
          }}
        >
          main thread
        </div>
        <div style={{ position: "absolute", inset: 0, display: "flex", justifyContent: "space-evenly", alignItems: "center" }}>
          {chips.map((c, i) => {
            const o = enter(frame, seconds(1.9) + i * seconds(0.35));
            return (
              <div
                key={c}
                style={{
                  padding: "18px 34px",
                  borderRadius: 999,
                  background: color.surfaceRaised,
                  border: `2px solid ${color.line}`,
                  fontSize: type.label + 4,
                  fontWeight: weight.medium,
                  color: color.text,
                  opacity: o,
                  transform: `scale(${0.92 + 0.08 * o})`,
                }}
              >
                {c}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const EXAM: FlowNode[] = [
  { id: "builder", label: "builder", sub: "writes the code", x: 220, y: 440, w: 360, h: 124 },
  { id: "tests", label: "test-writer", sub: "hidden tests, never sees the code", x: 800, y: 160, w: 520, h: 124 },
  { id: "reviewer", label: "reviewer", sub: "a different agent", x: 800, y: 440, w: 360, h: 124 },
  { id: "person", label: "a person", sub: "approves one commit", x: 1380, y: 440, w: 400, h: 140, accent: true },
];

const scenes: Scene[] = [
  {
    captions: [
      "Six times in eleven hours, the agent forgot most of what we'd said.",
      "It came back working the same way, because every habit was written down.",
    ],
    visual: (cues) => <Compactions second={cues.at(1)} />,
  },
  {
    captions: [
      "Every recommendation came with a confidence number. The useful part was the other 25%.",
      "Once it went down: 75% to about 40%, after one experiment. That stopped a build on a hole.",
    ],
    hold: 0.6,
    visual: (cues) => <Confidence second={cues.at(1)} />,
  },
  {
    captions: ["Heavy reading went to subagents. The main thread kept the decisions."],
    hold: 1.2,
    visual: () => <MainThread />,
  },
  {
    captions: ["Nobody grades their own exam. Not the builder, and not the agent posting for you."],
    hold: 0.8,
    visual: () => (
      <FlowDiagram
        nodes={EXAM}
        start={seconds(0.2)}
        stagger={seconds(0.35)}
        edges={[
          { from: "tests", to: "reviewer" },
          { from: "builder", to: "reviewer", label: "the diff" },
          { from: "reviewer", to: "person", label: "verdict", accent: true },
        ]}
      />
    ),
  },
];

export const Ch09: React.FC = () => (
  <Chapter
    id="Ch09"
    scenes={scenes}
    takeaway="Notes are where a rule starts. The ones that matter *end up in code*."
  />
);
