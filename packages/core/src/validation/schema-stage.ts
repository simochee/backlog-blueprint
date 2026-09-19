import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";

import { type Diagnostic } from "../diagnostic";
import { DATE_PATTERN, ManifestSchema, STATUS_COLORS } from "../manifest";
import { type SchemaStage } from "./pipeline";
import { instancePathTokens, pathFromInstancePath, type SourceMap } from "./source-map";

export type SchemaStageOptions = {
  source?: SourceMap;
};

const validateManifest = new Ajv2020({ allErrors: true, strict: true }).compile(ManifestSchema);

const CUSTOM_FIELD_CONDITIONS = "#/properties/customFields/items/allOf/";

const UNION_BRANCH = /\/(?:anyOf|oneOf)\/\d+\//;

const CUSTOM_FIELD_INDEX = /^\/customFields\/(\d+)/;

const STATUS_COLOR_PATH = /^\/statuses\/\d+\/color$/;

/**
 * `if` の指摘と、`anyOf` / `oneOf` の枝の指摘は落とす。どちらも同じ誤りが二重に出るが、
 * 残すべき側が逆になる。`if` は `then` 側の指摘が本体で、`if` 自身は
 * 「then に一致しない」としか言わない。`anyOf` / `oneOf` は逆で、枝の指摘には
 * 「数値でない」と「日付形式でない」のように同時には満たせないものが並び、
 * どれか1つを満たせばよいことを利用者に伝えられない。
 */
const isRedundant = (error: ErrorObject): boolean =>
  error.keyword === "if" || UNION_BRANCH.test(error.schemaPath);

const valueAt = (data: unknown, pointer: string): unknown =>
  instancePathTokens(pointer).reduce<unknown>(
    (value, token) =>
      typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)[token]
        : undefined,
    data,
  );

const lastToken = (pointer: string): string => instancePathTokens(pointer).at(-1) ?? "";

const typeName = (value: unknown): string => (value === null ? "null" : typeof value);

const quoted = (values: readonly unknown[]): string =>
  values.map((value) => JSON.stringify(value)).join(", ");

const lengthAt = (data: unknown, pointer: string): number => {
  const value = valueAt(data, pointer);

  return Array.isArray(value) ? value.length : 0;
};

/**
 * ソース上に値が書かれていないことまで確かめる（Y-3）。`color: null` と明示的に
 * 書いた場合まで「YAML がコメントとして読んだ」と言うと、原因の説明が嘘になる。
 */
const isUnquotedColor = (
  error: ErrorObject,
  data: unknown,
  source: SourceMap | undefined,
): boolean =>
  lastToken(error.instancePath) === "color" &&
  valueAt(data, error.instancePath) === null &&
  (source?.isEmptySource(pathFromInstancePath(error.instancePath)) ?? false);

const identify = (error: ErrorObject, data: unknown, source: SourceMap | undefined): string => {
  if (isUnquotedColor(error, data, source)) {
    return "V-A18";
  }
  if (error.keyword === "enum" && STATUS_COLOR_PATH.test(error.instancePath)) {
    return "V-A8";
  }
  if (error.keyword === "additionalProperties") {
    return "V-A1";
  }
  if (error.keyword === "required" && error.instancePath === "") {
    return "V-A2";
  }
  if (error.keyword === "pattern" && error.instancePath === "/key") {
    return "V-A3";
  }
  if (error.keyword === "maxItems" && error.instancePath === "/statuses") {
    return "V-A7";
  }
  if (error.keyword === "minItems" && error.instancePath === "/issueTypes") {
    return "V-A9";
  }
  if (error.schemaPath.startsWith(CUSTOM_FIELD_CONDITIONS)) {
    return "V-A11";
  }
  if (error.keyword === "uniqueItems" && error.instancePath.startsWith("/access/")) {
    return "V-A13";
  }

  return "V-A21";
};

