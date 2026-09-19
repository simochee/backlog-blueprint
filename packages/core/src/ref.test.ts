import { describe, expect, it } from "vitest";

import { embedRef, resolutionKey, resolvePath, resolveRequest } from "./ref";
import { Secret } from "./secret";
import { type ResolutionTable } from "./resolution";
import { type Ref } from "./value";

const otherIssueType: Ref = { $ref: { kind: "issueType", name: "その他" } };

describe("path に埋め込まれた参照", () => {
  it("plan の出力仕様に載っている表記で埋め込まれる", () => {
    const path = `/api/v2/projects/PROJ_A/issueTypes/${embedRef(otherIssueType)}`;

    expect(path).toBe("/api/v2/projects/PROJ_A/issueTypes/{$ref:issueType:その他}");
  });

  it("埋め込みと解決表のキーは同じ組み立てから作られる", () => {
    expect(embedRef(otherIssueType)).toBe(`{$ref:${resolutionKey(otherIssueType)}}`);
  });

  it("埋め込んだ参照は解決表の ID に置き換わる", () => {
    const resolutions: ResolutionTable = new Map([["issueType:その他", 1234]]);

    const result = resolvePath(
      `/api/v2/projects/PROJ_A/issueTypes/${embedRef(otherIssueType)}`,
      resolutions,
    );

    expect(result).toEqual({ resolved: true, value: "/api/v2/projects/PROJ_A/issueTypes/1234" });
  });

  it("参照を含まない path はそのまま返る", () => {
    const result = resolvePath("/api/v2/projects/PROJ_A/issueTypes", new Map());

    expect(result).toEqual({ resolved: true, value: "/api/v2/projects/PROJ_A/issueTypes" });
  });

  it("1つの path にある参照はすべて置き換わる", () => {
    const resolutions: ResolutionTable = new Map([
      ["project:プロジェクトA", 7],
      ["webhook:Slack 通知", 42],
    ]);

    const result = resolvePath(
      `/api/v2/projects/${embedRef({ $ref: { kind: "project", name: "プロジェクトA" } })}/webhooks/${embedRef({ $ref: { kind: "webhook", name: "Slack 通知" } })}`,
      resolutions,
    );

    expect(result).toEqual({ resolved: true, value: "/api/v2/projects/7/webhooks/42" });
  });

  it("解決表に無い参照は失敗として返り、置き換えた path は返らない", () => {
    const result = resolvePath(
      `/api/v2/projects/PROJ_A/issueTypes/${embedRef(otherIssueType)}`,
      new Map(),
    );

    expect(result).toEqual({ resolved: false, unresolved: [otherIssueType] });
  });

  it("解決できない参照は取りこぼさずすべて列挙される", () => {
    const bug: Ref = { $ref: { kind: "issueType", name: "バグ" } };
    const resolutions: ResolutionTable = new Map([["issueType:その他", 1234]]);

    const result = resolvePath(
      `/${embedRef(otherIssueType)}/${embedRef(bug)}/${embedRef({ $ref: { kind: "status", name: "レビュー中" } })}`,
      resolutions,
    );

    expect(result).toEqual({
      resolved: false,
      unresolved: [bug, { $ref: { kind: "status", name: "レビュー中" } }],
    });
  });

  it("リソース種別として知られていない語は参照として扱わない", () => {
    const result = resolvePath("/api/v2/{$ref:issue:1}", new Map());

    expect(result).toEqual({ resolved: true, value: "/api/v2/{$ref:issue:1}" });
  });

  it("リネームで旧名のエントリが消えていれば、旧名を指す参照は解決しない", () => {
    const resolutions: ResolutionTable = new Map([["issueType:調査", 1234]]);

    const result = resolvePath(embedRef(otherIssueType), resolutions);

    expect(result).toEqual({ resolved: false, unresolved: [otherIssueType] });
  });
});

describe("Ref を解決したリクエスト", () => {
  const bug: Ref = { $ref: { kind: "issueType", name: "バグ" } };

  it("params にある参照も ID に置き換わる", () => {
    const resolutions: ResolutionTable = new Map([["issueType:バグ", 1234]]);

    const result = resolveRequest(
      {
        method: "POST",
        path: "/api/v2/projects/PROJ_A/customFields",
        params: { name: "影響範囲", applicableIssueTypes: bug },
      },
      resolutions,
    );

    expect(result).toEqual({
      resolved: true,
      value: {
        method: "POST",
        path: "/api/v2/projects/PROJ_A/customFields",
        params: { name: "影響範囲", applicableIssueTypes: 1234 },
      },
    });
  });

  it("配列に並んだ参照はすべて ID に置き換わる", () => {
    const resolutions: ResolutionTable = new Map([
      ["issueType:バグ", 1234],
      ["issueType:調査", 5678],
    ]);

    const result = resolveRequest(
      {
        method: "POST",
        path: "/api/v2/projects/PROJ_A/customFields",
        params: { applicableIssueTypes: [bug, { $ref: { kind: "issueType", name: "調査" } }] },
      },
      resolutions,
    );

    expect(result).toEqual({
      resolved: true,
      value: {
        method: "POST",
        path: "/api/v2/projects/PROJ_A/customFields",
        params: { applicableIssueTypes: [1234, 5678] },
      },
    });
  });

  it("Secret は解決を通しても Secret のまま残り、実値は現れない", () => {
    const result = resolveRequest(
      {
        method: "POST",
        path: "/api/v2/projects/PROJ_A/webhooks",
        params: { name: "Slack 通知", hookUrl: new Secret("https://hooks.example.test/T000/B000") },
      },
      new Map(),
    );

    expect(result.resolved).toBe(true);

    if (!result.resolved) {
      return;
    }

    expect(result.value.params["hookUrl"]).toBeInstanceOf(Secret);
    expect(JSON.stringify(result.value.params)).toBe('{"name":"Slack 通知","hookUrl":"***"}');
  });

  it("params の参照が解決できなければリクエストは組み上がらない", () => {
    const result = resolveRequest(
      {
        method: "POST",
        path: "/api/v2/projects/PROJ_A/customFields",
        params: { applicableIssueTypes: [bug] },
      },
      new Map(),
    );

    expect(result).toEqual({ resolved: false, unresolved: [bug] });
  });

  it("path と params のどちらの参照も取りこぼさず列挙される", () => {
    const result = resolveRequest(
      {
        method: "PATCH",
        path: `/api/v2/projects/PROJ_A/issueTypes/${embedRef(otherIssueType)}`,
        params: { applicableIssueTypes: [bug] },
      },
      new Map(),
    );

    expect(result).toEqual({ resolved: false, unresolved: [otherIssueType, bug] });
  });
});
