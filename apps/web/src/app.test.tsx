import { type ResolvedHttpRequest } from "@backlog-blueprint/core";
import { fixedGet, fixedSpaceResponses, recordingSend } from "@backlog-blueprint/test-utils";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

/**
 * 送信層を丸ごと差し替える。`fetch` を差し替える形（CLI の端から端まで）では
 * backlog-js が読み込まれ、ブラウザ環境で動かす意味の無い URL 組み立てまで
 * 巻き込む。ここで確かめたいのはステッパーの挙動である。
 */
let respond: (path: string) => Promise<unknown>;

let deliver: (request: ResolvedHttpRequest) => Promise<unknown>;

vi.mock("@backlog-blueprint/backlog-client", () => ({
  createBacklogClient: () => ({
    get: (path: string) => respond(path),
    send: (request: ResolvedHttpRequest) => deliver(request),
  }),
}));

const SPACE = "example.backlog.com";

const API_KEY = "api-key-must-never-be-rendered";

const MANIFEST = [
  "key: PROJ_A",
  "name: プロジェクトA",
  "issueTypes:",
  "  - name: タスク",
  '    color: "#7ea800"',
  "statuses:",
  "  - name: 未対応",
  "  - name: 処理中",
  "  - name: 処理済み",
  "  - name: 完了",
  "",
].join("\n");

const withCategory = (name: string): string => `${MANIFEST}categories:\n  - name: ${name}\n`;

const withWebhook = (hookUrl: string): string =>
  `${MANIFEST}webhooks:\n  - name: notify\n    hookUrl: ${hookUrl}\n    events:\n      - issueCreated\n`;

/**
 * モジュールスコープに閉じた秘匿値と送信層（§2.4）は、テストのあいだも1つしかない。
 * 読み込み直さないと、前のテストが打った API キーと開いた接続が次のテストに残る。
 */
const startApp = async (responses: Record<string, unknown> = {}): Promise<UserEvent> => {
  respond = fixedGet(fixedSpaceResponses(responses));

  const user = userEvent.setup();

  vi.resetModules();

  const { App } = await import("./app");

  render(<App />);

  return user;
};

const manifestField = (): HTMLElement => screen.getByLabelText(/^Manifest/);

const button = (name: string): HTMLElement => screen.getByRole("button", { name });

const connect = async (user: UserEvent): Promise<void> => {
  await user.type(screen.getByLabelText("Space domain"), SPACE);
  await user.type(screen.getByLabelText("API key"), API_KEY);
  await user.click(button("Connect"));
};

const writeManifest = async (user: UserEvent, text: string): Promise<void> => {
  await user.click(manifestField());
  await user.paste(text);
};

const plan = async (user: UserEvent): Promise<void> => {
  await waitFor(() => {
    expect(button("Plan")).toBeEnabled();
  });
  await user.click(button("Plan"));
  await screen.findByRole("button", { name: "Apply" });
};

const reach = async (user: UserEvent): Promise<void> => {
  await connect(user);
  await screen.findByText(/Signed in as yamada/);
  await writeManifest(user, MANIFEST);
  await plan(user);
};

/**
 * 入力の値だけでなく属性も見る。React は `defaultValue` を value 属性に書き戻すので、
 * 値だけを見ると欄の外へ写った属性を見落とす。
 */
const carrying = (value: string): string[] =>
  [...document.querySelectorAll("*")]
    .filter(
      (element) =>
        [...element.attributes].some((attribute) => attribute.value.includes(value)) ||
        (element instanceof HTMLInputElement && element.value === value),
    )
    .map((element) => `${element.tagName}:${element.getAttribute("type") ?? ""}`);

const beforeUnloadCalls = (spy: MockInstance<typeof globalThis.addEventListener>): number =>
  spy.mock.calls.filter(([type]) => type === "beforeunload").length;

const confirmApply = async (user: UserEvent): Promise<void> => {
  await user.click(button("Apply"));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Apply" }));
};

beforeEach(() => {
  deliver = recordingSend(() => ({ id: 900 })).send;
});

describe("接続", () => {
  it("スペース管理者でなければマニフェストを書く段には進めない", async () => {
    const user = await startApp({
      "/api/v2/users/myself": { id: 2, userId: "suzuki", roleType: 2 },
    });

    await connect(user);

    expect(await screen.findByText("V-B2", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Connect to a space first.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Manifest/)).toBeNull();
  });
});

