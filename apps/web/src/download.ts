/**
 * ダウンロードが URL を読み終える前に解放されうるので、`click()` の直後には解放しない。
 * FileSaver.js が同じ理由で解放を遅らせている。
 */
const REVOKE_DELAY_MS = 40_000;

/**
 * `<a href>` に object URL を持たせ続ける形にしない。結果が差し替わるたびに古い URL を
 * 解放する後片付けが要り、漏れても画面からは分からない。押したときに作って捨てる。
 */
export const downloadText = (filename: string, text: string, type: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, REVOKE_DELAY_MS);
};
