import { Box, Button, Flex, Grid, Text, TextField } from "@radix-ui/themes";
import { lazy, Suspense } from "react";

import { DiagnosticList } from "../components/diagnostics";
import { environmentValue, setEnvironmentValue } from "../secrets";
import { type ManifestValidation } from "../validation";

/**
 * Monaco は束ねると本体の数倍になる。この段はスペースに繋がるまで現れないので、
 * 最初の読み込みに載せない。接続前の画面が Monaco を待つ理由が無い。
 */
const ManifestEditor = lazy(async () => {
  const loaded = await import("../components/manifest-editor");

  return { default: loaded.ManifestEditor };
});

export type ManifestStepProps = {
  text: string;
  onTextChange: (text: string) => void;
  onFileDropped: (name: string, text: string) => void;
  /**
   * 入力欄の一覧を検証結果から取らない。検証は入力が止まってから走る（§2.2）ので、
   * 途中の状態で欄が消えると、環境変数を打っている最中に focus が外れる。
   */
  names: string[];
  validation?: ManifestValidation;
  canPlan: boolean;
  planning: boolean;
  onPlan: () => void;
};

export const ManifestStep = ({
  text,
  onTextChange,
  onFileDropped,
  names,
  validation,
  canPlan,
  planning,
  onPlan,
}: ManifestStepProps) => (
  <Flex direction="column" gap="4">
    <Grid columns={{ initial: "1", md: "minmax(0, 2fr) minmax(0, 1fr)" }} gap="4">
      <Flex direction="column" gap="1">
        <Text as="label" htmlFor="manifest" size="2" weight="medium">
          Manifest (paste, or drop a file here)
        </Text>
        <Suspense fallback={<div className="manifest-editor" />}>
          <ManifestEditor
            id="manifest"
            onChange={onTextChange}
            onFileDropped={onFileDropped}
            value={text}
          />
        </Suspense>
      </Flex>
      <Flex direction="column" gap="3">
        <Text size="2" weight="medium">
          Environment values
        </Text>
        {names.length === 0 ? (
          <Text color="gray" size="2">
            No ${"{NAME}"} references in the manifest.
          </Text>
        ) : (
          names.map((name) => (
            <Flex direction="column" gap="1" key={name}>
              <Text as="label" htmlFor={`env-${name}`} size="1" weight="medium">
                {name}
              </Text>
              <TextField.Root
                autoComplete="off"
                defaultValue={environmentValue(name)}
                id={`env-${name}`}
                onChange={(event) => setEnvironmentValue(name, event.target.value)}
                type="password"
              />
            </Flex>
          ))
        )}
      </Flex>
    </Grid>
    <Box>
      {validation === undefined ? (
        <Text color="gray" size="2">
          Validating...
        </Text>
      ) : (
        <DiagnosticList diagnostics={validation.diagnostics} />
      )}
    </Box>
    <Flex justify="end">
      <Button disabled={!canPlan || planning} loading={planning} onClick={onPlan} size="3">
        Plan
      </Button>
    </Flex>
  </Flex>
);
