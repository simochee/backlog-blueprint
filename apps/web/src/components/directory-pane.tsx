import { renderHttpFailure, serializeAccessEntries } from "@backlog-blueprint/core";
import { Cross2Icon, MagnifyingGlassIcon, PersonIcon, ReloadIcon } from "@radix-ui/react-icons";
import {
  Badge,
  Button,
  Checkbox,
  Code,
  Flex,
  Heading,
  IconButton,
  Spinner,
  Text,
  TextField,
} from "@radix-ui/themes";
import { type ReactNode, useState } from "react";

import { matchesFilter, type DirectoryEntry, type DirectoryKind } from "../directory";
import { type Directory } from "../use-directory";
import { StepBoundary } from "./boundary";
import { CopyButton, CopyIconButton } from "./copy-button";

/**
 * Radix Icons には人の集まりを表すものが無い（`GroupIcon` は図形のグループ化）。
 * ユーザーの `PersonIcon` と同じ 15px の格子と線の太さで描き、並べたときに揃える。
 */
export const TeamIcon = () => (
  <svg aria-hidden fill="none" height="15" viewBox="0 0 15 15" width="15">
    <g stroke="currentColor" strokeLinecap="round">
      <circle cx="5.5" cy="4.5" r="2" />
      <path d="M1.5 12.5C1.5 10.3 3.3 8.5 5.5 8.5S9.5 10.3 9.5 12.5" />
      <circle cx="10.5" cy="4" r="1.5" />
      <path d="M10.5 7.5C12.2 7.5 13.5 8.8 13.5 10.5" />
    </g>
  </svg>
);

export const DIRECTORY_PANES: Record<
  DirectoryKind,
  { title: string; icon: ReactNode; description: string; noun: string }
> = {
  users: {
    title: "Users",
    icon: <PersonIcon aria-hidden />,
    description:
      "Login IDs for access.members and access.administrators, with each display name as a comment.",
    noun: "users",
  },
  teams: {
    title: "Teams",
    icon: <TeamIcon />,
    description: "Team IDs for access.teams, with each team's name as a comment.",
    noun: "teams",
  },
};

type EntryValue = DirectoryEntry["value"];

const yamlOf = (entries: DirectoryEntry[]): string =>
  serializeAccessEntries(entries.map(({ value, label }) => ({ value, label })));

type EntryListProps = {
  entries: DirectoryEntry[];
  selected: ReadonlySet<EntryValue>;
  onToggle: (value: EntryValue, checked: boolean) => void;
};

const EntryList = ({ entries, selected, onToggle }: EntryListProps) => (
  <Flex asChild direction="column">
    <ul className="side-pane-list">
      {entries.map((entry) => (
        <Flex align="center" asChild gap="2" key={entry.value}>
          <li>
            <Text as="label" className="side-pane-entry" size="2">
              <Flex align="center" gap="2" py="1">
                <Checkbox
                  checked={selected.has(entry.value)}
                  onCheckedChange={(checked) => onToggle(entry.value, checked === true)}
                />
                <Flex direction="column" flexGrow="1" minWidth="0">
                  <Text truncate>{entry.label}</Text>
                  {entry.label === String(entry.value) ? null : (
                    <Code size="1" variant="ghost">
                      {entry.value}
                    </Code>
                  )}
                </Flex>
                {entry.note === undefined ? null : (
                  <Badge color="gray" variant="soft">
                    {entry.note}
                  </Badge>
                )}
              </Flex>
            </Text>
            <CopyIconButton label={`Copy ${entry.label}`} text={() => yamlOf([entry])} />
          </li>
        </Flex>
      ))}
    </ul>
  </Flex>
);

const selectAllState = (chosen: number, shown: number): boolean | "indeterminate" => {
  if (chosen === 0) {
    return false;
  }

  return chosen === shown ? true : "indeterminate";
};

export type DirectoryPaneProps = {
  kind: DirectoryKind;
  open: boolean;
  directory: Directory;
  onClose: () => void;
  onReload: () => void;
};

export const DirectoryPane = ({ kind, open, directory, onClose, onReload }: DirectoryPaneProps) => {
  const { title, icon, description, noun } = DIRECTORY_PANES[kind];
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<EntryValue>>(new Set());
  const entries = directory.entries ?? [];
  const shown = entries.filter((entry) => matchesFilter(entry, filter));
  const chosen = entries.filter(({ value }) => selected.has(value));
  const shownChosen = shown.filter(({ value }) => selected.has(value)).length;

  const toggle = (value: EntryValue, checked: boolean): void => {
    setSelected((previous) => {
      const next = new Set(previous);

      if (checked) {
        next.add(value);
      } else {
        next.delete(value);
      }

      return next;
    });
  };

  /** 絞り込みで隠れている選択は外さない。探し直すたびに前の選択が消えると、何件選んだかを覚えていられない。 */
  const toggleShown = (checked: boolean): void => {
    setSelected((previous) => {
      const next = new Set(previous);

      for (const { value } of shown) {
        if (checked) {
          next.add(value);
        } else {
          next.delete(value);
        }
      }

      return next;
    });
  };

  return (
    <aside aria-label={title} className="side-pane" hidden={!open}>
      <Flex direction="column" gap="3" height="100%" p="4">
        <Flex align="center" gap="2">
          {icon}
          <Heading as="h2" size="4">
            {title}
          </Heading>
          <Flex gap="1" ml="auto">
            <Button
              color="gray"
              disabled={directory.loading}
              onClick={onReload}
              size="1"
              type="button"
              variant="ghost"
            >
              <ReloadIcon aria-hidden />
              Reload
            </Button>
            <IconButton
              aria-label={`Close ${title}`}
              color="gray"
              onClick={onClose}
              size="1"
              type="button"
              variant="ghost"
            >
              <Cross2Icon />
            </IconButton>
          </Flex>
        </Flex>
        <Text color="gray" size="2">
          {description}
        </Text>
        <StepBoundary>
          <TextField.Root
            aria-label={`Filter ${noun}`}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter"
            value={filter}
          >
            <TextField.Slot>
              <MagnifyingGlassIcon aria-hidden />
            </TextField.Slot>
          </TextField.Root>
          {directory.loading ? (
            <Flex justify="center" py="4">
              <Spinner size="3" />
            </Flex>
          ) : null}
          {!directory.loading && directory.failure !== undefined ? (
            <pre className="mono">{renderHttpFailure(directory.failure, { color: false })}</pre>
          ) : null}
          {!directory.loading && directory.entries !== undefined ? (
            <>
              <Flex align="center" justify="between">
                <Text as="label" size="2">
                  <Flex align="center" gap="2">
                    <Checkbox
                      checked={selectAllState(shownChosen, shown.length)}
                      disabled={shown.length === 0}
                      onCheckedChange={(checked) => toggleShown(checked === true)}
                    />
                    Select all
                  </Flex>
                </Text>
                <Text color="gray" size="1">
                  {shown.length} of {entries.length} {noun}
                </Text>
              </Flex>
              <EntryList entries={shown} onToggle={toggle} selected={selected} />
            </>
          ) : null}
          <Flex justify="end" mt="auto">
            <CopyButton
              disabled={chosen.length === 0}
              label={`Copy ${chosen.length} as YAML`}
              text={() => yamlOf(chosen)}
            />
          </Flex>
        </StepBoundary>
      </Flex>
    </aside>
  );
};