describe("環境変数の入力欄", () => {
  it("${NAME} を書くとその名前の入力欄が現れる", async () => {
    const user = await startApp();

    await connect(user);
    await screen.findByText(/Signed in as yamada/);
    await writeManifest(user, withCategory("${CATEGORY_NAME}"));

    expect(await screen.findByLabelText("CATEGORY_NAME")).toBeInTheDocument();
  });

  it("値を打っていない ${NAME} は計画に進めない", async () => {
    const user = await startApp();

    await connect(user);
    await screen.findByText(/Signed in as yamada/);
    await writeManifest(user, withCategory("${CATEGORY_NAME}"));

    expect(await screen.findByText(/value is not entered: CATEGORY_NAME/)).toBeInTheDocument();
    expect(button("Plan")).toBeDisabled();
  });
});

describe("マニフェストの受け取り方", () => {
  it("落としたファイルの中身が貼り付け欄に入る", async () => {
    const user = await startApp();

    await connect(user);
    await screen.findByText(/Signed in as yamada/);

    fireEvent.drop(manifestField(), {
      dataTransfer: { files: [new File([MANIFEST], "project.yml", { type: "text/yaml" })] },
    });

    await waitFor(() => {
      expect(manifestField()).toHaveValue(MANIFEST);
    });
  });
});

describe("秘匿値の置き場所", () => {
  it("秘匿値が現れるのは type=password の入力欄だけで、計画には出ない", async () => {
    const hookUrl = "https://hooks.example.com/must-never-be-rendered";
    const user = await startApp();

    await connect(user);
    await screen.findByText(/Signed in as yamada/);
    await writeManifest(user, withWebhook("${WEBHOOK_URL}"));
    await user.type(await screen.findByLabelText("WEBHOOK_URL"), hookUrl);
    await plan(user);

    expect(screen.getByText(/webhook .+ hookUrl \*\*\*/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(API_KEY);
    expect(document.body.textContent).not.toContain(hookUrl);
    expect(carrying(API_KEY)).toStrictEqual(["INPUT:password"]);
    expect(carrying(hookUrl)).toStrictEqual(["INPUT:password"]);
  });
});

describe("確認ダイアログ", () => {
  it("Apply を押したときだけ開く", async () => {
    const user = await startApp();

    await reach(user);

    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(button("Apply"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("マニフェストを1文字でも変えると閉じる", async () => {
    const user = await startApp();

    await reach(user);
    await user.click(button("Apply"));
    await user.type(manifestField(), "#");

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("計画をやり直しても自動では開き直さない", async () => {
    const user = await startApp();

    await reach(user);
    await user.click(button("Apply"));
    await user.type(manifestField(), "#");
    await plan(user);

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("適用し終えた計画", () => {
  it("apply が完了すると同じ計画には Apply を押せない", async () => {
    const user = await startApp();

    await reach(user);
    await confirmApply(user);

    expect(await screen.findByText(/Apply complete/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
  });

  it("apply が中断すると Apply は押せなくなるが、中断レポートは残る", async () => {
    const user = await startApp();

    deliver = () => Promise.reject({ status: 400, errors: [{ message: "Bad Request" }] });

    await reach(user);
    await confirmApply(user);

    expect(await screen.findByText(/Apply aborted/)).toBeInTheDocument();
    expect(button("Copy report")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
  });

  it("確認を断った計画にはもう一度 Apply を押せる", async () => {
    const user = await startApp();

    await reach(user);
    await user.click(button("Apply"));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    expect(await screen.findByText(/Apply cancelled/)).toBeInTheDocument();
    expect(button("Apply")).toBeEnabled();
  });
});

describe("離脱の警告", () => {
  it("apply の実行中だけ beforeunload を登録する", async () => {
    const added = vi.spyOn(globalThis, "addEventListener");
    const removed = vi.spyOn(globalThis, "removeEventListener");

    let release!: () => void;
    const applied = new Promise<void>((resolve) => {
      release = resolve;
    });

    deliver = () => applied.then(() => ({ id: 900 }));

    const user = await startApp();

    await reach(user);

    expect(beforeUnloadCalls(added)).toBe(0);

    await confirmApply(user);
    await waitFor(() => {
      expect(beforeUnloadCalls(added)).toBe(1);
    });

    expect(beforeUnloadCalls(removed)).toBe(0);

    release();

    await screen.findByText(/Apply complete/);

    expect(beforeUnloadCalls(removed)).toBe(1);

    added.mockRestore();
    removed.mockRestore();
  });
});
