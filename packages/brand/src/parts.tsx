import { type ReactNode } from "react";
import { color, font, grid } from "./theme";

type Size = { width: number; height: number };

const Layer = ({ width, height, children }: Size & { children: ReactNode }) => (
  <svg
    width={width}
    height={height}
    viewBox={`0 0 ${width} ${height}`}
    style={{ position: "absolute", top: 0, left: 0 }}
  >
    {children}
  </svg>
);

export const GridPaper = ({ width, height }: Size) => (
  <Layer width={width} height={height}>
    <defs>
      <radialGradient id="vignette" cx="50%" cy="45%" r="75%">
        <stop offset="0%" stopColor={color.paper} />
        <stop offset="100%" stopColor={color.paperDeep} />
      </radialGradient>
      <pattern id="minor" width={grid.minor} height={grid.minor} patternUnits="userSpaceOnUse">
        <path
          d={`M ${grid.minor} 0 L 0 0 0 ${grid.minor}`}
          fill="none"
          stroke={color.gridMinor}
          strokeWidth={1}
        />
      </pattern>
      <pattern id="major" width={grid.major} height={grid.major} patternUnits="userSpaceOnUse">
        <path
          d={`M ${grid.major} 0 L 0 0 0 ${grid.major}`}
          fill="none"
          stroke={color.gridMajor}
          strokeWidth={1.5}
        />
      </pattern>
    </defs>
    <rect width={width} height={height} fill="url(#vignette)" />
    <rect width={width} height={height} fill="url(#minor)" />
    <rect width={width} height={height} fill="url(#major)" />
  </Layer>
);

export type SheetLayout = Size & { outer: number; inner: number; columns: number; rows: number };

const faint = { stroke: color.line, strokeOpacity: 0.55, strokeWidth: 1 };

export const SheetFrame = ({ width, height, outer, inner, columns, rows }: SheetLayout) => {
  const w = width - inner * 2;
  const h = height - inner * 2;
  const columnXs = Array.from({ length: columns - 1 }, (_, i) => inner + (w / columns) * (i + 1));
  const rowYs = Array.from({ length: rows - 1 }, (_, i) => inner + (h / rows) * (i + 1));
  const mark = outer - 12;
  const arm = 12;
  const corners: [number, number, number, number][] = [
    [mark, mark, 1, 1],
    [width - mark, mark, -1, 1],
    [mark, height - mark, 1, -1],
    [width - mark, height - mark, -1, -1],
  ];
  return (
    <Layer width={width} height={height}>
      <rect
        x={outer}
        y={outer}
        width={width - outer * 2}
        height={height - outer * 2}
        fill="none"
        {...faint}
      />
      <rect
        x={inner}
        y={inner}
        width={w}
        height={h}
        fill="none"
        stroke={color.line}
        strokeWidth={2.5}
      />
      {columnXs.map((x) => (
        <g key={`c${x}`}>
          <line x1={x} y1={outer} x2={x} y2={inner} {...faint} />
          <line x1={x} y1={height - inner} x2={x} y2={height - outer} {...faint} />
        </g>
      ))}
      {rowYs.map((y) => (
        <g key={`r${y}`}>
          <line x1={outer} y1={y} x2={inner} y2={y} {...faint} />
          <line x1={width - inner} y1={y} x2={width - outer} y2={y} {...faint} />
        </g>
      ))}
      {corners.map(([x, y, dx, dy]) => (
        <path
          key={`${x}-${y}`}
          d={`M ${x} ${y + dy * arm} L ${x} ${y} L ${x + dx * arm} ${y}`}
          fill="none"
          stroke={color.line}
          strokeWidth={1.5}
        />
      ))}
    </Layer>
  );
};

const zoneText = {
  position: "absolute",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  fontFamily: font.mono,
  fontSize: 10,
  color: color.inkMuted,
} as const;

export const SheetZoneLabels = ({ width, height, outer, inner, columns, rows }: SheetLayout) => {
  const cellW = (width - inner * 2) / columns;
  const cellH = (height - inner * 2) / rows;
  const band = inner - outer;
  const columnLabels = Array.from({ length: columns }, (_, i) => String(i + 1));
  const rowLabels = Array.from({ length: rows }, (_, i) => String.fromCodePoint(65 + i));
  return (
    <>
      {columnLabels.flatMap((label, i) =>
        [outer, height - inner].map((top) => (
          <div
            key={`c${label}-${top}`}
            style={{ ...zoneText, left: inner + cellW * i, top, width: cellW, height: band }}
          >
            {label}
          </div>
        )),
      )}
      {rowLabels.flatMap((label, i) =>
        [outer, width - inner].map((left) => (
          <div
            key={`r${label}-${left}`}
            style={{ ...zoneText, left, top: inner + cellH * i, width: band, height: cellH }}
          >
            {label}
          </div>
        )),
      )}
    </>
  );
};

const Arrowhead = ({ pointing }: { pointing: "left" | "right" }) => (
  <svg width={10} height={18} viewBox="0 0 10 18">
    {pointing === "left" ? (
      <>
        <line x1={0.75} y1={0} x2={0.75} y2={18} stroke={color.line} strokeWidth={1.5} />
        <path d="M 1.5 9 L 10 5.5 L 10 12.5 Z" fill={color.line} />
      </>
    ) : (
      <>
        <line x1={9.25} y1={0} x2={9.25} y2={18} stroke={color.line} strokeWidth={1.5} />
        <path d="M 8.5 9 L 0 5.5 L 0 12.5 Z" fill={color.line} />
      </>
    )}
  </svg>
);

const Rule = () => (
  <div style={{ display: "flex", flex: 1, height: 1, backgroundColor: color.line }} />
);

export const DimensionLine = ({ width, label }: { width: number; label: string }) => (
  <div style={{ display: "flex", alignItems: "center", width, height: 18 }}>
    <Arrowhead pointing="left" />
    <Rule />
    <div
      style={{
        display: "flex",
        padding: "0 14px",
        fontFamily: font.mono,
        fontSize: 14,
        letterSpacing: 2,
        color: color.ink,
      }}
    >
      {label}
    </div>
    <Rule />
    <Arrowhead pointing="right" />
  </div>
);

export type TitleBlockRow = { label: string; value: string };

export const TitleBlock = ({ rows, width }: { rows: TitleBlockRow[]; width: number }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      width,
      border: `2px solid ${color.line}`,
      backgroundColor: "rgba(18, 58, 107, 0.6)",
    }}
  >
    {rows.map(({ label, value }, i) => (
      <div
        key={label}
        style={{
          display: "flex",
          borderTop: i === 0 ? "none" : `1px solid ${color.line}`,
          fontFamily: font.mono,
        }}
      >
        <div
          style={{
            display: "flex",
            width: 92,
            padding: "6px 10px",
            borderRight: `1px solid ${color.line}`,
            fontSize: 10,
            letterSpacing: 1.5,
            color: color.inkMuted,
          }}
        >
          {label}
        </div>
        <div
          style={{
            display: "flex",
            flex: 1,
            padding: "5px 10px",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 1,
            color: color.ink,
          }}
        >
          {value}
        </div>
      </div>
    ))}
  </div>
);
