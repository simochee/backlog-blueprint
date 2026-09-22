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

/**
 * Monaco は happy-dom では動かない。レイアウトの測定に実ブラウザの API を使うので、
 * 読み込んだだけで落ちる。ここで確かめたいのはステッパーの挙動なので、入力の口と
 * ファイルの受け口だけを持つ textarea に差し替える。エディタ自体の結線は
 * manifest-editor.tsx の Why-not コメントが守る範囲であり、テストの対象にしない。
 */
vi.mock("./components/manifest-editor", () => ({
  ManifestEditor: ({
    id,
    value,
    onChange,
    onFileDropped,
  }: {
    id: string;
    value: string;
    onChange: (text: string) => void;
    onFileDropped: (name: string, text: string) => void;
  }) => (
    <textarea
      id={id}
      onChange={(event) => onChange(event.target.value)}
      onDrop={(event) => {
        event.preventDefault();

        const [file] = event.dataTransfer.files;

        if (file !== undefined) {
          void file.text().then((text) => onFileDropped(file.name, text));
        }
      }}
      value={value}
    />
  ),
}));

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
 * モジュールスコープに閉じた API キーと送信層（§2.4）は、テストのあいだも1つしかない。
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

/**
 * 待ってから掴む。エディタは遅延読み込みなので（manifest.tsx）、接続した直後には
 * まだ DOM に無い。
 */
const manifestField = async (): Promise<HTMLElement> => screen.findByLabelText(/^Manifest/);

const button = (name: string): HTMLElement => screen.getByRole("button", { name });

const connect = async (user: UserEvent): Promise<void> => {
  await user.type(screen.getByLabelText("Space domain"), SPACE);
  await user.type(screen.getByLabelText("API key"), API_KEY);
  await user.click(button("Connect"));
};

const writeManifest = async (user: UserEvent, text: string): Promise<void> => {
  await user.click(await manifestField());
  await user.paste(text);
};

/** 環境変数の欄はボタンの中に畳まれている（manifest.tsx）。開いてから掴む。 */
const openEnvironment = async (user: UserEvent): Promise<void> => {
  await user.click(await screen.findByRole("button", { name: /Environment values/ }));
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

/**
 * 応答を握ったまま離さない。押している最中の姿を確かめるには、通信が終わらない窓が要る。
 */
const holding = (): (() => void) => {
  const answered = respond;

  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  respond = async (path) => {
    await held;

    return answered(path);
  };

  return release;
};

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
  it("繋いだ先のスペース名を利用者名と並べて出す", async () => {
    const user = await startApp();

    await connect(user);

    expect(await screen.findByText(/Signed in as yamada at Example Inc\./)).toBeInTheDocument();
  });

  it("ドメインを打つとそのスペースの API キーのページへの導線が出る", async () => {
    const user = await startApp();

    expect(screen.queryByRole("link")).toBeNull();

    await user.type(screen.getByLabelText("Space domain"), SPACE);

    expect(screen.getByRole("link", { name: /Get an API key/ })).toHaveAttribute(
      "href",
      `https://${SPACE}/EditApiSettings.action`,
    );
  });

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
  it("${NAME} を書くと、未入力の件数を示すボタンが現れる", async () => {
    const user = await startApp();

    await connect(user);
    await screen.findByText(/Signed in as yamada/);
    await writeManifest(user, withCategory("${CATEGORY_NAME}"));

    expect(await screen.findByRole("button", { name: /Environment values 1/ })).toBeInTheDocument();
  });

  it("そのボタンを開くと ${NAME} の名前で入力欄が並ぶ", async () => {
    const user = await startApp();

    await connect(user);
    await screen.findByText(/Signed in as yamada/);
    await writeManifest(user, withCategory("${CATEGORY_NAME}"));
    await openEnvironment(user);

    expect(await screen.findByLabelText("CATEGORY_NAME")).toBeInTheDocument();
  });

  it("${NAME} を書いていなければボタンごと出さない", async () => {
    const user = await startApp();

    await connect(user);
    await screen.findByText(/Signed in as yamada/);
    await writeManifest(user, MANIFEST);

    expect(screen.queryByRole("button", { name: /Environment values/ })).toBeNull();
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

    fireEvent.drop(await manifestField(), {
      dataTransfer: { files: [new File([MANIFEST], "project.yml", { type: "text/yaml" })] },
    });

    await waitFor(async () => {
      expect(await manifestField()).toHaveValue(MANIFEST);
    });
  });
});

