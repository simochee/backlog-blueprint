import { APPLY_CONFIRMATION } from "@backlog-blueprint/core";
import { Button, Card, Flex, Heading, Text } from "@radix-ui/themes";

/**
 * 問いの文面を Web 側で書かない。CLI の確認プロンプト（CL-4）と同じ問いにする。
 * 続く行は端末で `yes` を打たせるための案内（CL-5）なので、ボタンのある画面では使わない。
 */
const QUESTION = APPLY_CONFIRMATION.split("\n")[0] ?? "";

export type ConfirmDialogProps = { onCancel: () => void; onConfirm: () => void };

/**
 * Radix の `Dialog` に替えない。あれは開いているあいだ背面の操作を塞ぐ（`modal={false}`
 * でも覆いがクリックを吸う）。塞ぐと WU-3「入力が変わったら確認を閉じる」が利用者から
 * 到達できない経路になり、「見えている計画と適用される計画が一致する」を守っているものが
 * 何なのか分からなくなる。背面を生かしたまま覆いたいので、器だけ自前に持つ。
 *
 * 同じ理由で `aria-modal` は付けない。背面は実際に操作できるので、付ければ嘘になる。
 * `AlertDialog` も採らない。`role="alertdialog"` になり、確認の有無を `role="dialog"`
 * で確かめている受け入れテストが素通りするようになる。
 */
export const ConfirmDialog = ({ onCancel, onConfirm }: ConfirmDialogProps) => (
  <div className="overlay">
    <Card asChild size="4">
      <div className="dialog" role="dialog">
        <Flex direction="column" gap="3">
          <Heading as="h2" size="4">
            Apply
          </Heading>
          <Text size="2">{QUESTION}</Text>
          <Flex gap="3" justify="end" mt="2">
            <Button color="gray" onClick={onCancel} type="button" variant="soft">
              Cancel
            </Button>
            <Button onClick={onConfirm} type="button">
              Apply
            </Button>
          </Flex>
        </Flex>
      </div>
    </Card>
  </div>
);
