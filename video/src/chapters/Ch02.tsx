import { useCurrentFrame } from "remotion";
import {
  BarChart,
  Chapter,
  FlowDiagram,
  type FlowNode,
  type Scene,
  color,
  enter,
  font,
  progress,
  seconds,
  stage,
  type,
  weight,
} from "../design";
import { Card, CardTitle, Kicker, Layer, Pill, barRowHeight, fadeOutAt } from "./Ch02/kit";

/** Part 2: Meeting Jev. See STORYBOARD.md, "Ch02". */

/** Four asks of one question, and the 0.8 floor none of them reaches. */
const FourAsks: React.FC = () => {
  const frame = useCurrentFrame();
  const labelWidth = 260;
  const width = 1400;
  const track = width - labelWidth - 260;
  const floorX = labelWidth + 0.8 * track;
  const rows = 4 * barRowHeight(4);
  const line = progress(frame, seconds(1.6), seconds(0.8));
  const tag = enter(frame, seconds(1.9));
  return (
    <div style={{ position: "relative", width, height: rows, marginTop: 60 }}>
      <BarChart
        max={1}
        width={width}
        labelWidth={labelWidth}
        start={seconds(0.1)}
        bars={[
          { label: "ask 1", value: 0.69, display: "0.69" },
          { label: "ask 2", value: 0.79, display: "0.79" },
          { label: "ask 3", value: 0.64, display: "0.64" },
          { label: "ask 4", value: 0.77, display: "0.77" },
        ]}
      />
      <svg width={8} height={rows + 40} style={{ position: "absolute", left: floorX - 4, top: -20, overflow: "visible" }}>
        <line
          x1={4}
          x2={4}
          y1={0}
          y2={(rows + 40) * line}
          stroke={color.accent}
          strokeWidth={4}
          strokeDasharray="14 12"
          strokeLinecap="round"
        />
      </svg>
      <div
        style={{
          position: "absolute",
          left: floorX - 150,
          width: 300,
          top: -84,
          textAlign: "center",
          fontFamily: font.mono,
          fontSize: type.label + 2,
          fontWeight: weight.medium,
          color: color.accent,
          opacity: tag,
        }}
      >
        floor 0.8
      </div>
    </div>
  );
};

const JEV_FLOW: FlowNode[] = [
  { id: "state", label: "state (JSON)", x: 250, y: 210, w: 420, at: seconds(0.2) },
  { id: "question", label: "a question", sub: "with your answers", x: 250, y: 420, w: 420, h: 128, at: seconds(0.5) },
  { id: "jev", label: "Jev", sub: "a small classifier", x: 800, y: 315, w: 340, h: 150, accent: true, at: seconds(0.9) },
  { id: "answer", label: "one answer", sub: "+ how sure it is", x: 1340, y: 315, w: 400, h: 128 },
];

const JevFlow: React.FC<{ second: number }> = ({ second }) => (
  <div style={{ position: "relative", width: stage.width, height: stage.height }}>
    <FlowDiagram
      nodes={JEV_FLOW.map((n) => (n.id === "answer" ? { ...n, at: second } : n))}
      edges={[
        { from: "state", to: "jev" },
        { from: "question", to: "jev" },
        { from: "jev", to: "answer", accent: true },
      ]}
    />
    <div style={{ position: "absolute", left: 800 - 300, width: 600, top: 440, textAlign: "center" }}>
      <Pill text="$0.042 per million tokens" at={second + seconds(0.5)} />
    </div>
  </div>
);

const BAD_INPUTS = ["A rule that fights the code", "A rule about what stayed the same", "A ticket too thin to say what done is"];

