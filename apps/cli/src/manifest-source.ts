import { readFile } from "node:fs/promises";

import { type Io } from "./io";

export const STDIN_PATH = "-";

export type ManifestSource = { path: string; text: string };

export const manifestPath = (file: string): string => (file === STDIN_PATH ? "<stdin>" : file);

export const readManifest = async (file: string, io: Io): Promise<ManifestSource> => ({
  path: manifestPath(file),
  text: file === STDIN_PATH ? await io.readStdin() : await readFile(file, "utf8"),
});
