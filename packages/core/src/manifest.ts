import { Type, type SchemaOptions, type Static, type TProperties } from "@sinclair/typebox";

import { WEBHOOK_EVENTS, type WebhookEvent } from "./webhook-events";

/**
 * `Type.Union([Type.Literal(...)])` に置き換えない。TypeBox の Union は
 * `anyOf` の `const` 列を出し、`enum` キーワードを出さない。マニフェストのスキーマ定義
 * §5 / §6 / §7 / §9 は色や型を `enum` と決めており、生成物を読む人と
 * エディタの補完が見るキーワードは決定どおりでなければならない。
 * `Type.Unsafe` は TypeBox 自身の `Value` 検証を素通りさせるが、検証は Ajv が
 * このオブジェクトをそのまま JSON Schema として読んで行うので効力は落ちない。
 */
const StringEnum = <const Values extends readonly string[]>(
  values: Values,
  options: SchemaOptions = {},
) => Type.Unsafe<Values[number]>({ ...options, type: "string", enum: [...values] });

const StrictObject = <Properties extends TProperties>(
  properties: Properties,
  options: SchemaOptions = {},
) => Type.Object(properties, { ...options, additionalProperties: false });

const DATE_PATTERN = String.raw`^\d{4}-\d{2}-\d{2}$`;

export const ISSUE_TYPE_COLORS = [
  "#e30000",
  "#990000",
  "#934981",
  "#814fbc",
  "#2779ca",
  "#007e9a",
  "#7ea800",
  "#ff9200",
  "#ff3265",
  "#666665",
] as const;

export const STATUS_COLORS = [
  "#ea2c00",
  "#e87758",
  "#e07b9a",
  "#868cb7",
  "#3b9dbd",
  "#4caf93",
  "#b0be3c",
  "#eda62a",
  "#f42858",
  "#393939",
] as const;

export const CUSTOM_FIELD_TYPE_IDS = {
  text: 1,
  textArea: 2,
  number: 3,
  date: 4,
  singleList: 5,
  multipleList: 6,
  checkBox: 7,
  radio: 8,
} as const;

export const INITIAL_VALUE_TYPE_IDS = {
  today: 1,
  todayPlusShift: 2,
  specifiedDate: 3,
} as const;

export type CustomFieldType = keyof typeof CUSTOM_FIELD_TYPE_IDS;

export type InitialValueType = keyof typeof INITIAL_VALUE_TYPE_IDS;

const CUSTOM_FIELD_TYPES = Object.keys(CUSTOM_FIELD_TYPE_IDS) as CustomFieldType[];

const INITIAL_VALUE_TYPES = Object.keys(INITIAL_VALUE_TYPE_IDS) as InitialValueType[];

const LIST_CUSTOM_FIELD_TYPES = [
  "singleList",
  "multipleList",
  "checkBox",
  "radio",
] as const satisfies readonly CustomFieldType[];

const TYPE_SPECIFIC_CUSTOM_FIELD_KEYS = [
  "min",
  "max",
  "initialValue",
  "unit",
  "initialDate",
  "initialValueType",
  "initialShift",
  "items",
  "allowInput",
  "allowAddItem",
] as const;

const forbid = (...keys: readonly string[]): Record<string, false> =>
  Object.fromEntries(keys.map((key) => [key, false]));

const rangeOf = (schema: Record<string, unknown>) => ({ min: schema, max: schema });

const NUMBER_RANGE = rangeOf({ type: "number" });

const DATE_RANGE = rangeOf({ type: "string", pattern: DATE_PATTERN });

/**
 * 8種の型を判別共用体にして `oneOf` を出す形は採らない。どの分岐にも一致しない入力に
 * 対してエディタが出せるのは「どの分岐にも一致しない」だけで、V-A11 が指したい
 * 「この型にはこのキーが要る」にならない。§9 が `allOf` + `if`/`then` を指定しているのは
 * この違いによる。
 *
 * 各 `if` の `required` は省略できない。判別キー（`type` / `initialValueType`）が
 * 書かれていないとき `properties` だけの `if` は真になるため、`required` を外すと
 * すべての分岐の `then` が同時に成立し、型固有キーが一律に禁止された結果として
 * 「どのキーも書けない」というエラーが並ぶ。
 */
