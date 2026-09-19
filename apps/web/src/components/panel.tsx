import { type ReactNode } from "react";

export type PanelProps = {
  step: number;
  title: string;
  enabled: boolean;
  hint?: string;
  children: ReactNode;
};

export const Panel = ({ step, title, enabled, hint, children }: PanelProps) => (
  <section className="panel" aria-disabled={!enabled} data-enabled={enabled}>
    <h2 className="panel-title">
      <span className="panel-step">{step}</span>
      {title}
    </h2>
    {enabled ? children : <p className="panel-hint">{hint}</p>}
  </section>
);
