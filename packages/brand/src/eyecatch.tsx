import {
  DimensionLine,
  GridPaper,
  SheetFrame,
  type SheetLayout,
  SheetZoneLabels,
  TitleBlock,
} from "./parts";
import { color, font } from "./theme";

export const eyecatchSize = { width: 1280, height: 640 };

const sheet: SheetLayout = { ...eyecatchSize, outer: 20, inner: 40, columns: 8, rows: 4 };

const titleWidth = 720;

const SpreadWord = ({ word, width, style }: { word: string; width: number; style: object }) => (
  <div style={{ display: "flex", justifyContent: "space-between", width, ...style }}>
    {[...word].map((letter, i) => (
      <span key={`${letter}${i}`}>{letter}</span>
    ))}
  </div>
);

const CompassMark = ({ cx, cy, r }: { cx: number; cy: number; r: number }) => (
  <svg
    width={eyecatchSize.width}
    height={eyecatchSize.height}
    viewBox={`0 0 ${eyecatchSize.width} ${eyecatchSize.height}`}
    style={{ position: "absolute", top: 0, left: 0 }}
  >
    <circle
      cx={cx}
      cy={cy}
      r={r}
      fill="none"
      stroke={color.line}
      strokeOpacity={0.35}
      strokeWidth={1}
    />
    <circle
      cx={cx}
      cy={cy}
      r={r * 0.62}
      fill="none"
      stroke={color.line}
      strokeOpacity={0.35}
      strokeWidth={1}
      strokeDasharray="6 6"
    />
    <line
      x1={cx - r - 24}
      y1={cy}
      x2={cx + r + 24}
      y2={cy}
      stroke={color.line}
      strokeOpacity={0.35}
      strokeDasharray="18 4 3 4"
    />
    <line
      x1={cx}
      y1={cy - r - 24}
      x2={cx}
      y2={cy + r + 24}
      stroke={color.line}
      strokeOpacity={0.35}
      strokeDasharray="18 4 3 4"
    />
    <circle cx={cx} cy={cy} r={4} fill="none" stroke={color.line} strokeWidth={1.5} />
  </svg>
);

export const Eyecatch = () => (
  <div
    style={{
      display: "flex",
      position: "relative",
      width: eyecatchSize.width,
      height: eyecatchSize.height,
      backgroundColor: color.paper,
    }}
  >
    <GridPaper {...eyecatchSize} />
    <CompassMark cx={1030} cy={250} r={150} />
    <SheetFrame {...sheet} />
    <SheetZoneLabels {...sheet} />

    <div
      style={{
        position: "absolute",
        left: 120,
        top: 150,
        display: "flex",
        flexDirection: "column",
        color: color.ink,
      }}
    >
      <div
        style={{
          display: "flex",
          fontFamily: font.mono,
          fontSize: 30,
          fontWeight: 700,
          letterSpacing: 14,
          marginBottom: 4,
        }}
      >
        BACKLOG
      </div>
      <SpreadWord
        word="BLUEPRINT"
        width={titleWidth}
        style={{ fontFamily: font.display, fontSize: 180, lineHeight: 0.9, marginBottom: 20 }}
      />
      <DimensionLine width={titleWidth} label="MANIFEST -> PROJECT" />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          marginTop: 56,
          fontFamily: font.hand,
          fontSize: 26,
          lineHeight: 1.35,
          color: color.ink,
          transform: "rotate(-2deg)",
          transformOrigin: "left center",
        }}
      >
        <span>Create a Backlog project from a YAML manifest.</span>
        <span style={{ alignSelf: "flex-end" }}>Validate it, review the plan, then apply it.</span>
      </div>
    </div>

    <div style={{ position: "absolute", right: 40, bottom: 40, display: "flex" }}>
      <TitleBlock
        width={340}
        rows={[
          { label: "PROJECT", value: "BACKLOG BLUEPRINT" },
          { label: "DWG NO.", value: "BB-001" },
          { label: "SCALE", value: "1 : 1" },
          { label: "AUTHOR", value: "@simochee" },
        ]}
      />
    </div>
  </div>
);
