import { type Diagnostic } from "../diagnostic";
import { type Manifest } from "../manifest";
import { hasEnvSentinel } from "./expand-stage";
import { type SourceMap } from "./source-map";

type NamedItem = { name: string; oldname?: string };

type NamedResource = { key: string; items: readonly NamedItem[] };

const namedResources = (manifest: Manifest): NamedResource[] => [
  { key: "issueTypes", items: manifest.issueTypes },
  { key: "statuses", items: manifest.statuses },
  { key: "categories", items: manifest.categories },
  { key: "milestones", items: manifest.milestones },
  { key: "customFields", items: manifest.customFields },
  { key: "webhooks", items: manifest.webhooks },
];

const pathOf = (...segments: (string | number)[]): string => segments.join("/");

const exceeds = (min: number | string, max: number | string): boolean => {
  if (typeof min === "number" && typeof max === "number") {
    return min > max;
  }

  if (typeof min === "string" && typeof max === "string") {
    return min > max;
  }

  return false;
};

export const validateStaticSemantics = (manifest: Manifest, source: SourceMap): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];

  const report = (id: string, path: string, message: string, hint: string): void => {
    diagnostics.push({
      id,
      severity: "error",
      stage: "semantic",
      path,
      ...source.positionAt(path),
      message,
      hint,
    });
  };

  const resources = namedResources(manifest);

  for (const { key, items } of resources) {
    const seen = new Set<string>();

    for (const [index, item] of items.entries()) {
      if (hasEnvSentinel(item.name)) {
        continue;
      }

      if (seen.has(item.name)) {
        report(
          "V-A5",
          pathOf(key, index, "name"),
          `duplicate name in ${key}: ${item.name}`,
          `${key} are identified by name. rename this entry, or remove the duplicate`,
        );
      }

      seen.add(item.name);
    }
  }

  if (manifest.issueTypes.length === 0) {
    report(
      "V-A9",
      "issueTypes",
      "a project must declare at least one issue type",
      "add an entry to issueTypes. the last issue type of a project cannot be deleted",
    );
  }

  const issueTypeNames = new Set(manifest.issueTypes.map(({ name }) => name));
  const issueTypeNamesAreKnown = manifest.issueTypes.every(({ name }) => !hasEnvSentinel(name));

  if (issueTypeNamesAreKnown) {
    for (const [index, field] of manifest.customFields.entries()) {
      for (const [reference, name] of (field.applicableIssueTypes ?? []).entries()) {
        if (hasEnvSentinel(name) || issueTypeNames.has(name)) {
          continue;
        }

        const declared = [...issueTypeNames].join(", ");

        report(
          "V-A10",
          pathOf("customFields", index, "applicableIssueTypes", reference),
          `applicableIssueTypes refers to an issue type that is not declared: ${name}`,
          declared.length > 0
            ? `add "${name}" to issueTypes, or use one of: ${declared}`
            : `add "${name}" to issueTypes`,
        );
      }
    }
  }

  if (
    manifest.settings.grandchildIssueEnabled === true &&
    manifest.settings.subtaskingEnabled !== true
  ) {
    report(
      "V-A12",
      "settings/grandchildIssueEnabled",
      "grandchildIssueEnabled requires subtaskingEnabled to be true",
      "set settings.subtaskingEnabled to true, or set settings.grandchildIssueEnabled to false",
    );
  }

  for (const { key, items } of resources) {
    for (const [index, item] of items.entries()) {
      const { oldname } = item;

      if (oldname === undefined || hasEnvSentinel(oldname)) {
        continue;
      }

      const collides = items.some(
        (other, otherIndex) => otherIndex !== index && other.name === oldname,
      );

      if (collides) {
        report(
          "V-A17",
          pathOf(key, index, "oldname"),
          `oldname is also the name of another entry in ${key}: ${oldname}`,
          "an entry cannot be renamed from a name that another entry keeps. remove the oldname, or rename the other entry",
        );
      }
    }
  }

  for (const [index, milestone] of manifest.milestones.entries()) {
    const { startDate, releaseDueDate } = milestone;

    if (startDate === undefined || releaseDueDate === undefined) {
      continue;
    }

    if (hasEnvSentinel(startDate) || hasEnvSentinel(releaseDueDate)) {
      continue;
    }

    if (startDate > releaseDueDate) {
      report(
        "V-A19",
        pathOf("milestones", index, "startDate"),
        `startDate ${startDate} is later than releaseDueDate ${releaseDueDate}`,
        `set startDate to ${releaseDueDate} or earlier, or move releaseDueDate later`,
      );
    }
  }

  for (const [index, field] of manifest.customFields.entries()) {
    const { min, max } = field;

    if (min === undefined || max === undefined) {
      continue;
    }

    if (hasEnvSentinel(min) || hasEnvSentinel(max)) {
      continue;
    }

    if (exceeds(min, max)) {
      report(
        "V-A20",
        pathOf("customFields", index, "min"),
        `min ${min} is greater than max ${max}`,
        `set min to ${max} or less, or raise max`,
      );
    }
  }

  const checkBrace = (path: string, key: string, value: string | undefined): void => {
    if (value === undefined || hasEnvSentinel(value) || !value.includes("}")) {
      return;
    }

    report(
      "V-A22",
      path,
      `${key} contains "}": ${value}`,
      'Backlog itself allows "}" in names, but this tool embeds names in {$ref:<kind>:<name>} placeholders that end at the first "}", so such a name cannot be resolved. rename it without "}"',
    );
  };

  checkBrace("name", "name", manifest.name);

  for (const { key, items } of resources) {
    for (const [index, item] of items.entries()) {
      checkBrace(pathOf(key, index, "name"), "name", item.name);
      checkBrace(pathOf(key, index, "oldname"), "oldname", item.oldname);
    }
  }

  return diagnostics;
};
