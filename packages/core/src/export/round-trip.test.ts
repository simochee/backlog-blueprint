import { describe, expect, it } from "vitest";

import { exportableResourceSnapshots, fixedSnapshot } from "../../../test-utils/src/index";
import { normalizeManifest } from "../manifest";
import { type ResourceSnapshots } from "../plan";
import { planActions } from "../planner";
import { resultingOrder } from "../resulting-order";
import { validatePlan } from "../validation/plan-stage";
import { validateAgainstSnapshot } from "../validation/snapshot-stage";
import { toManifest } from "./to-manifest";

const exportedManifest = (snapshots: ResourceSnapshots) => {
  const { manifest } = toManifest(snapshots);

  if (manifest === undefined) {
    throw new Error("expected a manifest");
  }

  return normalizeManifest(manifest);
};

const roundTrip = (snapshots: ResourceSnapshots) => {
  const manifest = exportedManifest(snapshots);
  const snapshot = fixedSnapshot();
  const actions = planActions(manifest, snapshots, { manifest, snapshot });

  return {
    writes: actions.filter(({ writeRequest }) => writeRequest).map(({ id }) => id),
    againstSnapshot: validateAgainstSnapshot({ manifest, snapshot, snapshots }),
    againstPlan: validatePlan({
      manifest,
      snapshot,
      snapshots,
      actions,
      order: resultingOrder(manifest, snapshots, actions),
    }),
  };
};

describe("書き出したマニフェストを同じプロジェクトへ読み戻す（EX-18 (1)）", () => {
  it("書き出しは診断を1件も出さない", () => {
    expect(toManifest(exportableResourceSnapshots()).diagnostics).toEqual([]);
  });

  it("書き出したマニフェストを同じプロジェクトに計画すると、更新系の Action が1件も出ない", () => {
    expect(roundTrip(exportableResourceSnapshots()).writes).toEqual([]);
  });

  it("書き出したマニフェストは S6 の検証を1件も落とさない", () => {
    expect(roundTrip(exportableResourceSnapshots()).againstSnapshot).toEqual([]);
  });

  it("書き出したマニフェストは S7 の検証でエラーも警告も出さない", () => {
    expect(roundTrip(exportableResourceSnapshots()).againstPlan).toEqual([]);
  });
});

const withPersonalTeamMember = (): ResourceSnapshots => {
  const snapshots = exportableResourceSnapshots();

  return {
    ...snapshots,
    access: {
      ...snapshots.access,
      members: [...snapshots.access.members, { id: 3, name: "田中 一郎" }],
    },
  };
};

describe("チーム経由で参加している人が個人参加も持つとき（EX-8）", () => {
  it("チーム経由の個人参加者を残しても、更新系の Action は1件も出ない", () => {
    expect(roundTrip(withPersonalTeamMember()).writes).toEqual([]);
  });

  it("チーム経由の個人参加者について V-A16 の警告だけが出る", () => {
    expect(roundTrip(withPersonalTeamMember()).againstPlan).toEqual([
      expect.objectContaining({
        id: "V-A16",
        severity: "warning",
        path: "access/members/1",
      }),
    ]);
  });
});
