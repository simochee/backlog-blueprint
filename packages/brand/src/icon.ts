import { color } from "./theme";

export const iconSvg = ({ cornerRadius }: { cornerRadius: number }) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="${cornerRadius}" fill="${color.paper}"/>
  <path d="M8 0V32M16 0V32M24 0V32M0 8H32M0 16H32M0 24H32" stroke="${color.gridMajor}"/>
  <rect x="5" y="5" width="22" height="22" fill="none" stroke="${color.line}" stroke-width="2.5"/>
  <path d="M15 27V19H27M15 23H27" fill="none" stroke="${color.line}" stroke-width="2"/>
  <path d="M9 9H20M9 9V15" fill="none" stroke="${color.line}" stroke-width="1.5" stroke-opacity=".7"/>
</svg>
`;
