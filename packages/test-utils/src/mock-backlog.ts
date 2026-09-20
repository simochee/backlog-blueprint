import { DEFAULT_STATUSES_JA } from "@backlog-blueprint/core";

/**
 * `fixedSpaceResponses` と違い、`fetch` そのものを差し替えて更新系にも応答し、
 * 状態を進める。受け入れ基準の AC-1 / AC-2 / AC-7 / AC-8 は「適用したあとに
 * どうなっているか」を問うので、path から値を引くだけの表では書き表せない。
 *
 * 既定リソースの名前・色・ID は Backlog API の実測値（research の
 * 「既定リソースの表示名」「課題種別」）をそのまま写している。
 */

export type MockMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type MockRequest = {
  method: MockMethod;
  path: string;
  params: Record<string, unknown>;
  /** 符号化されたままの本文。`params` に畳むと `key[]=` と `key[]=""` の区別が消える */
  body: string;
};

/** `roleType` はスペース全体の権限。1 がスペース管理者（実測。research「権限」） */
export type MockUser = { id: number; userId: string; roleType: number };

export type MockTeam = { id: number; name: string };

export type MockSpaceTeam = MockTeam & { members: MockUser[] };

export type MockIssueType = {
  id: number;
  name: string;
  color: string;
  templateSummary: string | null;
  templateDescription: string | null;
};

export type MockStatus = { id: number; name: string; color: string };

export type MockCategory = { id: number; name: string };

export type MockMilestone = {
  id: number;
  name: string;
  description: string | null;
  startDate: string | null;
  releaseDueDate: string | null;
};

export type MockCustomField = {
  id: number;
  name: string;
  typeId: number;
  description: string | null;
  required: boolean;
  min: number | string | null;
  max: number | string | null;
  initialValue: number | null;
  unit: string | null;
  initialDate: string | null;
  initialValueType: number | null;
  initialShift: number | null;
  items: { id: number; name: string }[] | null;
  allowInput: boolean | null;
  allowAddItem: boolean | null;
  applicableIssueTypes: number[];
};

export type MockWebhook = {
  id: number;
  name: string;
  description: string | null;
  hookUrl: string;
  allEvent: boolean;
  activityTypeIds: number[];
};

export type MockProject = {
  id: number;
  projectKey: string;
  name: string;
  settings: Record<string, string | boolean>;
  issueCount: number;
  issueTypes: MockIssueType[];
  statuses: MockStatus[];
  categories: MockCategory[];
  milestones: MockMilestone[];
  customFields: MockCustomField[];
  webhooks: MockWebhook[];
  teams: MockTeam[];
  members: MockUser[];
  administrators: MockUser[];
};

export type MockProjectInput = {
  key: string;
  name: string;
  issueCount?: number;
  settings?: Record<string, string | boolean>;
  categories?: string[];
  members?: string[];
  administrators?: string[];
  teams?: string[];
};

/** 応答の代わりにこの失敗を返す規則。合致した要求は状態を進めない */
export type MockFailure = {
  method: MockMethod;
  path: string;
  status?: number;
  message: string;
};

export type MockBacklogOptions = {
  executor?: MockUser;
  rateLimit?: { limit: number; remaining: number; reset: number };
  spaceUsers?: MockUser[];
  spaceTeams?: { name: string; members?: string[] }[];
  projects?: MockProjectInput[];
  failures?: MockFailure[];
};

export type MockResponse = {
  url: string;
  status: number;
  statusText: string;
  headers: { get: (name: string) => string | null };
  json: () => Promise<unknown>;
};

export type MockFetch = (
  url: string,
  init?: { method?: string; body?: string },
) => Promise<MockResponse>;

export type MockBacklog = {
  fetch: MockFetch;
  /** 送られた要求のすべて。GET と更新系を分けて見るための元 */
  requests: MockRequest[];
  reads: MockRequest[];
  /** 更新系だけ。`[]` であることが「Backlog は一切変更されていない」の裏取りになる */
  writes: MockRequest[];
  project: (key: string) => MockProject | undefined;
};