const CUSTOM_FIELD_CONDITIONS = [
  {
    if: { properties: { type: { enum: [...LIST_CUSTOM_FIELD_TYPES] } }, required: ["type"] },
    then: {
      required: ["items"],
      properties: {
        // `type` は `minItems` と併記する。Ajv の strict モードが単独の `minItems` を拒む。
        items: { type: "array", minItems: 1 },
        ...forbid(
          "min",
          "max",
          "unit",
          "initialValue",
          "initialDate",
          "initialValueType",
          "initialShift",
        ),
      },
    },
  },
  {
    if: { properties: { type: { const: "number" } }, required: ["type"] },
    then: {
      properties: {
        ...NUMBER_RANGE,
        ...forbid(
          "items",
          "allowInput",
          "allowAddItem",
          "initialDate",
          "initialValueType",
          "initialShift",
        ),
      },
    },
  },
  {
    if: { properties: { type: { const: "date" } }, required: ["type"] },
    then: {
      properties: {
        ...DATE_RANGE,
        ...forbid("items", "allowInput", "allowAddItem", "unit", "initialValue"),
      },
    },
  },
  {
    if: {
      properties: { initialValueType: { const: "specifiedDate" } },
      required: ["initialValueType"],
    },
    then: { required: ["initialDate"], properties: forbid("initialShift") },
  },
  {
    if: {
      properties: { initialValueType: { const: "todayPlusShift" } },
      required: ["initialValueType"],
    },
    then: { required: ["initialShift"], properties: forbid("initialDate") },
  },
  {
    if: { properties: { initialValueType: { const: "today" } }, required: ["initialValueType"] },
    then: { properties: forbid("initialDate", "initialShift") },
  },
  {
    if: { properties: { type: { enum: ["text", "textArea"] } }, required: ["type"] },
    then: { properties: forbid(...TYPE_SPECIFIC_CUSTOM_FIELD_KEYS) },
  },
];

const SettingsSchema = StrictObject({
  textFormattingRule: Type.Optional(StringEnum(["backlog", "markdown"])),
  chartEnabled: Type.Optional(Type.Boolean()),
  useResolvedForChart: Type.Optional(Type.Boolean()),
  subtaskingEnabled: Type.Optional(Type.Boolean()),
  grandchildIssueEnabled: Type.Optional(Type.Boolean()),
  projectLeaderCanEditProjectLeader: Type.Optional(Type.Boolean()),
  useWiki: Type.Optional(Type.Boolean()),
  useWikiTreeView: Type.Optional(Type.Boolean()),
  useOriginalImageSizeAtWiki: Type.Optional(Type.Boolean()),
  useDocument: Type.Optional(Type.Boolean()),
  useFileSharing: Type.Optional(Type.Boolean()),
  useGit: Type.Optional(Type.Boolean()),
  useSubversion: Type.Optional(Type.Boolean()),
  useDevAttributes: Type.Optional(Type.Boolean()),
});

const IssueTypeSchema = StrictObject({
  name: Type.String({ minLength: 1 }),
  color: StringEnum(ISSUE_TYPE_COLORS),
  templateSummary: Type.Optional(Type.String()),
  templateDescription: Type.Optional(Type.String()),
  oldname: Type.Optional(Type.String({ minLength: 1 })),
});

const StatusSchema = StrictObject({
  name: Type.String({ minLength: 1 }),
  color: Type.Optional(StringEnum(STATUS_COLORS)),
  oldname: Type.Optional(Type.String({ minLength: 1 })),
});

const CategorySchema = StrictObject({
  name: Type.String({ minLength: 1 }),
  oldname: Type.Optional(Type.String({ minLength: 1 })),
});

const MilestoneSchema = StrictObject({
  name: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
  startDate: Type.Optional(Type.String({ pattern: DATE_PATTERN })),
  releaseDueDate: Type.Optional(Type.String({ pattern: DATE_PATTERN })),
  oldname: Type.Optional(Type.String({ minLength: 1 })),
});

const CustomFieldRange = Type.Union([Type.Number(), Type.String({ pattern: DATE_PATTERN })]);

