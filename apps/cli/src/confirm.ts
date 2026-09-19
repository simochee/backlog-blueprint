import { APPLY_CONFIRMATION } from "@backlog-blueprint/core";

import { type Io } from "./io";

export const NOT_A_TERMINAL =
  "ERROR  apply requires confirmation, but stdin is not a terminal.\n  → pass --auto-approve to skip the confirmation\n";

export type Confirmation = { confirmed: boolean } | { error: string };

/**
 * 全文の `yes` だけを通す（CL-5）。1文字で通すと Enter の連打で通ってしまい、
 * 課題種別やステータスの削除に対する最後の砦が無くなる。
 *
 * 非 TTY でプロンプトを出さずに拒否するのは CL-6。CI で確認待ちのまま
 * ハングするのが最悪なので、明示的に落としてフラグを足させる。
 */
export const confirmApply = async (io: Io): Promise<Confirmation> => {
  if (!io.isStdinTty) {
    return { error: NOT_A_TERMINAL };
  }

  io.err(APPLY_CONFIRMATION);

  const answer = await io.readLine();

  io.err("\n");

  return { confirmed: answer.trim() === "yes" };
};
