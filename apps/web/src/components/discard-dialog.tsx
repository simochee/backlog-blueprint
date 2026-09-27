import { AlertDialog } from "radix-ui";

type DiscardDialogProps = {
  current: string;
  replacement?: string;
  onCancel: () => void;
  onDiscard: () => void;
};

export const DiscardDialog = ({
  current,
  replacement,
  onCancel,
  onDiscard,
}: DiscardDialogProps) => (
  <AlertDialog.Root
    onOpenChange={(next) => {
      if (!next) {
        onCancel();
      }
    }}
    open={replacement !== undefined}
  >
    <AlertDialog.Portal>
      <AlertDialog.Overlay className="scrim" />
      <AlertDialog.Content className="modal">
        <div className="modal-header">
          <AlertDialog.Title className="modal-title">Discard unsaved changes?</AlertDialog.Title>
          <AlertDialog.Cancel asChild>
            <button aria-label="Close" className="close-button" type="button">
              ×
            </button>
          </AlertDialog.Cancel>
        </div>
        <div className="modal-body">
          <AlertDialog.Description className="modal-message">
            {current} has unsaved changes. Opening <strong>{replacement}</strong> replaces them.
          </AlertDialog.Description>
        </div>
        <div className="modal-footer">
          <AlertDialog.Cancel asChild>
            <button className="button" data-size="modal" type="button">
              Cancel
            </button>
          </AlertDialog.Cancel>
          <AlertDialog.Action asChild>
            <button
              className="button"
              data-size="modal"
              data-variant="destroy"
              onClick={onDiscard}
              type="button"
            >
              Discard and open
            </button>
          </AlertDialog.Action>
        </div>
      </AlertDialog.Content>
    </AlertDialog.Portal>
  </AlertDialog.Root>
);
