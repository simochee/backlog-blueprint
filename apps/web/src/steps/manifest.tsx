import { Box, Button, Flex, Text } from "@radix-ui/themes";
import { lazy, Suspense } from "react";

import { DiagnosticList } from "../components/diagnostics";
import { EnvironmentDialog } from "../components/environment-dialog";
import { type ManifestValidation } from "../validation";

/**
 * エディタとスキーマ一式は、この段がスペースに繋がるまで現れないので最初の読み込みに
 * 載せない。接続前の画面がエディタを待つ理由が無い。
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
    <Flex direction="column" gap="1">
      <Flex align="center" gap="3" justify="between">
        <Text as="label" htmlFor="manifest" size="2" weight="medium">
          Manifest (paste, or drop a file here)
        </Text>
        {names.length === 0 ? null : <EnvironmentDialog names={names} />}
      </Flex>
      <Suspense fallback={<div className="manifest-editor" />}>
        <ManifestEditor
          id="manifest"
          onChange={onTextChange}
          onFileDropped={onFileDropped}
          value={text}
        />
      </Suspense>
    </Flex>
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