/** 既定の課題種別4件（実測。research「課題種別」） */
const DEFAULT_ISSUE_TYPES_JA: { name: string; color: string }[] = [
  { name: "タスク", color: "#7ea800" },
  { name: "バグ", color: "#990000" },
  { name: "要望", color: "#ff9200" },
  { name: "その他", color: "#2779ca" },
];

/** 既定ステータスは全プロジェクト共通で ID 1〜4 の固定値（実測） */
const LAST_DEFAULT_STATUS_ID = 4;

/**
 * 実 API は既定ステータスの更新に `No such status`、削除に
 * `Default status cannot be deleted. id: N` を返す（research「ステータス」）。
 * 受け付ける実装にすると、適用順序 §6 フェーズ3の「既定4つには何もしない」を
 * 破る計画でも受け入れが通ってしまう。
 */
const isDefaultStatus = ({ id }: MockStatus): boolean => id <= LAST_DEFAULT_STATUS_ID;

const FIRST_GENERATED_ID = 1000;

const NOT_FOUND = 404;

const BAD_REQUEST = 400;

type Failure = { status: number; message: string };

const failWith = (status: number, message: string): never => {
  throw { status, message } as Failure;
};

const isFailure = (value: unknown): value is Failure =>
  typeof value === "object" && value !== null && "status" in value && "message" in value;

/**
 * `URLSearchParams` を使わない。`packages/test-utils` は基底の tsconfig
 * （`lib: ES2022` / `types: []`）を継承しており、実行環境固有のグローバルは
 * 型として存在しない。
 */
const parseFormBody = (body: string): Record<string, unknown> => {
  const params: Record<string, unknown> = {};

  if (body === "") {
    return params;
  }

  for (const pair of body.split("&")) {
    const separator = pair.indexOf("=");
    const rawKey = separator === -1 ? pair : pair.slice(0, separator);
    const rawValue = separator === -1 ? "" : pair.slice(separator + 1);
    const key = decodeURIComponent(rawKey.replaceAll("+", " "));
    const value = decodeURIComponent(rawValue.replaceAll("+", " "));

    if (key.endsWith("[]")) {
      const name = key.slice(0, -2);
      const current = params[name];

      params[name] = Array.isArray(current) ? [...current, value] : [value];

      continue;
    }

    params[key] = value;
  }

  return params;
};

const text = (params: Record<string, unknown>, field: string): string | undefined => {
  const value = params[field];

  return typeof value === "string" ? value : undefined;
};

const flag = (params: Record<string, unknown>, field: string): boolean | undefined => {
  const value = text(params, field);

  return value === undefined ? undefined : value === "true";
};

const digits = (params: Record<string, unknown>, field: string): number | undefined => {
  const value = text(params, field);

  return value === undefined ? undefined : Number(value);
};

/**
 * `key[]=` の1件だけを空配列として読む。送信層は空配列をこの形に変換する
 * （API 制約「空配列を送る方法」）ので、`[""]` のまま扱うと絞りの解除が
 * 「空文字という値が1つ」に化ける。
 */
