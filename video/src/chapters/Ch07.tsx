import { interpolate, useCurrentFrame } from "remotion";
import {
  BarChart,
  Chapter,
  Counter,
  type Scene,
  color,
  easeInOut,
  enter,
  font,
  progress,
  seconds,
  stage,
  type,
  weight,
} from "../design";
import { Kicker, Pill } from "./Ch05/kit";

/** Part 7: Cheap enough to read everything. See STORYBOARD.md, "Ch07". */

const FILES = 1511;
const COLS = 72;
const STEP = 19;
const GRID_W = (COLS - 1) * STEP;
const GRID_TOP = 210;
/** The two files the real fix changed, somewhere in the package. */
const CHANGED = [437, 1188] as const;

/** Every file in the package as a dot. The two changed files light up, then rise to the top of the ranking. */
const FileGrid: React.FC<{ rise: number }> = ({ rise }) => {
  const frame = useCurrentFrame();
  const left = (stage.width - GRID_W) / 2;
  const lit = progress(frame, seconds(2.0), seconds(0.6));
  const up = progress(frame, rise + seconds(0.3), seconds(1.2), easeInOut);
  const ranks = enter(frame, rise + seconds(1.3));
  return (
    <div style={{ position: "relative", width: stage.width, height: stage.height }}>
      <svg width={stage.width} height={stage.height} style={{ position: "absolute", inset: 0 }}>
        {Array.from({ length: FILES }, (_, i) => {
          const col = i % COLS;
          const r = Math.floor(i / COLS);
          if ((CHANGED as readonly number[]).includes(i)) return null;
          const o = progress(frame, col * 0.6, seconds(0.5));
          return <circle key={i} cx={left + col * STEP} cy={GRID_TOP + r * STEP} r={4.5} fill={color.textFaint} opacity={o * 0.8} />;
        })}
        {CHANGED.map((i, k) => {
          const col = i % COLS;
          const r = Math.floor(i / COLS);
          const x0 = left + col * STEP;
          const y0 = GRID_TOP + r * STEP;
          const x1 = stage.width / 2 - 150 + k * 300;
          const y1 = 80;
          const o = progress(frame, col * 0.6, seconds(0.5));
          return (
            <circle
              key={i}
              cx={interpolate(up, [0, 1], [x0, x1])}
              cy={interpolate(up, [0, 1], [y0, y1])}
              r={4.5 + 11 * lit}
              fill={lit > 0.05 ? color.accent : color.textFaint}
              opacity={Math.max(o * 0.8, lit)}
            />
          );
        })}
      </svg>
      {["1st", "2nd"].map((t, k) => (
        <div
          key={t}
          style={{
            position: "absolute",
            left: stage.width / 2 - 150 + k * 300 + 32,
            top: 80 - 24,
            fontFamily: font.mono,
            fontSize: type.label + 8,
            fontWeight: weight.medium,
            color: color.accent,
            opacity: ranks,
          }}
        >
          {t}
        </div>
      ))}
      <Kicker
        text="1,511 files in the package · 2 changed"
        at={seconds(0.6)}
        style={{ position: "absolute", top: GRID_TOP + 21 * STEP + 18, width: "100%", textAlign: "center" }}
      />
    </div>
  );
};

