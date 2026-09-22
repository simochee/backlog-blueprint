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

export const DATE_PATTERN = String.raw`^\d{4}-\d{2}-\d{2}$`;

export const PROJECT_KEY_PATTERN = String.raw`^[A-Z0-9_]+$`;

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

export const TEXT_FORMATTING_RULES = ["backlog", "markdown"] as const;

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

export type TypeSpecificCustomFieldKey = (typeof TYPE_SPECIFIC_CUSTOM_FIELD_KEYS)[number];

type ForbiddenKeys = readonly TypeSpecificCustomFieldKey[];

const LIST_FORBIDDEN_KEYS = [
  "min",
  "max",
  "unit",
  "initialValue",
  "initialDate",
  "initialValueType",
  "initialShift",
] as const satisfies ForbiddenKeys;

const NUMBER_FORBIDDEN_KEYS = [
  "items",
  "allowInput",
  "allowAddItem",
  "initialDate",
  "initialValueType",
  "initialShift",
] as const satisfies ForbiddenKeys;

const DATE_FORBIDDEN_KEYS = [
  "items",
  "allowInput",
  "allowAddItem",
  "unit",
  "initialValue",
] as const satisfies ForbiddenKeys;

const FORBIDDEN_KEYS_BY_TYPE = {
  text: TYPE_SPECIFIC_CUSTOM_FIELD_KEYS,
  textArea: TYPE_SPECIFIC_CUSTOM_FIELD_KEYS,
  number: NUMBER_FORBIDDEN_KEYS,
  date: DATE_FORBIDDEN_KEYS,
  singleList: LIST_FORBIDDEN_KEYS,
  multipleList: LIST_FORBIDDEN_KEYS,
  checkBox: LIST_FORBIDDEN_KEYS,
  radio: LIST_FORBIDDEN_KEYS,
} as const satisfies Record<CustomFieldType, ForbiddenKeys>;

const FORBIDDEN_KEYS_BY_INITIAL_VALUE_TYPE = {
  today: ["initialDate", "initialShift"],
  todayPlusShift: ["initialDate"],
  specifiedDate: ["initialShift"],
} as const satisfies Record<InitialValueType, ForbiddenKeys>;

/**
 * 書き出し（EX-11）が型ごとの許可キーを自前の表で持たない形にするための入口。
 * 条件表と射影が別々の表を引くと、M-1 が「手書きの JSON Schema と実行時バリデータを
 * 二重に持つと必ずズレる」として退けた形に戻る。
 */
export const typeSpecificCustomFieldKeys = (
  type: CustomFieldType,
  initialValueType: InitialValueType | undefined,
): TypeSpecificCustomFieldKey[] => {
  const forbidden: ForbiddenKeys = [
    ...FORBIDDEN_KEYS_BY_TYPE[type],
    ...FORBIDDEN_KEYS_BY_INITIAL_VALUE_TYPE[initialValueType ?? "today"],
  ];

  return TYPE_SPECIFIC_CUSTOM_FIELD_KEYS.filter((key) => !forbidden.includes(key));
};

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
        ...forbid(...LIST_FORBIDDEN_KEYS),
      },
    },
  },
  {
    if: { properties: { type: { const: "number" } }, required: ["type"] },
    then: {
      properties: {
        ...NUMBER_RANGE,
        ...forbid(...NUMBER_FORBIDDEN_KEYS),
      },
    },
  },
  {
    if: { properties: { type: { const: "date" } }, required: ["type"] },
    then: {
      properties: {
        ...DATE_RANGE,
        ...forbid(...DATE_FORBIDDEN_KEYS),
      },
    },
  },
  {
    if: {
      properties: { initialValueType: { const: "specifiedDate" } },
      required: ["initialValueType"],
    },
    then: {
      required: ["initialDate"],
      properties: forbid(...FORBIDDEN_KEYS_BY_INITIAL_VALUE_TYPE.specifiedDate),
    },
  },
  {
    if: {
      properties: { initialValueType: { const: "todayPlusShift" } },
      required: ["initialValueType"],
    },
    then: {
      required: ["initialShift"],
      properties: forbid(...FORBIDDEN_KEYS_BY_INITIAL_VALUE_TYPE.todayPlusShift),
    },
  },
  {
    if: { properties: { initialValueType: { const: "today" } }, required: ["initialValueType"] },
    then: { properties: forbid(...FORBIDDEN_KEYS_BY_INITIAL_VALUE_TYPE.today) },
  },
  {
    if: { properties: { type: { enum: ["text", "textArea"] } }, required: ["type"] },
    then: { properties: forbid(...TYPE_SPECIFIC_CUSTOM_FIELD_KEYS) },
  },
];

