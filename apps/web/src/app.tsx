import { LayersIcon } from "@radix-ui/react-icons";
import { Box, Button, Container, Flex, Theme } from "@radix-ui/themes";
import {
  startTransition,
  useActionState,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import { runApply } from "./apply";
import { useAppearance } from "./appearance";
import { AccountMenu } from "./components/account-menu";
import { SectionBoundary } from "./components/boundary";
import { ConnectDialog } from "./components/connect-dialog";
import { ConnectScreen } from "./components/connect-screen";
import { DIRECTORY_PANES, DirectoryPane } from "./components/directory-pane";
import { ExportPage } from "./components/export-page";
import { ManifestPane } from "./components/manifest-pane";
import { OutputPanel } from "./components/output-panel";
import { type DirectoryKind } from "./directory";
import { prepareExport, type ExportAttempt } from "./export";
import {
  connectionStamp,
  fresh,
  manifestStamp,
  planStamp,
  type Derived,
  type ManifestInputs,
} from "./freshness";
import {
  appendEntry,
  applicableEntry,
  type ApplyRuns,
  isOutdated,
  type OutputEntry,
} from "./output";
import { PAGES, usePage } from "./page";
import { PASTED, preparePlan } from "./plan";
import { isRunning } from "./progress";
import { secretRevisions, subscribeSecrets } from "./secrets";
import { pinTransport, transport } from "./transport";
import { RESTORED_FORM_ID, useConnection } from "./use-connection";
import { useDirectory } from "./use-directory";
import { useIcon } from "./use-icon";
import { validatedFor } from "./validation";

const DIRECTORY_KINDS: DirectoryKind[] = ["users", "teams"];

/** WU-15。Action の dispatch は transition の中から呼ぶ。 */
const start = (action: () => void) => () => startTransition(action);

export const App = () => {
  const appearance = useAppearance();
  const page = usePage();
  const revisions = useSyncExternalStore(subscribeSecrets, secretRevisions);
  const connectionControl = useConnection();
  const { session } = connectionControl;
  const connection = session?.connection;
  const space = session?.domain ?? "";
  const [formId, setFormId] = useState(RESTORED_FORM_ID);
  const [switchingFrom, setSwitchingFrom] = useState<number>();
  const [manifestText, setManifestText] = useState("");
  const [manifestSource, setManifestSource] = useState(PASTED);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [runs, setRuns] = useState<ApplyRuns>({});
  /** 未指定のあいだは最新の項目を追う。新しい項目を足したら、その項目を開く（WU-39） */
  const [selectedId, setSelectedId] = useState<number>();
  const [outputExpanded, setOutputExpanded] = useState(false);
  const [paneRecord, setPaneRecord] = useState<Derived<DirectoryKind>>();
  const [exportKey, setExportKey] = useState("");

  const connectionKey = connectionStamp(session?.id);
  const icons = {
    space: useIcon(connectionKey, connection?.icons.space),
    user: useIcon(connectionKey, connection?.icons.user),
  };

  /** 失敗は、それを出したフォームにだけ見せる。開き直したフォームに前の失敗を残さない */
  const attempt =
    connectionControl.attempt?.formId === formId ? connectionControl.attempt : undefined;

  /**
   * モーダルは開いた時点の接続に紐づける。新しい接続が通れば番号が変わって閉じるので、
   * 「成功したら閉じる」を成功の経路に書き足さずに済む（WU-36）。
   */
  const switching = switchingFrom !== undefined && switchingFrom === session?.id;

  /**
   * 束ね直さない。`useDeferredValue` は同一性で新旧を見分けるので、描画のたびに別の
   * object を渡すと後回しの描画がいつまでも追いつかない。React Compiler も同じものを
   * 畳むが（WU-19）、それに任せて消さない。畳まれなかったときに出るのが「遅い」ではなく
   * 「描画が止まらない」なので、落ちても遅いだけで済む形にしておく。
   */
  const manifestInputs: ManifestInputs = useMemo(
    () => ({ manifestText, environment: revisions.environment }),
    [manifestText, revisions.environment],
  );
  const manifestKey = manifestStamp(manifestInputs);
  const planKey = planStamp(connectionKey, manifestKey);

  /** WU-16。追いついていない結果は印が合わないので `fresh` が弾き、Plan も Apply も押せないままになる。 */
  const settled = useDeferredValue(manifestInputs);
  const validated = validatedFor(settled);

  const validation = fresh(validated, manifestKey);

  const directories = {
    users: useDirectory("users", connectionKey),
    teams: useDirectory("teams", connectionKey),
  };
  /** WU-21。開いているペインも接続の印に紐づけ、接続を差し替えれば閉じる。 */
  const pane = connection === undefined ? undefined : fresh(paneRecord, connectionKey);

  const togglePane = (kind: DirectoryKind): void => {
    if (pane === kind) {
      setPaneRecord(undefined);

      return;
    }

    setPaneRecord({ stamp: connectionKey, value: kind });

    const directory = directories[kind];

    if (!directory.settled && !directory.loading) {
      startTransition(directory.load);
    }
  };

  const [exportRecord, runExport, exporting] = useActionState<Derived<ExportAttempt> | undefined>(
    async (previous) => {
      if (connection === undefined) {
        return previous;
      }

      const stamp = connectionKey;

      try {
        return { stamp, value: await prepareExport(exportKey, transport.get) };
      } catch (error) {
        return { stamp, value: { diagnostics: [], failure: error } };
      }
    },
    undefined,
  );

  /** WU-32。キーの欄には紐づけない。どのキーを書き出したかは結果が持っている。 */
  const exportAttempt = fresh(exportRecord, connectionKey);

  /** Plan は計画を作って履歴に1件足すだけで、何も書かない。適用は Apply が別に受け持つ（WU-3） */
  const [history, runPlan, planning] = useActionState<OutputEntry[]>(async (previous) => {
    if (validation?.manifest === undefined || connection === undefined) {
      return previous;
    }

    const { manifest, diagnostics } = validation;
    const entry = { startedAt: Date.now(), space, projectKey: manifest.key, stamp: planKey };

    try {
      return appendEntry(previous, {
        ...entry,
        attempt: await preparePlan({
          manifest,
          get: transport.get,
          space,
          source: manifestSource,
          staticDiagnostics: diagnostics,
        }),
      });
    } catch (error) {
      return appendEntry(previous, { ...entry, attempt: { diagnostics: [], failure: error } });
    }
  }, []);

  const running = Object.values(runs).some(isRunning);
  const applicable = applicableEntry({ history, runs, planKey, pending: planning });

  const selected = history.find(({ id }) => id === selectedId) ?? history.at(-1);
  const outputView =
    selected === undefined
      ? undefined
      : { entry: selected, outdated: isOutdated(selected, planKey), run: runs[selected.id] };

  const followLatest = (): void => {
    setSelectedId(undefined);
    setOutputExpanded(true);
  };

  const requestPlan = (): void => {
    followLatest();
    startTransition(runPlan);
  };

  /**
   * 離脱の警告は Output に失われる記録があるあいだ出す（WU-41）。マニフェストを書いた
   * だけでは出さない。何も実行していない画面を閉じるたびに聞くと、警告そのものが読まれなくなる。
   */
  const keepsRecords = history.length > 0 || planning;

  useEffect(() => {
    if (!keepsRecords) {
      return undefined;
    }

    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();

      /**
       * `returnValue` は非推奨だが消さない。`preventDefault()` だけを見るのは
       * Chrome 119 以降で、Safari と Firefox は今もこちらを見る。片方だけだと
       * 適用の最中に閉じても何も聞かれないブラウザが出る。
       */
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", warn);

    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [keepsRecords]);

  /**
   * 適用するのは描画した時点の判定ではなく、押された時点で導き直した計画にする。描画の後に
   * 入力が変わった描画より先にクリックが届く経路が残る。
   *
   * ここだけ Action にしないのは WU-15 による。進捗を1件ずつ出すのが仕事なので、
   * 包むと全部終わってからまとめて出る。保留中を自前で持たないことは WU-17 が満たす。
   */
  const applyPlan = (): void => {
    const prepared = applicable?.attempt.prepared;

    if (applicable === undefined || prepared === undefined) {
      return;
    }

    const { id } = applicable;

    followLatest();
    void runApply({ plan: prepared.plan, space, client: pinTransport() }, (run) =>
      setRuns((previous) => ({ ...previous, [id]: run })),
    );
  };

  const openSwitch = (): void => {
    setFormId(formId + 1);
    setSwitchingFrom(session?.id);
  };

  const disconnect = (): void => {
    setFormId(formId + 1);
    connectionControl.disconnect();
  };

  const header = (
    <Box asChild className="app-header" position="sticky" top="0">
      <header>
        <Container maxWidth="1200px" px={{ initial: "4", sm: "6" }}>
          <div className="navbar" data-connected={connection !== undefined}>
            <a className="navbar-brand" href={PAGES[0]?.hash}>
              <LayersIcon aria-hidden height="18" width="18" />
              backlog-blueprint
            </a>
            {session === undefined ? null : (
              <>
                {/**
                 * Radix の `TabNav` を使わない。下線のタブはページの中の切り替えに見え、
                 * サイト全体の行き先を選ぶ部品に見えない。
                 */}
                <nav aria-label="Pages" className="navbar-pages">
                  {PAGES.map((entry) => (
                    <a
                      aria-current={page === entry.page ? "page" : undefined}
                      className="navbar-page"
                      href={entry.hash}
                      key={entry.page}
                    >
                      {entry.title}
                    </a>
                  ))}
                </nav>
                <Flex align="center" className="navbar-tools" gap="2">
                  {DIRECTORY_KINDS.map((kind) => (
                    <Button
                      aria-label={DIRECTORY_PANES[kind].title}
                      aria-pressed={pane === kind}
                      color="gray"
                      key={kind}
                      onClick={() => togglePane(kind)}
                      type="button"
                      variant={pane === kind ? "solid" : "soft"}
                    >
                      {DIRECTORY_PANES[kind].icon}
                      <span className="navbar-tool-label">{DIRECTORY_PANES[kind].title}</span>
                    </Button>
                  ))}
                  <AccountMenu
                    connection={session.connection}
                    domain={session.domain}
                    icons={icons}
                    locked={running}
                    onDisconnect={disconnect}
                    onSwitch={openSwitch}
                  />
                </Flex>
              </>
            )}
          </div>
        </Container>
      </header>
    </Box>
  );

  if (session === undefined) {
    return (
      <Theme accentColor="blue" appearance={appearance} grayColor="slate" radius="medium">
        <Box className="page">
          {header}
          <ConnectScreen
            connecting={connectionControl.connecting}
            diagnostics={attempt?.diagnostics ?? []}
            failure={attempt?.failure}
            hasApiKey={revisions.hasApiKey}
            initialSpace={connectionControl.storedSpace}
            key={formId}
            onConnect={(domain) => connectionControl.connectTo(domain, formId)}
            reconnectingTo={connectionControl.reconnectingTo}
          />
        </Box>
      </Theme>
    );
  }

  return (
    <Theme accentColor="blue" appearance={appearance} grayColor="slate" radius="medium">
      <Box className="page" data-pane-open={pane !== undefined}>
        {header}
        {/**
         * 見えないページもアンマウントしない（WU-28）。apply の最中に Export を開いた
         * だけで進捗と離脱の警告が消え、書きかけのマニフェストも失われる。
         */}
        <Container maxWidth="1200px" px={{ initial: "4", sm: "6" }}>
          <div className="workspace" hidden={page !== "apply"}>
            <SectionBoundary>
              <ManifestPane
                applying={running}
                canApply={applicable !== undefined}
                canPlan={validation?.manifest !== undefined && !planning && !running}
                names={validated.value.names}
                onFileDropped={(name, text) => {
                  setManifestSource(name);
                  setManifestText(text);
                }}
                onApply={applyPlan}
                onPlan={requestPlan}
                onTextChange={(text) => {
                  setManifestSource(PASTED);
                  setManifestText(text);
                }}
                planning={planning}
                text={manifestText}
                validation={validation}
              />
            </SectionBoundary>
            <OutputPanel
              entries={history}
              expanded={outputExpanded}
              onExpandedChange={setOutputExpanded}
              onSelect={setSelectedId}
              onShowUnchangedChange={setShowUnchanged}
              preparing={planning && selectedId === undefined}
              runs={runs}
              showUnchanged={showUnchanged}
              view={outputView}
            />
          </div>
          <section aria-label="Export" className="export-view" hidden={page !== "export"}>
            <SectionBoundary>
              <ExportPage
                canExport={exportKey.trim() !== ""}
                diagnostics={exportAttempt?.diagnostics ?? []}
                exported={exportAttempt?.exported}
                exporting={exporting}
                failure={exportAttempt?.failure}
                onExport={start(runExport)}
                onProjectKeyChange={setExportKey}
                projectKey={exportKey}
              />
            </SectionBoundary>
          </section>
        </Container>
      </Box>
      {DIRECTORY_KINDS.map((kind) => (
        <DirectoryPane
          directory={directories[kind]}
          key={`${kind}:${connectionKey}`}
          kind={kind}
          onClose={() => setPaneRecord(undefined)}
          onReload={start(directories[kind].load)}
          open={pane === kind}
        />
      ))}
      <ConnectDialog
        connecting={connectionControl.connecting}
        diagnostics={attempt?.diagnostics ?? []}
        failure={attempt?.failure}
        hasApiKey={revisions.hasApiKey}
        initialSpace={session.domain}
        onClose={() => setSwitchingFrom(undefined)}
        onConnect={(domain) => connectionControl.connectTo(domain, formId)}
        open={switching}
      />
    </Theme>
  );
};
