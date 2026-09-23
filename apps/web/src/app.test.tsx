import { type ResolvedHttpRequest } from "@backlog-blueprint/core";
import {
  fixedGet,
  fixedSpaceResponses,
  httpFailure,
  recordingSend,
} from "@backlog-blueprint/test-utils";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

/**
 * 送信層を丸ごと差し替える。`fetch` を差し替える形（CLI の端から端まで）では
 * backlog-js が読み込まれ、ブラウザ環境で動かす意味の無い URL 組み立てまで
 * 巻き込む。ここで確かめたいのは画面の挙動である。
 */
let respond: (path: string, space?: string) => Promise<unknown>;

let deliver: (request: ResolvedHttpRequest) => Promise<unknown>;

/** アイコンを取りに行った先。取った中身は描画の対象にしない（happy-dom は画像を読まない） */
let bytesRequested: string[] = [];

/**
 * Monaco は happy-dom では動かない。レイアウトの測定に実ブラウザの API を使うので、
 * 読み込んだだけで落ちる。ここで確かめたいのは画面の挙動なので、入力の口と
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
  createBacklogClient: ({ space }: { space: string }) => ({
    get: (path: string) => respond(path, space),
    send: (request: ResolvedHttpRequest) => deliver(request),
    getBytes: (path: string) => {
      bytesRequested.push(`${space}${path}`);

      return Promise.resolve(new ArrayBuffer(0));
    },
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

const pane = (name: string): HTMLElement => screen.getByRole("complementary", { name });

/**
 * 文言は領域の中で引く。見えないページもアンマウントしない（WU-28）ので、`getByText` は
 * 隠れたページの同じ文言まで拾う。領域はロールで引くので、見えているものだけが当たる。
 */
const region = (name: string): HTMLElement => screen.getByRole("region", { name });

const ACCOUNT = "yamada at Example Inc.";

/** 接続できたかは右上のアカウント表示で見る（WU-35） */
const signedIn = async (): Promise<HTMLElement> => screen.findByRole("button", { name: ACCOUNT });

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
  await within(region("Output")).findByRole("button", { name: "Copy JSON" });
};

