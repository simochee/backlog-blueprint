import { type Diagnostic } from "../diagnostic";
import { normalizeManifest, type Manifest, type ManifestInput } from "../manifest";
import { expandEnvironment, type Environment } from "./expand-stage";
import { blocksNextStage, hasError, orderDiagnostics } from "./gate";
import { validateStaticSemantics } from "./semantic-stage";
import { parseManifestSyntax } from "./syntax-stage";
import { type ParsedDocument } from "./source-map";

/**
 * S3 に `ManifestInput` への確定をさせない。「S3 にエラーが無い」を保証するのは
 * VG-2 のゲートだけで、ほかで確定させると保証と確定が離れる。
 */
export type SchemaStage = (parsed: ParsedDocument) => Diagnostic[];

export type ValidateManifestOptions = {
  text: string;
  schemaStage: SchemaStage;
  env?: Environment;
  unresolvedEnvSeverity?: Diagnostic["severity"];
};

export type ValidationResult = {
  diagnostics: Diagnostic[];
  manifest?: Manifest;
};

const isUnder = (path: string, ancestors: Set<string>): boolean => {
  for (const ancestor of ancestors) {
    if (path === ancestor || path.startsWith(`${ancestor}/`)) {
      return true;
    }
  }

  return false;
};

export const validateManifest = ({
  text,
  schemaStage,
  env = {},
  unresolvedEnvSeverity = "error",
}: ValidateManifestOptions): ValidationResult => {
  const syntax = parseManifestSyntax(text);

  if (!syntax.parsed) {
    return { diagnostics: orderDiagnostics(syntax.diagnostics) };
  }

  const expand = expandEnvironment(syntax.parsed, { env, severity: unresolvedEnvSeverity });
  const { unresolvedPaths } = expand;
  const expanded = [...syntax.diagnostics, ...expand.diagnostics];

  if (blocksNextStage(expanded)) {
    return { diagnostics: orderDiagnostics(expanded) };
  }

  // 番兵が置かれた path の違反は捨てる（VG-3）。そこにあるのは利用者の値ではなく、
  // 本当の原因は同じ path の V-A4 が報告している。
  const schemaDiagnostics = schemaStage(expand.parsed).filter(
    ({ path }) => !isUnder(path, unresolvedPaths),
  );
  const validated = [...expanded, ...schemaDiagnostics];

  if (blocksNextStage(validated)) {
    return { diagnostics: orderDiagnostics(validated) };
  }

  const manifest = normalizeManifest(expand.parsed.value as ManifestInput);
  const diagnostics = [...validated, ...validateStaticSemantics(manifest, expand.parsed.source)];
  const applicable = !hasError(diagnostics) && unresolvedPaths.size === 0;

  return {
    diagnostics: orderDiagnostics(diagnostics),
    manifest: applicable ? manifest : undefined,
  };
};
