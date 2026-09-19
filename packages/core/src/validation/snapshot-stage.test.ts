import { describe, expect, it } from "vitest";

import { fixedManifest } from "../../../test-utils/src/index";
import { type Settings } from "../manifest";
import { type ProjectSettingsSnapshot, type ProjectSnapshot } from "../resources/project";
import { validateAgainstSnapshot } from "./snapshot-stage";

const existing = (settings: ProjectSettingsSnapshot = {}) =>
  ({ exists: true, id: 100, name: "プロジェクトA", settings }) satisfies ProjectSnapshot;

const validate = (settings: Settings, project: ProjectSnapshot) =>
  validateAgainstSnapshot({ manifest: fixedManifest({ settings }), project });

const idsOf = (settings: Settings, project: ProjectSnapshot) =>
  validate(settings, project).map(({ id }) => id);

describe("孫課題の設定（V-A12）", () => {
  it("子課題を明示的に無効にして孫課題を有効にするとエラーになる", () => {
    expect(idsOf({ grandchildIssueEnabled: true, subtaskingEnabled: false }, existing())).toEqual([
      "V-A12",
    ]);
  });

  it("どちらも有効ならエラーにならない", () => {
    expect(idsOf({ grandchildIssueEnabled: true, subtaskingEnabled: true }, existing())).toEqual(
      [],
    );
  });

  it("子課題の設定を省いても、現状が有効ならエラーにならない", () => {
    expect(idsOf({ grandchildIssueEnabled: true }, existing({ subtaskingEnabled: true }))).toEqual(
      [],
    );
  });

  it("子課題の設定を省いて現状も無効ならエラーになる", () => {
    const [diagnostic] = validate(
      { grandchildIssueEnabled: true },
      existing({ subtaskingEnabled: false }),
    );

    expect(diagnostic).toMatchObject({
      id: "V-A12",
      severity: "error",
      stage: "snapshot",
      path: "settings/grandchildIssueEnabled",
    });
    expect(diagnostic?.message).toContain("PROJ_A");
  });

  it("未作成のプロジェクトでは、子課題の設定を省くとエラーになる", () => {
    expect(idsOf({ grandchildIssueEnabled: true }, { exists: false })).toEqual(["V-A12"]);
  });

  it("孫課題を有効にしていなければ何も判定しない", () => {
    expect(idsOf({ subtaskingEnabled: false }, existing())).toEqual([]);
  });

  it("位置情報は持たない", () => {
    const [diagnostic] = validate({ grandchildIssueEnabled: true }, { exists: false });

    expect(diagnostic).not.toHaveProperty("line");
  });
});
