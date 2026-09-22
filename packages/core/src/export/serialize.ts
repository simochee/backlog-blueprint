import { stringify } from "yaml";

import {
  type Category,
  type CustomField,
  type IssueType,
  type ManifestInput,
  type Milestone,
  type Settings,
  type Status,
  type Webhook,
} from "../manifest";

export type SerializeOptions = {
  /** 実行中のツールの版。`$schema` の URL に入る（EX-15 / D-2） */
  version: string;
};

const DISTRIBUTION_ORIGIN = "https://simochee.github.io/backlog-blueprint";

export const projectSchemaUrl = (version: string): string =>
  `${DISTRIBUTION_ORIGIN}/schema/${version}/project.json`;

/**
 * `version` / `schema` / `resolveKnownTags` は S1 の `PARSE_OPTIONS` と同じ値でなければ
 * ならない。YAML 1.1 では `yes` / `no` / `on` / `off` が真偽値なので、書く側と読む側で
 * 版がずれると、その名前を持つリソースだけが読み戻せなくなる。
 *
 * 既定のままにできない残り4つ。`aliasDuplicateObjects` を切らないと同じ内容の要素が
 * `&a1` / `*a1` になる。`lineWidth: 0` を渡さないと80桁で折り返し、長い1行は
 * 二重引用符と継続行に化ける。`blockQuote: "literal"` は折り畳みスカラー（`>`）を
 * 選ばせない。折り畳みは空白を再構成するので末尾改行の有無が値のとおりに残らない。
 * `singleQuote: false` が無いと、二重引用符を含む値だけ単引用符で囲まれる。
 */
const STRINGIFY_OPTIONS = {
  version: "1.2",
  schema: "core",
  resolveKnownTags: false,
  indent: 2,
  indentSeq: true,
  lineWidth: 0,
  blockQuote: "literal",
  singleQuote: false,
  aliasDuplicateObjects: false,
  sortMapEntries: false,
} as const;

type KeyOrder<Value> = Record<keyof Value, null>;

type Unordered<Key extends string> = Partial<Record<Key, unknown>>;

/**
 * 並びを文字列の配列で持たない。`Record<keyof Value, null>` はスキーマにキーが増えたとき
 * 型エラーになるが、配列は書き漏らしたキーを黙って出力から落とす。
 */
const inOrder = <Key extends string>(
  order: Record<Key, null>,
  value: Unordered<Key>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.keys(order)
      .map((key) => [key, value[key as Key]] as const)
      .filter(([, item]) => item !== undefined),
  );

const inOrderEach = <Key extends string>(
  order: Record<Key, null>,
  items: Unordered<Key>[] | undefined,
): Record<string, unknown>[] | undefined => items?.map((item) => inOrder(order, item));

const SETTINGS_ORDER: KeyOrder<Settings> = {
  textFormattingRule: null,
  chartEnabled: null,
  useResolvedForChart: null,
  subtaskingEnabled: null,
  grandchildIssueEnabled: null,
  projectLeaderCanEditProjectLeader: null,
  useWiki: null,
  useWikiTreeView: null,
  useOriginalImageSizeAtWiki: null,
  useDocument: null,
  useFileSharing: null,
  useGit: null,
  useSubversion: null,
  useDevAttributes: null,
};

const ISSUE_TYPE_ORDER: KeyOrder<IssueType> = {
  name: null,
  color: null,
  templateSummary: null,
  templateDescription: null,
  oldname: null,
};

const STATUS_ORDER: KeyOrder<Status> = { name: null, color: null, oldname: null };

const CATEGORY_ORDER: KeyOrder<Category> = { name: null, oldname: null };

const MILESTONE_ORDER: KeyOrder<Milestone> = {
  name: null,
  description: null,
  startDate: null,
  releaseDueDate: null,
  oldname: null,
};

const CUSTOM_FIELD_ORDER: KeyOrder<CustomField> = {
  name: null,
  type: null,
  description: null,
  required: null,
  applicableIssueTypes: null,
  oldname: null,
  min: null,
  max: null,
  initialValue: null,
  unit: null,
  initialDate: null,
  initialValueType: null,
  initialShift: null,
  items: null,
  allowInput: null,
  allowAddItem: null,
};

const WEBHOOK_ORDER: KeyOrder<Webhook> = {
  name: null,
  description: null,
  hookUrl: null,
  events: null,
};

type AccessInput = NonNullable<ManifestInput["access"]>;

const ACCESS_ORDER: KeyOrder<AccessInput> = { teams: null, members: null, administrators: null };

type ManifestBody = Omit<ManifestInput, "$schema">;

const MANIFEST_ORDER: KeyOrder<ManifestBody> = {
  key: null,
  name: null,
  settings: null,
  issueTypes: null,
  statuses: null,
  categories: null,
  milestones: null,
  customFields: null,
  access: null,
  webhooks: null,
};

/**
 * 空になった `settings` を `{}` として書かない（EX-14）。K-3 のもとで
 * `settings: {}` は読み手に何も伝えない。配列キーは0件でも書くので通さない。
 */
const omitEmpty = (value: Record<string, unknown>): Record<string, unknown> | undefined =>
  Object.keys(value).length > 0 ? value : undefined;

const manifestBody = (manifest: ManifestInput): Record<string, unknown> =>
  inOrder(MANIFEST_ORDER, {
    key: manifest.key,
    name: manifest.name,
    settings: manifest.settings && omitEmpty(inOrder(SETTINGS_ORDER, manifest.settings)),
    issueTypes: inOrderEach(ISSUE_TYPE_ORDER, manifest.issueTypes),
    statuses: inOrderEach(STATUS_ORDER, manifest.statuses),
    categories: inOrderEach(CATEGORY_ORDER, manifest.categories),
    milestones: inOrderEach(MILESTONE_ORDER, manifest.milestones),
    customFields: inOrderEach(CUSTOM_FIELD_ORDER, manifest.customFields),
    access: manifest.access && inOrder(ACCESS_ORDER, manifest.access),
    webhooks: inOrderEach(WEBHOOK_ORDER, manifest.webhooks),
  });

export const serializeManifest = (manifest: ManifestInput, options: SerializeOptions): string =>
  `# yaml-language-server: $schema=${projectSchemaUrl(options.version)}\n${stringify(manifestBody(manifest), STRINGIFY_OPTIONS)}`;
