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
  ScrollArea,
  Spinner,
  Table,
  Text,
  TextField,
  VisuallyHidden,
} from "@radix-ui/themes";
import { type ReactNode, useState } from "react";

import { matchesFilter, type DirectoryEntry, type DirectoryKind } from "../directory";
import { type Directory } from "../use-directory";
import { SectionBoundary } from "./boundary";
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
  { title: string; icon: ReactNode; description: string; noun: string; singular: string }
> = {
  users: {
    title: "Users",
    icon: <PersonIcon aria-hidden />,
    description:
      "Login IDs for access.members and access.administrators, with each display name as a comment.",
    noun: "users",
    singular: "User",
  },
  teams: {
    title: "Teams",
    icon: <TeamIcon />,
    description: "Team IDs for access.teams, with each team's name as a comment.",
    noun: "teams",
    singular: "Team",
  },
};

type EntryValue = DirectoryEntry["value"];

const yamlOf = (entries: DirectoryEntry[]): string =>
  serializeAccessEntries(entries.map(({ value, label }) => ({ value, label })));

const selectAllState = (chosen: number, shown: number): boolean | "indeterminate" => {
  if (chosen === 0) {
    return false;
  }

  return chosen === shown ? true : "indeterminate";
};

type EntryTableProps = {
  heading: string;
  entries: DirectoryEntry[];
  selected: ReadonlySet<EntryValue>;
  onToggle: (value: EntryValue, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
};

const EntryRow = ({
  entry,
  checked,
  onToggle,
}: {
  entry: DirectoryEntry;
  checked: boolean;
  onToggle: (value: EntryValue, checked: boolean) => void;
}) => (
  <Table.Row align="center">
    <Table.Cell>
      <Checkbox
        aria-label={entry.label}
        checked={checked}
        onCheckedChange={(state) => onToggle(entry.value, state === true)}
      />
    </Table.Cell>
    <Table.RowHeaderCell className="side-pane-entry">
      <Flex align="center" gap="2">
        <Text size="2" truncate weight="medium">
          {entry.label}
        </Text>
        {entry.badge === undefined ? null : (
          <Badge color="gray" size="1" variant="soft">
            {entry.badge}
          </Badge>
        )}
      </Flex>
      <Flex align="center" gap="1" wrap="wrap">
        {entry.label === String(entry.value) ? null : (
          <Code size="1" variant="ghost">
            {entry.value}
          </Code>
        )}
        {entry.details.map((detail) => (
          <Text color="gray" key={detail} size="1" truncate>
            {detail}
          </Text>
        ))}
      </Flex>
    </Table.RowHeaderCell>
    <Table.Cell justify="end">
      <CopyIconButton label={`Copy ${entry.label}`} text={() => yamlOf([entry])} />
    </Table.Cell>
  </Table.Row>
);

const EntryTable = ({ heading, entries, selected, onToggle, onToggleAll }: EntryTableProps) => {
  const chosen = entries.filter(({ value }) => selected.has(value)).length;

  return (
    <ScrollArea className="side-pane-list" scrollbars="vertical" type="auto">
      <Table.Root size="1" variant="ghost">
        <Table.Header>
          <Table.Row align="center">
            <Table.ColumnHeaderCell width="2rem">
              <Checkbox
                aria-label="Select all"
                checked={selectAllState(chosen, entries.length)}
                disabled={entries.length === 0}
                onCheckedChange={(state) => onToggleAll(state === true)}
              />
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>{heading}</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell width="2.5rem">
              <VisuallyHidden>Copy</VisuallyHidden>
            </Table.ColumnHeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {entries.map((entry) => (
            <EntryRow
              checked={selected.has(entry.value)}
              entry={entry}
              key={entry.value}
              onToggle={onToggle}
            />
          ))}
        </Table.Body>
      </Table.Root>
    </ScrollArea>
  );
};

export type DirectoryPaneProps = {
  kind: DirectoryKind;
  open: boolean;
  directory: Directory;
  onClose: () => void;
  onReload: () => void;
};

export const DirectoryPane = ({ kind, open, directory, onClose, onReload }: DirectoryPaneProps) => {
  const { title, icon, description, noun, singular } = DIRECTORY_PANES[kind];
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<EntryValue>>(new Set());
  const entries = directory.entries ?? [];
  const shown = entries.filter((entry) => matchesFilter(entry, filter));
  const chosen = entries.filter(({ value }) => selected.has(value));

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
        <SectionBoundary>
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
            <EntryTable
              entries={shown}
              heading={singular}
              onToggle={toggle}
              onToggleAll={toggleShown}
              selected={selected}
            />
          ) : null}
          <Flex align="center" gap="3" justify="between" mt="auto">
            <Text color="gray" size="1">
              {directory.entries === undefined
                ? null
                : `${shown.length} of ${entries.length} ${noun}`}
            </Text>
            <CopyButton
              disabled={chosen.length === 0}
              label={`Copy ${chosen.length} as YAML`}
              text={() => yamlOf(chosen)}
            />
          </Flex>
        </SectionBoundary>
      </Flex>
    </aside>
  );
};
