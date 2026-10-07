import { useCurrentFrame } from "remotion";
import {
  Chapter,
  CodeCard,
  FlowDiagram,
  type FlowNode,
  Rich,
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

/** Part 10: Knobs in a file, systems with SDKs. See STORYBOARD.md, "Ch10". */

const TOML = `[lane]
attempts = 3           # builds before a person is asked

[failure]
floor = 0.8            # below this, the reading is unsure
on_unsure = "rebuild"  # or "park": ask a person

[review]
missing_floor = 0.5    # flag an untouched file at this
match_floor = 0.9      # a finding repeats a decided one`;

/** The three load rules, one row each: what you write, what the load does. */
const LOAD_RULES = [
  { input: "an empty file", result: "changes nothing" },
  { input: "`flor = 0.9`", result: "refused: unknown key" },
  { input: "`floor = 1.5`", result: "names `failure.floor`", accent: true },
];

const LoadRules: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <div style={{ width: 1360, display: "flex", flexDirection: "column", gap: 30 }}>
      {LOAD_RULES.map((r, i) => {
        const at = seconds(0.2) + i * seconds(1.7);
        const o = enter(frame, at);
        const arrow = progress(frame, at + seconds(0.4), seconds(0.5));
        const res = enter(frame, at + seconds(0.7));
        return (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "30px 44px",
              borderRadius: layout.radius,
              background: r.accent ? color.accentSoft : color.surface,
              border: `2px solid ${r.accent ? color.accent : color.line}`,
              opacity: o,
              transform: `translateY(${(1 - o) * 16}px)`,
            }}
          >
            <div style={{ width: 460, fontSize: type.body - 2, color: color.text }}>
              <Rich text={r.input} />
            </div>
            <div style={{ width: 140, display: "flex", justifyContent: "center" }}>
              <div style={{ width: 80 * arrow, height: 3, background: color.textMuted, position: "relative" }}>
                <div
                  style={{
                    position: "absolute",
                    right: -2,
                    top: -8,
                    width: 0,
                    height: 0,
                    borderTop: "9px solid transparent",
                    borderBottom: "9px solid transparent",
                    borderLeft: `16px solid ${color.textMuted}`,
                    opacity: arrow,
                  }}
                />
              </div>
            </div>
            <div
              style={{
                flex: 1,
                fontSize: type.body - 2,
                fontWeight: weight.medium,
                color: r.accent ? color.accent : color.textMuted,
                opacity: res,
              }}
            >
              <Rich text={r.result} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** A recipe card: change the quantities freely; the steps stay put; a condition gets struck out. */
const Recipe: React.FC = () => {
  const frame = useCurrentFrame();
  const card = enter(frame, seconds(0.1));
  const left = enter(frame, seconds(0.6));
  const right = enter(frame, seconds(1.4));
  const extra = enter(frame, seconds(2.4));
  const strike = progress(frame, seconds(3.4), seconds(0.7));
  const heading = (text: string, accent = false): React.ReactNode => (
    <div
      style={{
        fontFamily: font.mono,
        fontSize: type.label - 2,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: accent ? color.accent : color.textMuted,
        marginBottom: 26,
      }}
    >
      {text}
    </div>
  );
  const item: React.CSSProperties = { fontSize: type.label + 6, lineHeight: 1.65, color: color.text };
  return (
    <div
      style={{
        width: 1400,
        display: "flex",
        background: color.surface,
        border: `2px solid ${color.line}`,
        borderRadius: layout.radius,
        opacity: card,
        transform: `translateY(${(1 - card) * 18}px)`,
      }}
    >
      <div style={{ flex: 1, padding: "44px 52px", borderRight: `2px dashed ${color.line}`, opacity: left }}>
        {heading("quantities → config")}
        <div style={item}>more salt</div>
        <div style={item}>a hotter oven</div>
        <div style={item}>ten minutes longer</div>
      </div>
      <div style={{ flex: 1.3, padding: "44px 52px" }}>
        <div style={{ opacity: right }}>
          {heading("steps → stay in code", true)}
          {["1  mix", "2  knead", "3  rest", "4  bake"].map((s) => (
            <div key={s} style={{ ...item, fontFamily: font.mono, fontSize: type.label + 2 }}>
              {s}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14, opacity: extra * (1 - 0.45 * strike) }}>
          <span style={{ position: "relative", display: "inline-block", fontSize: type.label + 2, color: color.textMuted }}>
            if sticky, go back to step 3
            <span
              style={{
                position: "absolute",
                left: -6,
                top: "54%",
                height: 4,
                width: `calc(${strike * 100}% + 12px)`,
                background: color.accent,
                borderRadius: 2,
              }}
            />
          </span>
        </div>
      </div>
    </div>
  );
};

/** The house-rules picture: a run copies its knobs once, and a restart keeps them. */
const COPIED: FlowNode[] = [
  { id: "file", label: "fabrika.toml", sub: "attempts = 1", x: 230, y: 130, w: 380, at: seconds(0.1) },
  { id: "filed", label: "filed", sub: "read once", x: 790, y: 130, w: 300, at: seconds(0.5) },
  { id: "state", label: "the run's own state", sub: "attempts = 1", x: 1340, y: 130, w: 440, accent: true, at: seconds(0.9) },
  { id: "later", label: "fabrika.toml, later", sub: "attempts = 3", x: 230, y: 480, w: 380, muted: true, at: seconds(2.6) },
  { id: "parks", label: "parks after 1 try", sub: "the rules it began with", x: 1340, y: 480, w: 440, at: seconds(3.6) },
];

const KillMark: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const o = enter(frame, at);
  return (
    <div
      style={{
        position: "absolute",
        left: 1340 - 170,
        top: 290,
        width: 340,
        textAlign: "center",
        opacity: o,
        transform: `scale(${0.9 + 0.1 * o})`,
      }}
    >
      <span
        style={{
          fontFamily: font.mono,
          fontSize: type.label,
          color: color.text,
          background: color.bg,
          border: `2px solid ${color.textMuted}`,
          borderRadius: 999,
          padding: "10px 26px",
          whiteSpace: "nowrap",
        }}
      >
        ✕ killed, restarted
      </span>
    </div>
  );
};

const Replay: React.FC = () => (
  <div style={{ position: "relative", width: stage.width, height: stage.height }}>
    <FlowDiagram
      nodes={COPIED}
      edges={[
        { from: "file", to: "filed" },
        { from: "filed", to: "state", accent: true },
        { from: "state", to: "parks", at: seconds(1.7) },
        { from: "later", to: "parks", label: "not read", dashed: true, at: seconds(3.3) },
      ]}
    />
    <KillMark at={seconds(1.9)} />
  </div>
);

const RECORD = `missing-file check: ran, asked 911 file(s), 1 flagged
missing-file check: SKIPPED, the reader failed`;

/** v3 as one faint box; v4 as parts with SDKs, composed in code. */
const V4: FlowNode[] = [
  { id: "v3", label: "prose inside an agent harness", x: 250, y: 380, w: 440, h: 300, muted: true, at: seconds(0.2) },
  { id: "code", label: "composed in code", x: 1160, y: 380, w: 400, h: 112, accent: true, at: seconds(1.2) },
  { id: "machines", label: "machines", x: 860, y: 170, w: 250, at: seconds(1.6) },
  { id: "services", label: "services", x: 1460, y: 170, w: 250, at: seconds(1.8) },
  { id: "jev", label: "a classifier", x: 1460, y: 590, w: 250, at: seconds(2.0) },
  { id: "tracker", label: "a tracker", x: 860, y: 590, w: 250, at: seconds(2.2) },
  { id: "repo", label: "a repo", x: 740, y: 380, w: 200, at: seconds(2.4) },
];

const SideLabel: React.FC<{ text: string; x: number; at: number; accent?: boolean }> = ({ text, x, at, accent }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        left: x - 100,
        width: 200,
        top: 30,
        textAlign: "center",
        fontFamily: font.mono,
        fontSize: 48,
        fontWeight: weight.medium,
        color: accent ? color.accent : color.textFaint,
        opacity: enter(frame, at),
      }}
    >
      {text}
    </div>
  );
};

