import { Card, Flex, Heading, Spinner, Text } from "@radix-ui/themes";

import { ConnectForm, type ConnectFormProps } from "./connect-form";

export type ConnectScreenProps = ConnectFormProps & {
  /** 保存した資格情報で繋ぎ直している最中（WU-38）。フォームの代わりに待ちを出す */
  reconnectingTo?: string;
};

/** WU-34。接続するまでは、画面の中央にこれだけを出す */
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
              Use your Backlog API key. Creating a project or changing its statuses needs a Space
              Administrator. The key stays in this tab and is removed when you close it or
              disconnect.
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
