import { serializeAccessEntries } from "@backlog-blueprint/core";
import { ChevronDownIcon, ExitIcon, LoopIcon } from "@radix-ui/react-icons";
import { Avatar, Box, Button, Flex, Popover, Separator, Text } from "@radix-ui/themes";
import { type ReactNode } from "react";

import { initialOf } from "../avatar";
import { type Connection } from "../connection";
import { CopyIconButton } from "./copy-button";

export type AccountMenuProps = {
  domain: string;
  connection: Connection;
  /** 送信層で取ったアイコンの `blob:` URL（WU-35）。取れるまでは頭文字で描く */
  icons: { space?: string; user?: string };
  /** WU-37。適用の最中は切り替えも切断もさせない */
  locked: boolean;
  onSwitch: () => void;
  onDisconnect: () => void;
};

/** ヘッダーでは隣のボタンの高さに収め、ポップオーバーでは見出しの大きさにする */
type AvatarsSize = "header" | "menu";

const Avatars = ({
  space,
  user,
  icons,
  size,
}: {
  space: string;
  user: string;
  icons: AccountMenuProps["icons"];
  size: AvatarsSize;
}) => (
  <span className="account-avatars" data-size={size}>
    <Avatar
      aria-hidden
      fallback={initialOf(space)}
      radius="medium"
      size={size === "header" ? "1" : "3"}
      src={icons.space}
      variant="solid"
    />
    <Avatar
      aria-hidden
      className="account-avatar-user"
      color="gray"
      fallback={initialOf(user)}
      radius="full"
      size="1"
      src={icons.user}
      variant="solid"
    />
  </span>
);

const Detail = ({ label, children }: { label: string; children: ReactNode }) => (
  <Flex align="center" gap="3" justify="between" minHeight="24px">
    <Text color="gray" size="1">
      {label}
    </Text>
    <Flex align="center" gap="2">
      {children}
    </Flex>
  </Flex>
);

export const AccountMenu = ({
  domain,
  connection,
  icons,
  locked,
  onSwitch,
  onDisconnect,
}: AccountMenuProps) => {
  const { user, userName, space, updateRateLimit } = connection;

  return (
    <Popover.Root>
      <Popover.Trigger>
        <button aria-label={`${user} at ${space}`} className="account-trigger" type="button">
          <Avatars icons={icons} size="header" space={space} user={user} />
          <ChevronDownIcon aria-hidden className="account-chevron" />
        </button>
      </Popover.Trigger>
      <Popover.Content align="end" maxWidth="20rem" minWidth="18rem" size="2">
        <Flex direction="column" gap="3">
          <Flex align="center" gap="3">
            <Avatars icons={icons} size="menu" space={space} user={user} />
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
            <Detail label="Signed in as">
              <Text className="mono" size="1" weight="medium">
                {user}
              </Text>
              {/**
               * 値だけを写さない。`123` や `true` のようなログイン ID は、そのまま貼ると
               * Yaml が文字列として読まない。Users のペインと同じ書き出しを通す（WU-23）。
               */}
              <CopyIconButton
                label="Copy login ID as YAML"
                text={() =>
                  serializeAccessEntries([
                    { value: user, ...(userName === undefined ? {} : { label: userName }) },
                  ])
                }
              />
            </Detail>
            <Detail label="Role">
              <Text size="1" weight="medium">
                Space Administrator
              </Text>
            </Detail>
            <Detail label="Update rate limit">
              <Text size="1" weight="medium">
                {updateRateLimit.remaining} / {updateRateLimit.limit} remaining
              </Text>
            </Detail>
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
