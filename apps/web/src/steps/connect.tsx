import { renderHttpFailure, type Diagnostic } from "@backlog-blueprint/core";
import { Badge, Button, Flex, Grid, Link, Text, TextField } from "@radix-ui/themes";

import { DiagnosticList } from "../components/diagnostics";
import { type Connection } from "../connection";
import { setApiKey } from "../secrets";
import { apiKeyPageUrl } from "../space";

export type ConnectStepProps = {
  space: string;
  onSpaceChange: (space: string) => void;
  canConnect: boolean;
  connecting: boolean;
  onConnect: () => void;
  connection?: Connection;
  diagnostics: Diagnostic[];
  failure?: unknown;
};

export const ConnectStep = ({
  space,
  onSpaceChange,
  canConnect,
  connecting,
  onConnect,
  connection,
  diagnostics,
  failure,
}: ConnectStepProps) => {
  const apiKeyPage = apiKeyPageUrl(space);

  return (
    <Flex direction="column" gap="4">
      <Grid columns={{ initial: "1", sm: "2" }} gap="4">
        <Flex direction="column" gap="1">
          <Text as="label" htmlFor="space-domain" size="2" weight="medium">
            Space domain
          </Text>
          <TextField.Root
            id="space-domain"
            onChange={(event) => onSpaceChange(event.target.value)}
            placeholder="example.backlog.com"
            size="3"
            spellCheck={false}
            value={space}
          />
          {apiKeyPage === undefined ? null : (
            <Text size="1">
              <Link href={apiKeyPage} rel="noreferrer" target="_blank">
                Get an API key on {space.trim()}
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
      </Grid>
      <Flex justify="end">
        <Button
          disabled={!canConnect || connecting}
          loading={connecting}
          onClick={onConnect}
          size="3"
        >
          Connect
        </Button>
      </Flex>
      {connection === undefined ? null : (
        <Flex align="center" gap="3" wrap="wrap">
          <Badge color="green" size="2" variant="soft">
            Connected
          </Badge>
          <Text size="2">
            Signed in as {connection.user} at {connection.space} (Space Administrator)
          </Text>
          <Text color="gray" size="2">
            Update rate limit: {connection.updateRateLimit.remaining} /{" "}
            {connection.updateRateLimit.limit} remaining
          </Text>
        </Flex>
      )}
      <DiagnosticList diagnostics={diagnostics} />
      {failure === undefined ? null : (
        <pre className="mono">{renderHttpFailure(failure, { color: false })}</pre>
      )}
    </Flex>
  );
};