const reach = async (user: UserEvent): Promise<void> => {
  await connect(user);
  await signedIn();
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

/** Apply は今出ている計画を適用する。確認は挟まない（WU-3 / WU-5） */
const apply = async (user: UserEvent): Promise<void> => {
  await waitFor(() => {
    expect(button("Apply")).toBeEnabled();
  });
  await user.click(button("Apply"));
};

/**
 * 接続の資格情報は sessionStorage に残る（WU-38）。消さないと、前のテストで繋いだ
 * 接続を次のテストが読み込み時に自動で繋ぎ直し、接続画面から始まらない。
 */
beforeEach(() => {
  deliver = recordingSend(() => ({ id: 900 })).send;
  globalThis.sessionStorage.clear();
  globalThis.location.hash = "";
  bytesRequested = [];
});

const openAccount = async (user: UserEvent): Promise<void> => {
  await user.click(await signedIn());
};

const switchTo = async (user: UserEvent, domain: string): Promise<HTMLElement> => {
  await openAccount(user);
  await user.click(await screen.findByRole("button", { name: /Switch connection/ }));

  const dialog = await screen.findByRole("dialog", { name: "Switch connection" });
  const field = within(dialog).getByLabelText("Space domain");

  await user.clear(field);
  await user.type(field, domain);
  await user.type(within(dialog).getByLabelText("API key"), "another-api-key");
  await user.click(within(dialog).getByRole("button", { name: "Switch" }));

  return dialog;
};

const OTHER_SPACE = "other.backlog.com";

const KEY_REJECTED = httpFailure({ status: 401, errors: [{ message: "Authentication failure." }] });

/** 別のスペースでは API キーを受け付けない。切り替えが V-B1 で落ちる経路を作る */
const keyRejectedOn = (domain: string): void => {
  const answered = respond;

  respond = (path, space) =>
    space === domain && path === "/api/v2/users/myself"
      ? fixedGet({ [path]: KEY_REJECTED })(path)
      : answered(path, space);
};

describe("接続", () => {
  it("接続する前は接続のフォームだけを出し、ページの切り替えも一覧のボタンも出さない", async () => {
    await startApp();

    expect(screen.getByRole("heading", { name: "Connect to Backlog" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Pages" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Users" })).toBeNull();
    expect(screen.queryByLabelText(/^Manifest/)).toBeNull();
  });

  it("繋ぐと右上に利用者名とスペース名が出て、開くとドメイン・権限・更新系の残量が見える", async () => {
    const user = await startApp();

    await connect(user);
    await openAccount(user);

    expect(screen.getByText(SPACE)).toBeInTheDocument();
    expect(screen.getByText("Space Administrator")).toBeInTheDocument();
    expect(screen.getByText("150 / 150 remaining")).toBeInTheDocument();
  });

  it("ヘッダーのアカウント表示はアイコンだけで、名前は出さない", async () => {
    const user = await startApp();

    await connect(user);

    const account = await signedIn();

    expect(account).not.toHaveTextContent("yamada");
    expect(account).not.toHaveTextContent("Example Inc.");
  });

  it("アイコンは API キーを URL に載せず、接続した先から送信層で取る", async () => {
    const user = await startApp();

    await connect(user);
    await signedIn();

    await waitFor(() => {
      expect(bytesRequested).toEqual(
        expect.arrayContaining([`${SPACE}/api/v2/space/image`, `${SPACE}/api/v2/users/1/icon`]),
      );
    });
    expect(carrying(API_KEY)).toStrictEqual([]);
  });

  it("自分の数値のユーザー ID を、表示名のコメント付きで access の直下に貼れる Yaml としてコピーできる", async () => {
    const user = await startApp({
      "/api/v2/users/myself": { id: 1, userId: "yamada", name: "山田 太郎", roleType: 1 },
    });

    await connect(user);
    await openAccount(user);
    await user.click(await screen.findByRole("button", { name: "Copy user ID as YAML" }));

    expect(await navigator.clipboard.readText()).toBe("    - 1 # 山田 太郎\n");
  });

  it("ドメインを打つとそのスペースの API キーのページへの導線が出る", async () => {
    const user = await startApp();

    expect(screen.queryByRole("link", { name: /Get an API key/ })).toBeNull();

    await user.type(screen.getByLabelText("Space domain"), SPACE);

    expect(screen.getByRole("link", { name: /Get an API key/ })).toHaveAttribute(
      "href",
      `https://${SPACE}/EditApiSettings.action`,
    );
  });

  it("スペース管理者でなくても繋がり、アカウント表示でスペース管理者ではないと分かる", async () => {
    const user = await startApp({
      "/api/v2/users/myself": { id: 2, userId: "suzuki", roleType: 2 },
    });

    await connect(user);
    await user.click(await screen.findByRole("button", { name: "suzuki at Example Inc." }));

    expect(await screen.findByText("Not a space administrator")).toBeInTheDocument();
    expect(await manifestField()).toBeInTheDocument();
  });

  it("API キーが通らなければ接続画面から先へ進めない", async () => {
    const user = await startApp({ "/api/v2/users/myself": KEY_REJECTED });

    await connect(user);

    expect(await screen.findByText("V-B1", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Connect to Backlog" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Manifest/)).toBeNull();
  });

  it("繋ぐと、開いたときのページに着く", async () => {
    globalThis.location.hash = "#/export";

    const user = await startApp();

    await connect(user);
    await signedIn();

    expect(screen.getByRole("link", { name: "Export" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByLabelText("Project key")).toBeVisible();
  });
});

describe("接続の切り替え", () => {
  it("モーダルに打っているあいだも、今の接続と計画は残る", async () => {
    const user = await startApp();

    await reach(user);
    await openAccount(user);
    await user.click(await screen.findByRole("button", { name: /Switch connection/ }));

    const dialog = await screen.findByRole("dialog", { name: "Switch connection" });

    await user.type(within(dialog).getByLabelText("Space domain"), "x");
    await user.type(within(dialog).getByLabelText("API key"), "typing");

    /** モーダルの背面は読み上げから外れるので、隠れた要素も含めて探す */
    expect(screen.getByRole("button", { name: ACCOUNT, hidden: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy JSON", hidden: true })).toBeInTheDocument();
    expect(screen.queryByText("Outdated")).toBeNull();
  });

  it("切り替え先に繋げなければ診断をモーダルに出し、今の接続を残す", async () => {
    const user = await startApp();

    await reach(user);
    keyRejectedOn(OTHER_SPACE);

    const dialog = await switchTo(user, OTHER_SPACE);

    expect(await within(dialog).findByText("V-B1", { exact: false })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(button(ACCOUNT)).toBeInTheDocument();
    expect(button("Apply")).toBeEnabled();
    expect(screen.queryByText("Outdated")).toBeNull();
  });

  it("別の接続に差し替えるとモーダルは閉じ、算出済みの計画は前の接続のものとして古くなる", async () => {
    const user = await startApp();

    await reach(user);
    await switchTo(user, OTHER_SPACE);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Switch connection" })).toBeNull();
    });
    expect(within(region("Output")).getByText("Outdated")).toBeInTheDocument();
    expect(within(region("Output")).getByText(SPACE)).toBeInTheDocument();
    expect(button("Apply")).toBeDisabled();
    expect(await manifestField()).toHaveValue(MANIFEST);
  });

  it("apply の実行中は切り替えも切断もできない", async () => {
    const user = await startApp();

    deliver = () => new Promise(() => undefined);
    await reach(user);
    await apply(user);
    await openAccount(user);

    expect(await screen.findByRole("button", { name: /Switch connection/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Disconnect/ })).toBeDisabled();
  });

  it("Disconnect で接続画面に戻り、API キーの欄は空で始まる", async () => {
    const user = await startApp();

    await connect(user);
    await openAccount(user);
    await user.click(await screen.findByRole("button", { name: /Disconnect/ }));

    expect(await screen.findByRole("heading", { name: "Connect to Backlog" })).toBeInTheDocument();
    expect(screen.getByLabelText("API key")).toHaveValue("");
    expect(button("Connect")).toBeDisabled();
  });
});

describe("接続の保存", () => {
  const STORAGE_KEY = "backlog-blueprint:connection";

  const stored = (): unknown =>
    JSON.parse(globalThis.sessionStorage.getItem(STORAGE_KEY) ?? "null");

  it("繋げたときだけ、スペースと API キーをこのタブの sessionStorage に保つ", async () => {
    const user = await startApp({ "/api/v2/users/myself": KEY_REJECTED });

    await connect(user);
    await screen.findByText("V-B1", { exact: false });

    expect(stored()).toBeNull();
  });

  it("繋げるとスペースと API キーが保たれ、localStorage には何も書かない", async () => {
    const user = await startApp();

    await connect(user);
    await signedIn();

    expect(stored()).toEqual({ space: SPACE, apiKey: API_KEY });
    expect(globalThis.localStorage.length).toBe(0);
  });

  it("保存があれば、読み込んだときにフォームを経ずに繋ぎ直す", async () => {
    globalThis.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ space: SPACE, apiKey: API_KEY }),
    );

    await startApp();

    expect(await signedIn()).toBeInTheDocument();
  });

  it("繋ぎ直すたびに API キーを確かめ直し、通らなければ保存を消してドメインを入れた接続画面に戻る", async () => {
    globalThis.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ space: SPACE, apiKey: API_KEY }),
    );

    await startApp({ "/api/v2/users/myself": KEY_REJECTED });

    expect(await screen.findByText("V-B1", { exact: false })).toBeInTheDocument();
    expect(screen.getByLabelText("Space domain")).toHaveValue(SPACE);
    expect(stored()).toBeNull();
  });

  it("Disconnect で保存を消す", async () => {
    const user = await startApp();

    await connect(user);
    await openAccount(user);
    await user.click(await screen.findByRole("button", { name: /Disconnect/ }));
    await screen.findByRole("heading", { name: "Connect to Backlog" });

    expect(stored()).toBeNull();
  });
});

describe("環境変数の入力欄", () => {
  it("${NAME} を書くと、未入力の件数を示すボタンが現れる", async () => {
    const user = await startApp();

    await connect(user);
    await signedIn();
    await writeManifest(user, withCategory("${CATEGORY_NAME}"));

    expect(await screen.findByRole("button", { name: /Environment values 1/ })).toBeInTheDocument();
  });

  it("そのボタンを開くと ${NAME} の名前で入力欄が並ぶ", async () => {
    const user = await startApp();

    await connect(user);
    await signedIn();
    await writeManifest(user, withCategory("${CATEGORY_NAME}"));
    await openEnvironment(user);

    expect(await screen.findByLabelText("CATEGORY_NAME")).toBeInTheDocument();
  });

  it("${NAME} を書いていなければボタンごと出さない", async () => {
    const user = await startApp();

    await connect(user);
    await signedIn();
    await writeManifest(user, MANIFEST);

    expect(screen.queryByRole("button", { name: /Environment values/ })).toBeNull();
  });

  it("値を打っていない ${NAME} は計画に進めない", async () => {
    const user = await startApp();

    await connect(user);
    await signedIn();
    await writeManifest(user, withCategory("${CATEGORY_NAME}"));

    expect(await screen.findByText(/value is not entered: CATEGORY_NAME/)).toBeInTheDocument();
    expect(button("Plan")).toBeDisabled();
  });
});

describe("マニフェストの受け取り方", () => {
  it("落としたファイルの中身が貼り付け欄に入る", async () => {
    const user = await startApp();

    await connect(user);
    await signedIn();

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
    await signedIn();
    await writeManifest(user, withWebhook("${WEBHOOK_URL}"));
    await openEnvironment(user);
    await user.type(await screen.findByLabelText("WEBHOOK_URL"), hookUrl);

    expect(carrying(hookUrl)).toStrictEqual(["INPUT:"]);

    await user.click(screen.getByRole("button", { name: "Done" }));
    await plan(user);

    expect(screen.getByText(new RegExp(hookUrl))).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(API_KEY);
    expect(carrying(API_KEY)).toStrictEqual([]);
  });

  it("接続画面で打っている API キーは password の入力欄の値にだけあり、属性には写らない", async () => {
    const user = await startApp();

    await user.type(screen.getByLabelText("API key"), API_KEY);

    expect(carrying(API_KEY)).toStrictEqual(["INPUT:password"]);
  });
});

describe("Apply できるとき", () => {
  it("Plan で計画を出すまで Apply は押せない", async () => {
    const user = await startApp();

    await connect(user);
    await signedIn();
    await writeManifest(user, MANIFEST);
    await waitFor(() => {
      expect(button("Plan")).toBeEnabled();
    });

    expect(button("Apply")).toBeDisabled();
  });

  it("Apply は確認を挟まずに、今出ている計画をそのまま適用する", async () => {
    const user = await startApp();
    const answered = respond;
    const requested: string[] = [];

    await reach(user);

    respond = (path, space) => {
      requested.push(path);

      return answered(path, space);
    };

    await apply(user);

    expect(await within(region("Output")).findByText(/Apply complete/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(requested).not.toContain("/api/v2/users/myself");
  });

  it("マニフェストを1文字でも変えると、計画に Outdated が出て Apply は押せなくなる", async () => {
    const user = await startApp();

    await reach(user);
    await user.type(await manifestField(), "#");

    expect(await within(region("Output")).findByText("Outdated")).toBeInTheDocument();
    expect(within(region("Output")).getByText(/Run\s+Plan again to apply/)).toBeInTheDocument();
    expect(button("Apply")).toBeDisabled();
  });

  it("Outdated は Output を畳んでいても見える", async () => {
    const user = await startApp();

    await reach(user);
    await user.click(button("Minimize output"));
    await user.type(await manifestField(), "#");

    expect(await within(region("Output")).findByText("Outdated")).toBeInTheDocument();
  });

  it("Plan を押し直せば、変えた入力の計画で Apply できる", async () => {
    const user = await startApp();

    await reach(user);
    await user.type(await manifestField(), "#");
    await plan(user);

    expect(button("Apply")).toBeEnabled();
  });
});

describe("適用した後", () => {
  it("apply が完了すると結果がその計画の項目に続き、同じ計画にはもう Apply できない", async () => {
    const user = await startApp();

    await reach(user);
    await apply(user);

    expect(await within(region("Output")).findByText(/Apply complete/)).toBeInTheDocument();
    expect(button("Apply")).toBeDisabled();
  });

  it("apply が中断すると、中断レポートを写せる形で残り、同じ計画にはもう Apply できない", async () => {
    const user = await startApp();

    deliver = () => Promise.reject({ status: 400, errors: [{ message: "Bad Request" }] });

    await reach(user);
    await apply(user);

    expect(await within(region("Output")).findByText(/Apply aborted/)).toBeInTheDocument();
    expect(button("Copy report")).toBeInTheDocument();
    expect(button("Apply")).toBeDisabled();
  });

  it("前の項目に移っても、適用の記録は残っている", async () => {
    const user = await startApp();

    await reach(user);
    await apply(user);
    await within(region("Output")).findByText(/Apply complete/);
    await plan(user);
    await user.click(within(region("Output")).getByRole("button", { name: /^\d\d:\d\d:\d\d · / }));
    await user.click(await screen.findByRole("menuitem", { name: /Applied$/ }));

    expect(await within(region("Output")).findByText(/Apply complete/)).toBeInTheDocument();
  });
});

describe("Output パネル", () => {
  it("適用した計画では、計画と適用のログのあいだに区切りが入る", async () => {
    const user = await startApp();

    await reach(user);

    expect(within(region("Output")).queryByRole("separator", { name: "Apply" })).toBeNull();

    await apply(user);
    await within(region("Output")).findByText(/Apply complete/);

    const divider = within(region("Output")).getByRole("separator", { name: "Apply" });
    const planned = within(region("Output")).getByRole("button", { name: "Copy JSON" });
    const result = within(region("Output")).getByText(/Apply complete/);

    expect(
      planned.compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(divider.compareDocumentPosition(result) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("計画だけの項目には、Plan / Apply のアンカーを出さない", async () => {
    const user = await startApp();

    await reach(user);

    expect(within(region("Output")).queryByRole("navigation", { name: "Sections" })).toBeNull();
  });

  it("適用した項目の見出しには Plan / Apply のアンカーが出て、初めは Plan を読んでいることを示す", async () => {
    const user = await startApp();

    await reach(user);
    await apply(user);
    await within(region("Output")).findByText(/Apply complete/);

    const sections = within(region("Output")).getByRole("navigation", { name: "Sections" });

    expect(within(sections).getByRole("button", { name: "Jump to plan" })).toHaveAttribute(
      "aria-current",
      "location",
    );
    expect(within(sections).getByRole("button", { name: "Jump to apply" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("アンカーを押すと、今読んでいる部分としてその部分が示される", async () => {
    const user = await startApp();

    await reach(user);
    await apply(user);
    await within(region("Output")).findByText(/Apply complete/);

    const sections = within(region("Output")).getByRole("navigation", { name: "Sections" });

    await user.click(within(sections).getByRole("button", { name: "Jump to apply" }));

    expect(within(sections).getByRole("button", { name: "Jump to apply" })).toHaveAttribute(
      "aria-current",
      "location",
    );

    await user.click(within(sections).getByRole("button", { name: "Jump to plan" }));

    expect(within(sections).getByRole("button", { name: "Jump to plan" })).toHaveAttribute(
      "aria-current",
      "location",
    );
  });

  it("畳んでおいても、Plan を押すと開いてその結果を出す", async () => {
    const user = await startApp();

    await reach(user);
    await user.click(button("Minimize output"));

    expect(within(region("Output")).queryByRole("button", { name: "Copy JSON" })).toBeNull();

    await plan(user);

    expect(button("Minimize output")).toHaveAttribute("aria-expanded", "true");
  });
});

describe("離脱の警告", () => {
  it("登録した警告は離脱を引き止める", async () => {
    const added = vi.spyOn(globalThis, "addEventListener");
    const user = await startApp();

    await reach(user);

    await waitFor(() => {
      expect(beforeUnloadCalls(added)).toBe(1);
    });

    const [, warn] = added.mock.calls.find(([type]) => type === "beforeunload") ?? [];
    const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;

    (warn as EventListener)(event);

    expect(event.defaultPrevented).toBe(true);
    expect(event.returnValue).toBe("");

    added.mockRestore();
  });

  it("マニフェストを書いただけでは警告せず、Output に記録ができてから警告する", async () => {
    const added = vi.spyOn(globalThis, "addEventListener");
    const user = await startApp();

    await connect(user);
    await signedIn();
    await writeManifest(user, MANIFEST);

    expect(beforeUnloadCalls(added)).toBe(0);

    await plan(user);

    expect(beforeUnloadCalls(added)).toBe(1);

    added.mockRestore();
  });

  it("apply が終わっても、記録が残っているあいだは警告を外さない", async () => {
    const removed = vi.spyOn(globalThis, "removeEventListener");
    const user = await startApp();

    await reach(user);
    await apply(user);
    await within(region("Output")).findByText(/Apply complete/);

    expect(beforeUnloadCalls(removed)).toBe(0);

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

    expect(await signedIn()).toBeInTheDocument();
  });

  it("計画を組み立てているあいだ Plan も Apply も押せない", async () => {
    const user = await startApp();

    await connect(user);
    await signedIn();
    await writeManifest(user, MANIFEST);
    await waitFor(() => {
      expect(button("Plan")).toBeEnabled();
    });

    const release = holding();

    await user.click(button("Plan"));

    await waitFor(() => {
      expect(button("Plan")).toBeDisabled();
    });
    expect(button("Apply")).toBeDisabled();

    release();

    expect(await screen.findByRole("button", { name: "Copy JSON" })).toBeInTheDocument();
    expect(button("Plan")).toBeEnabled();
    expect(button("Apply")).toBeEnabled();
  });
});

describe("スペースのユーザーとチームの一覧", () => {
  const DIRECTORY = {
    "/api/v2/users": [
      { id: 1, userId: "yamada", name: "山田 太郎", roleType: 1 },
      {
        id: 2,
        userId: "suzuki",
        name: "鈴木 花子",
        mailAddress: "hanako@example.com",
        roleType: 2,
      },
      { id: 3, userId: "true", name: "真", roleType: 2 },
    ],
    "/api/v2/teams": [
      { id: 10, name: "開発チーム", members: [{ id: 2, userId: "suzuki" }] },
      { id: 11, name: "QA", members: [] },
    ],
  };

  const requested = (): string[] => {
    const paths: string[] = [];
    const answered = respond;

    respond = (path) => {
      paths.push(path);

      return answered(path);
    };

    return paths;
  };

  const connected = async (): Promise<UserEvent> => {
    const user = await startApp(DIRECTORY);

    await connect(user);
    await signedIn();

    return user;
  };

  it("接続する前はボタンもペインも出ていない", async () => {
    await startApp(DIRECTORY);

    expect(screen.queryByRole("button", { name: "Users" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Teams" })).toBeNull();
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("接続した直後はまだ開いておらず、一覧も取りに行かない", async () => {
    const user = await startApp(DIRECTORY);
    const paths = requested();

    await connect(user);
    await signedIn();

    expect(button("Users")).toBeEnabled();
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(paths).not.toContain("/api/v2/users");
    expect(paths).not.toContain("/api/v2/teams");
  });

  it("ユーザーの一覧には表示名とユーザー ID とログイン ID とメールアドレスが並び、スペース管理者には印が付く", async () => {
    const user = await connected();

    await user.click(button("Users"));

    const users = within(pane("Users"));

    expect(await users.findByText("山田 太郎")).toBeInTheDocument();
    expect(users.getByText("2")).toBeInTheDocument();
    expect(users.getByText("yamada")).toBeInTheDocument();
    expect(users.getByText("Space admin")).toBeInTheDocument();
    expect(users.getByText("hanako@example.com")).toBeInTheDocument();
    expect(users.getByText("3 of 3 users")).toBeInTheDocument();
  });

  it("チームの一覧にはチーム名と人数が並ぶ", async () => {
    const user = await connected();

    await user.click(button("Teams"));

    const teams = within(pane("Teams"));

    expect(await teams.findByText("開発チーム")).toBeInTheDocument();
    expect(teams.getByText("1 member")).toBeInTheDocument();
    expect(teams.getByText("0 members")).toBeInTheDocument();
  });

  it("開いているのは常に1枚だけで、もう一方を開くと先のペインは閉じる", async () => {
    const user = await connected();

    await user.click(button("Users"));
    await user.click(button("Teams"));

    expect(screen.getAllByRole("complementary")).toHaveLength(1);
    expect(pane("Teams")).toBeInTheDocument();
  });

  it("開いているペインのボタンをもう一度押すと閉じる", async () => {
    const user = await connected();

    await user.click(button("Users"));
    await user.click(button("Users"));

    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("選んだユーザーの数値のユーザー ID を、表示名のコメント付きで access の直下に貼れる段付きの Yaml としてコピーする", async () => {
    const user = await connected();

    await user.click(button("Users"));

    const users = within(pane("Users"));

    await user.click(await users.findByRole("checkbox", { name: /鈴木 花子/ }));
    await user.click(users.getByRole("checkbox", { name: /真/ }));
    await user.click(users.getByRole("button", { name: "Copy 2 as YAML" }));

    expect(await navigator.clipboard.readText()).toBe("    - 2 # 鈴木 花子\n    - 3 # 真\n");
  });

  it("スペース管理者でなく他人のログイン ID が返らなくても、一覧を開いてユーザー ID をコピーできる", async () => {
    const user = await startApp({
      "/api/v2/users/myself": { id: 2, userId: "suzuki", roleType: 2 },
      "/api/v2/users": [
        { id: 1, userId: null, name: "山田 太郎", roleType: 1 },
        { id: 2, userId: "suzuki", name: "鈴木 花子", roleType: 2 },
      ],
    });

    await connect(user);
    await screen.findByRole("button", { name: "suzuki at Example Inc." });
    await user.click(button("Users"));

    const users = within(pane("Users"));

    expect(await users.findByText("山田 太郎")).toBeInTheDocument();
    expect(users.getByText("Space admin")).toBeInTheDocument();

    await user.click(users.getByRole("button", { name: "Copy 山田 太郎" }));

    expect(await navigator.clipboard.readText()).toBe("    - 1 # 山田 太郎\n");
  });

  it("チームはチーム ID を、チーム名のコメント付きでコピーする", async () => {
    const user = await connected();

    await user.click(button("Teams"));

    const teams = within(pane("Teams"));

    await user.click(await teams.findByRole("checkbox", { name: /開発チーム/ }));
    await user.click(teams.getByRole("button", { name: "Copy 1 as YAML" }));

    expect(await navigator.clipboard.readText()).toBe("    - 10 # 開発チーム\n");
  });

  it("行ごとのボタンは、選択に関係なくその1件だけをコピーし、選択も変えない", async () => {
    const user = await connected();

    await user.click(button("Users"));

    const users = within(pane("Users"));

    await user.click(await users.findByRole("checkbox", { name: /山田 太郎/ }));
    await user.click(users.getByRole("button", { name: "Copy 鈴木 花子" }));

    expect(await navigator.clipboard.readText()).toBe("    - 2 # 鈴木 花子\n");
    expect(users.getByRole("checkbox", { name: /山田 太郎/ })).toBeChecked();
    expect(users.getByRole("checkbox", { name: /鈴木 花子/ })).not.toBeChecked();
  });

  it("何も選んでいなければコピーできない", async () => {
    const user = await connected();

    await user.click(button("Teams"));
    await within(pane("Teams")).findByText("QA");

    expect(within(pane("Teams")).getByRole("button", { name: "Copy 0 as YAML" })).toBeDisabled();
  });

  it("絞り込むと、表示名かログイン ID に打った文字を含むものだけが残り、Select all はそれだけを選ぶ", async () => {
    const user = await connected();

    await user.click(button("Users"));

    const users = within(pane("Users"));

    await users.findByText("山田 太郎");
    await user.type(users.getByLabelText("Filter users"), "SUZU");

    expect(users.queryByText("山田 太郎")).toBeNull();
    expect(users.getByText("1 of 3 users")).toBeInTheDocument();

    await user.click(users.getByLabelText("Select all"));

    expect(users.getByRole("button", { name: "Copy 1 as YAML" })).toBeEnabled();
  });

  it("メールアドレスでも絞り込めるが、コピーする行にメールアドレスは入らない", async () => {
    const user = await connected();

    await user.click(button("Users"));

    const users = within(pane("Users"));

    await users.findByText("山田 太郎");
    await user.type(users.getByLabelText("Filter users"), "hanako@");

    expect(users.getByText("1 of 3 users")).toBeInTheDocument();

    await user.click(users.getByRole("button", { name: "Copy 鈴木 花子" }));

    expect(await navigator.clipboard.readText()).toBe("    - 2 # 鈴木 花子\n");
  });

  it("閉じて開き直しても一覧を取り直さず、絞り込みと選択が残っている", async () => {
    const user = await connected();
    const paths = requested();

    await user.click(button("Users"));

    const users = within(pane("Users"));

    await user.click(await users.findByRole("checkbox", { name: /鈴木 花子/ }));
    await user.type(users.getByLabelText("Filter users"), "suzu");
    await user.click(users.getByRole("button", { name: "Close Users" }));
    await user.click(button("Teams"));
    await user.click(button("Users"));

    const reopened = within(pane("Users"));

    expect(reopened.getByLabelText("Filter users")).toHaveValue("suzu");
    expect(reopened.getByRole("checkbox", { name: /鈴木 花子/ })).toBeChecked();
    expect(paths.filter((path) => path === "/api/v2/users")).toHaveLength(1);
  });

  it("Reload を押すと一覧を取り直す", async () => {
    const user = await connected();
    const paths = requested();

    await user.click(button("Users"));
    await within(pane("Users")).findByText("山田 太郎");
    await user.click(within(pane("Users")).getByRole("button", { name: "Reload" }));

    await waitFor(() => {
      expect(paths.filter((path) => path === "/api/v2/users")).toHaveLength(2);
    });
  });

  it("別の接続に差し替えると開いていたペインは閉じ、開き直すと新しい接続で取り直す", async () => {
    const user = await connected();
    const paths = requested();

    await user.click(button("Users"));
    await within(pane("Users")).findByText("山田 太郎");
    await switchTo(user, OTHER_SPACE);

    await waitFor(() => {
      expect(screen.queryByRole("complementary")).toBeNull();
    });

    await user.click(button("Users"));
    await within(pane("Users")).findByText("山田 太郎");

    expect(paths.filter((path) => path === "/api/v2/users")).toHaveLength(2);
  });

  it("一覧を取れなかったときは失敗の内容をペインの中に出し、他の段は残る", async () => {
    const user = await startApp({
      ...DIRECTORY,
      "/api/v2/teams": httpFailure({ status: 500, errors: [{ message: "Boom" }] }),
    });

    await connect(user);
    await signedIn();
    await user.click(button("Teams"));

    expect(await within(pane("Teams")).findByText(/Boom/)).toBeInTheDocument();
    expect(button(ACCOUNT)).toBeInTheDocument();
  });
});

/**
 * 名前を完全一致で引かない。TabNav は太字になっても幅が変わらないよう、同じラベルを
 * CSS で不可視にした要素にもう一度描く。happy-dom はその CSS を読まないので、
 * 名前が `Export Export` になる。
 */
const tab = (name: string): HTMLElement =>
  screen.getByRole("link", { name: new RegExp(`^${name}\\b`) });

const exportedYaml = async (): Promise<string> => {
  const shown = await screen.findByLabelText("Exported manifest PROJ_A.yaml");

  return shown.textContent ?? "";
};

describe("Export ページ", () => {
  /** 課題種別が0件のプロジェクトはマニフェストにできない（EX-9h）ので、1件持たせる。 */
  const EXPORTABLE = {
    "/api/v2/projects/PROJ_A/issueTypes": [{ id: 1, name: "タスク", color: "#7ea800" }],
  };

  const ISSUES_COUNT = "/api/v2/issues/count?projectId[]=100";

  const openExport = async (user: UserEvent): Promise<void> => {
    await user.click(tab("Export"));
    await waitFor(() => {
      expect(region("Export")).toBeInTheDocument();
    });
  };

  const connectedOnExport = async (responses: Record<string, unknown> = {}): Promise<UserEvent> => {
    const user = await startApp({ ...EXPORTABLE, ...responses });

    await connect(user);
    await signedIn();
    await openExport(user);

    return user;
  };

  const exportProject = async (user: UserEvent, key: string): Promise<void> => {
    await user.type(screen.getByLabelText("Project key"), key);
    await user.click(button("Export"));
  };

  it("タブで Export を開くと Apply のエディタと Output は見えなくなり、URL のハッシュが #/export になる", async () => {
    const user = await startApp();

    await connect(user);
    await signedIn();
    await openExport(user);

    expect(globalThis.location.hash).toBe("#/export");
    expect(screen.queryByRole("region", { name: "Output" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Plan" })).toBeNull();
  });

  it("Apply ページで接続すると、Export ページでも接続したまま使える", async () => {
    const user = await startApp(EXPORTABLE);

    await connect(user);
    await signedIn();
    await openExport(user);
    await exportProject(user, "PROJ_A");

    expect(await exportedYaml()).toContain("key: PROJ_A\n");
  });

  it("#/export を開いても、接続するまでは接続画面だけが出る", async () => {
    globalThis.location.hash = "#/export";

    await startApp();

    expect(screen.getByRole("heading", { name: "Connect to Backlog" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Project key")).toBeNull();
  });

  it("書き出した Yaml はそのままコピーできる", async () => {
    const user = await connectedOnExport();

    await exportProject(user, "PROJ_A");

    const yaml = await exportedYaml();

    expect(yaml).toContain("key: PROJ_A\nname: プロジェクトA\n");
    await user.click(button("Copy YAML"));
    expect(await navigator.clipboard.readText()).toBe(yaml);
  });

  it("Download は <KEY>.yaml という名前で書き出した Yaml を保存させる", async () => {
    const user = await connectedOnExport();
    const saved: { filename: string; blob: Blob }[] = [];
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      saved.push({ filename: "", blob: blob as Blob });

      return "blob:exported";
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      const last = saved.at(-1);

      if (last !== undefined) {
        last.filename = this.download;
      }
    });

    await exportProject(user, "PROJ_A");

    const yaml = await exportedYaml();

    await user.click(button("Download"));

    expect(saved).toHaveLength(1);
    expect(saved[0]?.filename).toBe("PROJ_A.yaml");
    expect(await saved[0]?.blob.text()).toBe(yaml);

    createObjectURL.mockRestore();
    click.mockRestore();
  });

  it("課題を持つプロジェクトも書き出せ、そのままでは plan と apply が拒むことを案内する", async () => {
    const user = await connectedOnExport({ [ISSUES_COUNT]: { count: 3 } });

    await exportProject(user, "PROJ_A");

    expect(await exportedYaml()).toContain("key: PROJ_A\n");
    expect(screen.getByText(/PROJ_A holds 3 issues/)).toBeInTheDocument();
  });

  it("課題が無ければ案内は出ない", async () => {
    const user = await connectedOnExport();

    await exportProject(user, "PROJ_A");
    await exportedYaml();

    expect(screen.queryByText(/holds/)).toBeNull();
  });

  it("キーの形が正しくなければ診断を出し、Yaml は何も出さない", async () => {
    const user = await connectedOnExport();

    await exportProject(user, "proj-a");

    expect(
      await within(region("Export")).findByText(/export error\. Nothing has been written\./),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy YAML" })).toBeNull();
  });

  it("マニフェストにできない実状は全件の診断として出し、Yaml は何も出さない", async () => {
    const user = await connectedOnExport({ "/api/v2/projects/PROJ_A/issueTypes": [] });

    await exportProject(user, "PROJ_A");

    expect(await within(region("Export")).findAllByText(/EX-9h/)).not.toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Copy YAML" })).toBeNull();
  });

  it("読み取りに失敗したときは失敗の内容を出し、Yaml は何も出さない", async () => {
    const user = await connectedOnExport({
      "/api/v2/projects/PROJ_A/webhooks": httpFailure({
        status: 500,
        errors: [{ message: "Boom" }],
      }),
    });

    await exportProject(user, "PROJ_A");

    expect(await within(region("Export")).findByText(/Boom/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy YAML" })).toBeNull();
  });

  it("キーの欄を書き換えても、書き出した結果はどのキーのものかを示したまま残る", async () => {
    const user = await connectedOnExport();

    await exportProject(user, "PROJ_A");
    await exportedYaml();
    await user.type(screen.getByLabelText("Project key"), "_B");

    expect(screen.getByText("PROJ_A.yaml")).toBeInTheDocument();
  });

  it("別の接続に差し替えると、書き出した結果は消える", async () => {
    const user = await connectedOnExport();

    await exportProject(user, "PROJ_A");
    await exportedYaml();
    await switchTo(user, OTHER_SPACE);

    await waitFor(() => {
      expect(screen.queryByText("PROJ_A.yaml")).toBeNull();
    });
  });

  it("ページを行き来しても、書きかけのマニフェストと書き出した結果は残る", async () => {
    const user = await startApp(EXPORTABLE);

    await connect(user);
    await signedIn();
    await writeManifest(user, MANIFEST);
    await openExport(user);
    await exportProject(user, "PROJ_A");
    await exportedYaml();
    await user.click(tab("Apply"));

    expect(await manifestField()).toHaveValue(MANIFEST);

    await openExport(user);

    expect(screen.getByText("PROJ_A.yaml")).toBeInTheDocument();
  });

  it("書き出した Yaml を Apply のマニフェストへ送る導線は無い", async () => {
    const user = await connectedOnExport();

    await exportProject(user, "PROJ_A");
    await exportedYaml();

    expect(
      within(region("Export"))
        .getAllByRole("button")
        .map((element) => element.textContent),
    ).toEqual(["Export", "Copy YAML", "Download"]);
  });
});
