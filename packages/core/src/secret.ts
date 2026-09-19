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
