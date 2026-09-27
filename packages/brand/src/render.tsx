import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";
import satori, { type Font } from "satori";
import { type ReactNode } from "react";
import { Eyecatch, eyecatchSize } from "./eyecatch";
import { iconSvg } from "./icon";
import { font } from "./theme";

const here = (path: string) => new URL(path, import.meta.url);

const loadFont = async (name: string, file: string, weight: Font["weight"]): Promise<Font> => ({
  name,
  data: await readFile(here(`../fonts/${file}`)),
  weight,
  style: "normal",
});

const fonts = await Promise.all([
  loadFont(font.display, "BigShouldersStencilDisplay-ExtraBold.ttf", 800),
  loadFont(font.mono, "JetBrainsMono-Regular.ttf", 400),
  loadFont(font.mono, "JetBrainsMono-Bold.ttf", 700),
  loadFont(font.hand, "PermanentMarker-Regular.ttf", 400),
]);

type Target = { name: string; width: number; height: number; element: ReactNode };

const targets: Target[] = [{ name: "eyecatch", ...eyecatchSize, element: <Eyecatch /> }];

const outDir = here("../out/");
await mkdir(outDir, { recursive: true });

for (const { name, width, height, element } of targets) {
  const svg = await satori(element, { width, height, fonts });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: width * 2 } }).render().asPng();
  await writeFile(new URL(`${name}.svg`, outDir), svg);
  await writeFile(new URL(`${name}.png`, outDir), png);
  console.log(`out/${name}.svg, out/${name}.png (${width * 2}x${height * 2})`);
}

const webPublic = here("../../../apps/web/public/");
await mkdir(webPublic, { recursive: true });

const appleTouchIconSize = 180;
await writeFile(new URL("favicon.svg", webPublic), iconSvg({ cornerRadius: 6 }));
await writeFile(
  new URL("apple-touch-icon.png", webPublic),
  new Resvg(iconSvg({ cornerRadius: 0 }), { fitTo: { mode: "width", value: appleTouchIconSize } })
    .render()
    .asPng(),
);
console.log(
  `apps/web/public/favicon.svg, apps/web/public/apple-touch-icon.png (${appleTouchIconSize}x${appleTouchIconSize})`,
);
