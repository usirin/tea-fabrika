import { useCurrentFrame } from "remotion";
import { enter, progress, seconds } from "../timing";
import { color, font, layout, stage, type, weight } from "../tokens";

export type FlowNode = {
  id: string;
  label: string;
  /** A smaller second line under the label. */
  sub?: string;
  /** Centre of the box, in the diagram's own px (0..width, 0..height). */
  x: number;
  y: number;
  w?: number;
  h?: number;
  /** Paint the box in the accent. One per diagram, ideally. */
  accent?: boolean;
  /** Draw the box faint, for the old way, or something not built. */
  muted?: boolean;
  /** Frame the box appears at. Defaults to its turn in the stagger. */
  at?: number;
};

export type FlowEdge = {
  from: string;
  to: string;
  label?: string;
  /** Curve the arrow sideways by this many px (negative bends the other way). */
  bend?: number;
  dashed?: boolean;
  accent?: boolean;
  /** Frame the arrow starts drawing at. Defaults to just after both ends appear. */
  at?: number;
};

const DEFAULT_W = 280;
const DEFAULT_H = 112;
const GAP = 12;

type Pt = { x: number; y: number };

/** Where a ray from the centre of a box towards `toward` leaves the box. */
const exitPoint = (n: FlowNode, toward: Pt): Pt => {
  const hw = (n.w ?? DEFAULT_W) / 2 + GAP;
  const hh = (n.h ?? DEFAULT_H) / 2 + GAP;
  const dx = toward.x - n.x;
  const dy = toward.y - n.y;
  const t = Math.min(dx === 0 ? Infinity : hw / Math.abs(dx), dy === 0 ? Infinity : hh / Math.abs(dy));
  return { x: n.x + dx * t, y: n.y + dy * t };
};

/** Lay `labels` out evenly in one row. Returns nodes you can spread and tweak. */
export const row = (
  items: readonly { id: string; label: string; sub?: string }[],
  opts: { y?: number; width?: number; w?: number } = {},
): FlowNode[] => {
  const width = opts.width ?? stage.width;
  const step = width / items.length;
  return items.map((it, i) => ({ ...it, x: step * (i + 0.5), y: opts.y ?? stage.height / 2, w: opts.w }));
};

/**
 * Boxes and arrows that draw on in order. Boxes appear one after another, then
 * each arrow draws from its source to its target once both ends are on screen.
 * Coordinates are px in a `width` x `height` box (defaults to the visual area).
 * Box sizes are fixed so arrows can find their edges: keep a label to one line
 * at its width (about 15px per character) or pass a larger `w`.
 */
export const FlowDiagram: React.FC<{
  nodes: readonly FlowNode[];
  edges?: readonly FlowEdge[];
  start?: number;
  stagger?: number;
  width?: number;
  height?: number;
}> = ({ nodes, edges = [], start = 0, stagger = seconds(0.3), width = stage.width, height = stage.height }) => {
  const frame = useCurrentFrame();
  const appearAt = new Map(nodes.map((n, i) => [n.id, n.at ?? start + i * stagger]));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div style={{ position: "relative", width, height }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        {edges.map((e, i) => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          if (!a || !b) throw new Error(`FlowDiagram: edge ${e.from} -> ${e.to} names a node that does not exist`);
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          const bend = e.bend ?? 0;
          const ctrl = { x: mid.x + (-(b.y - a.y) / len) * bend, y: mid.y + ((b.x - a.x) / len) * bend };
          const p0 = exitPoint(a, bend ? ctrl : b);
          const p1 = exitPoint(b, bend ? ctrl : a);
          const d = bend
            ? `M ${p0.x} ${p0.y} Q ${ctrl.x} ${ctrl.y} ${p1.x} ${p1.y}`
            : `M ${p0.x} ${p0.y} L ${p1.x} ${p1.y}`;
          const at = e.at ?? Math.max(appearAt.get(e.from) ?? 0, appearAt.get(e.to) ?? 0) + seconds(0.25);
          const p = progress(frame, at, seconds(0.7));
          const tip = bend ? ctrl : p0;
          const angle = Math.atan2(p1.y - tip.y, p1.x - tip.x);
          const stroke = e.accent ? color.accent : color.textFaint;
          const head = 16;
          const labelPt = bend
            ? { x: 0.25 * p0.x + 0.5 * ctrl.x + 0.25 * p1.x, y: 0.25 * p0.y + 0.5 * ctrl.y + 0.25 * p1.y }
            : { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
          return (
            <g key={i}>
              <path
                d={d}
                fill="none"
                stroke={stroke}
                strokeWidth={3}
                strokeLinecap="round"
                pathLength={1}
                strokeDasharray={e.dashed ? "0.02 0.02" : "1 1"}
                strokeDashoffset={e.dashed ? 0 : 1 - p}
                opacity={e.dashed ? p : 1}
              />
              <polygon
                points={`0,0 ${-head},${-head * 0.55} ${-head},${head * 0.55}`}
                fill={stroke}
                transform={`translate(${p1.x} ${p1.y}) rotate(${(angle * 180) / Math.PI})`}
                opacity={progress(frame, at + seconds(0.55), seconds(0.2))}
              />
              {e.label ? (
                <text
                  x={labelPt.x}
                  y={labelPt.y - 18}
                  textAnchor="middle"
                  fill={color.textMuted}
                  fontFamily={font.mono}
                  fontSize={type.label - 4}
                  opacity={progress(frame, at + seconds(0.4), seconds(0.4))}
                >
                  {e.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {nodes.map((n) => {
        const s = enter(frame, appearAt.get(n.id) ?? 0);
        const w = n.w ?? DEFAULT_W;
        const h = n.h ?? DEFAULT_H;
        return (
          <div
            key={n.id}
            style={{
              position: "absolute",
              left: n.x - w / 2,
              top: n.y - h / 2,
              width: w,
              height: h,
              borderRadius: layout.radius,
              background: n.accent ? color.accentSoft : color.surface,
              border: `2px solid ${n.accent ? color.accent : color.line}`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              padding: "0 18px",
              opacity: s * (n.muted ? 0.45 : 1),
              transform: `scale(${0.94 + 0.06 * s})`,
            }}
          >
            <div
              style={{
                fontSize: type.label + 6,
                fontWeight: weight.semibold,
                color: n.accent ? color.accent : color.text,
                lineHeight: 1.15,
              }}
            >
              {n.label}
            </div>
            {n.sub ? (
              <div style={{ marginTop: 8, fontSize: type.label - 4, color: color.textMuted, lineHeight: 1.2 }}>
                {n.sub}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
