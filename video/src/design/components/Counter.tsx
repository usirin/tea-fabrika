import { useCurrentFrame } from "remotion";
import { enter, progress, seconds } from "../timing";
import { color, font, type, weight } from "../tokens";

const format = (n: number, decimals: number): string =>
  n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/**
 * A number that ticks up from `from` to `to`, with a label under it.
 * Use `prefix`/`suffix` for "$" or "%". `decimals` fixes the digits shown.
 */
export const Counter: React.FC<{
  to: number;
  from?: number;
  label?: string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  /** Frame the count starts at, relative to the enclosing sequence. */
  start?: number;
  /** Seconds the count takes. */
  dur?: number;
  size?: number;
  accent?: boolean;
}> = ({ to, from = 0, label, prefix = "", suffix = "", decimals = 0, start = 0, dur = 1.4, size = 168, accent = false }) => {
  const frame = useCurrentFrame();
  const shown = enter(frame, start);
  const p = progress(frame, start, seconds(dur));
  const value = from + (to - from) * p;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        opacity: shown,
        transform: `translateY(${(1 - shown) * 18}px)`,
      }}
    >
      <div
        style={{
          fontFamily: font.mono,
          fontSize: size,
          fontWeight: weight.medium,
          letterSpacing: "-0.03em",
          lineHeight: 1,
          color: accent ? color.accent : color.text,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {prefix}
        {format(value, decimals)}
        {suffix}
      </div>
      {label ? (
        <div
          style={{
            marginTop: 24,
            fontSize: type.label + 4,
            color: color.textMuted,
            textAlign: "center",
            maxWidth: 520,
            lineHeight: 1.3,
          }}
        >
          {label}
        </div>
      ) : null}
    </div>
  );
};

/** A row of counters, evenly spaced, each starting a little after the last. */
export const CounterRow: React.FC<{
  items: readonly React.ComponentProps<typeof Counter>[];
  start?: number;
  stagger?: number;
}> = ({ items, start = 0, stagger = seconds(0.35) }) => (
  <div style={{ display: "flex", justifyContent: "space-evenly", alignItems: "flex-start", width: "100%" }}>
    {items.map((item, i) => (
      <Counter key={i} {...item} start={(item.start ?? 0) + start + i * stagger} />
    ))}
  </div>
);
