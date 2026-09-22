import { LayersIcon } from "@radix-ui/react-icons";
import { Box, Button, Container, Flex, Heading, Text, Theme } from "@radix-ui/themes";
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
import { ConfirmDialog } from "./components/confirm";
import { ConnectDialog } from "./components/connect-dialog";
import { ConnectScreen } from "./components/connect-screen";
import { DIRECTORY_PANES, DirectoryPane } from "./components/directory-pane";
import { Panel } from "./components/panel";
import { Stepper } from "./components/stepper";
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
import { PAGE_INTROS, PAGES, usePage } from "./page";
import { PASTED, preparePlan, type PlanAttempt, type PreparedPlan } from "./plan";
import { isRunning, rejectedProgress, spentPlan, type ApplyRun } from "./progress";
import { secretRevisions, subscribeSecrets } from "./secrets";
import { ApplyStep } from "./steps/apply";
import { ExportStep } from "./steps/export";
import { ManifestStep } from "./steps/manifest";
import { PlanStep } from "./steps/plan";
import { pinTransport, transport } from "./transport";
import { RESTORED_FORM_ID, useConnection } from "./use-connection";
import { useDirectory } from "./use-directory";
import { useIcon } from "./use-icon";
import { validatedFor } from "./validation";

const APPLY_STEPS = ["Manifest", "Plan", "Apply"];

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
  const [confirmingPlan, setConfirmingPlan] = useState<PreparedPlan>();
  const [applyRecord, setApplyRecord] = useState<Derived<ApplyRun>>();
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

  /** WU-16。追いついていない結果は印が合わないので `fresh` が弾き、Plan は押せないままになる。 */
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

  const [planAttempt, runPlan, planning] = useActionState<Derived<PlanAttempt> | undefined>(
    async (previous) => {
      if (validation?.manifest === undefined || connection === undefined) {
        return previous;
      }

      const { manifest, diagnostics } = validation;
      const stamp = planKey;

      try {
        return {
          stamp,
          value: await preparePlan({
            manifest,
            get: transport.get,
            space,
            source: manifestSource,
            staticDiagnostics: diagnostics,
          }),
        };
      } catch (error) {
        return { stamp, value: { diagnostics: [], failure: error } };
      }
    },
    undefined,
  );

  /**
   * 適用の記録は印が合わなくなっても消さない。残すのは「何を適用したか」であって、
   * 「同じ計画をもう一度適用できること」ではない（WU-3 (b)）。
   */
  const run = applyRecord?.value;
  const running = run !== undefined && isRunning(run);
  const runOfPlan = fresh(applyRecord, planKey);
  const plan =
    runOfPlan !== undefined && spentPlan(runOfPlan) ? undefined : fresh(planAttempt, planKey);

  /**
   * 確認は計画そのものに紐づける。印に紐づけると、入力を変えずに Plan を押し直したときだけ
   * 印が変わらないので、開いたままの確認の後ろで計画が差し替わる。背面は操作できる
   * （confirm.tsx）ので、これは押せる経路である。同一性で見れば、確認が開いていること自体が
   * 「画面の計画と承認された計画が同じもの」の証拠になる（WU-3）。
   */
  const confirming = confirmingPlan !== undefined && confirmingPlan === plan?.prepared;

  /**
   * 離脱の警告は apply の実行中だけ出す（§2.4）。常に出すと、何も適用していない
   * 段階のタブを閉じるだけで警告が出て、警告そのものが読まれなくなる。
   */
  useEffect(() => {
    if (!running) {
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
  }, [running]);

  /**
   * ここだけ Action にしないのは WU-15 による。進捗を1件ずつ出すのが仕事なので、
   * 包むと全部終わってからまとめて出る。保留中を自前で持たないことは WU-17 が満たす。
   */
  const applyPlan = (): void => {
    const prepared = plan?.prepared;

    setConfirmingPlan(undefined);

    if (prepared === undefined) {
      return;
    }

    const stamp = planKey;

    void runApply({ plan: prepared.plan, space, client: pinTransport() }, (value) =>
      setApplyRecord({ stamp, value }),
    );
  };

  const cancelApply = (): void => {
    setConfirmingPlan(undefined);
    setApplyRecord({
      stamp: planKey,
      value: {
        progress: rejectedProgress,
        projectKey: plan?.prepared?.plan.manifest.key ?? "",
        space,
      },
    });
  };

  const openSwitch = (): void => {
    setFormId(formId + 1);
    setSwitchingFrom(session?.id);
  };

  const disconnect = (): void => {
    setFormId(formId + 1);
    connectionControl.disconnect();
  };

  const applyReached = [plan !== undefined, run !== undefined].filter(Boolean).length;

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
        <Container maxWidth="1200px" px={{ initial: "4", sm: "6" }} py={{ initial: "5", sm: "6" }}>
          <Flex direction="column" gap="5">
            <Flex direction="column" gap="1">
              <Heading as="h1" size="6">
                {PAGE_INTROS[page].title}
              </Heading>
              <Text color="gray" size="2">
                {PAGE_INTROS[page].description}
              </Text>
            </Flex>
            {/**
             * 見えないページもアンマウントしない（WU-28）。apply の最中に Export を開いた
             * だけで進捗と離脱の警告が消え、書きかけのマニフェストも失われる。
             */}
            <Flex className="page-view" direction="column" gap="5" hidden={page !== "apply"}>
              <Stepper reached={applyReached} titles={APPLY_STEPS} />
              <Panel enabled step={1} title="Manifest">
                <ManifestStep
                  canPlan={validation?.manifest !== undefined}
                  names={validated.value.names}
                  onFileDropped={(name, text) => {
                    setManifestSource(name);
                    setManifestText(text);
                  }}
                  onPlan={start(runPlan)}
                  onTextChange={(text) => {
                    setManifestSource(PASTED);
                    setManifestText(text);
                  }}
                  planning={planning}
                  text={manifestText}
                  validation={validation}
                />
              </Panel>
              <Panel
                enabled={plan !== undefined}
                hint="Run Plan to see what apply would do. The plan is discarded whenever an input changes, and once it has been applied."
                step={2}
                title="Plan"
              >
                <PlanStep
                  applying={running}
                  diagnostics={plan?.diagnostics ?? []}
                  failure={plan?.failure}
                  onApply={() => setConfirmingPlan(plan?.prepared)}
                  onShowUnchangedChange={setShowUnchanged}
                  prepared={plan?.prepared}
                  showUnchanged={showUnchanged}
                />
              </Panel>
              <Panel
                enabled={run !== undefined}
                hint="Nothing has been applied yet."
                step={3}
                title="Apply"
              >
                {run === undefined ? null : <ApplyStep run={run} />}
              </Panel>
              {confirming && plan?.prepared !== undefined ? (
                <ConfirmDialog onCancel={cancelApply} onConfirm={applyPlan} />
              ) : null}
            </Flex>
            <Flex className="page-view" direction="column" gap="5" hidden={page !== "export"}>
              <Panel enabled title="Export">
                <ExportStep
                  canExport={exportKey.trim() !== ""}
                  diagnostics={exportAttempt?.diagnostics ?? []}
                  exported={exportAttempt?.exported}
                  exporting={exporting}
                  failure={exportAttempt?.failure}
                  onExport={start(runExport)}
                  onProjectKeyChange={setExportKey}
                  projectKey={exportKey}
                />
              </Panel>
            </Flex>
          </Flex>
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
