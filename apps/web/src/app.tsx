import { execute, type Diagnostic } from "@backlog-blueprint/core";
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

import { useAppearance } from "./appearance";
import { ConfirmDialog } from "./components/confirm";
import { Panel } from "./components/panel";
import { Stepper } from "./components/stepper";
import { connect, type Connection } from "./connection";
import {
  connectionStamp,
  fresh,
  manifestStamp,
  marked,
  planStamp,
  type Derived,
  type ManifestInputs,
  type Mark,
} from "./freshness";
import { PASTED, preparePlan, type PlanAttempt } from "./plan";
import {
  foldExecutionEvent,
  idleProgress,
  isRunning,
  rejectedProgress,
  spentPlan,
  type ApplyRun,
} from "./progress";
import { environmentValue, hasApiKey, secretRevisions, subscribeSecrets } from "./secrets";
import { ApplyStep } from "./steps/apply";
import { ConnectStep } from "./steps/connect";
import { ManifestStep } from "./steps/manifest";
import { PlanStep } from "./steps/plan";
import { openTransport, transport } from "./transport";
import { validateInBrowser, type ManifestValidation } from "./validation";

const STEPS = ["Connect", "Manifest", "Plan", "Apply"];

const EMPTY_VALIDATION: ManifestValidation = {
  diagnostics: [],
  names: [],
  expandedPaths: new Set(),
};

type ConnectAttempt = { diagnostics: Diagnostic[]; failure?: unknown; connection?: Connection };

/**
 * Action を呼ぶのは `startTransition` の中から。`<form action>` に渡す形も React は
 * 認めるが、それだと送信のたびに非制御の入力欄が空になるので、API キーの欄が繋いだ
 * 直後に消える。空になったのか打っていないのかが画面から区別できなくなる。
 */
const start = (action: () => void) => () => startTransition(action);

export const App = () => {
  const appearance = useAppearance();
  const revisions = useSyncExternalStore(subscribeSecrets, secretRevisions);
  const [space, setSpace] = useState("");
  const [manifestText, setManifestText] = useState("");
  const [manifestSource, setManifestSource] = useState(PASTED);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [confirmingPlan, setConfirmingPlan] = useState<Mark>();
  const [applied, setApplied] = useState<Derived<ApplyRun>>();

  const connectionKey = connectionStamp({ space, credentials: revisions.credentials });

  /**
   * 束ね直さない。`useDeferredValue` は同一性で新旧を見分けるので、描画のたびに別の
   * object を渡すと後回しの描画がいつまでも追いつかない。
   */
  const manifestInputs: ManifestInputs = useMemo(
    () => ({ manifestText, environment: revisions.environment }),
    [manifestText, revisions.environment],
  );
  const manifestKey = manifestStamp(manifestInputs);
  const planKey = planStamp(connectionKey, manifestKey);

  /**
   * 検証は後回しの描画として走らせる（WU-16）。打鍵のほうが優先されるので入力は詰まらず、
   * 追い越された分は React が捨てる。結果は落ち着いた入力の派生そのものなので、
   * 印が合わないあいだ `fresh` が古い検証結果を弾き、Plan は押せないままになる。
   */
  const settled = useDeferredValue(manifestInputs);
  const validated = useMemo<Derived<ManifestValidation>>(
    () => ({
      stamp: manifestStamp(settled),
      value:
        settled.manifestText.trim() === ""
          ? EMPTY_VALIDATION
          : validateInBrowser({ text: settled.manifestText, valueOf: environmentValue }),
    }),
    [settled],
  );

  const validation = fresh(validated, manifestKey);

  const [connectAttempt, runConnect, connecting] = useActionState<
    Derived<ConnectAttempt> | undefined
  >(async () => {
    const stamp = connectionKey;

    openTransport(space);

    try {
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

      const { manifest, expandedPaths, diagnostics } = validation;
      const stamp = planKey;

      try {
        return {
          stamp,
          value: await preparePlan({
            manifest,
            get: transport.get,
            isSecret: (path) => expandedPaths.has(path),
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
  const run = applied?.value;
  const running = run !== undefined && isRunning(run);
  const runOfPlan = fresh(applied, planKey);
  const plan =
    runOfPlan !== undefined && spentPlan(runOfPlan) ? undefined : fresh(planAttempt, planKey);
  const confirming = marked(confirmingPlan, planKey);

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
   * apply だけは Action にしない。Action の中で置いた state は、その Action が解決するまで
   * 画面に出ない（終わるまで中途半端な姿を見せないための仕組み）。apply は進捗を1件ずつ
   * 出すのが仕事なので、包んだ瞬間に進捗が全部終わってからまとめて出る。
   * `useOptimistic` で流す形も採らない。あれを await の後に呼ぶのは Action の外からの
   * 更新になり、進捗が出たそばから消える。
   *
   * 保留中の真偽値を持たないこと（WU-15）は、ここでは記録そのものから読むことで満たす
   * （WU-17）。走っているかどうかを別に持たないので、Action に任せるものが残らない。
   */
  const applyPlan = (): void => {
    const prepared = plan?.prepared;

    setConfirmingPlan(undefined);

    if (prepared === undefined) {
      return;
    }

    const stamp = planKey;
    const { actions, resolutions, manifest } = prepared.plan;
    const base = { resolutions, projectKey: manifest.key, space };

    const apply = async (): Promise<void> => {
      let progress = idleProgress;

      setApplied({ stamp, value: { ...base, progress } });

      try {
        for await (const event of execute(actions, {
          projectKey: manifest.key,
          resolutions,
          get: transport.get,
          send: transport.send,
        })) {
          progress = foldExecutionEvent(progress, event);
          setApplied({ stamp, value: { ...base, progress } });
        }
      } catch (error) {
        setApplied({ stamp, value: { ...base, progress, failure: error } });
      }
    };

    void apply();
  };

  const cancelApply = (): void => {
    setConfirmingPlan(undefined);
    setApplied({
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
              canConnect={space !== "" && hasApiKey()}
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
              onApply={() => setConfirmingPlan(planKey)}
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