/**
 * 名前がそのまま意味になる項目（`useWiki` / `useGit` など）には説明を置かない。
 * キー名を言い換えただけの文はホバーに何も足さず、説明のある項目とない項目の差が
 * 「ここには言うべきことがある」という合図として働かなくなる。
 */
const SettingsSchema = StrictObject(
  {
    textFormattingRule: Type.Optional(
      StringEnum(TEXT_FORMATTING_RULES, {
        description: "The markup syntax for issue and wiki text.",
      }),
    ),
    chartEnabled: Type.Optional(Type.Boolean()),
    useResolvedForChart: Type.Optional(
      Type.Boolean({
        description:
          "Count an issue as finished on the chart once it reaches the resolved status, rather than only when it is closed.",
      }),
    ),
    subtaskingEnabled: Type.Optional(Type.Boolean()),
    grandchildIssueEnabled: Type.Optional(
      Type.Boolean({
        description: "Allow subtasks of subtasks. Requires subtaskingEnabled to be on as well.",
      }),
    ),
    projectLeaderCanEditProjectLeader: Type.Optional(
      Type.Boolean({
        description: "Let project administrators appoint and remove other project administrators.",
      }),
    ),
    useWiki: Type.Optional(Type.Boolean()),
    useWikiTreeView: Type.Optional(
      Type.Boolean({ description: "Show the wiki as a tree rather than a flat list." }),
    ),
    useOriginalImageSizeAtWiki: Type.Optional(
      Type.Boolean({
        description: "Show images in the wiki at their own size instead of scaling them to fit.",
      }),
    ),
    useDocument: Type.Optional(Type.Boolean({ description: "Enable Backlog's Document feature." })),
    useFileSharing: Type.Optional(Type.Boolean()),
    useGit: Type.Optional(Type.Boolean()),
    useSubversion: Type.Optional(Type.Boolean()),
    useDevAttributes: Type.Optional(
      Type.Boolean({
        description: "Show the priority, affected version and milestone fields on issues.",
      }),
    ),
  },
  {
    description:
      "Project settings. A key left out is not sent at all, so Backlog keeps the value it already has. All of them travel in one request however many you write.",
  },
);

const IssueTypeSchema = StrictObject({
  name: Type.String({
    minLength: 1,
    description: "The name the issue type should end up with.",
  }),
  color: StringEnum(ISSUE_TYPE_COLORS, {
    description:
      "One of Backlog's ten issue type colors. Backlog has no default, so it is required.",
  }),
  templateSummary: Type.Optional(
    Type.String({ description: "Prefilled into the summary of a new issue of this type." }),
  ),
  templateDescription: Type.Optional(
    Type.String({ description: "Prefilled into the description of a new issue of this type." }),
  ),
  oldname: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "The name this issue type has in Backlog now. Resources are matched by name, so without it a renamed entry is deleted and recreated: two requests instead of one.",
    }),
  ),
});

const StatusSchema = StrictObject({
  name: Type.String({
    minLength: 1,
    description:
      "The name the status should end up with. The four default statuses cannot be renamed, so write those exactly as they are.",
  }),
  color: Type.Optional(
    StringEnum(STATUS_COLORS, {
      description:
        "One of Backlog's ten status colors. Required on statuses you add; not allowed on the four default statuses, which cannot be recolored.",
    }),
  ),
  oldname: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "The name this status has in Backlog now, so a renamed status is renamed rather than deleted and recreated. Not allowed on the four default statuses, which cannot be renamed.",
    }),
  ),
});

