import { createInterface } from "node:readline";

/**
 * stdout と stderr を1つのロガーにまとめない。`--output json` のとき stdout に
 * 書いてよいのは JSON だけで（PO-7）、書き分けを呼び出し側の規律に任せると
 * `| jq` が黙って壊れる。
 */
export type Io = {
  out: (text: string) => void;
  err: (text: string) => void;
  readStdin: () => Promise<string>;
  readLine: () => Promise<string>;
  isStdinTty: boolean;
  env: Record<string, string | undefined>;
};

const readAll = async (stream: NodeJS.ReadableStream): Promise<string> => {
  const chunks: string[] = [];

  stream.setEncoding("utf8");

  for await (const chunk of stream) {
    chunks.push(chunk as string);
  }

  return chunks.join("");
};

export const processIo = (): Io => ({
  out: (text) => {
    process.stdout.write(text);
  },
  err: (text) => {
    process.stderr.write(text);
  },
  readStdin: () => readAll(process.stdin),
  readLine: async () => {
    const reader = createInterface({ input: process.stdin });

    try {
      for await (const line of reader) {
        return line;
      }

      return "";
    } finally {
      reader.close();
    }
  },
  isStdinTty: process.stdin.isTTY === true,
  env: process.env,
});
