export type SidebarKind = "users" | "teams" | "env";

type ActivityBarProps = {
  active?: SidebarKind;
  showEnvironment: boolean;
  missingValues: number;
  onToggle: (kind: SidebarKind) => void;
};

const ITEMS: { kind: SidebarKind; glyph: string; title: string }[] = [
  { kind: "users", glyph: "USR", title: "Users" },
  { kind: "teams", glyph: "TMS", title: "Teams" },
  { kind: "env", glyph: "ENV", title: "Environment values" },
];

export const ActivityBar = ({
  active,
  showEnvironment,
  missingValues,
  onToggle,
}: ActivityBarProps) => (
  <nav aria-label="Sidebars" className="activity-bar">
    {ITEMS.filter(({ kind }) => kind !== "env" || showEnvironment).map(({ kind, glyph, title }) => {
      const badge = kind === "env" && missingValues > 0 ? missingValues : undefined;

      return (
        <button
          aria-label={badge === undefined ? title : `${title} (${badge} missing)`}
          aria-pressed={active === kind}
          className="activity-item"
          key={kind}
          onClick={() => onToggle(kind)}
          title={title}
          type="button"
        >
          <span aria-hidden>{glyph}</span>
          {badge === undefined ? null : (
            <span aria-hidden className="badge">
              {badge}
            </span>
          )}
        </button>
      );
    })}
  </nav>
);