const CategorySchema = StrictObject({
  name: Type.String({ minLength: 1, description: "The name the category should end up with." }),
  oldname: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "The name this category has in Backlog now. Resources are matched by name, so without it a renamed entry is deleted and recreated: two requests instead of one.",
    }),
  ),
});

const MilestoneSchema = StrictObject({
  name: Type.String({ minLength: 1, description: "The name the milestone should end up with." }),
  description: Type.Optional(
    Type.String({
      description: "Shown on the milestone itself, not on the issues assigned to it.",
    }),
  ),
  startDate: Type.Optional(
    Type.String({ pattern: DATE_PATTERN, description: "Start date, as yyyy-MM-dd." }),
  ),
  releaseDueDate: Type.Optional(
    Type.String({ pattern: DATE_PATTERN, description: "Release due date, as yyyy-MM-dd." }),
  ),
  oldname: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "The name this milestone has in Backlog now. Resources are matched by name, so without it a renamed entry is deleted and recreated: two requests instead of one.",
    }),
  ),
});

const customFieldRange = (description: string) =>
  Type.Union([Type.Number(), Type.String({ pattern: DATE_PATTERN })], { description });

const CustomFieldSchema = StrictObject(
  {
    name: Type.String({
      minLength: 1,
      description: "The name the custom field should end up with.",
    }),
    type: StringEnum(CUSTOM_FIELD_TYPES, {
      description:
        "The field's type. Backlog cannot change the type of a field that exists, so changing this deletes the field and creates a new one.",
    }),
    description: Type.Optional(
      Type.String({ description: "Shown to whoever fills the field in." }),
    ),
    required: Type.Optional(
      Type.Boolean({
        default: false,
        description: "An issue cannot be saved while this field is empty.",
      }),
    ),
    applicableIssueTypes: Type.Optional(
      Type.Array(Type.String(), {
        uniqueItems: true,
        description:
          "Names of the issue types this field appears on. Empty or absent means it appears on every issue type.",
      }),
    ),
    oldname: Type.Optional(
      Type.String({
        minLength: 1,
        description:
          "The name this custom field has in Backlog now. Resources are matched by name, so without it a renamed entry is deleted and recreated: two requests instead of one.",
      }),
    ),
    min: Type.Optional(
      customFieldRange("Lowest value accepted: a number, or a yyyy-MM-dd date for a date field."),
    ),
    max: Type.Optional(
      customFieldRange("Highest value accepted: a number, or a yyyy-MM-dd date for a date field."),
    ),
    initialValue: Type.Optional(
      Type.Number({ description: "The value a new issue starts with. Number fields only." }),
    ),
    unit: Type.Optional(
      Type.String({
        description: "Shown after the value when the field is displayed. Number fields only.",
      }),
    ),
    initialDate: Type.Optional(
      Type.String({
        pattern: DATE_PATTERN,
        description:
          "The fixed date a new issue starts with, when initialValueType is specifiedDate.",
      }),
    ),
    initialValueType: Type.Optional(
      StringEnum(INITIAL_VALUE_TYPES, {
        description:
          "How a date field is prefilled: today, today plus initialShift days, or the fixed date in initialDate.",
      }),
    ),
    initialShift: Type.Optional(
      Type.Integer({
        description:
          "Days added to today when initialValueType is todayPlusShift. A negative number moves it earlier.",
      }),
    ),
    items: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "The choices, in the order they are offered. List, checkbox and radio fields only.",
      }),
    ),
    allowInput: Type.Optional(
      Type.Boolean({
        description: 'Offer an "Other" box so a value outside items can be typed in.',
      }),
    ),
    allowAddItem: Type.Optional(
      Type.Boolean({ description: "Let people add new choices to items from the issue form." }),
    ),
  },
  { allOf: CUSTOM_FIELD_CONDITIONS },
);

/**
 * `administrators` の説明にだけ Backlog 側の制約を書く。V-B11 はこれを判定できるが、
 * 判定には `GET /users` の `roleType` が要るので、`plan` まで待たないと言えない。
 * スキーマの説明はエディタが書いている最中に出せる唯一の地点である。
 */
