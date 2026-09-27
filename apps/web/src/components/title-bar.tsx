import { DropdownMenu } from "radix-ui";
import { type ReactNode } from "react";

import { SHORTCUTS, shortcutLabel } from "../hotkeys";
import { LOGO_COMPACT } from "../logos";

type Run = { blocker?: string; onClick: () => void };

type TitleBarProps = {
  onOpen: () => void;
  onSave: () => void;
  onImport: () => void;
  outdated: boolean;
  onShowOutput: () => void;
  plan: Run;
  apply: Run;
  account: ReactNode;
};

/**
 * `disabled` にしない。押せないボタンもクリックを拾い、理由の場所へ誘導する（WU-52）。
 * `aria-disabled` なら読み上げには押せないことが伝わり、クリックは届く。
 */
const RunButton = ({
  label,
  variant,
  run,
  title,
  shortcut,
}: {
  label: string;
  variant: "primary" | "secondary";
  run: Run;
  title: string;
  shortcut?: string;
}) => (
  <button
    aria-disabled={run.blocker !== undefined}
    aria-keyshortcuts={shortcut}
    className="button"
    data-size="main"
    data-variant={variant}
    onClick={run.onClick}
    title={run.blocker ?? title}
    type="button"
  >
    {label}
  </button>
);

export const TitleBar = ({
  onOpen,
  onSave,
  onImport,
  outdated,
  onShowOutput,
  plan,
  apply,
  account,
}: TitleBarProps) => (
  <header className="title-bar">
    <div className="title-bar-logo">
      <img alt="Backlog Blueprint" src={LOGO_COMPACT} />
    </div>
    <div className="title-bar-group" data-layout="wide">
      <button
        aria-keyshortcuts="Meta+O Control+O"
        className="button"
        onClick={onOpen}
        title={`Open a manifest file (${shortcutLabel(SHORTCUTS.open)})`}
        type="button"
      >
        Open
      </button>
      <button
        aria-keyshortcuts="Meta+S Control+S"
        className="button"
        onClick={onSave}
        title={`Save (${shortcutLabel(SHORTCUTS.save)})`}
        type="button"
      >
        Save <kbd aria-hidden>{shortcutLabel(SHORTCUTS.save)}</kbd>
      </button>
      <button className="button" onClick={onImport} type="button">
        Import from Backlog
      </button>
    </div>
    <div className="title-bar-group" data-layout="compact">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="button" type="button">
            File{" "}
            <span aria-hidden className="caret">
              ▾
            </span>
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="start" className="menu" data-kind="file" sideOffset={4}>
            <DropdownMenu.Item className="menu-item" onSelect={onOpen}>
              Open <kbd>{shortcutLabel(SHORTCUTS.open)}</kbd>
            </DropdownMenu.Item>
            <DropdownMenu.Item className="menu-item" onSelect={onSave}>
              Save <kbd>{shortcutLabel(SHORTCUTS.save)}</kbd>
            </DropdownMenu.Item>
            <DropdownMenu.Item className="menu-item" onSelect={onImport}>
              Import from Backlog
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
    <span className="title-bar-spacer" />
    <div className="title-bar-group title-bar-run">
      {outdated ? (
        <button
          className="outdated-button"
          onClick={onShowOutput}
          title="The latest plan no longer matches the input"
          type="button"
        >
          Plan outdated
        </button>
      ) : null}
      <RunButton
        label="Plan"
        run={plan}
        shortcut="Meta+Enter Control+Enter"
        title={`Build a plan. Nothing is written. (${shortcutLabel(SHORTCUTS.plan)})`}
        variant="secondary"
      />
      <RunButton
        label="Apply"
        run={apply}
        title="Apply the latest plan. Writes to Backlog."
        variant="primary"
      />
    </div>
    {account}
  </header>
);
