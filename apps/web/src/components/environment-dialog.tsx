import { Badge, Button, Dialog, Flex, Text, TextField } from "@radix-ui/themes";

import { environmentValue, setEnvironmentValue } from "../secrets";

export type EnvironmentDialogProps = {
  /**
   * 入力欄の一覧を検証結果から取らない。検証は入力が止まってから走る（§2.2）ので、
   * 途中の状態で欄が消えると、環境変数を打っている最中に focus が外れる。
   */
  names: string[];
};

/**
 * ここはモーダルでよい。確認ダイアログ（confirm.tsx）が背面を生かしているのは
 * WU-3 を利用者から到達できる形で保つためだが、環境変数を打つあいだマニフェストを
 * 触れなくても失われるものは無い。
 */
export const EnvironmentDialog = ({ names }: EnvironmentDialogProps) => {
  /**
   * React Compiler に畳ませない。この部品は未入力の件数も入力欄の初期値も、React が
   * 追えないモジュールの値（secrets.ts）から読む。畳まれると、件数は
   * 打った直後に増減せず、閉じて開き直した入力欄が打つ前の値で描き直される。
   */
  "use no memo";

  const missing = names.filter((name) => environmentValue(name) === "").length;

  return (
    <Dialog.Root>
      <Dialog.Trigger>
        <Button color="gray" type="button" variant="soft">
          <Flex align="center" gap="2">
            Environment values
            {missing === 0 ? null : (
              <Badge color="amber" variant="solid">
                {missing}
              </Badge>
            )}
          </Flex>
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="32rem" size="3">
        <Dialog.Title size="4">Environment values</Dialog.Title>
        <Dialog.Description size="2">
          Values for the ${"{NAME}"} references in the manifest. They stay in this tab and are never
          stored.
        </Dialog.Description>
        <Flex direction="column" gap="3" mt="4">
          {names.map((name) => (
            <Flex direction="column" gap="1" key={name}>
              <Text as="label" htmlFor={`env-${name}`} size="1" weight="medium">
                {name}
              </Text>
              <TextField.Root
                autoComplete="off"
                defaultValue={environmentValue(name)}
                id={`env-${name}`}
                onChange={(event) => setEnvironmentValue(name, event.target.value)}
              />
            </Flex>
          ))}
        </Flex>
        <Flex justify="end" mt="4">
          <Dialog.Close>
            <Button type="button">Done</Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
};