const offendingKey = (error: ErrorObject): string | undefined => {
  if (error.keyword === "additionalProperties") {
    return String(error.params.additionalProperty);
  }
  if (error.keyword === "required") {
    return String(error.params.missingProperty);
  }

  return undefined;
};

const pathOf = (error: ErrorObject): string => {
  const base = pathFromInstancePath(error.instancePath);
  const key = offendingKey(error);

  if (key === undefined) {
    return base;
  }

  return base === "" ? key : `${base}/${key}`;
};

type Wording = { message: string; hint?: string };

const WEBHOOK_EVENTS_PATH = /^\/webhooks\/\d+\/events/;

/**
 * `events` には専用の hint を出す（W-4 前半）。「どの形にも一致しない」だけでは、
 * イベント名を打ち間違えた利用者が、名前が拒まれたのか数値が拒まれたのかを読み取れない。
 */
const acceptedFormHint = (error: ErrorObject): string | undefined =>
  WEBHOOK_EVENTS_PATH.test(error.instancePath)
    ? 'write a known event name (such as "issueCreated"), a positive activityTypeId, or "all" for every event. event names are matched exactly'
    : undefined;

const byKeyword = (error: ErrorObject, data: unknown): Wording => {
  const params = error.params as Record<string, unknown>;

  switch (error.keyword) {
    case "additionalProperties": {
      return {
        message: `unknown key "${String(params.additionalProperty)}"`,
        hint: "remove the key, or upgrade the CLI if it was added in a newer version",
      };
    }
    case "required": {
      const key = String(params.missingProperty);

      return { message: `missing required key "${key}"`, hint: `add "${key}"` };
    }
    case "false schema": {
      const key = lastToken(error.instancePath);

      return { message: `"${key}" is not allowed here`, hint: `remove "${key}"` };
    }
    case "type": {
      const expected = String(params.type);

      return {
        message: `expected ${expected}, got ${typeName(valueAt(data, error.instancePath))}`,
        hint: `write the value as ${expected}`,
      };
    }
    case "enum": {
      return {
        message: `${JSON.stringify(valueAt(data, error.instancePath))} is not an allowed value`,
        hint: `use one of: ${quoted(params.allowedValues as readonly unknown[])}`,
      };
    }
    case "const": {
      return {
        message: `${JSON.stringify(valueAt(data, error.instancePath))} is not the expected value`,
        hint: `use ${JSON.stringify(params.allowedValue)}`,
      };
    }
    case "pattern": {
      const pattern = String(params.pattern);

      return {
        message: `${JSON.stringify(valueAt(data, error.instancePath))} does not match ${pattern}`,
        hint:
          pattern === DATE_PATTERN
            ? "use the yyyy-MM-dd format"
            : `write a value that matches ${pattern}`,
      };
    }
    case "minLength": {
      return { message: "the value is empty", hint: "write a non-empty value" };
    }
    case "maxItems": {
      const limit = Number(params.limit);

      return {
        message: `${lengthAt(data, error.instancePath)} entries, but at most ${limit} are allowed`,
        hint: `remove entries until at most ${limit} remain`,
      };
    }
    case "minItems": {
      const limit = Number(params.limit);

      return {
        message: `${lengthAt(data, error.instancePath)} entries, but at least ${limit} are required`,
        hint: `add at least ${limit} entry`,
      };
    }
    case "uniqueItems": {
      return {
        message: `entries ${Number(params.j)} and ${Number(params.i)} are the same`,
        hint: "remove the duplicate entry",
      };
    }
    case "minimum": {
      const limit = Number(params.limit);

      return {
        message: `${JSON.stringify(valueAt(data, error.instancePath))} is below the minimum ${limit}`,
        hint: `use ${limit} or greater`,
      };
    }
    case "oneOf":
    case "anyOf": {
      return {
        message: "the value does not match any accepted form",
        hint: acceptedFormHint(error),
      };
    }
    default: {
      return {
        message: error.message ?? error.keyword,
        hint: "adjust the value so that it satisfies the schema",
      };
    }
  }
};

