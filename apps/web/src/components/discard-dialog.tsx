import { AlertDialog, Button, Code, Flex } from "@radix-ui/themes";

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
    <AlertDialog.Content maxWidth="28rem">
      <AlertDialog.Title size="4">Discard unsaved changes?</AlertDialog.Title>
      <AlertDialog.Description size="2">
        <Code>{current}</Code> has changes that are not saved. Opening <Code>{replacement}</Code>{" "}
        replaces them.
      </AlertDialog.Description>
      <Flex gap="3" justify="end" mt="4">
        <AlertDialog.Cancel>
          <Button color="gray" type="button" variant="soft">
            Cancel
          </Button>
        </AlertDialog.Cancel>
        <AlertDialog.Action>
          <Button color="red" onClick={onDiscard} type="button">
            Discard and open
          </Button>
        </AlertDialog.Action>
      </Flex>
    </AlertDialog.Content>
  </AlertDialog.Root>
);
