import { renderHttpFailure, serializeAccessEntries } from "@backlog-blueprint/core";
import { Checkbox } from "radix-ui";
import { Fragment, useState } from "react";

import { matchesFilter, type DirectoryEntry, type DirectoryKind } from "../directory";
import { type Directory } from "../use-directory";
import { SectionBoundary } from "./boundary";
import { CopyButton } from "./copy-button";
import { Sidebar } from "./sidebar";

const PANES: Record<DirectoryKind, { title: string; noun: string; placeholder: string }> = {
  users: { title: "Users", noun: "users", placeholder: "Filter by name, ID or email" },
  teams: { title: "Teams", noun: "teams", placeholder: "Filter by name or ID" },
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

const EntryRow = ({
  entry,
  checked,
  onToggle,
}: {
  entry: DirectoryEntry;
  checked: boolean;
  onToggle: (value: EntryValue, checked: boolean) => void;
}) => (
  <li className="entry" data-selected={checked}>
    <Checkbox.Root
      aria-label={entry.label}
      checked={checked}
      className="checkbox"
      onCheckedChange={(state) => onToggle(entry.value, state === true)}
    >
      <Checkbox.Indicator>✓</Checkbox.Indicator>
    </Checkbox.Root>
    <div className="entry-main">
      <div className="entry-title">
        <span className="entry-name">{entry.label}</span>
        {entry.administrator === true ? (
          <span className="admin-chip" title="Space admin">
            Admin
          </span>
        ) : null}
      </div>
      <div className="entry-details">
        {[String(entry.value), ...entry.details].map((detail, index) => (
          <Fragment key={detail}>
            {index === 0 ? null : " · "}
            <span>{detail}</span>
          </Fragment>
        ))}
      </div>
    </div>
    <CopyButton
      accessibleLabel={`Copy ${entry.label}`}
      label="Copy"
      size="small"
      text={() => yamlOf([entry])}
    />
  </li>
);

type DirectoryPaneProps = {
  kind: DirectoryKind;
  open: boolean;
  directory: Directory;
  onClose: () => void;
  onReload: () => void;
};

export const DirectoryPane = ({ kind, open, directory, onClose, onReload }: DirectoryPaneProps) => {
  const { title, noun, placeholder } = PANES[kind];
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<EntryValue>>(new Set());
  const entries = directory.entries ?? [];
  const shown = entries.filter((entry) => matchesFilter(entry, filter));
  const chosen = entries.filter(({ value }) => selected.has(value));
  const chosenShown = shown.filter(({ value }) => selected.has(value)).length;
  const selectAll = selectAllState(chosenShown, shown.length);

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

  // 絞り込みで隠れている選択は外さない。探し直すたびに前の選択が消えると、何件選んだかを覚えていられない。
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
    <Sidebar
      actions={
        <button
          className="button"
          data-size="small"
          disabled={directory.loading}
          onClick={onReload}
          type="button"
        >
          Reload
        </button>
      }
      onClose={onClose}
      open={open}
      title={title}
    >
      <SectionBoundary>
        <div className="sidebar-filter">
          <input
            aria-label={`Filter ${noun}`}
            className="input"
            onChange={(event) => setFilter(event.target.value)}
            placeholder={placeholder}
            spellCheck={false}
            value={filter}
          />
        </div>
        <div className="select-all">
          <Checkbox.Root
            aria-label="Select all"
            checked={selectAll}
            className="checkbox"
            disabled={shown.length === 0}
            onCheckedChange={(state) => toggleShown(state === true)}
          >
            <Checkbox.Indicator>{selectAll === "indeterminate" ? "–" : "✓"}</Checkbox.Indicator>
          </Checkbox.Root>
          <span aria-hidden>Select all</span>
        </div>
        <div className="sidebar-list">
          {directory.loading ? (
            <p className="sidebar-status">
              <span aria-hidden className="spinner" />
              <span className="visually-hidden">Loading {noun}</span>
            </p>
          ) : null}
          {!directory.loading && directory.failure !== undefined ? (
            <p className="failure mono">{renderHttpFailure(directory.failure, { color: false })}</p>
          ) : null}
          {!directory.loading && directory.entries !== undefined ? (
            <ul aria-label={title} className="entry-list">
              {shown.map((entry) => (
                <EntryRow
                  checked={selected.has(entry.value)}
                  entry={entry}
                  key={entry.value}
                  onToggle={toggle}
                />
              ))}
            </ul>
          ) : null}
        </div>
        <div className="sidebar-footer">
          <span>
            {directory.entries === undefined
              ? null
              : `${shown.length} of ${entries.length} ${noun}`}
          </span>
          <CopyButton
            disabled={chosen.length === 0}
            label={`Copy ${chosen.length} as YAML`}
            text={() => yamlOf(chosen)}
            variant="primary"
          />
        </div>
      </SectionBoundary>
    </Sidebar>
  );
};
