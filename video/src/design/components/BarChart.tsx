import { useCurrentFrame } from "remotion";
import { enter, progress, seconds } from "../timing";
import { color, font, type, weight } from "../tokens";

export type Bar = {
  label: string;
  value: number;
  /** What to print at the end of the bar, e.g. "117 of 117". Defaults to the value. */
  display?: string;
  /** Paint this bar in the accent. Use it for the one bar the caption is about. */
  accent?: boolean;
};

/**
 * Horizontal bars that grow in one after another. Labels on the left, the
 * value printed at the end of each bar. Keep it to 6 bars or fewer.
 */
export const BarChart: React.FC<{
  bars: readonly Bar[];
  /** The value a full-width bar stands for. Defaults to the largest value. */
  max?: number;
  title?: string;
  start?: number;
  stagger?: number;
  labelWidth?: number;
  width?: number;
}> = ({ bars, max, title, start = 0, stagger = seconds(0.25), labelWidth = 520, width = 1500 }) => {
  const frame = useCurrentFrame();
  const top = max ?? Math.max(...bars.map((b) => b.value));
  const trackWidth = width - labelWidth - 260;
  const rowHeight = bars.length > 4 ? 84 : 104;
  return (
    <div style={{ width, display: "flex", flexDirection: "column", gap: 0 }}>
      {title ? (
        <div
          style={{
            fontFamily: font.mono,
            fontSize: type.label,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: color.textMuted,
            marginBottom: 32,
            opacity: enter(frame, start),
          }}
        >
          {title}
        </div>
      ) : null}
      {bars.map((bar, i) => {
        const at = start + seconds(0.2) + i * stagger;
        const shown = enter(frame, at);
        const grow = progress(frame, at, seconds(1.1));
        const w = top > 0 ? (bar.value / top) * trackWidth * grow : 0;
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", height: rowHeight, opacity: shown }}>
            <div
              style={{
                width: labelWidth,
                paddingRight: 32,
                fontSize: type.label + 4,
                lineHeight: 1.2,
                color: bar.accent ? color.text : color.textMuted,
                textAlign: "right",
              }}
            >
              {bar.label}
            </div>
            <div style={{ position: "relative", width: trackWidth, height: 44 }}>
              <div style={{ position: "absolute", inset: 0, borderRadius: 8, background: color.surface }} />
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: Math.max(w, 0),
                  borderRadius: 8,
                  background: bar.accent ? color.accent : color.line,
                }}
              />
            </div>
            <div
              style={{
                width: 260,
                paddingLeft: 28,
                fontFamily: font.mono,
                fontSize: type.label + 4,
                fontWeight: weight.medium,
                color: bar.accent ? color.accent : color.text,
                fontVariantNumeric: "tabular-nums",
                opacity: progress(frame, at + seconds(0.5), seconds(0.5)),
                whiteSpace: "nowrap",
              }}
            >
              {bar.display ?? String(bar.value)}
            </div>
          </div>
        );
      })}
    </div>
  );
};
