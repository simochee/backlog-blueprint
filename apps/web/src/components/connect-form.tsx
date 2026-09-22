import { renderHttpFailure, type Diagnostic } from "@backlog-blueprint/core";
import { ExternalLinkIcon } from "@radix-ui/react-icons";
import { Button, Flex, Link, Text, TextField } from "@radix-ui/themes";
import { useEffect, useState } from "react";

import { setApiKey } from "../secrets";
import { apiKeyPageUrl } from "../space";
import { DiagnosticList } from "./diagnostics";

export type ConnectFormProps = {
  initialSpace: string;
  hasApiKey: boolean;
  connecting: boolean;
  onConnect: (space: string) => void;
  diagnostics: Diagnostic[];
  failure?: unknown;
  submitLabel?: string;
};

/** 接続画面と切り替えのモーダルが同じものを使う（WU-34 / WU-36） */
export const ConnectForm = ({
  initialSpace,
  hasApiKey,
  connecting,
  onConnect,
  diagnostics,
  failure,
  submitLabel = "Connect",
}: ConnectFormProps) => {
  const [space, setSpace] = useState(initialSpace);
  const apiKeyPage = apiKeyPageUrl(space);
  const canConnect = space.trim() !== "" && hasApiKey && !connecting;

  /**
   * 開いた時点で API キーの下書きを空にする。欄は非制御で初期値を持てない（§2.4）ので、
   * 前に打った値が secrets.ts に残っていると、空に見える欄のまま Connect が押せる。
   */
  useEffect(() => {
    setApiKey("");
  }, []);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();

        if (canConnect) {
          onConnect(space.trim());
        }
      }}
    >
      <Flex direction="column" gap="4">
        <Flex direction="column" gap="1">
          <Text as="label" htmlFor="space-domain" size="2" weight="medium">
            Space domain
          </Text>
          <TextField.Root
            autoFocus
            id="space-domain"
            onChange={(event) => setSpace(event.target.value)}
            placeholder="example.backlog.com"
            size="3"
            spellCheck={false}
            value={space}
          />
          {apiKeyPage === undefined ? null : (
            <Text size="1">
              <Link href={apiKeyPage} rel="noreferrer" target="_blank">
                Get an API key on {space.trim()} <ExternalLinkIcon aria-hidden />
              </Link>
            </Text>
          )}
        </Flex>
        <Flex direction="column" gap="1">
          <Text as="label" htmlFor="api-key" size="2" weight="medium">
            API key
          </Text>
          <TextField.Root
            autoComplete="off"
            id="api-key"
            onChange={(event) => setApiKey(event.target.value)}
            size="3"
            type="password"
          />
        </Flex>
        <DiagnosticList diagnostics={diagnostics} />
        {failure === undefined ? null : (
          <pre className="mono">{renderHttpFailure(failure, { color: false })}</pre>
        )}
        <Button disabled={!canConnect} loading={connecting} size="3" type="submit">
          {submitLabel}
        </Button>
      </Flex>
    </form>
  );
};