const Systems: React.FC = () => (
  <div style={{ position: "relative", width: stage.width, height: stage.height }}>
    <SideLabel text="v3" x={250} at={0} />
    <SideLabel text="v4" x={1160} at={seconds(1.0)} accent />
    <div style={{ position: "absolute", inset: 0 }}>
      <FlowDiagram
        nodes={V4}
        edges={["machines", "services", "jev", "tracker", "repo"].map((id) => ({ from: "code", to: id }))}
      />
    </div>
  </div>
);

const scenes: Scene[] = [
  {
    captions: ['Once the loop is code, "sure enough" is a number. Numbers can live in a file.'],
    hold: 0.8,
    visual: () => <CodeCard code={TOML} lang="toml" title="fabrika.toml" fontSize={32} highlight={[5]} start={0} />,
  },
  {
    captions: ["An empty file changes nothing. A typo fails the load. A bad value names its key."],
    hold: 0.6,
    visual: () => <LoadRules />,
  },
  {
    captions: ["Config holds numbers. The order of the steps stays in code, where it has tests."],
    hold: 0.8,
    visual: () => <Recipe />,
  },
  {
    captions: ["Each run copies its knobs when it's filed. A restart replays by the rules it began with."],
    hold: 0.8,
    visual: () => <Replay />,
  },
  {
    captions: ["A check that was skipped says SKIPPED, in capitals, where the approver reads."],
    hold: 0.6,
    visual: () => (
      <CodeCard code={RECORD} lang="text" title="the approval record" fontSize={38} highlight={[2]} start={0} />
    ),
  },
  {
    captions: ["v3 lives inside an agent harness. v4 is systems with SDKs, composed in code."],
    hold: 0.8,
    visual: () => <Systems />,
  },
];

export const Ch10: React.FC = () => (
  <Chapter
    id="Ch10"
    scenes={scenes}
    takeaway="A knob is a number. Anything that *decides what happens next* belongs in code."
  />
);
