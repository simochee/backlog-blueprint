import { Dialog } from "@radix-ui/themes";

import { ConnectForm, type ConnectFormProps } from "./connect-form";

export type ConnectDialogProps = Omit<ConnectFormProps, "submitLabel"> & {
  open: boolean;
  onClose: () => void;
};

/**
 * モーダルでよい（WU-36）。確認ダイアログ（confirm.tsx）が背面を生かしているのは
 * WU-3 を利用者から到達できる形で保つためだが、ここで打っているあいだは今の接続が
 * 生きたままなので、背面を触れなくても失われるものは無い。
 */
export const ConnectDialog = ({ open, onClose, ...form }: ConnectDialogProps) => (
  <Dialog.Root
    onOpenChange={(next) => {
      if (!next) {
        onClose();
      }
    }}
    open={open}
  >
    <Dialog.Content maxWidth="28rem" size="3">
      <Dialog.Title size="4">Switch connection</Dialog.Title>
      <Dialog.Description color="gray" mb="4" size="2">
        The current connection stays until the new one is confirmed as a Space Administrator.
      </Dialog.Description>
      <ConnectForm {...form} submitLabel="Switch" />
    </Dialog.Content>
  </Dialog.Root>
);