describe("入力値の表示", () => {
  it("環境変数の値は計画に表示され、API キーは表示されない", async () => {
    const hookUrl = "https://hooks.example.com/from-environment";
    const user = await startApp();

    await connect(user);
    await screen.findByText(/Signed in as yamada/);
    await writeManifest(user, withWebhook("${WEBHOOK_URL}"));
    await openEnvironment(user);
    await user.type(await screen.findByLabelText("WEBHOOK_URL"), hookUrl);

    expect(carrying(hookUrl)).toStrictEqual(["INPUT:password"]);

    await user.click(screen.getByRole("button", { name: "Done" }));
    await plan(user);

    expect(screen.getByText(new RegExp(hookUrl))).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(API_KEY);
    expect(carrying(API_KEY)).toStrictEqual(["INPUT:password"]);
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
    await user.type(await manifestField(), "#");

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  /**
   * 背面は操作できる（confirm.tsx）ので、確認を開いたまま Plan を押し直せる。入力は
   * 変わっていないので印も変わらないが、読み直した先の状態は変わりうる。
   */
  it("入力を変えずに計画を取り直しても閉じる", async () => {
    const user = await startApp();

    await reach(user);
    await user.click(button("Apply"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(button("Plan"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("計画をやり直しても自動では開き直さない", async () => {
    const user = await startApp();

    await reach(user);
    await user.click(button("Apply"));
    await user.type(await manifestField(), "#");
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
  it("登録した警告は離脱を引き止める", async () => {
    const added = vi.spyOn(globalThis, "addEventListener");

    let release!: () => void;
    const applied = new Promise<void>((resolve) => {
      release = resolve;
    });

    deliver = () => applied.then(() => ({ id: 900 }));

    const user = await startApp();

    await reach(user);
    await confirmApply(user);

    await waitFor(() => {
      expect(beforeUnloadCalls(added)).toBe(1);
    });

    const [, warn] = added.mock.calls.find(([type]) => type === "beforeunload") ?? [];
    const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;

    (warn as EventListener)(event);

    expect(event.defaultPrevented).toBe(true);
    expect(event.returnValue).toBe("");

    release();
    added.mockRestore();
  });

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

/**
 * 保留中は Action が解決するまでで決まる（WU-15）。押しっぱなしで固まらないことと、
 * 走っているあいだ二重に走らせられないことの両方が、ここで初めて見える。
 */
describe("通信しているあいだの押せなさ", () => {
  it("繋いでいるあいだ Connect は押せない", async () => {
    const user = await startApp();
    const release = holding();

    await connect(user);

    await waitFor(() => {
      expect(button("Connect")).toBeDisabled();
    });

    release();

    expect(await screen.findByText(/Signed in as yamada/)).toBeInTheDocument();
    expect(button("Connect")).toBeEnabled();
  });

  it("計画を組み立てているあいだ Plan は押せない", async () => {
    const user = await startApp();

    await connect(user);
    await screen.findByText(/Signed in as yamada/);
    await writeManifest(user, MANIFEST);
    await waitFor(() => {
      expect(button("Plan")).toBeEnabled();
    });

    const release = holding();

    await user.click(button("Plan"));

    await waitFor(() => {
      expect(button("Plan")).toBeDisabled();
    });

    release();

    expect(await screen.findByRole("button", { name: "Apply" })).toBeInTheDocument();
    expect(button("Plan")).toBeEnabled();
  });
});
