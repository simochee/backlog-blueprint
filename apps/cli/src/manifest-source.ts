import { readFile } from "node:fs/promises";

import { type Io } from "./io";

export const STDIN_PATH = "-";

export type ManifestSource = { path: string; text: string };

export const readManifest = async (file: string, io: Io): Promise<ManifestSource> =>
  file === STDIN_PATH
    ? { path: "<stdin>", text: await io.readStdin() }
    : { path: file, text: await readFile(file, "utf8") };
