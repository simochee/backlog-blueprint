import { CheckIcon } from "@radix-ui/react-icons";
import { Text, VisuallyHidden } from "@radix-ui/themes";
import { Fragment } from "react";

export type StepperProps = { titles: string[]; reached: number };

const stateOf = (index: number, reached: number): "done" | "active" | "todo" => {
  if (index < reached) {
    return "done";
  }

  return index === reached ? "active" : "todo";
};

/**
 * 進捗を数字で持たず、到達済みの段数だけを受け取る。画面の状態は入力から導かれる
 * （WU-3）ので、ステッパーが自分の state を持つと、計画を破棄したときに表示だけが
 * 先に進んだままになる。
 */
export const Stepper = ({ titles, reached }: StepperProps) => (
  <nav aria-label="Progress" className="stepper">
    {titles.map((title, index) => (
      <Fragment key={title}>
        {index === 0 ? null : <span className="stepper-rule" />}
        <span className="stepper-item" data-state={stateOf(index, reached)}>
          <span className="stepper-bullet">
            {stateOf(index, reached) === "done" ? (
              <>
                <CheckIcon aria-hidden />
                {/* 数字は読み上げに残す。チェックだけでは何段目かが伝わらない。 */}
                <VisuallyHidden>{index + 1}</VisuallyHidden>
              </>
            ) : (
              index + 1
            )}
          </span>
          <Text color={index <= reached ? undefined : "gray"} size="2" weight="medium">
            {title}
          </Text>
        </span>
      </Fragment>
    ))}
  </nav>
);
