import { APPLY_CONFIRMATION } from "@backlog-blueprint/core";

/**
 * 問いの文面を Web 側で書かない。CLI の確認プロンプト（CL-4）と同じ問いにする。
 * 続く行は端末で `yes` を打たせるための案内（CL-5）なので、ボタンのある画面では使わない。
 */
const QUESTION = APPLY_CONFIRMATION.split("\n")[0] ?? "";

export type ConfirmDialogProps = { onCancel: () => void; onConfirm: () => void };

export const ConfirmDialog = ({ onCancel, onConfirm }: ConfirmDialogProps) => (
  <div className="overlay">
    <div aria-modal className="dialog" role="dialog">
      <p className="dialog-question">{QUESTION}</p>
      <div className="actions">
        <button className="button" onClick={onCancel} type="button">
          Cancel
        </button>
        <button className="button primary" onClick={onConfirm} type="button">
          Apply
        </button>
      </div>
    </div>
  </div>
);
