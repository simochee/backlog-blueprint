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
import { ConnectDialog, ConnectScreen } from "./components/connect";
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
import { isSaveShortcut } from "./shortcut";
import { pinTransport, transport } from "./transport";
import { RESTORED_FORM_ID, useConnection } from "./use-connection";
import { useDirectory } from "./use-directory";
import { useIcon } from "./use-icon";
import { validatedFor } from "./validation";

const DIRECTORY_KINDS: DirectoryKind[] = ["users", "teams"];

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
  const [selectedId, setSelectedId] = useState<number>();
  const [outputExpanded, setOutputExpanded] = useState(false);
  const [paneRecord, setPaneRecord] = useState<Derived<DirectoryKind>>();

  const connectionKey = connectionStamp(session?.id);
  const icons = {
    space: useIcon(connectionKey, connection?.icons.space),
    user: useIcon(connectionKey, connection?.icons.user),
  };

  // `connectionControl.attempt` をそのまま出さない。開き直したフォームに前の失敗が残る。
  const attempt =
    connectionControl.attempt?.formId === formId ? connectionControl.attempt : undefined;

  // 開閉を真偽値で持たない。開いた時点の接続に紐づければ、新しい接続が通った時点で閉じ、
  // 「成功したら閉じる」を成功の経路ごとに書き足さずに済む（WU-36）。
  const switching = switchingFrom !== undefined && switchingFrom === session?.id;

  // `useMemo` を消して React Compiler に任せない（WU-19）。`useDeferredValue` は同一性で
  // 新旧を見分けるので、畳まれなかったときに出るのは「遅い」ではなく「描画が止まらない」になる。
  const manifestInputs: ManifestInputs = useMemo(
    () => ({ manifestText, environment: revisions.environment }),
    [manifestText, revisions.environment],
  );
  const manifestKey = manifestStamp(manifestInputs);
  const planKey = planStamp(connectionKey, manifestKey);

  const settled = useDeferredValue(manifestInputs);
  const validated = validatedFor(settled);

  const validation = fresh(validated, manifestKey);

  const directories = {
    users: useDirectory("users", connectionKey),
    teams: useDirectory("teams", connectionKey),
  };
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

  // マニフェストを書いただけでは警告しない。何も実行していない画面を閉じるたびに聞くと、
  // 警告そのものが読まれなくなる（WU-41）。
  const keepsRecords = history.length > 0 || planning;

  useEffect(() => {
    if (!keepsRecords) {
      return undefined;
    }

    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();

      // `returnValue` は非推奨だが消さない。`preventDefault()` だけを見るのは Chrome 119 以降で、
      // Safari と Firefox は今もこちらを見る。
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", warn);

    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [keepsRecords]);

  // 描画した時点の判定を適用しない。入力が変わった描画より先にクリックが届く経路が残る。
  // Action にしないのは、包むと進捗が全部終わってからまとめて出るため（WU-15）。
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

  const saveFile = async (): Promise<void> => {
    const failure = `Could not save ${manifestDocument.name ?? UNTITLED_FILENAME}`;

    try {
      const saved = await saveManifestFile(manifestDocument, manifestText);

      if (saved !== undefined) {
        // 書き込みの許可を待つあいだに別の文書へ差し替えられていたら戻さない。戻すと、
        // 表示は新しい文書のまま保存先だけが前のファイルになり、次の Save がそこを上書きする。
        setManifestDocument((current) => (current === manifestDocument ? saved : current));
        setFileFailure(undefined);
      }
    } catch (error) {
      setFileFailure(`${failure}: ${String(error)}`);
    }
  };

  const saveOnShortcut = useEffectEvent((event: KeyboardEvent): void => {
    if (!isSaveShortcut(event)) {
      return;
    }

    // 繰り返しで先に抜けない。押し続けたときにブラウザのページ保存が開く（WU-47）。
    event.preventDefault();

    if (!event.repeat) {
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
