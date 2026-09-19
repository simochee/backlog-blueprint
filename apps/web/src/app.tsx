import { execute, type Diagnostic } from "@backlog-blueprint/core";
import { useEffect, useState, useSyncExternalStore } from "react";

import { ConfirmDialog } from "./components/confirm";
import { Panel } from "./components/panel";
import { connect, type Connection } from "./connection";
import {
  connectionStamp,
  fresh,
  manifestStamp,
  marked,
  planStamp,
  type Derived,
  type Inputs,
  type Mark,
} from "./freshness";
import { PASTED, preparePlan, type PlanAttempt } from "./plan";
import { foldExecutionEvent, idleProgress, rejectedProgress } from "./progress";
import { environmentValue, hasApiKey, secretRevisions, subscribeSecrets } from "./secrets";
import { ApplyStep, type ApplyRun } from "./steps/apply";
import { ConnectStep } from "./steps/connect";
import { ManifestStep } from "./steps/manifest";
import { PlanStep } from "./steps/plan";
import { openTransport, transport } from "./transport";
import { validateInBrowser, type ManifestValidation } from "./validation";

const VALIDATION_DELAY_MS = 300;

const EMPTY_VALIDATION: ManifestValidation = {
  diagnostics: [],
  names: [],
  expandedPaths: new Set(),
};

type ConnectAttempt = { diagnostics: Diagnostic[]; failure?: unknown; connection?: Connection };

export const App = () => {
  const revisions = useSyncExternalStore(subscribeSecrets, secretRevisions);
  const [space, setSpace] = useState("");
  const [manifestText, setManifestText] = useState("");
  const [manifestSource, setManifestSource] = useState(PASTED);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [connectAttempt, setConnectAttempt] = useState<Derived<ConnectAttempt>>();
  const [validated, setValidated] = useState<Derived<ManifestValidation>>();
  const [planAttempt, setPlanAttempt] = useState<Derived<PlanAttempt>>();
  const [connecting, setConnecting] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [confirmingPlan, setConfirmingPlan] = useState<Mark>();
  const [appliedPlan, setAppliedPlan] = useState<Mark>();
  const [run, setRun] = useState<ApplyRun>();

  const inputs: Inputs = { space, manifestText, revisions };
  const connectionKey = connectionStamp(inputs);
  const manifestKey = manifestStamp(inputs);
  const planKey = planStamp(inputs);

  const attempt = fresh(connectAttempt, connectionKey);
  const connection = attempt?.connection;
  const validation = fresh(validated, manifestKey);
  const plan = marked(appliedPlan, planKey) ? undefined : fresh(planAttempt, planKey);
  const confirming = marked(confirmingPlan, planKey);

  useEffect(() => {
    const timer = setTimeout(() => {
      setValidated({
        stamp: manifestKey,
        value:
          manifestText.trim() === ""
            ? EMPTY_VALIDATION
            : validateInBrowser({ text: manifestText, valueOf: environmentValue }),
      });
    }, VALIDATION_DELAY_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [manifestKey, manifestText]);

  /**
   * 離脱の警告は apply の実行中だけ出す（§2.4）。常に出すと、何も適用していない
   * 段階のタブを閉じるだけで警告が出て、警告そのものが読まれなくなる。
   */
  useEffect(() => {
    if (run?.running !== true) {
      return undefined;
    }

    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };

    window.addEventListener("beforeunload", warn);

    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [run?.running]);

  const runConnect = async (): Promise<void> => {
    const stamp = connectionKey;

    setConnecting(true);
    openTransport(space);

    try {
      const result = await connect(transport.get);

      setConnectAttempt({ stamp, value: result });
    } catch (error) {
      setConnectAttempt({ stamp, value: { diagnostics: [], failure: error } });
    } finally {
      setConnecting(false);
    }
  };

  const runPlan = async (manifest: NonNullable<ManifestValidation["manifest"]>): Promise<void> => {
    if (connection === undefined || validation === undefined) {
      return;
    }

    const stamp = planKey;

    setPlanning(true);

    try {
      const attempted = await preparePlan({
        manifest,
        get: transport.get,
        isSecret: (path) => validation.expandedPaths.has(path),
        space,
        source: manifestSource,
        staticDiagnostics: validation.diagnostics,
      });

      setPlanAttempt({ stamp, value: attempted });
    } catch (error) {
      setPlanAttempt({ stamp, value: { diagnostics: [], failure: error } });
    } finally {
      setPlanning(false);
    }
  };

  const runApply = async (): Promise<void> => {
    if (plan?.prepared === undefined || connection === undefined) {
      return;
    }

    const stamp = planKey;
    const { actions, resolutions, manifest } = plan.prepared.plan;
    const base = { resolutions, projectKey: manifest.key, space };

    let progress = idleProgress;

    setRun({ ...base, progress, running: true });

    try {
      for await (const event of execute(actions, {
        projectKey: manifest.key,
        resolutions,
        get: transport.get,
        send: transport.send,
      })) {
        progress = foldExecutionEvent(progress, event);
        setRun({ ...base, progress, running: true });
      }

      setRun({ ...base, progress, running: false });
    } catch (error) {
      setRun({ ...base, progress, running: false, failure: error });
    } finally {
      /**
       * 完了も中断も同じ1箇所で印を置く（WU-3 (b)）。終わり方ごとに書くと、
       * 終わり方が1つ増えたときに書き忘れた経路だけ同じ計画を2度適用できる。
       */
      setAppliedPlan(stamp);
    }
  };

  const applyPlan = (): void => {
    setConfirmingPlan(undefined);
    void runApply();
  };

  const cancelApply = (): void => {
    setConfirmingPlan(undefined);
    setRun({
      progress: rejectedProgress,
      running: false,
      projectKey: plan?.prepared?.plan.manifest.key ?? "",
      space,
    });
  };

  return (
    <main className="app">
      <header className="app-header">
        <h1>backlog-blueprint</h1>
        <p>Declare a Backlog project in YAML, review the plan, then apply it.</p>
      </header>
      <Panel enabled step={1} title="Connect">
        <ConnectStep
          canConnect={space !== "" && hasApiKey()}
          connecting={connecting}
          diagnostics={attempt?.diagnostics ?? []}
          failure={attempt?.failure}
          onConnect={() => void runConnect()}
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
          names={validated?.value.names ?? []}
          onFileDropped={(name, text) => {
            setManifestSource(name);
            setManifestText(text);
          }}
          onPlan={() => {
            if (validation?.manifest !== undefined) {
              void runPlan(validation.manifest);
            }
          }}
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
          applying={run?.running === true}
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
    </main>
  );
};
