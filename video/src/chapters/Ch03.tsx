import { Sequence, useCurrentFrame } from "remotion";
import {
  BarChart,
  Chapter,
  Counter,
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
import { Card, Kicker, Layer, Pill, fadeOutAt } from "./Ch02/kit";

/** Part 3: A judge that cannot add. See STORYBOARD.md, "Ch03". */

const Mono: React.FC<{ children: React.ReactNode; size?: number; muted?: boolean }> = ({ children, size = 44, muted }) => (
  <span
    style={{
      fontFamily: font.mono,
      fontSize: size,
      fontWeight: weight.medium,
      color: muted ? color.textMuted : color.text,
      fontVariantLigatures: "none",
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </span>
);

/** Two answers to the same call, both said yes to, almost equally sure. */
const TwoAnswers: React.FC<{ second: number }> = ({ second }) => {
  const frame = useCurrentFrame();
  const wrong = enter(frame, second + seconds(2));
  const cards = [
    { result: "5400", conf: 0.9, at: seconds(0.2), count: seconds(0.8), wrong: false },
    { result: "4500", conf: 0.89, at: second, count: second + seconds(0.5), wrong: true },
  ];
  return (
    <div style={{ display: "flex", gap: 60 }}>
      {cards.map((c) => (
        <div key={c.result} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 40 }}>
          <Card at={c.at} width={760} height={150} style={{ alignItems: "center", padding: "0 24px" }}>
            <div>
              <Mono size={34} muted>
                parseDuration("1.5h") →{" "}
              </Mono>
              <Mono size={44}>{c.result}</Mono>
            </div>
            {c.wrong ? (
              <div
                style={{
                  position: "absolute",
                  right: -18,
                  top: -22,
                  fontFamily: font.mono,
                  fontSize: type.label,
                  color: color.textMuted,
                  background: color.bg,
                  border: `2px solid ${color.textFaint}`,
                  borderRadius: 999,
                  padding: "6px 20px",
                  opacity: wrong,
                }}
              >
                wrong
              </div>
            ) : null}
          </Card>
          <Counter to={c.conf} decimals={2} start={c.count} size={132} label="Jev: yes" />
        </div>
      ))}
    </div>
  );
};

const HandBuilt: React.FC<{ second: number }> = ({ second }) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 72, width: "100%" }}>
    <Kicker text="54 hand-built tests · 324 answers" />
    <div style={{ display: "flex", justifyContent: "space-evenly", width: "100%", alignItems: "flex-start" }}>
      <Counter to={200} suffix=" of 200" start={seconds(0.2)} size={132} label="right at 0.9 and up" />
      <Counter to={41} suffix="%" start={second} size={132} accent label="of good tests unsure at 0.8" />
    </div>
  </div>
);

const SameWords: React.FC = () => (
  <BarChart
    title="same background line, different JSON key"
    max={1}
    labelWidth={520}
    start={seconds(0.1)}
    stagger={seconds(0.35)}
    bars={[
      { label: "issue · short line", value: 0.93, display: "0.92–0.94" },
      { label: "issue · long line", value: 0.755, display: "0.67–0.84" },
      { label: "goal · long line", value: 0.33, display: "0.30–0.36", accent: true },
      { label: "about · long line", value: 0.875, display: "0.85–0.90" },
    ]}
  />
);

const SPLIT: FlowNode[] = [
  { id: "broad", label: "Is this test good?", x: 800, y: 60, w: 520, h: 100, muted: false, at: seconds(0.1) },
  { id: "in", label: "same_input", sub: "yes / no", x: 330, y: 250, w: 380, at: seconds(0.7) },
  { id: "res", label: "same_result", sub: "yes / no", x: 800, y: 250, w: 380, at: seconds(0.9) },
  { id: "chk", label: "exact_check", sub: "yes / no", x: 1270, y: 250, w: 380, at: seconds(1.1) },
];

const Split: React.FC<{ second: number }> = ({ second }) => (
  <div style={{ position: "relative", width: stage.width, height: stage.height }}>
    <div style={{ position: "absolute", left: 0, top: 0 }}>
      <FlowDiagram
        nodes={SPLIT}
        height={320}
        edges={[
          { from: "broad", to: "in" },
          { from: "broad", to: "res" },
          { from: "broad", to: "chk" },
        ]}
      />
    </div>
    <div style={{ position: "absolute", left: 50, top: 380 }}>
      <BarChart
        title="good tests accepted · 88 good tests"
        max={88}
        labelWidth={520}
        start={second}
        bars={[
          { label: "one broad question", value: 53, display: "53 of 88" },
          { label: "three narrow ones", value: 87, display: "87 of 88", accent: true },
        ]}
      />
    </div>
  </div>
);

