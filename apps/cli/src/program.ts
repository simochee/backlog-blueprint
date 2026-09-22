import { Command, InvalidArgumentError, Option } from "commander";

import {
  runApply,
  runExport,
  runPlan,
  runValidate,
  type ApplyOptions,
  type CommonOptions,
  type ConnectionOptions,
  type Deps,
  type ExportOptions,
  type PlanOptions,
} from "./commands";
import { API_KEY_VARIABLE, SPACE_VARIABLE } from "./credentials";
import { EXIT_ERROR, EXIT_SUCCESS } from "./exit-code";
import { type Io } from "./io";
import { STDIN_PATH } from "./manifest-source";
import { TOOL } from "./version";

type RawOptions = Record<string, unknown>;

/**
 * 複数のマニフェストを受け取らない（CL-3）。受け取ると、2つ目のプロジェクトの
 * 途中で失敗したときに「1つ目は適用済み」というプロジェクト境界をまたぐ
 * 部分適用が生まれる。commander の既定は後勝ちなので、明示的に断る。
 */
const onlyOnce = () => {
  let given = false;

  return (value: string): string => {
    if (given) {
      throw new InvalidArgumentError(
        "--file accepts a single manifest; one file declares one project.",
      );
    }

    given = true;

    return value;
  };
};

/**
 * 3分割する（CL-7）。`export` は位置引数1つを主語に取り、`-f` / `--output` という
 * 修飾子を持たないので、全コマンド共通の接続オプションだけ別に切り出す。
 */
const withConnectionOptions = (command: Command): Command =>
  command
    .option("--space <domain>", `Backlog space domain (falls back to ${SPACE_VARIABLE})`)
    .option("--no-color", "Disable colored output");

const withManifestOption = (command: Command): Command =>
  command.requiredOption(
    "-f, --file <path>",
    `Manifest path, or "${STDIN_PATH}" to read standard input`,
    onlyOnce(),
  );

const withOutputOption = (command: Command): Command =>
  command.addOption(
    new Option("--output <format>", "Output format").choices(["text", "json"]).default("text"),
  );

const withCommonOptions = (command: Command): Command =>
  withOutputOption(withManifestOption(withConnectionOptions(command)));

/**
 * 色は `--no-color` と `NO_COLOR` のどちらでも落ちる。`NO_COLOR` は空でない値が
 * 設定されていることを合図とする取り決めなので、空文字は無視する。
 */
const colorAllowed = (options: RawOptions, io: Io): boolean => {
  const noColor = io.env["NO_COLOR"];

  return options["color"] !== false && (noColor === undefined || noColor === "");
};

const connectionOptions = (options: RawOptions, io: Io): ConnectionOptions => {
  const { space } = options;
  const allowed = colorAllowed(options, io);

  return {
    ...(typeof space === "string" ? { space } : {}),
    color: { stdout: allowed && io.isStdoutTty, stderr: allowed && io.isStderrTty },
  };
};

const commonOptions = (options: RawOptions, io: Io): CommonOptions => ({
  ...connectionOptions(options, io),
  file: options["file"] as string,
  output: options["output"] as CommonOptions["output"],
});

const exportOptions = (key: string, options: RawOptions, io: Io): ExportOptions => ({
  ...connectionOptions(options, io),
  key,
});

const planOptions = (options: RawOptions, io: Io): PlanOptions => ({
  ...commonOptions(options, io),
  showUnchanged: options["showUnchanged"] === true,
});

const applyOptions = (options: RawOptions, io: Io): ApplyOptions => ({
  ...commonOptions(options, io),
  autoApprove: options["autoApprove"] === true,
});

/**
 * コマンドの外に例外を出さない。commander の `parseAsync` まで抜けた例外は
 * commander のものと区別が付かず、握りつぶすと原因を出さないまま 1 で終わる。
 */
const runCommand = async <T extends ConnectionOptions>(
  options: T,
  deps: Deps,
  run: (options: T, deps: Deps) => Promise<number>,
): Promise<number> => {
  try {
    return await run(options, deps);
  } catch (error) {
    deps.io.err(deps.output.failure(error, { color: options.color.stderr }));

    return EXIT_ERROR;
  }
};

const isHandled = (error: unknown): boolean => {
  const { code } = error as { code?: unknown };

  return code === "commander.helpDisplayed" || code === "commander.version";
};

export const runCli = async (argv: string[], deps: Deps): Promise<number> => {
  let code = EXIT_SUCCESS;

  const program = new Command()
    .name("backlog-blueprint")
    .description(
      `Declare Backlog project settings in YAML and apply them (${API_KEY_VARIABLE} is required for plan and apply)`,
    )
    .version(TOOL.version, "-V, --version")
    .exitOverride()
    .configureOutput({
      writeOut: (text) => {
        deps.io.out(text);
      },
      writeErr: (text) => {
        deps.io.err(text);
      },
    });

  withCommonOptions(
    program.command("validate").description("Validate a manifest without contacting Backlog"),
  ).action(async (options: RawOptions) => {
    code = await runCommand(commonOptions(options, deps.io), deps, runValidate);
  });

  withCommonOptions(program.command("plan").description("Show what apply would do (read-only)"))
    .option("--show-unchanged", "Show actions that change nothing")
    .action(async (options: RawOptions) => {
      code = await runCommand(planOptions(options, deps.io), deps, runPlan);
    });

  withCommonOptions(program.command("apply").description("Apply the manifest to Backlog"))
    .option("-y, --auto-approve", "Skip the confirmation prompt")
    .action(async (options: RawOptions) => {
      code = await runCommand(applyOptions(options, deps.io), deps, runApply);
    });

  withConnectionOptions(
    program
      .command("export")
      .description("Write an existing project out as a manifest (read-only)")
      .argument("<key>", "The project key to export"),
  ).action(async (key: string, options: RawOptions) => {
    code = await runCommand(exportOptions(key, options, deps.io), deps, runExport);
  });

  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (error) {
    return isHandled(error) ? EXIT_SUCCESS : EXIT_ERROR;
  }

  return code;
};
