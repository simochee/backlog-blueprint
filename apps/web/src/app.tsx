import { LayersIcon } from "@radix-ui/react-icons";
import { Box, Button, Container, Flex, Theme } from "@radix-ui/themes";
import {
  startTransition,
  useActionState,
  useDeferredValue,
  useEffect,
  useEffectEvent,
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
import { DiscardDialog } from "./components/discard-dialog";
import { ManifestPane } from "./components/manifest-pane";
import { OutputPanel } from "./components/output-panel";
import { type DirectoryKind } from "./directory";
import { prepareExport } from "./export";
import { openManifestFile, saveManifestFile, UNTITLED_FILENAME } from "./files";
import {
  connectionStamp,
  fresh,
  manifestStamp,
  planStamp,
  type Derived,
  type ManifestInputs,
} from "./freshness";
import {
  documentName,
  hasUnsavedChanges,
  importedDocument,
  openedFile,
  type ManifestDocument,
  type OpenedDocument,
  UNTITLED,
} from "./manifest-document";
import {
  appendEntry,
  applicableEntry,
  type ApplyRuns,
  isOutdated,
  type OutputEntry,
} from "./output";
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
  const revisions = useSyncExternalStore(subscribeSecrets, secretRevisions);
  const connectionControl = useConnection();
  const { session } = connectionControl;
  const connection = session?.connection;
  const space = session?.domain ?? "";
  const [formId, setFormId] = useState(RESTORED_FORM_ID);
  const [switchingFrom, setSwitchingFrom] = useState<number>();
  const [manifestText, setManifestText] = useState("");
  const [manifestDocument, setManifestDocument] = useState<ManifestDocument>(UNTITLED);
  const [replacement, setReplacement] = useState<OpenedDocument>();
  const [fileFailure, setFileFailure] = useState<string>();
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [runs, setRuns] = useState<ApplyRuns>({});
  /** 未指定のあいだは最新の項目を追う。新しい項目を足したら、その項目を開く（WU-39） */
  const [selectedId, setSelectedId] = useState<number>();
  const [outputExpanded, setOutputExpanded] = useState(false);
  const [paneRecord, setPaneRecord] = useState<Derived<DirectoryKind>>();

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

  /** Plan は計画を作って履歴に1件足すだけで、何も書かない。適用は Apply が別に受け持つ（WU-3） */
  const [history, runPlan, planning] = useActionState<OutputEntry[]>(async (previous) => {
    if (validation?.manifest === undefined || connection === undefined) {
      return previous;
    }

    const { manifest, diagnostics } = validation;
    const source = manifestDocument.name ?? PASTED;
    const entry = { startedAt: Date.now(), space, projectKey: manifest.key, stamp: planKey };

    try {
      return appendEntry(previous, {
        ...entry,
        attempt: await preparePlan({
          manifest,
          get: transport.get,
          space,
          source,
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

  const unsaved = hasUnsavedChanges(manifestDocument, manifestText);

  const replaceDocument = ({ document, text }: OpenedDocument): void => {
    setManifestDocument(document);
    setManifestText(text);
    setReplacement(undefined);
    setFileFailure(undefined);
  };

  /** WU-45。保存していない変更があるときだけ、差し替える前に確かめる。 */
  const openDocument = (opened: OpenedDocument): void => {
    if (unsaved) {
      setReplacement(opened);
    } else {
      replaceDocument(opened);
    }
  };

  const openFile = async (): Promise<void> => {
    try {
      const opened = await openManifestFile();

      if (opened !== undefined) {
        openDocument(opened);
      }
    } catch (error) {
      setFileFailure(`Could not open the file: ${String(error)}`);
    }
  };

  /** 書いているあいだに打った分は保存した内容に含まれないので、Unsaved のまま残る（WU-43）。 */
  const saveFile = async (): Promise<void> => {
    const failure = `Could not save ${manifestDocument.name ?? UNTITLED_FILENAME}`;

    try {
      const saved = await saveManifestFile(manifestDocument, manifestText);

      if (saved !== undefined) {
        setManifestDocument(saved);
        setFileFailure(undefined);
      }
    } catch (error) {
      setFileFailure(`${failure}: ${String(error)}`);
    }
  };

  /**
   * WU-47。エディタの中だけで効かせない。Output や一覧を触った後に押すと、ブラウザが
   * このページの HTML を保存する画面を開く。Shift+Cmd+S は「名前を付けて保存」に残す。
   */
  const saveOnShortcut = useEffectEvent((event: KeyboardEvent): void => {
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === "s"
    ) {
      event.preventDefault();
      void saveFile();
    }
  });

  const connected = session !== undefined;

  useEffect(() => {
    if (!connected) {
      return undefined;
    }

    const listen = (event: KeyboardEvent): void => saveOnShortcut(event);

    globalThis.addEventListener("keydown", listen);

    return () => {
      globalThis.removeEventListener("keydown", listen);
    };
  }, [connected]);

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
            <span className="navbar-brand">
              <LayersIcon aria-hidden height="18" width="18" />
              backlog-blueprint
            </span>
            {session === undefined ? null : (
              <Flex align="center" gap="2">
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
        <Container maxWidth="1200px" px={{ initial: "4", sm: "6" }}>
          <div className="workspace">
            <SectionBoundary>
              <ManifestPane
                applying={running}
                canApply={applicable !== undefined}
                canPlan={validation?.manifest !== undefined && !planning && !running}
                documentName={documentName(manifestDocument)}
                fileFailure={fileFailure}
                importKey={connectionKey}
                names={validated.value.names}
                notes={manifestDocument.notes}
                onApply={applyPlan}
                onFileDropped={(name, text) => openDocument(openedFile(name, text))}
                onImport={(projectKey) => prepareExport(projectKey, transport.get)}
                onImported={(exported) => openDocument(importedDocument(exported))}
                onOpen={() => void openFile()}
                onPlan={requestPlan}
                onSave={() => void saveFile()}
                onTextChange={setManifestText}
                planning={planning}
                text={manifestText}
                unsaved={unsaved}
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
      <DiscardDialog
        current={documentName(manifestDocument)}
        onCancel={() => setReplacement(undefined)}
        onDiscard={() => {
          if (replacement !== undefined) {
            replaceDocument(replacement);
          }
        }}
        replacement={replacement?.document.name}
      />
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