const CustomFieldSchema = StrictObject(
  {
    name: Type.String({ minLength: 1 }),
    type: StringEnum(CUSTOM_FIELD_TYPES),
    description: Type.Optional(Type.String()),
    required: Type.Optional(Type.Boolean({ default: false })),
    applicableIssueTypes: Type.Optional(Type.Array(Type.String(), { uniqueItems: true })),
    oldname: Type.Optional(Type.String({ minLength: 1 })),
    min: Type.Optional(CustomFieldRange),
    max: Type.Optional(CustomFieldRange),
    initialValue: Type.Optional(Type.Number()),
    unit: Type.Optional(Type.String()),
    initialDate: Type.Optional(Type.String({ pattern: DATE_PATTERN })),
    initialValueType: Type.Optional(StringEnum(INITIAL_VALUE_TYPES)),
    initialShift: Type.Optional(Type.Integer()),
    items: Type.Optional(Type.Array(Type.String())),
    allowInput: Type.Optional(Type.Boolean()),
    allowAddItem: Type.Optional(Type.Boolean()),
  },
  { allOf: CUSTOM_FIELD_CONDITIONS },
);

const AccessSchema = StrictObject({
  teams: Type.Optional(Type.Array(Type.String(), { uniqueItems: true })),
  members: Type.Optional(Type.Array(Type.String(), { uniqueItems: true })),
  administrators: Type.Optional(Type.Array(Type.String(), { uniqueItems: true })),
});

const WebhookEventsSchema = Type.Unsafe<"all" | WebhookEvent[]>({
  oneOf: [
    { const: "all" },
    {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: {
        oneOf: [
          ...WEBHOOK_EVENTS.map(({ name, description }) => ({ const: name, description })),
          { type: "integer", minimum: 1 },
        ],
      },
    },
  ],
});

const WebhookSchema = StrictObject({
  name: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
  hookUrl: Type.String({ minLength: 1 }),
  events: WebhookEventsSchema,
});

export const ManifestSchema = StrictObject({
  $schema: Type.Optional(Type.String()),
  key: Type.String({ pattern: "^[A-Z0-9_]+$" }),
  name: Type.String({ minLength: 1 }),
  settings: Type.Optional(SettingsSchema),
  issueTypes: Type.Optional(Type.Array(IssueTypeSchema, { minItems: 1 })),
  statuses: Type.Optional(Type.Array(StatusSchema, { maxItems: 12 })),
  categories: Type.Optional(Type.Array(CategorySchema)),
  milestones: Type.Optional(Type.Array(MilestoneSchema)),
  customFields: Type.Optional(Type.Array(CustomFieldSchema)),
  access: Type.Optional(AccessSchema),
  webhooks: Type.Optional(Type.Array(WebhookSchema)),
});

export type Settings = Static<typeof SettingsSchema>;
export type IssueType = Static<typeof IssueTypeSchema>;
export type Status = Static<typeof StatusSchema>;
export type Category = Static<typeof CategorySchema>;
export type Milestone = Static<typeof MilestoneSchema>;
export type CustomField = Static<typeof CustomFieldSchema>;
export type Webhook = Static<typeof WebhookSchema>;

export type ManifestInput = Static<typeof ManifestSchema>;

const orEmpty = <Item>(items: Item[] | undefined): Item[] => items ?? [];

export const normalizeManifest = (manifest: ManifestInput) => ({
  ...manifest,
  settings: { ...manifest.settings },
  issueTypes: orEmpty(manifest.issueTypes),
  statuses: orEmpty(manifest.statuses),
  categories: orEmpty(manifest.categories),
  milestones: orEmpty(manifest.milestones),
  customFields: orEmpty(manifest.customFields),
  access: {
    teams: orEmpty(manifest.access?.teams),
    members: orEmpty(manifest.access?.members),
    administrators: orEmpty(manifest.access?.administrators),
  },
  webhooks: orEmpty(manifest.webhooks),
});

/**
 * 文字列のフィールドを `string | Secret` に広げない（E-6）。`${ENV}` 由来かどうかは
 * 展開された path の集合として S2 が別に返し、`Secret` で包むのは `Action` を
 * 組み立てるときだけである。ここに `Secret` を混ぜると、10色パレットの enum も
 * `minLength` もパターンも `reveal()` を経由することになり、
 * 「`reveal()` は送信の直前だけ」という不変条件が崩れる。
 */
export type Manifest = ReturnType<typeof normalizeManifest>;

export type Access = Manifest["access"];