const BadQuestions: React.FC<{ second: number }> = ({ second }) => {
  const frame = useCurrentFrame();
  const lights = [second + seconds(0.3), second + seconds(2.3)];
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 48 }}>
      <Kicker text="three kinds of bad question" />
      <div style={{ display: "flex", gap: 40 }}>
        {BAD_INPUTS.map((t, i) => {
          const at = lights[i];
          const lit = at === undefined ? 0 : progress(frame, at, seconds(0.5));
          return (
            <Card key={t} at={seconds(0.3 + i * 0.5)} lit={lit} width={480} height={260}>
              <div
                style={{
                  fontFamily: font.mono,
                  fontSize: type.label,
                  color: lit > 0.5 ? color.accent : color.textFaint,
                  marginBottom: 18,
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </div>
              <CardTitle>{t}</CardTitle>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

const RunsFinishing: React.FC = () => (
  <BarChart
    title="runs finishing · before and after fixing the question"
    max={100}
    labelWidth={500}
    start={seconds(0.1)}
    bars={[
      { label: "slugify · before", value: 0, display: "0 of 3" },
      { label: "slugify · after", value: 100, display: "5 of 5", accent: true },
      { label: "duration-open · before", value: 0, display: "0 of 5" },
      { label: "duration-open · after", value: 80, display: "8 of 10" },
    ]}
  />
);

const WhenRight: React.FC<{ second: number }> = ({ second }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "relative", width: stage.width, height: stage.height }}>
      <Layer opacity={fadeOutAt(frame, second - seconds(0.2))}>
        <BarChart
          title="right, by confidence · 87 cases, 261 answers"
          max={100}
          labelWidth={480}
          start={seconds(0.1)}
          bars={[
            { label: "0.8 and up", value: (218 / 221) * 100, display: "218 of 221", accent: true },
            { label: "0.7 to 0.8", value: (11 / 12) * 100, display: "11 of 12" },
            { label: "under 0.7", value: 50, display: "about half" },
          ]}
        />
      </Layer>
      <Layer opacity={progress(frame, second, seconds(0.4))}>
        <BarChart
          title="right, by what it was shown"
          max={100}
          labelWidth={480}
          start={second}
          bars={[
            { label: "a passing test", value: 100, display: "117 of 117", accent: true },
            { label: "no test, correct code", value: 95, display: "95%" },
            { label: "no test, broken code", value: 50, display: "about half" },
          ]}
        />
      </Layer>
    </div>
  );
};

/** Answers drop from above into a bin; the low ones land in the unsure tray. */
const DROPS: { bin: 0 | 1 | 2; at: number }[] = [
  { bin: 0, at: 0.5 },
  { bin: 2, at: 0.8 },
  { bin: 1, at: 1.1 },
  { bin: 0, at: 1.4 },
  { bin: 0, at: 1.7 },
  { bin: 2, at: 2.0 },
  { bin: 1, at: 2.3 },
  { bin: 0, at: 2.6 },
];

const BINS = [
  { label: "met", x: 340, accent: false },
  { label: "not met", x: 800, accent: false },
  { label: "unsure", x: 1260, accent: true },
];

const Tray: React.FC = () => {
  const frame = useCurrentFrame();
  const binTop = 100;
  const binW = 320;
  const binH = 130;
  return (
    <div style={{ position: "relative", width: stage.width, height: stage.height }}>
      {BINS.map((b, i) => {
        const s = enter(frame, seconds(0.1 + i * 0.15));
        return (
          <div
            key={b.label}
            style={{
              position: "absolute",
              left: b.x - binW / 2,
              top: binTop,
              width: binW,
              height: binH,
              boxSizing: "border-box",
              borderRadius: "0 0 20px 20px",
              border: `3px solid ${b.accent ? color.accent : color.line}`,
              borderTop: "none",
              background: b.accent ? color.accentSoft : color.surface,
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              paddingBottom: 14,
              fontFamily: font.mono,
              fontSize: type.label + 2,
              fontWeight: weight.medium,
              color: b.accent ? color.accent : color.text,
              opacity: s,
            }}
          >
            {b.label}
          </div>
        );
      })}
      {DROPS.map((d, i) => {
        const p = progress(frame, seconds(d.at), seconds(0.6));
        if (p <= 0) return null;
        const bin = BINS[d.bin]!;
        const count = DROPS.slice(0, i).filter((x) => x.bin === d.bin).length;
        const x = bin.x - 60 + count * 40;
        const y = binTop - 60 + p * 90;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x - 14,
              top: y - 14,
              width: 28,
              height: 28,
              borderRadius: 14,
              background: bin.accent ? color.accent : color.textMuted,
              opacity: Math.min(1, p * 3),
            }}
          />
        );
      })}
      <div style={{ position: "absolute", left: 50, top: 300 }}>
        <BarChart
          title="the review router · 12 cases, asked 3 times"
          max={36}
          labelWidth={360}
          start={seconds(1.6)}
          bars={[
            { label: "right", value: 30, display: "30 of 36" },
            { label: "unsure", value: 6, display: "6", accent: true },
            { label: "wrong", value: 0, display: "0" },
          ]}
        />
      </div>
    </div>
  );
};

const scenes: Scene[] = [
  {
    captions: ["0.69, 0.79, 0.64, 0.77. One question, asked four times. All under the floor of 0.8."],
    visual: () => <FourAsks />,
  },
  {
    captions: [
      "Jev is a small classifier. You give it JSON and a multiple-choice question.",
      "It picks one of your answers and says how sure it is.",
    ],
    visual: (cues) => <JevFlow second={cues.at(1)} />,
  },
  {
    captions: [
      "It wasn't noise. Every time we looked, the question was bad.",
      "A rule that fought the code. A rule about what stayed the same.",
    ],
    visual: (cues) => <BadQuestions second={cues.at(1)} />,
  },
  {
    captions: ["So fix the question, don't ask again. Slugify went from 0 of 3 runs finishing to 5 of 5."],
    visual: () => <RunsFinishing />,
  },
  {
    captions: [
      "Then we counted. At 0.8 and up, the judge was right 218 times out of 221.",
      "With a passing test in front of it: 117 of 117. Without one, on broken code: about half.",
    ],
    visual: (cues) => <WhenRight second={cues.at(1)} />,
  },
  {
    captions: ["Unsure is not an error. It goes somewhere, and code decides where, by what a mistake costs."],
    visual: () => <Tray />,
  },
];

export const Ch02: React.FC = () => (
  <Chapter id="Ch02" scenes={scenes} takeaway="When a small model is *unsure*, check the question before the model." />
);
