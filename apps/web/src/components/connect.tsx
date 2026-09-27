import { renderHttpFailure, type Diagnostic } from "@backlog-blueprint/core";
import { ExternalLinkIcon } from "@radix-ui/react-icons";
import {
  Button,
  Card,
  Dialog,
  Flex,
  Heading,
  Link,
  Spinner,
  Text,
  TextField,
} from "@radix-ui/themes";
import { useEffect, useState } from "react";

import { setApiKey } from "../secrets";
import { apiKeyPageUrl } from "../space";
import { DiagnosticList } from "./diagnostics";

type ConnectFormProps = {
  initialSpace: string;
  hasApiKey: boolean;
  connecting: boolean;
  onConnect: (space: string) => void;
  diagnostics: Diagnostic[];
  failure?: unknown;
  submitLabel?: string;
};

const ConnectForm = ({
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

  // 開いた時点で API キーの下書きを空にする。欄は非制御で初期値を持てない（§2.4）ので、
  // 前に打った値が secrets.ts に残っていると、空に見える欄のまま Connect が押せる。
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

type ConnectScreenProps = ConnectFormProps & { reconnectingTo?: string };

export const ConnectScreen = ({ reconnectingTo, ...form }: ConnectScreenProps) => (
  <Flex align="center" className="connect-screen" justify="center" px="4">
    <Card size="4" style={{ width: "100%", maxWidth: "28rem" }}>
      {reconnectingTo === undefined ? (
        <Flex direction="column" gap="5">
          <Flex direction="column" gap="2">
            <Heading as="h1" size="6">
              Connect to Backlog
            </Heading>
            <Text color="gray" size="2">
              Use your Backlog API key. Creating a project, changing its statuses and granting the
              project administrator role need a Space Administrator. The key stays in this tab and
              is removed when you close it or disconnect.
            </Text>
          </Flex>
          <ConnectForm {...form} />
        </Flex>
      ) : (
        <Flex align="center" direction="column" gap="3" py="4">
          <Spinner size="3" />
          <Text color="gray" size="2">
            Reconnecting to {reconnectingTo}...
          </Text>
        </Flex>
      )}
    </Card>
  </Flex>
);

type ConnectDialogProps = Omit<ConnectFormProps, "submitLabel"> & {
  open: boolean;
  onClose: () => void;
};

export const ConnectDialog = ({ open, onClose, ...form }: ConnectDialogProps) => (
  <Dialog.Root
    onOpenChange={(next) => {
      if (!next) {
        onClose();
      }
    }}
    open={open}
  >
    <Dialog.Content maxWidth="28rem" size="3">
      <Dialog.Title size="4">Switch connection</Dialog.Title>
      <Dialog.Description color="gray" mb="4" size="2">
        The current connection stays until the new one is confirmed.
      </Dialog.Description>
      <ConnectForm {...form} submitLabel="Switch" />
    </Dialog.Content>
  </Dialog.Root>
);
