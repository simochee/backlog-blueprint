import { Component, type ReactNode } from "react";

type SectionBoundaryProps = { children: ReactNode };

type SectionBoundaryState = { failed: boolean };

const reload = (): void => {
  globalThis.location.reload();
};

/** 関数で書かない。error boundary を書く方法はクラスしか無い */
export class SectionBoundary extends Component<SectionBoundaryProps, SectionBoundaryState> {
  override state: SectionBoundaryState = { failed: false };

  static getDerivedStateFromError(): SectionBoundaryState {
    return { failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) {
      return this.props.children;
    }

    return (
      <div className="failure section-failure" role="alert">
        <p>This section stopped working. Reload to start over — nothing you entered is kept.</p>
        <button className="button" onClick={reload} type="button">
          Reload
        </button>
      </div>
    );
  }
}
