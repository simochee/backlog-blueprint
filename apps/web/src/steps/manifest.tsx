import { type DragEvent } from "react";

import { DiagnosticList } from "../components/diagnostics";
import { environmentValue, setEnvironmentValue } from "../secrets";
import { type ManifestValidation } from "../validation";

export type ManifestStepProps = {
  text: string;
  onTextChange: (text: string) => void;
  onFileDropped: (name: string, text: string) => void;
  /**
   * 入力欄の一覧を検証結果から取らない。検証は入力が止まってから走る（§2.2）ので、
   * 途中の状態で欄が消えると、環境変数を打っている最中に focus が外れる。
   */
  names: string[];
  validation?: ManifestValidation;
  canPlan: boolean;
  planning: boolean;
  onPlan: () => void;
};

const readDroppedFile = async (
  event: DragEvent<HTMLTextAreaElement>,
  onFileDropped: (name: string, text: string) => void,
): Promise<void> => {
  const [file] = event.dataTransfer.files;

  if (file !== undefined) {
    onFileDropped(file.name, await file.text());
  }
};

export const ManifestStep = ({
  text,
  onTextChange,
  onFileDropped,
  names,
  validation,
  canPlan,
  planning,
  onPlan,
}: ManifestStepProps) => (
  <div className="step-body">
    <div className="manifest-columns">
      <label className="field manifest-field">
        <span className="field-label">Manifest (paste, or drop a file here)</span>
        <textarea
          className="textarea"
          onChange={(event) => onTextChange(event.target.value)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void readDroppedFile(event, onFileDropped);
          }}
          spellCheck={false}
          value={text}
        />
      </label>
      <div className="environment">
        <span className="field-label">Environment values</span>
        {names.length === 0 ? (
          <p className="panel-hint">No ${"{NAME}"} references in the manifest.</p>
        ) : (
          names.map((name) => (
            <label className="field" key={name}>
              <span className="field-label">{name}</span>
              <input
                autoComplete="off"
                className="input"
                defaultValue={environmentValue(name)}
                onChange={(event) => setEnvironmentValue(name, event.target.value)}
                type="password"
              />
            </label>
          ))
        )}
      </div>
    </div>
    {validation === undefined ? (
      <p className="panel-hint">Validating...</p>
    ) : (
      <DiagnosticList diagnostics={validation.diagnostics} />
    )}
    <div className="actions">
      <button
        className="button primary"
        disabled={!canPlan || planning}
        onClick={onPlan}
        type="button"
      >
        {planning ? "Reading Backlog" : "Plan"}
      </button>
    </div>
  </div>
);
