/**
 * 再輸出するだけのファイル。monaco-yaml の README（FAQ「Why doesn't it work with Vite?」）が
 * 指示する回避策で、依存パッケージの path を直接 `?worker` で参照すると Vite の事前バンドルが
 * 挟まり、ワーカーがハンドラを登録しないまま起動することがある。
 */
import "monaco-yaml/yaml.worker";
