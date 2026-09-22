import { type Diagnostic } from "../diagnostic";
import { PROJECT_KEY_PATTERN } from "../manifest";
import { PROJECT_KEY_HINT } from "../validation/schema-stage";
import { type Value } from "../value";

/**
 * 位置を持たせない（DG-5）。判定の根拠はスペースから読んだ実状であり、
 * 書き出す前のマニフェストには指せる行が無い。
 */
const snapshotError = (id: string, path: string, message: string, hint: string): Diagnostic => ({
  id,
  severity: "error",
  stage: "snapshot",
  path,
  message,
  hint,
});

const shown = (value: Value): string => JSON.stringify(value);

/**
 * ここだけ `snapshotError` を使わず、EX-9* に並ぶ ID も振らない。S3 の `key` と同じ規則を
 * 同じ hint で指摘するものなので、V-A3 と `"schema"` をそのまま借りる（EX-3）。
 */
export const invalidProjectKey = (key: string): Diagnostic => ({
  id: "V-A3",
  severity: "error",
  stage: "schema",
  path: "key",
  message: `${JSON.stringify(key)} does not match ${PROJECT_KEY_PATTERN}`,
  hint: PROJECT_KEY_HINT,
});

export const projectDoesNotExist = (projectKey: string): Diagnostic =>
  snapshotError(
    "EX-3",
    "key",
    `project not found: ${projectKey}`,
    "export reads an existing project and does not create one. check the key, and that the API key belongs to the space that holds it",
  );

export const duplicateName = (path: string, noun: string, name: string): Diagnostic =>
  snapshotError(
    "EX-9a",
    path,
    `another ${noun} is already named "${name}"`,
    "resources are matched by name, so a manifest cannot hold both. rename one of them in Backlog, then export again",
  );

export const nameHoldsBrace = (path: string, noun: string, name: string): Diagnostic =>
  snapshotError(
    "EX-9b",
    path,
    `the ${noun} name "${name}" contains "}"`,
    'Backlog itself allows "}" in names, but this tool embeds names in {$ref:<kind>:<name>} placeholders that end at the first "}", so such a name cannot be written. rename it in Backlog, then export again',
  );

export const unknownColor = (path: string, noun: string, name: string, color: string): Diagnostic =>
  snapshotError(
    "EX-9c",
    path,
    `the ${noun} "${name}" has the color "${color}", which is not one of the ten colors this tool accepts`,
    "choose one of the ten colors for it in Backlog, then export again",
  );

export const unknownTextFormattingRule = (value: Value): Diagnostic =>
  snapshotError(
    "EX-9c",
    "settings/textFormattingRule",
    `the project's text formatting rule is ${shown(value)}, which is neither "backlog" nor "markdown"`,
    "a manifest can only hold those two. set the syntax in Backlog's project settings, then export again",
  );

export const nonBooleanSetting = (key: string, value: Value): Diagnostic =>
  snapshotError(
    "EX-9c",
    `settings/${key}`,
    `the project setting ${key} is ${shown(value)}, which is neither true nor false`,
    "a manifest can only hold true or false here. check the setting in Backlog, then export again",
  );

export const unknownCustomFieldType = (path: string, name: string, typeId: number): Diagnostic =>
  snapshotError(
    "EX-9d",
    path,
    `the custom field "${name}" has type ${typeId}, which this tool has no name for`,
    "a manifest writes the type by name and accepts no numeric form. upgrade backlog-blueprint if Backlog has added a type",
  );

export const unknownInitialValueType = (
  path: string,
  name: string,
  initialValueType: number,
): Diagnostic =>
  snapshotError(
    "EX-9d",
    path,
    `the custom field "${name}" prefills its date with rule ${initialValueType}, which this tool has no name for`,
    "a manifest writes the rule by name and accepts no numeric form. upgrade backlog-blueprint if Backlog has added a rule",
  );

export const unknownApplicableIssueType = (
  path: string,
  name: string,
  issueTypeId: number,
): Diagnostic =>
  snapshotError(
    "EX-9e",
    path,
    `the custom field "${name}" is limited to issue type ${issueTypeId}, which this project does not have`,
    "applicableIssueTypes names issue types, so an ID with no issue type behind it cannot be written. check the field's settings in Backlog, then export again",
  );

export const webhookWithoutEvents = (path: string, name: string): Diagnostic =>
  snapshotError(
    "EX-9f",
    path,
    `the webhook "${name}" sends no events`,
    "a manifest lists at least one event per webhook. choose its events in Backlog, then export again",
  );

export const listWithoutItems = (path: string, name: string): Diagnostic =>
  snapshotError(
    "EX-9g",
    path,
    `the custom field "${name}" offers no choices`,
    "a manifest lists at least one choice per list field. add its choices in Backlog, then export again",
  );

/**
 * 表現できない値を1つずつ数え上げない（EX-9h）。スキーマにキーが増えるたびに
 * 書き出し側の検査を足す形は、M-1 が退けた二重管理そのものになる。
 */
export const cannotBeWritten = (rejected: Diagnostic): Diagnostic =>
  snapshotError(
    "EX-9h",
    rejected.path,
    `this value cannot go into a manifest: ${rejected.message}`,
    `the manifest validator rejects it (${rejected.id}). change the value in Backlog, then export again`,
  );