const customFieldLabel = (data: unknown, instancePath: string): string => {
  const index = CUSTOM_FIELD_INDEX.exec(instancePath)?.[1];
  const name = index === undefined ? undefined : valueAt(data, `/customFields/${index}/name`);

  return typeof name === "string" ? `custom field "${name}"` : "this custom field";
};

/**
 * 失敗した条件が `type` 由来か `initialValueType` 由来かは Ajv の指摘から復元できない。
 * どちらかを名指しすると、`initialValueType: todayPlusShift` でなら書ける `initialShift` を
 * 「この型では書けない」と説明してしまう。要る・書けないという事実だけを言う。
 */
const asCustomFieldWording = (error: ErrorObject, data: unknown): Wording => {
  const label = customFieldLabel(data, error.instancePath);
  const params = error.params as Record<string, unknown>;

  switch (error.keyword) {
    case "required": {
      const key = String(params.missingProperty);

      return {
        message: `${label} needs "${key}" with the settings it declares`,
        hint: `add "${key}" to ${label}`,
      };
    }
    case "false schema": {
      const key = lastToken(error.instancePath);

      return {
        message: `${label} cannot have "${key}" with the settings it declares`,
        hint: `remove "${key}" from ${label}`,
      };
    }
    default: {
      return byKeyword(error, data);
    }
  }
};

const wordingFor = (id: string, error: ErrorObject, data: unknown): Wording => {
  switch (id) {
    case "V-A3": {
      return {
        ...byKeyword(error, data),
        hint: "write the project key with uppercase letters, digits and underscores only",
      };
    }
    case "V-A8": {
      return {
        message: `${JSON.stringify(valueAt(data, error.instancePath))} is not one of the ten colors Backlog accepts for a status`,
        hint: `use one of: ${STATUS_COLORS.join(", ")}`,
      };
    }
    case "V-A9": {
      return { ...byKeyword(error, data), hint: "add at least one issue type" };
    }
    case "V-A11": {
      return asCustomFieldWording(error, data);
    }
    case "V-A18": {
      return {
        message: "the color is empty because YAML read the unquoted value as a comment",
        hint: 'quote the color, as in color: "#RRGGBB"',
      };
    }
    default: {
      return byKeyword(error, data);
    }
  }
};

const toDiagnostic = (
  error: ErrorObject,
  data: unknown,
  source: SourceMap | undefined,
): Diagnostic => {
  const id = identify(error, data, source);
  const path = pathOf(error);

  return {
    id,
    severity: "error",
    stage: "schema",
    path,
    ...source?.positionAt(path),
    ...wordingFor(id, error, data),
  };
};

const signature = (diagnostic: Diagnostic): string =>
  JSON.stringify([diagnostic.id, diagnostic.path, diagnostic.message]);

export const validateSchema = (
  value: unknown,
  { source }: SchemaStageOptions = {},
): Diagnostic[] => {
  if (validateManifest(value)) {
    return [];
  }

  const seen = new Set<string>();

  return (validateManifest.errors ?? [])
    .filter((error) => !isRedundant(error))
    .map((error) => toDiagnostic(error, value, source))
    .filter((diagnostic) => {
      const key = signature(diagnostic);
      const isFirst = !seen.has(key);

      seen.add(key);

      return isFirst;
    });
};

/**
 * パイプラインに渡す形をここに置く。呼び出し側が `validateSchema(parsed.value)` と
 * 書いてしまうと、位置（DG-5）と V-A18 の判定に要る `isEmptySource`（Y-3）が
 * 黙って落ちる。落ちても検証は動くので、テストでも気付けない。
 */
export const schemaStage: SchemaStage = (parsed) =>
  validateSchema(parsed.value, { source: parsed.source });
