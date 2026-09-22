import { type Diagnostic } from "@backlog-blueprint/core";
import { Container, Flex, Heading, Text, Theme } from "@radix-ui/themes";
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
import { ConfirmDialog } from "./components/confirm";
import { Panel } from "./components/panel";
import { Stepper } from "./components/stepper";
import { connect, type Connection } from "./connection";
import {
  connectionStamp,
  fresh,
  manifestStamp,
  planStamp,
  type Derived,
  type ManifestInputs,
} from "./freshness";
import { PASTED, preparePlan, type PlanAttempt, type PreparedPlan } from "./plan";
import { isRunning, rejectedProgress, spentPlan, type ApplyRun } from "./progress";
import { secretRevisions, subscribeSecrets } from "./secrets";
import { ApplyStep } from "./steps/apply";
import { ConnectStep } from "./steps/connect";
import { ManifestStep } from "./steps/manifest";
import { PlanStep } from "./steps/plan";
import { openTransport, transport } from "./transport";
import { validatedFor } from "./validation";

const STEPS = ["Connect", "Manifest", "Plan", "Apply"];

type ConnectAttempt = { diagnostics: Diagnostic[]; failure?: unknown; connection?: Connection };

/** WU-15。Action の dispatch は transition の中から呼ぶ。 */
const start = (action: () => void) => () => startTransition(action);

export const App = () => {
  const appearance = useAppearance();
  const revisions = useSyncExternalStore(subscribeSecrets, secretRevisions);
  const [space, setSpace] = useState("");
  const [manifestText, setManifestText] = useState("");
  const [manifestSource, setManifestSource] = useState(PASTED);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [confirmingPlan, setConfirmingPlan] = useState<PreparedPlan>();
  const [applyRecord, setApplyRecord] = useState<Derived<ApplyRun>>();

  const connectionKey = connectionStamp({ space, credentials: revisions.credentials });

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

  const [connectAttempt, runConnect, connecting] = useActionState<
    Derived<ConnectAttempt> | undefined
  >(async () => {
    const stamp = connectionKey;

    try {
      openTransport(space);

      return { stamp, value: await connect(transport.get) };
    } catch (error) {
      return { stamp, value: { diagnostics: [], failure: error } };
    }
  }, undefined);

  const attempt = fresh(connectAttempt, connectionKey);
  const connection = attempt?.connection;

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

    void runApply({ plan: prepared.plan, space }, (value) => setApplyRecord({ stamp, value }));
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

  const reached = [connection !== undefined, plan !== undefined, run !== undefined].filter(
    Boolean,
  ).length;

  return (
    <Theme accentColor="blue" appearance={appearance} grayColor="slate" radius="medium">
      <Container maxWidth="1200px" px={{ initial: "4", sm: "6" }} py={{ initial: "5", sm: "8" }}>
        <Flex direction="column" gap="5">
          <Flex direction="column" gap="1">
            <Heading as="h1" size="7">
              backlog-blueprint
            </Heading>
            <Text color="gray" size="3">
              Declare a Backlog project in YAML, review the plan, then apply it.
            </Text>
          </Flex>
          <Stepper reached={reached} titles={STEPS} />
          <Panel enabled step={1} title="Connect">
            <ConnectStep
              canConnect={space !== "" && revisions.hasApiKey}
              connecting={connecting}
              diagnostics={attempt?.diagnostics ?? []}
              failure={attempt?.failure}
              onConnect={start(runConnect)}
              onSpaceChange={setSpace}
              connection={attempt?.connection}
              space={space}
            />
          </Panel>
          <Panel
            enabled={connection !== undefined}
            hint="Connect to a space first."
            step={2}
            title="Manifest"
          >
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
            step={3}
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
            step={4}
            title="Apply"
          >
            {run === undefined ? null : <ApplyStep run={run} />}
          </Panel>
          {confirming && plan?.prepared !== undefined ? (
            <ConfirmDialog onCancel={cancelApply} onConfirm={applyPlan} />
          ) : null}
        </Flex>
      </Container>
    </Theme>
  );
};