/** About a thousand questions, and a clock face that sweeps to 11 seconds. */
const QuestionsClock: React.FC = () => {
  const frame = useCurrentFrame();
  const sweep = progress(frame, seconds(0.6), seconds(1.4));
  const R = 120;
  const C = 2 * Math.PI * R;
  return (
    <div style={{ display: "flex", justifyContent: "space-evenly", alignItems: "center", width: "100%", whiteSpace: "nowrap" }}>
      <Counter to={1000} prefix="~" label="file questions" start={seconds(0.2)} size={150} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", opacity: enter(frame, seconds(0.5)) }}>
        <div style={{ position: "relative", width: 2 * R + 40, height: 2 * R + 40 }}>
          <svg width={2 * R + 40} height={2 * R + 40} style={{ position: "absolute", inset: 0 }}>
            <circle cx={R + 20} cy={R + 20} r={R} fill="none" stroke={color.surfaceRaised} strokeWidth={14} />
            <circle
              cx={R + 20}
              cy={R + 20}
              r={R}
              fill="none"
              stroke={color.accent}
              strokeWidth={14}
              strokeLinecap="round"
              strokeDasharray={`${C * sweep} ${C}`}
              transform={`rotate(-90 ${R + 20} ${R + 20})`}
            />
          </svg>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Counter to={11} suffix="s" start={seconds(0.6)} size={84} accent />
          </div>
        </div>
        <div style={{ marginTop: 24, fontSize: type.label + 4, color: color.textMuted }}>for all of them</div>
      </div>
    </div>
  );
};

/** The four floors on one ruler, each with what a wrong answer costs there. */
const FLOORS = [
  { at: 0.5, check: "missing file", cost: "one look" },
  { at: 0.7, check: "duplicate", cost: "one look" },
  { at: 0.8, check: "failure and shell", cost: "a person's time" },
  { at: 0.9, check: "docs", cost: "a false claim passes" },
];

const Floors: React.FC = () => {
  const frame = useCurrentFrame();
  const left = 60;
  const width = stage.width - 120;
  const y = 130;
  const line = progress(frame, 0, seconds(1));
  const xAt = (v: number) => left + v * width;
  const cardW = 370;
  const cardGap = (stage.width - 4 * cardW) / 5;
  const cardX = (i: number) => cardGap + i * (cardW + cardGap) + cardW / 2;
  const cardTop = 330;
  return (
    <div style={{ position: "relative", width: stage.width, height: stage.height }}>
      <svg width={stage.width} height={stage.height} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <line x1={left} y1={y} x2={left + width * line} y2={y} stroke={color.line} strokeWidth={4} strokeLinecap="round" />
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <line key={v} x1={xAt(v)} y1={y - 12} x2={xAt(v)} y2={y + 12} stroke={color.line} strokeWidth={3} opacity={line} />
        ))}
        {FLOORS.map((f, i) => {
          const at = seconds(0.8 + i * 0.45);
          const p = progress(frame, at, seconds(0.7));
          const x0 = xAt(f.at);
          const x1 = cardX(i);
          return (
            <g key={f.check} opacity={p}>
              <circle cx={x0} cy={y} r={11} fill={color.accent} />
              <path
                d={`M ${x0} ${y + 18} C ${x0} ${y + 110}, ${x1} ${cardTop - 110}, ${x1} ${cardTop - 12}`}
                fill="none"
                stroke={color.textFaint}
                strokeWidth={2.5}
                pathLength={1}
                strokeDasharray="1 1"
                strokeDashoffset={1 - p}
              />
            </g>
          );
        })}
      </svg>
      {[0, 1].map((v) => (
        <div
          key={v}
          style={{
            position: "absolute",
            left: xAt(v) - 40,
            width: 80,
            top: y - 64,
            textAlign: "center",
            fontFamily: font.mono,
            fontSize: type.label,
            color: color.textFaint,
            opacity: line,
          }}
        >
          {v}
        </div>
      ))}
      {FLOORS.map((f, i) => {
        const s = enter(frame, seconds(0.8 + i * 0.45));
        return (
          <div key={f.check}>
            <div
              style={{
                position: "absolute",
                left: xAt(f.at) - 50,
                width: 100,
                top: y - 70,
                textAlign: "center",
                fontFamily: font.mono,
                fontSize: type.label + 4,
                fontWeight: weight.medium,
                color: color.accent,
                opacity: s,
              }}
            >
              {f.at}
            </div>
            <div
              style={{
                position: "absolute",
                left: cardX(i) - cardW / 2,
                width: cardW,
                top: cardTop,
                boxSizing: "border-box",
                background: color.surface,
                border: `2px solid ${color.line}`,
                borderRadius: 20,
                padding: "28px 16px",
                textAlign: "center",
                opacity: s,
                transform: `translateY(${(1 - s) * 16}px)`,
              }}
            >
              <div style={{ fontSize: type.label + 4, fontWeight: weight.semibold, color: color.text }}>{f.check}</div>
              <div style={{ marginTop: 12, fontSize: type.label, color: color.textMuted, whiteSpace: "nowrap" }}>{f.cost}</div>
            </div>
          </div>
        );
      })}
      <Kicker
        text="under each: what a wrong answer costs"
        at={seconds(2.6)}
        style={{ position: "absolute", top: cardTop + 190, width: "100%", textAlign: "center" }}
      />
    </div>
  );
};

