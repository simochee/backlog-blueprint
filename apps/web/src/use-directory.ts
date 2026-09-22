import { useActionState } from "react";

import { readDirectory, type DirectoryEntry, type DirectoryKind } from "./directory";
import { fresh, type Derived } from "./freshness";
import { transport } from "./transport";

type DirectoryAttempt = { entries?: DirectoryEntry[]; failure?: unknown };

export type Directory = DirectoryAttempt & {
  loading: boolean;
  load: () => void;
  settled: boolean;
};

/** WU-15 / WU-22。一覧は接続の印に紐づけ、別の接続で取ったものは `fresh` が弾く。 */
export const useDirectory = (kind: DirectoryKind, connectionKey: string): Directory => {
  const [attempt, load, loading] = useActionState<Derived<DirectoryAttempt> | undefined>(
    async () => {
      const stamp = connectionKey;

      try {
        return { stamp, value: { entries: await readDirectory(kind, transport.get) } };
      } catch (error) {
        return { stamp, value: { failure: error } };
      }
    },
    undefined,
  );
  const current = fresh(attempt, connectionKey);

  return { ...current, loading, load, settled: current !== undefined };
};