const AccessSchema = StrictObject(
  {
    teams: Type.Optional(
      Type.Array(Type.String(), {
        uniqueItems: true,
        description:
          "Names of space teams to add to the project. A team costs one request however many people it holds.",
      }),
    ),
    members: Type.Optional(
      Type.Array(Type.String(), {
        uniqueItems: true,
        description:
          "Login IDs of people to add one by one, one request each. Leave out anyone already covered by teams or administrators.",
      }),
    ),
    administrators: Type.Optional(
      Type.Array(Type.String(), {
        uniqueItems: true,
        description:
          "Login IDs of people to make project administrators. Do not write yourself: Backlog refuses that role to space administrators, and you can already operate the project without belonging to it.",
      }),
    ),
  },
  {
    description:
      "Who belongs to the project. Leaving this out removes every member and takes the role from every project administrator.",
  },
);

const WebhookEventsSchema = Type.Unsafe<"all" | WebhookEvent[]>({
  description: "Which events to send: all, or a list of event names or numeric event IDs.",
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
  name: Type.String({ minLength: 1, description: "The name the webhook should end up with." }),
  description: Type.Optional(
    Type.String({ description: "Shown on the webhook in Backlog's project settings." }),
  ),
  hookUrl: Type.String({
    minLength: 1,
    description:
      "Where Backlog sends the notification. Write it as ${NAME} to keep the URL out of the file when it carries a token.",
  }),
  events: WebhookEventsSchema,
});

export const ManifestSchema = StrictObject({
  $schema: Type.Optional(
    Type.String({
      description:
        "Accepted and ignored. The yaml-language-server comment at the top of the file is what selects the schema; writing this key as well does no harm.",
    }),
  ),
  key: Type.String({
    pattern: PROJECT_KEY_PATTERN,
    description:
      "The project key: capital letters, digits and underscores. It identifies the project, so changing it points this file at a different project rather than renaming this one.",
  }),
  name: Type.String({
    minLength: 1,
    description: "The project's display name. Unlike the key, it can be changed freely.",
  }),
  settings: Type.Optional(SettingsSchema),
  issueTypes: Type.Optional(
    Type.Array(IssueTypeSchema, {
      minItems: 1,
      description:
        "Every issue type the project should end up with. One that exists in Backlog but is not listed here is deleted; a project must keep at least one, so an empty list is rejected. On a new project the first four entries take over Backlog's four default issue types.",
    }),
  ),
  statuses: Type.Optional(
    Type.Array(StatusSchema, {
      maxItems: 12,
      description:
        "Every status, in display order. The four default statuses cannot be renamed, recolored or deleted, so list them as they are; the not-started status must come first, the closed one last, and in-progress before resolved.",
    }),
  ),
  categories: Type.Optional(
    Type.Array(CategorySchema, {
      description:
        "Every category the project should end up with. One that exists in Backlog but is not listed here is deleted, and leaving the key out deletes all of them.",
    }),
  ),
  milestones: Type.Optional(
    Type.Array(MilestoneSchema, {
      description:
        "Every milestone the project should end up with. One that exists in Backlog but is not listed here is deleted, and leaving the key out deletes all of them.",
    }),
  ),
  customFields: Type.Optional(
    Type.Array(CustomFieldSchema, {
      description:
        "Every custom field the project should end up with. One that exists in Backlog but is not listed here is deleted, and leaving the key out deletes all of them.",
    }),
  ),
  access: Type.Optional(AccessSchema),
  webhooks: Type.Optional(
    Type.Array(WebhookSchema, {
      description:
        "Every webhook the project should end up with. One that exists in Backlog but is not listed here is deleted, and leaving the key out deletes all of them.",
    }),
  ),
});

export type Settings = Static<typeof SettingsSchema>;

/** 射影（EX-10）が14個のキーを並べ直さずに済むよう、スキーマの並びをそのまま渡す */
export const SETTINGS_KEYS = Object.keys(SettingsSchema.properties) as (keyof Settings)[];

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
