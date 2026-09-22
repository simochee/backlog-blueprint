import { ChevronDownIcon, ExitIcon, LoopIcon } from "@radix-ui/react-icons";
import { Avatar, Box, Button, Flex, Popover, Separator, Text } from "@radix-ui/themes";

import { initialOf } from "../avatar";
import { type Connection } from "../connection";

export type AccountMenuProps = {
  domain: string;
  connection: Connection;
  /** WU-37。適用の最中は切り替えも切断もさせない */
  locked: boolean;
  onSwitch: () => void;
  onDisconnect: () => void;
};

/**
 * アバターは頭文字で描く（WU-35）。Backlog のアイコン画像は取得に API キーが要り、
 * `<img src>` の URL に載せると DOM の属性にキーが出る。
 */
const Avatars = ({ space, user }: { space: string; user: string }) => (
  <span className="account-avatars">
    <Avatar aria-hidden fallback={initialOf(space)} radius="medium" size="2" variant="solid" />
    <Avatar
      aria-hidden
      className="account-avatar-user"
      color="gray"
      fallback={initialOf(user)}
      radius="full"
      size="1"
      variant="solid"
    />
  </span>
);

const Detail = ({ label, value }: { label: string; value: string }) => (
  <Flex gap="3" justify="between">
    <Text color="gray" size="1">
      {label}
    </Text>
    <Text size="1" weight="medium">
      {value}
    </Text>
  </Flex>
);

export const AccountMenu = ({
  domain,
  connection,
  locked,
  onSwitch,
  onDisconnect,
}: AccountMenuProps) => {
  const { user, space, updateRateLimit } = connection;

  return (
    <Popover.Root>
      <Popover.Trigger>
        <button aria-label={`${user} at ${space}`} className="account-trigger" type="button">
          <Avatars space={space} user={user} />
          <span className="account-names">
            <Text as="span" size="2" truncate weight="medium">
              {user}
            </Text>
            <Text as="span" color="gray" size="1" truncate>
              {space}
            </Text>
          </span>
          <ChevronDownIcon aria-hidden className="account-chevron" />
        </button>
      </Popover.Trigger>
      <Popover.Content align="end" maxWidth="20rem" minWidth="18rem" size="2">
        <Flex direction="column" gap="3">
          <Flex align="center" gap="3">
            <Avatars space={space} user={user} />
            <Box minWidth="0">
              <Text as="div" size="2" truncate weight="bold">
                {space}
              </Text>
              <Text as="div" color="gray" size="1" truncate>
                {domain}
              </Text>
            </Box>
          </Flex>
          <Flex direction="column" gap="1">
            <Detail label="Signed in as" value={user} />
            <Detail label="Role" value="Space Administrator" />
            <Detail
              label="Update rate limit"
              value={`${updateRateLimit.remaining} / ${updateRateLimit.limit} remaining`}
            />
          </Flex>
          <Separator size="4" />
          <Flex direction="column" gap="2">
            <Popover.Close>
              <Button color="gray" disabled={locked} onClick={onSwitch} variant="soft">
                <LoopIcon />
                Switch connection
              </Button>
            </Popover.Close>
            <Popover.Close>
              <Button color="red" disabled={locked} onClick={onDisconnect} variant="soft">
                <ExitIcon />
                Disconnect
              </Button>
            </Popover.Close>
            {locked ? (
              <Text color="gray" size="1">
                Unavailable while apply is running.
              </Text>
            ) : null}
          </Flex>
        </Flex>
      </Popover.Content>
    </Popover.Root>
  );
};