const list = (params: Record<string, unknown>, field: string): string[] | undefined => {
  const value = params[field];

  if (typeof value === "string") {
    return value === "" ? [] : [value];
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value.map((item) => String(item));

  return items.length === 1 && items[0] === "" ? [] : items;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** 日付は `yyyy-MM-ddT00:00:00Z` で返る（実測） */
const asStoredDate = (value: string | undefined): string | null => {
  if (value === undefined) {
    return null;
  }

  return DATE_ONLY.test(value) ? `${value}T00:00:00Z` : value;
};

/**
 * 本文の値はすべて文字列として届くので、Backlog が返す型に戻す。戻さないと
 * 適用直後の plan で「`true` と `"true"` が違う」という差分が出て、AC-8 が
 * モックの都合で落ちる。
 */
const settingValue = (value: string): string | boolean => {
  if (value === "true") {
    return true;
  }

  return value === "false" ? false : value;
};

const settingsOf = (params: Record<string, unknown>): Record<string, string | boolean> => {
  const settings: Record<string, string | boolean> = {};

  for (const [key, value] of Object.entries(params)) {
    if (key !== "key" && key !== "name" && typeof value === "string") {
      settings[key] = settingValue(value);
    }
  }

  return settings;
};

/** 数値型のカスタム属性は `min` / `max` / `initialValue` が Number（API 制約） */
const NUMBER_CUSTOM_FIELD_TYPE_ID = 3;

const projectBody = (project: MockProject): Record<string, unknown> => ({
  id: project.id,
  projectKey: project.projectKey,
  name: project.name,
  ...project.settings,
});

const range = (
  params: Record<string, unknown>,
  field: string,
  typeId: number,
): number | string | null => {
  const value = text(params, field);

  if (value === undefined) {
    return null;
  }

  return typeId === NUMBER_CUSTOM_FIELD_TYPE_ID ? Number(value) : asStoredDate(value);
};

const OK = 200;

const respond = (url: string, status: number, body: unknown): MockResponse => ({
  url,
  status,
  statusText: status === OK ? "OK" : "Error",
  headers: { get: () => null },
  json: () => Promise.resolve(body),
});

export const mockBacklog = (options: MockBacklogOptions = {}): MockBacklog => {
  const requests: MockRequest[] = [];
  const reads: MockRequest[] = [];
  const writes: MockRequest[] = [];
  const failures = options.failures ?? [];
  const executor = options.executor ?? { id: 1, userId: "yamada", roleType: 1 };
  const rateLimit = options.rateLimit ?? { limit: 150, remaining: 150, reset: 0 };

  let lastId = FIRST_GENERATED_ID;

  const identify = (): number => {
    lastId += 1;

    return lastId;
  };

  const spaceUsers: MockUser[] = options.spaceUsers ?? [executor];
  const spaceTeams: MockSpaceTeam[] = (options.spaceTeams ?? []).map(({ name, members }) => ({
    id: identify(),
    name,
    members: (members ?? []).flatMap((userId) =>
      spaceUsers.filter((user) => user.userId === userId),
    ),
  }));

  const userById = (id: number): MockUser | undefined => spaceUsers.find((user) => user.id === id);

  const teamById = (id: number): MockSpaceTeam | undefined =>
    spaceTeams.find((team) => team.id === id);

  /**
   * 表示順の2番目に、1番目より小さい ID を置く（実測）。ID の昇順で返すと、
   * 「返ってきた順で枠を割り当てる」（§4.1）が ID 順の割り当てでも通ってしまい、
   * 枠方式が並びに依存していることをテストが確かめられなくなる。
   */
  const defaultIssueTypes = (): MockIssueType[] => {
    const ids = DEFAULT_ISSUE_TYPES_JA.map(() => identify());
    const [first, second, ...rest] = ids;
    const displayed = [second, first, ...rest];

    return DEFAULT_ISSUE_TYPES_JA.map(({ name, color }, slot) => ({
      id: displayed[slot] ?? identify(),
      name,
      color,
      templateSummary: null,
      templateDescription: null,
    }));
  };

  const projects: MockProject[] = (options.projects ?? []).map((input) => ({
    id: identify(),
    projectKey: input.key,
    name: input.name,
    settings: input.settings ?? {},
    issueCount: input.issueCount ?? 0,
    issueTypes: defaultIssueTypes(),
    statuses: DEFAULT_STATUSES_JA.map((status) => ({ ...status })),
    categories: (input.categories ?? []).map((name) => ({ id: identify(), name })),
    milestones: [],
    customFields: [],
    webhooks: [],
    teams: (input.teams ?? []).flatMap((name) =>
      spaceTeams.filter((team) => team.name === name).map(({ id }) => ({ id, name })),
    ),
    members: (input.members ?? []).flatMap((userId) =>
      spaceUsers.filter((user) => user.userId === userId),
    ),
    administrators: (input.administrators ?? []).flatMap((userId) =>
      spaceUsers.filter((user) => user.userId === userId),
    ),
  }));

  const projectByKey = (key: string): MockProject =>
    projects.find((project) => project.projectKey === key) ??
    failWith(NOT_FOUND, `No project named ${key}.`);

  const memberOf = <Item extends { id: number }>(items: Item[], id: number): Item =>
    items.find((item) => item.id === id) ?? failWith(NOT_FOUND, `No such resource: ${id}`);

  const createProject = (params: Record<string, unknown>): MockProject => {
    const key = text(params, "key") ?? failWith(BAD_REQUEST, "key is required.");
    const name = text(params, "name") ?? failWith(BAD_REQUEST, "name is required.");

    if (projects.some((project) => project.projectKey === key)) {
      failWith(BAD_REQUEST, `The project key ${key} is already taken.`);
    }

    const project: MockProject = {
      id: identify(),
      projectKey: key,
      name,
      settings: settingsOf(params),
      issueCount: 0,
      issueTypes: defaultIssueTypes(),
      statuses: DEFAULT_STATUSES_JA.map((status) => ({ ...status })),
      categories: [],
      milestones: [],
      customFields: [],
      webhooks: [],
      teams: [],
      members: [],
      administrators: [],
    };

    projects.push(project);

    return project;
  };

  const updateIssueType = (
    issueType: MockIssueType,
    params: Record<string, unknown>,
  ): MockIssueType => {
    issueType.name = text(params, "name") ?? issueType.name;
    issueType.color = text(params, "color") ?? issueType.color;
    issueType.templateSummary = text(params, "templateSummary") ?? issueType.templateSummary;
    issueType.templateDescription =
      text(params, "templateDescription") ?? issueType.templateDescription;

    return issueType;
  };

  /**
   * 新規カスタムステータスは「完了」（ID 4）の直前に入る（実測）。末尾に足すと、
   * 記述順どおりに書いたマニフェストでも並べ替えが要る計画になり、
   * 適用順序 §6 が前提にしている挙動と食い違う。
   */
  const insertStatus = (project: MockProject, status: MockStatus): MockStatus => {
    const last = project.statuses.findIndex(({ id }) => id === LAST_DEFAULT_STATUS_ID);

    project.statuses.splice(last === -1 ? project.statuses.length : last, 0, status);

    return status;
  };

  const reorderStatuses = (project: MockProject, order: string[]): MockStatus[] => {
    const ordered = order.flatMap((id) =>
      project.statuses.filter((status) => status.id === Number(id)),
    );

    if (ordered.length !== project.statuses.length) {
      failWith(BAD_REQUEST, "statusId must contain every status of the project.");
    }

    project.statuses = ordered;

    return ordered;
  };

  const customFieldBody = (
    params: Record<string, unknown>,
    id: number,
    current: MockCustomField | undefined,
  ): MockCustomField => {
    const typeId = digits(params, "typeId") ?? current?.typeId ?? BAD_REQUEST;
    const items = list(params, "items");
    const applicable = list(params, "applicableIssueTypes");

    return {
      id,
      name: text(params, "name") ?? current?.name ?? "",
      typeId,
      description: text(params, "description") ?? current?.description ?? null,
      required: flag(params, "required") ?? current?.required ?? false,
      min: range(params, "min", typeId) ?? current?.min ?? null,
      max: range(params, "max", typeId) ?? current?.max ?? null,
      initialValue: digits(params, "initialValue") ?? current?.initialValue ?? null,
      unit: text(params, "unit") ?? current?.unit ?? null,
      initialDate: asStoredDate(text(params, "initialDate")) ?? current?.initialDate ?? null,
      initialValueType: digits(params, "initialValueType") ?? current?.initialValueType ?? null,
      initialShift: digits(params, "initialShift") ?? current?.initialShift ?? null,
      items:
        items === undefined
          ? (current?.items ?? null)
          : items.map((name) => ({ id: identify(), name })),
      allowInput: flag(params, "allowInput") ?? current?.allowInput ?? null,
      allowAddItem: flag(params, "allowAddItem") ?? current?.allowAddItem ?? null,
      applicableIssueTypes:
        applicable === undefined
          ? (current?.applicableIssueTypes ?? [])
          : applicable.map((id_) => Number(id_)),
    };
  };

  const webhookBody = (
    params: Record<string, unknown>,
    id: number,
    current: MockWebhook | undefined,
  ): MockWebhook => {
    const allEvent = flag(params, "allEvent") ?? current?.allEvent ?? false;

    return {
      id,
      name: text(params, "name") ?? current?.name ?? "",
      description: text(params, "description") ?? current?.description ?? null,
      hookUrl: text(params, "hookUrl") ?? current?.hookUrl ?? "",
      allEvent,
      activityTypeIds: allEvent
        ? []
        : (list(params, "activityTypeIds") ?? []).map((id_) => Number(id_)),
    };
  };

  const milestoneBody = (
    params: Record<string, unknown>,
    id: number,
    current: MockMilestone | undefined,
  ): MockMilestone => ({
    id,
    name: text(params, "name") ?? current?.name ?? "",
    description: text(params, "description") ?? current?.description ?? null,
    startDate: asStoredDate(text(params, "startDate")) ?? current?.startDate ?? null,
    releaseDueDate: asStoredDate(text(params, "releaseDueDate")) ?? current?.releaseDueDate ?? null,
  });

  const readSpace = (path: string): unknown => {
    if (path === "/api/v2/users/myself") {
      return executor;
    }

    if (path === "/api/v2/rateLimit") {
      return {
        rateLimit: { read: rateLimit, update: rateLimit, search: rateLimit, icon: rateLimit },
      };
    }

    if (path === "/api/v2/users") {
      return spaceUsers;
    }

    if (path === "/api/v2/teams") {
      return spaceTeams;
    }

    const counted = /^\/api\/v2\/issues\/count\?projectId\[\]=(\d+)$/.exec(path);

    if (counted !== null) {
      const id = Number(counted[1]);
      const project =
        projects.find((candidate) => candidate.id === id) ??
        failWith(NOT_FOUND, `No project with id ${id}.`);

      return { count: project.issueCount };
    }

    return undefined;
  };

  /**
   * `excludeGroupMembers=true` が無ければチーム経由の参加者まで返る（要件定義 §6 フェーズ7）。
   * 常に個人参加者だけを返すと、問い合わせ側が付け忘れても受け入れが気づけない。
   */
  const projectUsers = (project: MockProject, query: string): MockUser[] => {
    if (query.includes("excludeGroupMembers=true")) {
      return project.members;
    }

    const joined = new Map(project.members.map((user) => [user.id, user]));

    for (const { id } of project.teams) {
      for (const user of teamById(id)?.members ?? []) {
        joined.set(user.id, user);
      }
    }

    return [...joined.values()];
  };

  const readProject = (path: string): unknown => {
    const matched = /^\/api\/v2\/projects\/([^/?]+)(\/[^?]*)?(\?.*)?$/.exec(path);

    if (matched === null) {
      return undefined;
    }

    const project = projectByKey(matched[1] ?? "");
    const section = matched[2] ?? "";
    const query = matched[3] ?? "";

    if (section === "") {
      return projectBody(project);
    }

    if (section === "/issueTypes") {
      return project.issueTypes;
    }

    if (section === "/statuses") {
      return project.statuses;
    }

    if (section === "/categories") {
      return project.categories;
    }

    if (section === "/versions") {
      return project.milestones;
    }

    if (section === "/customFields") {
      return project.customFields;
    }

    if (section === "/webhooks") {
      return project.webhooks;
    }

    if (section === "/teams") {
      return project.teams;
    }

    if (section === "/administrators") {
      return project.administrators;
    }

    return section === "/users" ? projectUsers(project, query) : undefined;
  };

  const writeProject = (
    method: MockMethod,
    path: string,
    params: Record<string, unknown>,
  ): unknown => {
    if (path === "/api/v2/projects" && method === "POST") {
      return projectBody(createProject(params));
    }

    const matched = /^\/api\/v2\/projects\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(path);

    if (matched === null) {
      return undefined;
    }

    const project = projectByKey(matched[1] ?? "");
    const [section, member] = matched.slice(2);

    if (section === undefined) {
      project.name = text(params, "name") ?? project.name;
      project.settings = { ...project.settings, ...settingsOf(params) };

      return projectBody(project);
    }

    if (section === "issueTypes") {
      if (member === undefined) {
        const created = updateIssueType(
          {
            id: identify(),
            name: "",
            color: "",
            templateSummary: null,
            templateDescription: null,
          },
          params,
        );

        project.issueTypes.push(created);

        return created;
      }

      const target = memberOf(project.issueTypes, Number(member));

      if (method === "DELETE") {
        if (digits(params, "substituteIssueTypeId") === target.id) {
          failWith(BAD_REQUEST, "deletedTargetIssueTypeId and substituteIssueTypeId are the same.");
        }

        project.issueTypes = project.issueTypes.filter(({ id }) => id !== target.id);

        return target;
      }

      return updateIssueType(target, params);
    }

    if (section === "statuses") {
      if (member === "updateDisplayOrder") {
        return reorderStatuses(project, list(params, "statusId") ?? []);
      }

      if (member === undefined) {
        return insertStatus(project, {
          id: identify(),
          name: text(params, "name") ?? "",
          color: text(params, "color") ?? "",
        });
      }

      const target = memberOf(project.statuses, Number(member));

      if (method === "DELETE") {
        if (isDefaultStatus(target)) {
          failWith(BAD_REQUEST, `Default status cannot be deleted. id: ${target.id}`);
        }

        if (digits(params, "substituteStatusId") === undefined) {
          failWith(BAD_REQUEST, "substituteStatusId is required.");
        }

        project.statuses = project.statuses.filter(({ id }) => id !== target.id);

        return target;
      }

      if (isDefaultStatus(target)) {
        failWith(NOT_FOUND, "No such status");
      }

      target.name = text(params, "name") ?? target.name;
      target.color = text(params, "color") ?? target.color;

      return target;
    }

    if (section === "categories") {
      if (member === undefined) {
        const created = { id: identify(), name: text(params, "name") ?? "" };

        project.categories.push(created);

        return created;
      }

      const target = memberOf(project.categories, Number(member));

      if (method === "DELETE") {
        project.categories = project.categories.filter(({ id }) => id !== target.id);

        return target;
      }

      target.name = text(params, "name") ?? target.name;

      return target;
    }

    if (section === "versions") {
      if (member === undefined) {
        const created = milestoneBody(params, identify(), undefined);

        project.milestones.push(created);

        return created;
      }

      const target = memberOf(project.milestones, Number(member));

      if (method === "DELETE") {
        project.milestones = project.milestones.filter(({ id }) => id !== target.id);

        return target;
      }

      const updated = milestoneBody(params, target.id, target);

      project.milestones = project.milestones.map((item) =>
        item.id === target.id ? updated : item,
      );

      return updated;
    }

    if (section === "customFields") {
      if (member === undefined) {
        const created = customFieldBody(params, identify(), undefined);

        project.customFields.push(created);

        return created;
      }

      const target = memberOf(project.customFields, Number(member));

      if (method === "DELETE") {
        project.customFields = project.customFields.filter(({ id }) => id !== target.id);

        return target;
      }

      const updated = customFieldBody(params, target.id, target);

      project.customFields = project.customFields.map((item) =>
        item.id === target.id ? updated : item,
      );

      return updated;
    }

    if (section === "webhooks") {
      if (member === undefined) {
        const created = webhookBody(params, identify(), undefined);

        project.webhooks.push(created);

        return created;
      }

      const target = memberOf(project.webhooks, Number(member));

      if (method === "DELETE") {
        project.webhooks = project.webhooks.filter(({ id }) => id !== target.id);

        return target;
      }

      const updated = webhookBody(params, target.id, target);

      project.webhooks = project.webhooks.map((item) => (item.id === target.id ? updated : item));

      return updated;
    }

    if (section === "teams") {
      const id = digits(params, "teamId") ?? failWith(BAD_REQUEST, "teamId is required.");
      const team = teamById(id) ?? failWith(NOT_FOUND, `No team with id ${id}.`);

      if (method === "DELETE") {
        project.teams = project.teams.filter((joined) => joined.id !== team.id);

        return { id: team.id, name: team.name };
      }

      project.teams.push({ id: team.id, name: team.name });

      return { id: team.id, name: team.name };
    }

    if (section === "users" || section === "administrators") {
      const id = digits(params, "userId") ?? failWith(BAD_REQUEST, "userId is required.");
      const user = userById(id) ?? failWith(NOT_FOUND, `No user with id ${id}.`);
      if (section === "users") {
        const kept = project.members.filter((joined) => joined.id !== user.id);

        project.members = method === "DELETE" ? kept : [...kept, user];

        return user;
      }

      /**
       * チーム経由のみの参加者には管理者を付与できない（実測。`No such project member`）。
       * 通す実装にすると、フェーズ7が「管理者の未参加者を必ず個人参加させる」順序で
       * 並んでいることを受け入れが確かめられなくなる。
       */
      if (method !== "DELETE" && !project.members.some((joined) => joined.id === user.id)) {
        failWith(BAD_REQUEST, "No such project member.");
      }

      const kept = project.administrators.filter((joined) => joined.id !== user.id);

      project.administrators = method === "DELETE" ? kept : [...kept, user];

      return user;
    }

    return undefined;
  };

  const handle = (request: MockRequest): unknown => {
    const failure = failures.find(
      (rule) => rule.method === request.method && rule.path === request.path,
    );

    if (failure !== undefined) {
      failWith(failure.status ?? BAD_REQUEST, failure.message);
    }

    const handled =
      request.method === "GET"
        ? (readSpace(request.path) ?? readProject(request.path))
        : writeProject(request.method, request.path, request.params);

    return handled ?? failWith(NOT_FOUND, `No route for ${request.method} ${request.path}.`);
  };

  const fetch: MockFetch = (url, init) => {
    const method = (init?.method ?? "GET") as MockMethod;
    const path = decodeURIComponent(url)
      .replace(/^https:\/\/[^/]+/, "")
      .replace(/\?$/, "");
    const body = init?.body ?? "";
    const request: MockRequest = { method, path, params: parseFormBody(body), body };

    requests.push(request);
    (method === "GET" ? reads : writes).push(request);

    try {
      return Promise.resolve(respond(url, OK, handle(request)));
    } catch (error) {
      if (!isFailure(error)) {
        throw error;
      }

      return Promise.resolve(respond(url, error.status, { errors: [{ message: error.message }] }));
    }
  };

  return {
    fetch,
    requests,
    reads,
    writes,
    project: (key) => projects.find((project) => project.projectKey === key),
  };
};

/**
 * X-1 の1秒間隔をそのまま待つと、受け入れ1本ごとに更新系の件数ぶんの実時間がかかる
 * （AC-1 の適用だけで20秒を超える）。間隔そのものは Executor の仕様なので消さず、
 * 待ち時間だけを潰す。
 */
export const withoutWritePacing = async <T>(run: () => Promise<T>): Promise<T> => {
  const original = globalThis.setTimeout;

  globalThis.setTimeout = ((callback: () => void) =>
    original(callback, 0)) as typeof globalThis.setTimeout;

  try {
    return await run();
  } finally {
    globalThis.setTimeout = original;
  }
};
