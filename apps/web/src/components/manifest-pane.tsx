import { Button, Flex, Text } from "@radix-ui/themes";
import { lazy, Suspense } from "react";

import { type ManifestValidation } from "../validation";
import { DiagnosticList } from "./diagnostics";
import { EnvironmentDialog } from "./environment-dialog";

/**
 * エディタとスキーマ一式は、スペースに繋がるまで現れないので最初の読み込みに
 * 載せない。接続前の画面がエディタを待つ理由が無い。
 */
const ManifestEditor = lazy(async () => {
  const loaded = await import("./manifest-editor");

  return { default: loaded.ManifestEditor };
});

export type ManifestPaneProps = {
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
  /** 押せるのは今の入力で作った、変更のある、まだ適用していない計画があるときだけ（WU-3） */
  canApply: boolean;
  applying: boolean;
  onApply: () => void;
};

export const ManifestPane = ({
  text,
  onTextChange,
  onFileDropped,
  names,
  validation,
  canPlan,
  planning,
  onPlan,
  canApply,
  applying,
  onApply,
}: ManifestPaneProps) => (
  <>
    <Flex align="center" className="workspace-toolbar" gap="3" justify="between">
      <Flex align="center" gap="3">
        <Text as="label" color="gray" htmlFor="manifest" size="2">
          Manifest (paste, or drop a file here)
        </Text>
        {names.length === 0 ? null : <EnvironmentDialog names={names} />}
      </Flex>
      <Flex gap="2">
        <Button color="gray" disabled={!canPlan} loading={planning} onClick={onPlan} variant="soft">
          Plan
        </Button>
        <Button disabled={!canApply} loading={applying} onClick={onApply}>
          Apply
        </Button>
      </Flex>
    </Flex>
    <Suspense fallback={<div className="manifest-editor" />}>
      <ManifestEditor
        id="manifest"
        onChange={onTextChange}
        onFileDropped={onFileDropped}
        value={text}
      />
    </Suspense>
    <div className="workspace-diagnostics">
      {validation === undefined ? (
        <Text color="gray" size="2">
          Validating...
        </Text>
      ) : (
        <DiagnosticList diagnostics={validation.diagnostics} />
      )}
    </div>
  </>
);