/**
 * The same run read as a gate. "No false alarms" holds only for the complete
 * changes: when a file was missing, Jev sometimes flagged a second one.
 */
const GateNote: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const s = enter(frame, at);
  return (
    <div
      style={{
        textAlign: "center",
        fontSize: type.label,
        lineHeight: 1.45,
        color: color.textMuted,
        opacity: s,
        transform: `translateY(${(1 - s) * 12}px)`,
      }}
    >
      As a gate, flagging at 0.5: 22 of 28 caught, with 5 wrong flags in 28 trials.
      <br />
      The 9 complete changes, with nothing missing, got no flags at all.
    </div>
  );
};

const scenes: Scene[] = [
  {
    captions: [
      "A real ticket. Its fix changed 2 files. The package has 1,511.",
      "Jev read every file whole. The 2 changed files came out first and second.",
    ],
    hold: 0.6,
    visual: (cues) => <FileGrid rise={cues.at(1)} />,
  },
  {
    captions: [
      "About a thousand file questions in 11 seconds.",
      "A narrow question about a whole file is still a narrow question.",
    ],
    hold: 0.4,
    visual: () => <QuestionsClock />,
  },
  {
    captions: ["Whose fault is a red run? 42 of 42 right. Does the doc say X? 0 false claims passed."],
    hold: 0.8,
    visual: () => (
      <div style={{ display: "flex", justifyContent: "space-evenly", alignItems: "flex-start", width: "100%", whiteSpace: "nowrap" }}>
        <Counter to={42} suffix=" of 42" label="red runs blamed right" accent start={seconds(0.2)} size={132} />
        <Counter to={0} suffix=" of 66" label="false doc claims passed" start={seconds(1.6)} size={132} />
      </div>
    ),
  },
  {
    captions: [
      "Hide one file a real fix changed. Over whole packages, Jev ranked it first 22 of 28 times.",
      "It misses knock-on edits. Reading isn't tracing. A typechecker does that part.",
    ],
    hold: 0.8,
    visual: (cues) => {
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
          <BarChart
            title="hidden file found · whole packages, 268 to 1,591 files"
            max={28}
            start={seconds(0.2)}
            bars={[
              { label: "ranked 1st", value: 22, display: "22 of 28", accent: true },
              { label: "in the top 5", value: 26, display: "26 of 28" },
              { label: "in the top 10", value: 27, display: "27 of 28" },
            ]}
          />
          <GateNote at={seconds(1.8)} />
          <Pill text="a knock-on edit: `port.ts` ranked 15th of 268" faint mono={false} at={cues.at(1) + seconds(0.3)} />
        </div>
      );
    },
  },
  {
    captions: ["Every floor is set by what a mistake costs there: 0.5, 0.7, 0.8, 0.9."],
    hold: 1.0,
    visual: () => <Floors />,
  },
];

export const Ch07: React.FC = () => (
  <Chapter id="Ch07" scenes={scenes} takeaway="Ask what you'd want read *if reading were free*." />
);
