import { hasError, type Diagnostic } from "@backlog-blueprint/core";
import { useHotkey } from "@tanstack/react-hotkeys";
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
import { AccountMenu } from "./components/account-menu";
import { ActivityBar, type SidebarKind } from "./components/activity-bar";
import { SectionBoundary } from "./components/boundary";
import { ConnectDialog, ConnectScreen } from "./components/connect";
import { ProblemList } from "./components/diagnostics";
import { DirectoryPane } from "./components/directory-pane";
import { DiscardDialog } from "./components/discard-dialog";
import { EnvironmentPane } from "./components/environment-pane";
import { ImportDialog } from "./components/import-dialog";
import { type FileFailure, ManifestPane } from "./components/manifest-pane";
import { OutputPanel, type OutputView } from "./components/output-panel";
import { Panel, type PanelTab } from "./components/panel";
import { StatusBar } from "./components/status-bar";
import { TitleBar } from "./components/title-bar";
import { type DirectoryKind } from "./directory";
import { type EditorJump, type EditorPosition } from "./editor-position";
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
import { SHORTCUTS } from "./hotkeys";
import {
  documentName,
  type ExportNotes,
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
  applyBlocker,
  type ApplyRuns,
  entryState,
  isOutdated,
  type OutputEntry,
  PLANNING,
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

const SHORT_SCREEN = "(max-height: 759px)";

/** `matchMedia` があると決めつけない。happy-dom や埋め込みの WebView には無い */
const isShortScreen = (): boolean =>
  typeof globalThis.matchMedia === "function" && globalThis.matchMedia(SHORT_SCREEN).matches;

const errorsIn = (diagnostics: Diagnostic[]): number =>
  diagnostics.filter(({ severity }) => severity === "error").length;

const start = (action: () => void) => () => startTransition(action);

export const App = () => {
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
  const [fileFailure, setFileFailure] = useState<FileFailure>();
  const [dismissedNotes, setDismissedNotes] = useState<ExportNotes>();
  const [importOpen, setImportOpen] = useState(false);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [runs, setRuns] = useState<ApplyRuns>({});
  const [selectedId, setSelectedId] = useState<number>();
  const [applyRequested, setApplyRequested] = useState<number>();
  const [panel, setPanel] = useState<{ open: boolean; tab: PanelTab }>({
    open: false,
    tab: "output",
  });
  const [sidebarRecord, setSidebarRecord] = useState<Derived<SidebarKind>>();
  const [lastSidebar, setLastSidebar] = useState<SidebarKind>("users");
  const [environmentFocus, setEnvironmentFocus] = useState(0);
  const [cursor, setCursor] = useState<EditorPosition>({ line: 1, column: 1 });
  const [jump, setJump] = useState<EditorJump>();
  const [problemsFor, setProblemsFor] = useState<ManifestDocument>();

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

  // 件数と Problems は落ち着いた検証から描く。今の入力の検証を待つと、打鍵のたびに 0 件へ戻る。
  const { diagnostics, variables } = validated.value;
  const errors = errorsIn(diagnostics);
  const warnings = diagnostics.length - errors;
  const missingValues = variables.filter(({ missing }) => missing).length;

  const directories = {
    users: useDirectory("users", connectionKey),
    teams: useDirectory("teams", connectionKey),
  };
  const recorded = connection === undefined ? undefined : fresh(sidebarRecord, connectionKey);
  const sidebar = recorded === "env" && variables.length === 0 ? undefined : recorded;

  const openSidebar = (kind: SidebarKind): void => {
    setSidebarRecord({ stamp: connectionKey, value: kind });
    setLastSidebar(kind);

    if (kind === "env") {
      return;
    }

    const directory = directories[kind];

    if (!directory.settled && !directory.loading) {
      startTransition(directory.load);
    }
  };

  const toggleSidebar = (kind: SidebarKind): void => {
    if (sidebar === kind) {
      setSidebarRecord(undefined);
    } else {
      openSidebar(kind);
    }
  };

  const toggleLastSidebar = (): void => {
    if (sidebar === undefined) {
      openSidebar(lastSidebar === "env" && variables.length === 0 ? "users" : lastSidebar);
    } else {
      setSidebarRecord(undefined);
    }
  };

  const showPanel = (tab: PanelTab): void => {
    setPanel({ open: true, tab });
  };

  const selectTab = (tab: PanelTab): void => {
    setPanel((previous) =>
      previous.open && previous.tab === tab ? { ...previous, open: false } : { open: true, tab },
    );
  };

  const togglePanel = (): void => {
    setPanel((previous) => ({ ...previous, open: !previous.open }));
  };

  const [history, runPlan, planning] = useActionState<OutputEntry[]>(async (previous) => {
    if (validation?.manifest === undefined || connection === undefined) {
      return previous;
    }

    const { manifest } = validation;
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
          staticDiagnostics: validation.diagnostics,
        }),
      });
    } catch (error) {
      return appendEntry(previous, { ...entry, attempt: { diagnostics: [], failure: error } });
    }
  }, []);

  const running = Object.values(runs).some(isRunning);
  const applyContext = { history, runs, planKey, pending: planning };
  const applicable = applicableEntry(applyContext);

  const view = (entry: OutputEntry | undefined): OutputView | undefined =>
    entry === undefined
      ? undefined
      : { entry, outdated: isOutdated(entry, planKey), run: runs[entry.id] };

  const outputView = view(history.find(({ id }) => id === selectedId) ?? history.at(-1));
  const latest = view(history.at(-1));
  const latestOutdated =
    latest !== undefined &&
    latest.run === undefined &&
    latest.outdated &&
    latest.entry.attempt.prepared !== undefined;

  const planBlocker = ((): string | undefined => {
    if (manifestText.trim() === "") {
      return "Write or open a manifest first";
    }

    if (running) {
      return "Apply is running";
    }

    if (planning) {
      return "Plan is running";
    }

    if (validation === undefined) {
      return "Checking the manifest...";
    }

    if (validation.manifest !== undefined) {
      return undefined;
    }

    return validation.variables.some(({ missing }) => missing)
      ? "Enter the environment values first"
      : "Fix the errors in Problems first";
  })();

  const followLatest = (): void => {
    setSelectedId(undefined);
    showPanel("output");
  };

  // 未入力の環境変数を先に見る。未入力も Problems にエラーとして並ぶが、直す場所は ENV の欄である（WU-52）。
  const guideToBlocker = (): void => {
    if (validation?.variables.some(({ missing }) => missing)) {
      openSidebar("env");
      setEnvironmentFocus((previous) => previous + 1);

      return;
    }

    if (validation !== undefined && hasError(validation.diagnostics)) {
      showPanel("problems");
    }
  };

  const requestPlan = (): void => {
    if (planBlocker !== undefined) {
      guideToBlocker();

      return;
    }

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
      if (history.length > 0) {
        showPanel("output");
      }

      return;
    }

    const { id } = applicable;

    followLatest();
    setApplyRequested(id);
    void runApply({ plan: prepared.plan, space, client: pinTransport() }, (run) =>
      setRuns((previous) => ({ ...previous, [id]: run })),
    );
  };

  // 開いた文書のエラーを知らせるのは1回だけ。閉じた後に打鍵のたびに開き直すと、閉じた意味が無くなる（WU-54）。
  useEffect(() => {
    if (problemsFor === undefined || problemsFor !== manifestDocument || validation === undefined) {
      return;
    }

    setProblemsFor(undefined);

    if (hasError(validation.diagnostics) && !isShortScreen()) {
      setPanel({ open: true, tab: "problems" });
    }
  }, [problemsFor, manifestDocument, validation]);

  const unsaved = hasUnsavedChanges(manifestDocument, manifestText);

  const replaceDocument = ({ document, text }: OpenedDocument): void => {
    setManifestDocument(document);
    setManifestText(text);
    setReplacement(undefined);
    setFileFailure(undefined);
    setProblemsFor(document);
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
      setFileFailure({ action: "open", message: `Could not open the file: ${String(error)}` });
    }
  };

  const saveFile = async (): Promise<void> => {
    const name = manifestDocument.name ?? UNTITLED_FILENAME;

    try {
      const saved = await saveManifestFile(manifestDocument, manifestText);

      if (saved !== undefined) {
        // 書き込みの許可を待つあいだに別の文書へ差し替えられていたら戻さない。戻すと、
        // 表示は新しい文書のまま保存先だけが前のファイルになり、次の Save がそこを上書きする。
        setManifestDocument((current) => (current === manifestDocument ? saved : current));
        setFileFailure(undefined);
      }
    } catch (error) {
      setFileFailure({ action: "save", message: `Could not save ${name}: ${String(error)}` });
    }
  };

  const connected = session !== undefined;
  const modalOpen = importOpen || switching || replacement !== undefined;
  const background = { enabled: connected && !modalOpen };

  // 押し続けた繰り返しでは何もしない。保存はダウンロードに落ちる環境で押したぶんだけファイルが増え、
  // 他は開閉が点滅する。既定の動作は繰り返しでも止まる（WU-47）。
  useHotkey(
    SHORTCUTS.save,
    (event) => {
      if (!event.repeat) {
        void saveFile();
      }
    },
    { enabled: connected },
  );
  useHotkey(
    SHORTCUTS.open,
    (event) => {
      if (!event.repeat) {
        void openFile();
      }
    },
    background,
  );
  useHotkey(
    SHORTCUTS.plan,
    (event) => {
      if (!event.repeat) {
        requestPlan();
      }
    },
    background,
  );
  useHotkey(
    SHORTCUTS.panel,
    (event) => {
      if (!event.repeat) {
        togglePanel();
      }
    },
    background,
  );
  useHotkey(
    SHORTCUTS.sidebar,
    (event) => {
      if (!event.repeat) {
        toggleLastSidebar();
      }
    },
    background,
  );

  const openSwitch = (): void => {
    setFormId(formId + 1);
    setSwitchingFrom(session?.id);
  };

  const disconnect = (): void => {
    setFormId(formId + 1);
    connectionControl.disconnect();
  };

  const jumpTo = ({ line, column }: Diagnostic): void => {
    if (line !== undefined) {
      setJump((previous) => ({ line, column: column ?? 1, request: (previous?.request ?? 0) + 1 }));
    }
  };

  if (session === undefined) {
    return (
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
    );
  }

  const name = documentName(manifestDocument);
  const notes = manifestDocument.notes === dismissedNotes ? undefined : manifestDocument.notes;
  const outputState = planning
    ? PLANNING
    : latest && entryState(latest.entry, latest.run, latest.outdated);

  return (
    <div className="workbench">
      <TitleBar
        account={
          <AccountMenu
            connection={session.connection}
            domain={session.domain}
            icons={icons}
            locked={running}
            onDisconnect={disconnect}
            onSwitch={openSwitch}
          />
        }
        apply={{ blocker: applyBlocker(applyContext), onClick: applyPlan }}
        onImport={() => setImportOpen(true)}
        onOpen={() => void openFile()}
        onSave={() => void saveFile()}
        onShowOutput={() => showPanel("output")}
        outdated={latestOutdated}
        plan={{ blocker: planBlocker, onClick: requestPlan }}
      />
      <div className="workbench-body">
        <ActivityBar
          active={sidebar}
          missingValues={missingValues}
          onToggle={toggleSidebar}
          showEnvironment={variables.length > 0}
        />
        {DIRECTORY_KINDS.map((kind) => (
          <DirectoryPane
            directory={directories[kind]}
            key={`${kind}:${connectionKey}`}
            kind={kind}
            onClose={() => setSidebarRecord(undefined)}
            onReload={start(directories[kind].load)}
            open={sidebar === kind}
          />
        ))}
        {variables.length === 0 ? null : (
          <EnvironmentPane
            focusRequest={environmentFocus}
            onClose={() => setSidebarRecord(undefined)}
            open={sidebar === "env"}
            variables={variables}
          />
        )}
        <div className="center">
          <SectionBoundary>
            <ManifestPane
              author={session.connection.user}
              documentName={name}
              fileFailure={fileFailure}
              jump={jump}
              notes={notes}
              onCursorChange={setCursor}
              onDismissFailure={() => setFileFailure(undefined)}
              onDismissNotes={() => setDismissedNotes(manifestDocument.notes)}
              onFileDropped={(dropped, text) => openDocument(openedFile(dropped, text))}
              onImport={() => setImportOpen(true)}
              onOpen={() => void openFile()}
              onTextChange={setManifestText}
              space={session.domain}
              text={manifestText}
              unsaved={unsaved}
              untitled={manifestDocument.name === undefined}
            />
          </SectionBoundary>
          <Panel
            errors={errors}
            onTab={selectTab}
            onToggle={togglePanel}
            open={panel.open}
            outputState={outputState}
            tab={panel.tab}
            warnings={warnings}
          >
            {panel.tab === "problems" ? (
              <ProblemList diagnostics={diagnostics} documentName={name} onSelect={jumpTo} />
            ) : (
              <OutputPanel
                applyRequested={applyRequested}
                entries={history}
                onApplyFollowed={() => setApplyRequested(undefined)}
                onPlanAgain={requestPlan}
                onSelect={setSelectedId}
                onShowUnchangedChange={setShowUnchanged}
                planKey={planKey}
                preparing={planning && selectedId === undefined}
                runs={runs}
                showUnchanged={showUnchanged}
                view={outputView}
              />
            )}
          </Panel>
        </div>
      </div>
      <StatusBar
        cursor={cursor}
        domain={session.domain}
        errors={errors}
        latest={latest}
        missingValues={missingValues}
        onEnvironment={() => openSidebar("env")}
        onOutput={() => showPanel("output")}
        onProblems={() => showPanel("problems")}
        planning={planning}
        rateLimit={session.connection.updateRateLimit}
        schemaVersion={__SCHEMA_VERSION__}
        warnings={warnings}
      />
      <DiscardDialog
        current={name}
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
        current={session.domain}
        diagnostics={attempt?.diagnostics ?? []}
        failure={attempt?.failure}
        hasApiKey={revisions.hasApiKey}
        initialSpace={session.domain}
        onClose={() => setSwitchingFrom(undefined)}
        onConnect={(domain) => connectionControl.connectTo(domain, formId)}
        open={switching}
      />
      <ImportDialog
        key={connectionKey}
        onImport={(projectKey) => prepareExport(projectKey, transport.get)}
        onImported={(exported) => openDocument(importedDocument(exported))}
        onOpenChange={setImportOpen}
        open={importOpen}
      />
    </div>
  );
};
