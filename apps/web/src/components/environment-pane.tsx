import { useEffect, useRef } from "react";

import { type EnvironmentVariable } from "../environment";
import { environmentValue, setEnvironmentValue } from "../secrets";
import { Sidebar } from "./sidebar";

type EnvironmentPaneProps = {
  open: boolean;
  /**
   * 欄の一覧を最新の検証結果から取らない。検証は入力が止まってから走る（§2.2）ので、
   * 途中の状態で欄が消えると、環境変数を打っている最中に focus が外れる。
   */
  variables: EnvironmentVariable[];
  focusRequest: number;
  onClose: () => void;
};

export const EnvironmentPane = ({
  open,
  variables,
  focusRequest,
  onClose,
}: EnvironmentPaneProps) => {
  // React Compiler に畳ませない。入力欄の初期値は React が追えないモジュールの値
  // （secrets.ts）から読むので、畳まれると開き直した欄が古い値で描かれる。
  "use no memo";

  const list = useRef<HTMLDivElement>(null);
  const missing = variables.filter((variable) => variable.missing).length;

  // 未入力の印（`missing`）で探さない。印は検証が追いつくまで古く、打ち終えた欄に戻ることがある。
  useEffect(() => {
    if (focusRequest === 0) {
      return;
    }

    const empty = [...(list.current?.querySelectorAll("input") ?? [])].find(
      (input) => input.value === "",
    );

    empty?.focus();
  }, [focusRequest]);

  return (
    <Sidebar onClose={onClose} open={open} title="Environment values">
      <p className="sidebar-note">
        Values stay in this tab and fill <span className="variable">{"${NAME}"}</span> at Plan time.
        They are not written to the manifest.
      </p>
      <div className="sidebar-list" ref={list}>
        {variables.map(({ name, line, missing: unset }) => (
          <div className="env-field" key={name}>
            <div className="env-field-head">
              <label className="env-name" htmlFor={`env-${name}`}>
                {name}
              </label>
              <span className="env-line">line {line}</span>
            </div>
            <input
              aria-describedby={unset ? `env-${name}-required` : undefined}
              autoComplete="off"
              className="input"
              data-missing={unset}
              defaultValue={environmentValue(name)}
              id={`env-${name}`}
              onChange={(event) => setEnvironmentValue(name, event.target.value)}
              placeholder="Not set"
              spellCheck={false}
            />
            {unset ? (
              <span className="env-required" id={`env-${name}-required`}>
                Required before Plan
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <div className="sidebar-footer">
        <span>
          {missing === 0
            ? `${variables.length} of ${variables.length} set`
            : `${missing} of ${variables.length} missing`}
        </span>
      </div>
    </Sidebar>
  );
};
