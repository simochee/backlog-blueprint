import { serializeAccessEntries } from "@backlog-blueprint/core";
import { Popover } from "radix-ui";

import { initialOf } from "../avatar";
import { type Connection } from "../connection";
import { CopyButton } from "./copy-button";

type AccountMenuProps = {
  domain: string;
  connection: Connection;
  icons: { space?: string; user?: string };
  locked: boolean;
  onSwitch: () => void;
  onDisconnect: () => void;
};

const Avatars = ({
  space,
  user,
  icons,
  size,
}: {
  space: string;
  user: string;
  icons: AccountMenuProps["icons"];
  size: "header" | "menu";
}) => (
  <span aria-hidden className="avatars" data-size={size}>
    {icons.space === undefined ? initialOf(space) : <img alt="" src={icons.space} />}
    <span className="avatar-user">
      {icons.user === undefined ? initialOf(user) : <img alt="" src={icons.user} />}
    </span>
  </span>
);

const LOCKED = "Wait for Apply to finish";

export const AccountMenu = ({
  domain,
  connection,
  icons,
  locked,
  onSwitch,
  onDisconnect,
}: AccountMenuProps) => {
  const { user, userId, userName, spaceAdministrator, space, updateRateLimit } = connection;
  const remaining =
    updateRateLimit.limit === 0 ? 0 : (updateRateLimit.remaining / updateRateLimit.limit) * 100;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button aria-label={`${user} at ${space}`} className="account-trigger" type="button">
          <Avatars icons={icons} size="header" space={space} user={user} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          aria-label="Account"
          className="account-popover"
          collisionPadding={8}
          sideOffset={4}
        >
          <div className="account-head">
            <Avatars icons={icons} size="menu" space={space} user={user} />
            <div className="account-names">
              <span className="account-space">{space}</span>
              <span className="account-domain">{domain}</span>
            </div>
          </div>
          <dl className="account-table">
            <dt>User</dt>
            <dd>
              <span>Signed in as {user}</span>
              {/*
               * 表示しているログイン ID を写さない。`access` に書くのは数値の ID で（A-7）、
               * 名前のコメントも付けるので、Users のサイドバーと同じ書き出しを通す（WU-23）。
               */}
              <CopyButton
                accessibleLabel="Copy user ID as YAML"
                label="Copy"
                size="small"
                text={() =>
                  serializeAccessEntries([
                    { value: userId, ...(userName === undefined ? {} : { label: userName }) },
                  ])
                }
              />
            </dd>
            <dt>Role</dt>
            <dd>{spaceAdministrator ? "Space Administrator" : "Not a space administrator"}</dd>
            <dt>Update rate limit</dt>
            <dd data-layout="stack">
              <span>
                {updateRateLimit.remaining} / {updateRateLimit.limit} remaining
              </span>
              <span aria-hidden className="meter">
                <span style={{ width: `${remaining}%` }} />
              </span>
            </dd>
          </dl>
          <div className="account-actions">
            <Popover.Close asChild>
              <button
                disabled={locked}
                onClick={onSwitch}
                title={locked ? LOCKED : undefined}
                type="button"
              >
                Switch connection
              </button>
            </Popover.Close>
            <Popover.Close asChild>
              <button
                data-tone="destroy"
                disabled={locked}
                onClick={onDisconnect}
                title={locked ? LOCKED : undefined}
                type="button"
              >
                Disconnect
              </button>
            </Popover.Close>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};
