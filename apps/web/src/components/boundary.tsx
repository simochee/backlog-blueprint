import { CrossCircledIcon } from "@radix-ui/react-icons";
import { Button, Callout, Flex } from "@radix-ui/themes";
import { Component, type ReactNode } from "react";

export type StepBoundaryProps = { children: ReactNode };

type StepBoundaryState = { failed: boolean };

const reload = (): void => {
  globalThis.location.reload();
};

/**
 * WU-18。受け止めた error を props にも画面にも渡さないので、この器が覚えるのは
 * 受け止めたことだけになる。React に他の書き方が無いのでクラスで書く。
 */
export class StepBoundary extends Component<StepBoundaryProps, StepBoundaryState> {
  override state: StepBoundaryState = { failed: false };

  static getDerivedStateFromError(): StepBoundaryState {
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
          This step stopped working. Reload to start over — nothing you entered is kept.
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
