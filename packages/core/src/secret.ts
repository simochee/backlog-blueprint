import { type Change } from "./action";
import { type Value } from "./value";

/**
 * 値を持つだけの型エイリアスにしない。`#value` を private field に閉じ込め、
 * `toString` / `toJSON` をマスクに固定することで、マスクし忘れた出力経路が
 * そもそも書けなくなる（E-4 / FR-3.6 / NFR-3 / AC-10）。
 * `reveal()` を呼んでよいのは HTTP 送信の直前と、差分判定（hookUrl の比較）だけ。
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  toString(): string {
    return "***";
  }

  toJSON(): string {
    return "***";
  }

  reveal(): string {
    return this.#value;
  }
}

/**
 * `Action` に載せる値だけを包む道を1つに絞る（E-6）。reconciler が `new Secret(...)` を
 * 直に書ける形にすると、包む場所と包まない場所の判断が実装ごとに散る。
 * 配列の要素にも添字付きの path で当てるのは、S2 が展開経路を DG-4 の形で集めるため。
 */
export type Seal = (path: string, value: Value) => Value;

export const sealer = (isSecret: (path: string) => boolean): Seal => {
  const seal: Seal = (path, value) => {
    if (Array.isArray(value)) {
      return value.map((item, index) => seal(`${path}/${index}`, item));
    }

    return typeof value === "string" && isSecret(path) ? new Secret(value) : value;
  };

  return seal;
};

/**
 * `Action` のフィールド名とマニフェストの path が一致する場所でだけ使う。
 * 一致しない場所（`settings.*` のように表示名を変えているところ）でこれを呼ぶと、
 * 引く path がずれて包むべき値を素通しするので、その場合は path を直に書く。
 */
export const sealFields = (
  fields: Record<string, Value>,
  basePath: string,
  seal: Seal,
): Record<string, Value> =>
  Object.fromEntries(
    Object.entries(fields).map(([field, value]) => [field, seal(`${basePath}/${field}`, value)]),
  );

export const sealChanges = (changes: Change[], basePath: string, seal: Seal): Change[] =>
  changes.map((change) => ({
    ...change,
    after: seal(`${basePath}/${change.field}`, change.after),
  }));
