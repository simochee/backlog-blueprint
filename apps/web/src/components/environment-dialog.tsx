import { Badge, Button, Dialog, Flex, Text, TextField } from "@radix-ui/themes";

import { environmentValue, setEnvironmentValue } from "../secrets";

export const EnvironmentDialog = ({ names }: { names: string[] }) => {
  // React Compiler に畳ませない。未入力の件数も入力欄の初期値も、React が追えないモジュールの値
  // （secrets.ts）から読むので、畳まれると件数が打った直後に増減せず、開き直した欄が古い値で描かれる。
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
