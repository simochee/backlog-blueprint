import { type ReactNode } from "react";

type SidebarProps = {
  title: string;
  open: boolean;
  onClose: () => void;
  actions?: ReactNode;
  children: ReactNode;
};

/**
 * Radix の `Dialog` や `Popover` を使わない。背面を覆うか外側の操作で閉じるので、一覧から
 * 写しながらエディタに貼る使い方ができない（WU-56）。
 */
export const Sidebar = ({ title, open, onClose, actions, children }: SidebarProps) => (
  <aside aria-label={title} className="sidebar" hidden={!open}>
    <div className="sidebar-header">
      <h2 className="sidebar-title">{title}</h2>
      {actions}
      <button
        aria-label={`Close ${title}`}
        className="close-button"
        onClick={onClose}
        title="Close"
        type="button"
      >
        ×
      </button>
    </div>
    {children}
  </aside>
);