/** The three boxes again; the first two turn into string matching. */
const StringMatch: React.FC = () => {
  const frame = useCurrentFrame();
  const flip = progress(frame, seconds(1.2), seconds(0.6));
  const boxes = [
    { name: "same_input", code: true },
    { name: "same_result", code: true },
    { name: "exact_check", code: false },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 64 }}>
      <div style={{ display: "flex", gap: 60 }}>
        {boxes.map((b, i) => (
          <div key={b.name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
            <Card at={seconds(0.1 + i * 0.15)} width={400} height={112} style={{ alignItems: "center", padding: 0 }}>
              <Mono size={38}>{b.name}</Mono>
            </Card>
            <div style={{ height: 56, display: "flex", alignItems: "center" }}>
              {b.code ? (
                <span style={{ opacity: flip }}>
                  <Pill text="string match" at={seconds(1.2)} />
                </span>
              ) : (
                <span style={{ opacity: flip, fontFamily: font.mono, fontSize: type.label, color: color.textMuted }}>
                  still Jev
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      <Counter to={152} suffix=" of 156" start={seconds(1.6)} size={120} accent label="code and Jev agreed" />
    </div>
  );
};

const NoCut: React.FC = () => (
  <BarChart
    title="does this example show the rule? · share let in"
    max={100}
    labelWidth={480}
    start={seconds(0.1)}
    bars={[
      { label: "cut 0.5 · good", value: (30 / 35) * 100, display: "30 of 35" },
      { label: "cut 0.5 · bad", value: (47 / 216) * 100, display: "47 of 216", accent: true },
      { label: "cut 0.9 · good", value: (7 / 35) * 100, display: "7 of 35" },
      { label: "cut 0.9 · bad", value: (1 / 216) * 100, display: "1 of 216" },
    ]}
  />
);

const INVOICE = [
  { item: "1 hour", amount: "3,600" },
  { item: "30 minutes", amount: "1,800" },
];

/** A proofreader passes an invoice whose total is off by 900. */
const Invoice: React.FC = () => {
  const frame = useCurrentFrame();
  const stamp = enter(frame, seconds(1.6));
  const note = enter(frame, seconds(2.4));
  const rowStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    fontFamily: font.mono,
    fontSize: 40,
    padding: "14px 0",
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 80 }}>
      <Card width={620} style={{ padding: "36px 48px" }}>
        <Kicker text="invoice · seconds" style={{ marginBottom: 20 }} />
        {INVOICE.map((r) => (
          <div key={r.item} style={{ ...rowStyle, color: color.text }}>
            <span>{r.item}</span>
            <span>{r.amount}</span>
          </div>
        ))}
        <div style={{ height: 2, background: color.line, margin: "12px 0" }} />
        <div style={{ ...rowStyle, color: color.accent, fontWeight: weight.semibold }}>
          <span>total</span>
          <span>4,500</span>
        </div>
        <div
          style={{
            position: "absolute",
            right: -40,
            bottom: -36,
            transform: `rotate(-8deg) scale(${1.3 - 0.3 * stamp})`,
            opacity: stamp,
            border: `4px solid ${color.textMuted}`,
            borderRadius: 12,
            padding: "8px 24px",
            fontFamily: font.mono,
            fontSize: 40,
            fontWeight: weight.bold,
            letterSpacing: "0.12em",
            color: color.textMuted,
            background: color.bg,
          }}
        >
          PASSED
        </div>
      </Card>
      <div style={{ width: 600, opacity: note, transform: `translateY(${(1 - note) * 12}px)` }}>
        <div style={{ fontSize: type.body, fontWeight: weight.semibold, lineHeight: 1.3 }}>
          Every line is real. The total looks like a total.
        </div>
        <div style={{ marginTop: 24, fontSize: type.label + 4, color: color.textMuted, lineHeight: 1.4 }}>
          It should be 5,400. Off by 900, and nobody added it up.
        </div>
      </div>
    </div>
  );
};

const CutThenInvoice: React.FC<{ second: number }> = ({ second }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "relative", width: stage.width, height: stage.height }}>
      <Layer opacity={fadeOutAt(frame, second - seconds(0.2))}>
        <NoCut />
      </Layer>
      <Layer opacity={progress(frame, second, seconds(0.4))}>
        {/* A Sequence restarts the frame count, so the invoice animates from its own cue. */}
        <Sequence from={second} layout="none">
          <Invoice />
        </Sequence>
      </Layer>
    </div>
  );
};

const scenes: Scene[] = [
  {
    captions: [
      "An hour and a half is 5,400 seconds. Jev said yes to 5400, at 0.90.",
      "Then we showed it 4500. Jev said yes again, at 0.89.",
    ],
    hold: 0.4,
    visual: (cues) => <TwoAnswers second={cues.at(1)} />,
  },
  {
    captions: ["On 54 hand-built tests, Jev at 0.9 was right 200 of 200 times.", "But 41% of the good tests came back unsure."],
    visual: (cues) => <HandBuilt second={cues.at(1)} />,
  },
  {
    captions: ["Same words, different key. Under `issue`: 0.67 to 0.84. Under `goal`: 0.30 to 0.36."],
    hold: 0.6,
    visual: () => <SameWords />,
  },
  {
    captions: [
      "Split one broad question into three small yes/no ones.",
      "Good tests accepted went from 53 of 88 to 87 of 88. Same model, same tests.",
    ],
    visual: (cues) => <Split second={cues.at(1)} />,
  },
  {
    captions: ["Two of the three were string matching. Code agreed with Jev on 152 of 156."],
    hold: 0.4,
    visual: () => <StringMatch />,
  },
  {
    captions: [
      "No cut works. At 0.5, 47 bad examples get in. At 0.9, most good ones don't.",
      "Jev reads. It doesn't add. Keep the arithmetic in code.",
    ],
    visual: (cues) => <CutThenInvoice second={cues.at(1)} />,
  },
];

export const Ch03: React.FC = () => (
  <Chapter id="Ch03" scenes={scenes} takeaway="Code works out the facts. *Jev reads them.*" />
);
