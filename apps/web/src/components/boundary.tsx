import { CrossCircledIcon } from "@radix-ui/react-icons";
import { Button, Callout, Flex } from "@radix-ui/themes";
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
      <Callout.Root color="red" size="1" variant="surface">
        <Callout.Icon>
          <CrossCircledIcon />
        </Callout.Icon>
        {/* ボタンは `Callout.Text` の外に置く。あれが出すのは `<p>` である（diagnostics.tsx）。 */}
        <Callout.Text>
          This section stopped working. Reload to start over — nothing you entered is kept.
        </Callout.Text>
        <Flex justify="end">
          <Button color="gray" onClick={reload} type="button" variant="soft">
            Reload
          </Button>
        </Flex>
      </Callout.Root>
    );
  }
}
