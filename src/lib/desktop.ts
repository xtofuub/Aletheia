import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";

export type Theme = "dark" | "light" | "system";

export interface Settings {
  authorizationConfirmed: boolean;
  theme: Theme;
  storageRoot: string;
  networkDisabled: boolean;
  clipboardClearSeconds: number;
  inactivityLockMinutes: number;
  workerLimit: number;
  memoryLimitMb: number;
  automaticUpdateChecks: boolean;
}

export interface SystemStatus {
  databaseReady: boolean;
  offline: boolean;
  metadataBytes: number;
  indexBytes: number;
  datasetCount: number;
  indexedDocuments: number;
  orphanedIndex: boolean;
  storageRoot: string;
  appVersion: string;
}

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
  releaseNotes: string | null;
}

export interface UpdateInstallProgress {
  state: "checking" | "downloading" | "installing" | "restarting";
  downloadedBytes: number;
  totalBytes: number | null;
}

export interface OnboardingInput {
  authorizationConfirmed: boolean;
  storageRoot: string;
}

export type SourceFormat =
  "text" | "csv" | "tsv" | "delimited" | "jsonl" | "gzip";

export type FieldType =
  | "email"
  | "username"
  | "first_name"
  | "last_name"
  | "full_name"
  | "phone"
  | "ip_address"
  | "domain"
  | "url"
  | "password"
  | "password_hash"
  | "salt"
  | "date_of_birth"
  | "address"
  | "city"
  | "country"
  | "postal_code"
  | "company"
  | "job_title"
  | "user_id"
  | "timestamp"
  | "unknown";

export interface FieldMapping {
  sourceName: string;
  fieldType: FieldType;
  confidence: number;
  isSensitive: boolean;
}

export interface PreviewRow {
  sourceLocation: number;
  values: string[];
}

export interface FileInspection {
  absolutePath: string;
  relativePath: string;
  fileName: string;
  fileSize: number;
  modifiedAt: string | null;
  format: SourceFormat;
  compressed: boolean;
  encoding: string;
  lineEnding: string;
  delimiter: string | null;
  hasHeader: boolean;
  estimatedRecords: number | null;
  columnCount: number;
  rowConsistency: number;
  mappings: FieldMapping[];
  preview: PreviewRow[];
  warnings: string[];
  eligible: boolean;
}

export interface InspectionResult {
  files: FileInspection[];
  rejectedPaths: string[];
  totalBytes: number;
}

export interface ImportOptions {
  skipInvalidRows: boolean;
  stopOnSevereError: boolean;
  extractUrls: boolean;
  extractDomains: boolean;
  groupIdentities: boolean;
  deduplicate: boolean;
  storeOffsets: boolean;
}

export interface ImportPlan {
  datasetLabel: string;
  authorizationNote: string;
  files: FileInspection[];
  options: ImportOptions;
}

export interface ImportStartResult {
  jobId: string;
  datasetId: string;
}

export interface ImportProgress {
  jobId: string;
  datasetId: string;
  status:
    | "queued"
    | "running"
    | "paused"
    | "cancelling"
    | "cancelled"
    | "interrupted"
    | "completed"
    | "failed";
  currentFile: string | null;
  bytesRead: number;
  totalBytes: number;
  recordsProcessed: number;
  recordsIndexed: number;
  invalidRecords: number;
  duplicateRecords: number;
  message: string;
}

export interface DatasetSummary {
  id: string;
  name: string;
  status: string;
  recordCount: number;
  fileCount: number;
  totalBytes: number;
  warningCount: number;
  createdAt: string;
  lastIndexedAt: string | null;
}

export interface CreateLiveSourceInput {
  name: string;
  paths: string[];
  includeArchives: boolean;
}

export interface LiveSourceSummary {
  id: string;
  name: string;
  paths: string[];
  includeArchives: boolean;
  createdAt: string;
}

export interface LiveSearchActivity {
  jobId: string;
  sourceId: string;
  sourceName: string;
  matches: number;
  filesScanned: number;
  bytesScanned: number;
  completedAt: string;
}

export interface OverviewStats {
  identityGroupCount: number;
  parentDomainCount: number;
}

export type SearchMode = "exact" | "contains" | "prefix";

export interface SearchRequest {
  query: string;
  mode: SearchMode;
  datasetId: string | null;
  fieldType: FieldType | null;
  offset: number;
  limit: number;
}

export interface SearchField {
  name: string;
  fieldType: FieldType;
  displayValue: string;
  sensitive: boolean;
}

export interface SearchHit {
  recordId: string;
  datasetId: string;
  datasetName: string;
  sourceFileId: string;
  sourceFile: string;
  sourceLocation: string;
  parser: string;
  matchReason: string;
  fields: SearchField[];
}

export interface SearchResponse {
  total: number;
  offset: number;
  hits: SearchHit[];
}

export interface DirectSearchRequest {
  paths: string[];
  query: string;
  mode: SearchMode;
  caseSensitive: boolean;
  includeArchives: boolean;
  maxResults: number;
  workerLimit: number;
}

export interface DirectSearchStart {
  jobId: string;
  sourceCount: number;
  totalBytes: number;
  queryCount: number;
}

export interface DirectSearchHit {
  id: string;
  sourcePath: string;
  sourceFile: string;
  archiveEntry: string | null;
  sourceLocation: string;
  excerpt: string;
  matchReason: string;
  matchedQuery: string;
}

export interface DirectSearchProgress {
  jobId: string;
  sequence: number;
  status:
    "running" | "paused" | "cancelling" | "cancelled" | "completed" | "failed";
  currentSource: string | null;
  sourceCount: number;
  filesScanned: number;
  totalBytes: number;
  sourceBytesScanned: number;
  contentBytesScanned: number;
  matches: number;
  elapsedMs: number;
  bytesPerSecond: number;
  estimatedRemainingMs: number | null;
  queryCount: number;
  truncated: boolean;
  message: string;
  hits: DirectSearchHit[];
}

export interface DomainSummary {
  id: string;
  hostname: string;
  registrableDomain: string;
  publicSuffix: string | null;
  isSubdomain: boolean;
  recordCount: number;
}

export interface DomainGroupSummary {
  registrableDomain: string;
  publicSuffix: string | null;
  hostnameCount: number;
  recordCount: number;
}

export interface DomainSearchResponse {
  total: number;
  offset: number;
  groups: DomainGroupSummary[];
}

export interface DomainBreachSummary {
  datasetId: string;
  datasetName: string;
  recordCount: number;
}

export interface DomainRecordSummary {
  recordId: string;
  datasetId: string;
  datasetName: string;
  sourceFile: string;
  sourceLocation: string;
  parser: string;
  fields: SearchField[];
}

export interface DomainDetailsResponse {
  registrableDomain: string;
  selectedHostname: string | null;
  hostnames: DomainSummary[];
  breaches: DomainBreachSummary[];
  totalRecords: number;
  recordOffset: number;
  records: DomainRecordSummary[];
}

export interface SaveLiveDomainEvidenceInput {
  domain: string;
  sourceId: string;
  sourceName: string;
  evidence: DirectSearchHit[];
}

export interface LiveDomainCollectionSummary {
  registrableDomain: string;
  sourceCount: number;
  evidenceCount: number;
  updatedAt: string;
}

export interface LiveDomainCollectionResponse {
  total: number;
  offset: number;
  collections: LiveDomainCollectionSummary[];
}

export interface StoredLiveDomainEvidence extends DirectSearchHit {
  sourceId: string;
  sourceName: string;
  createdAt: string;
}

export interface LiveDomainEvidenceResponse {
  registrableDomain: string;
  total: number;
  offset: number;
  evidence: StoredLiveDomainEvidence[];
}

export interface IdentitySummary {
  id: string;
  displayLabel: string;
  confidenceLevel: string;
  memberCount: number;
  linkType: string;
  explanation: string;
  userStatus: string;
}

export interface IdentityMember {
  recordId: string;
  origin: "indexed" | "live";
  datasetName: string;
  sourceFile: string;
  sourcePath: string | null;
  sourceLocation: string;
  userStatus: string;
  fields: SearchField[];
}

export interface IdentityMembersResponse {
  total: number;
  offset: number;
  members: IdentityMember[];
}

export interface IdentityActionInput {
  action: "confirm" | "reject" | "merge" | "split" | "undo";
  groupId: string;
  recordIds: string[];
  targetGroupId: string | null;
}

export interface ManualIdentityInput {
  name: string;
  recordIds: string[];
  liveEvidence: LiveIdentityEvidenceInput[];
}

export interface LiveIdentityEvidenceInput {
  sourcePath: string;
  sourceFile: string;
  archiveEntry: string | null;
  sourceLocation: string;
  excerpt: string;
  matchReason: string;
}

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  filtersJson: string;
  createdAt: string;
}

export type ExportFormat = "csv" | "json" | "jsonl" | "markdown";

export interface ExportRequest {
  destinationPath: string;
  format: ExportFormat;
  recordIds: string[];
  maskEmailLocalPart: boolean;
}

export interface ExportResult {
  exportId: string;
  destinationPath: string;
  manifestPath: string;
  recordCount: number;
}

export interface ExportHistoryItem {
  id: string;
  format: string;
  destinationPath: string;
  recordCount: number;
  createdAt: string;
}

export interface CleanupRequest {
  index: boolean;
  cache: boolean;
  temp: boolean;
  searchHistory: boolean;
  allGenerated: boolean;
}

export interface SecuritySettingsInput {
  clipboardClearSeconds: number;
  inactivityLockMinutes: number;
  workerLimit: number;
  memoryLimitMb: number;
  automaticUpdateChecks: boolean;
}

const browserSettingsKey = "aletheia.browser.settings";
const browserEfferdThemeKey = "aletheia.browser.efferd-theme-v1";
const browserExportsKey = "aletheia.browser.exports";
const browserSearchHistoryKey = "aletheia.browser.search-history";
const defaultBrowserSettings: Settings = {
  authorizationConfirmed: false,
  theme: "dark",
  storageRoot: "C:\\Aletheia Workspace",
  networkDisabled: true,
  clipboardClearSeconds: 60,
  inactivityLockMinutes: 15,
  workerLimit: 2,
  memoryLimitMb: 512,
  automaticUpdateChecks: true,
};

export function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

function readBrowserSettings(): Settings {
  const stored = window.localStorage.getItem(browserSettingsKey);
  let next = { ...defaultBrowserSettings };
  try {
    if (stored) {
      next = { ...next, ...(JSON.parse(stored) as Settings) };
    }
  } catch {
    next = { ...defaultBrowserSettings };
  }

  // Apply the new dark-first visual system once without overriding later choices.
  if (!window.localStorage.getItem(browserEfferdThemeKey)) {
    next.theme = "dark";
    window.localStorage.setItem(browserEfferdThemeKey, "1");
    window.localStorage.setItem("aletheia.theme", "dark");
    window.localStorage.setItem(browserSettingsKey, JSON.stringify(next));
  }

  return next;
}

export async function getSettings(): Promise<Settings> {
  if (isTauriRuntime()) {
    return invoke<Settings>("get_settings");
  }
  return readBrowserSettings();
}

export async function saveOnboarding(
  input: OnboardingInput,
): Promise<Settings> {
  if (isTauriRuntime()) {
    return invoke<Settings>("save_onboarding", { input });
  }
  const next = {
    ...readBrowserSettings(),
    authorizationConfirmed: input.authorizationConfirmed,
    storageRoot: input.storageRoot,
  };
  window.localStorage.setItem(browserSettingsKey, JSON.stringify(next));
  return next;
}

export async function updateTheme(theme: Theme): Promise<void> {
  window.localStorage.setItem("aletheia.theme", theme);
  if (isTauriRuntime()) {
    await invoke("update_theme", { theme });
    return;
  }
  window.localStorage.setItem(
    browserSettingsKey,
    JSON.stringify({ ...readBrowserSettings(), theme }),
  );
}

export async function getSystemStatus(): Promise<SystemStatus> {
  if (isTauriRuntime()) {
    return invoke<SystemStatus>("get_system_status");
  }
  const settings = readBrowserSettings();
  return {
    databaseReady: true,
    offline: true,
    metadataBytes: 0,
    indexBytes: 0,
    datasetCount: 0,
    indexedDocuments: 0,
    orphanedIndex: false,
    storageRoot: settings.storageRoot,
    appVersion: "0.1.7",
  };
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (isTauriRuntime()) {
    const [{ getVersion }, { check }] = await Promise.all([
      import("@tauri-apps/api/app"),
      import("@tauri-apps/plugin-updater"),
    ]);
    const currentVersion = await getVersion();
    const update = await check({ timeout: 15_000 });
    if (!update) {
      return {
        currentVersion,
        latestVersion: currentVersion,
        updateAvailable: false,
        releaseUrl: "https://github.com/xtofuub/Aletheia/releases",
        releaseNotes: null,
      };
    }
    try {
      const latestVersion = update.version;
      const safeVersion = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(
        latestVersion,
      )
        ? latestVersion
        : null;
      return {
        currentVersion: update.currentVersion,
        latestVersion,
        updateAvailable: true,
        releaseUrl: safeVersion
          ? `https://github.com/xtofuub/Aletheia/releases/tag/v${encodeURIComponent(safeVersion)}`
          : "https://github.com/xtofuub/Aletheia/releases",
        releaseNotes: update.body?.trim().slice(0, 2_000) || null,
      };
    } finally {
      try {
        await update.close();
      } catch {
        // The completed check result is still safe to show.
      }
    }
  }
  return {
    currentVersion: "0.1.7",
    latestVersion: "0.1.7",
    updateAvailable: false,
    releaseUrl: "https://github.com/xtofuub/Aletheia/releases",
    releaseNotes: null,
  };
}

export async function openReleasePage(releaseUrl: string): Promise<void> {
  const parsed = new URL(releaseUrl);
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
    throw new Error("The update link is not an approved GitHub URL.");
  }
  if (isTauriRuntime()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(parsed.toString());
    return;
  }
  window.open(parsed.toString(), "_blank", "noopener,noreferrer");
}

export async function downloadAndInstallUpdate(
  onProgress: (progress: UpdateInstallProgress) => void,
): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  onProgress({
    state: "checking",
    downloadedBytes: 0,
    totalBytes: null,
  });
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check({ timeout: 15_000 });
  if (!update) return false;

  let downloadedBytes = 0;
  let totalBytes: number | null = null;
  try {
    await update.downloadAndInstall(
      (event) => {
        if (event.event === "Started") {
          totalBytes = event.data.contentLength ?? null;
          onProgress({
            state: "downloading",
            downloadedBytes,
            totalBytes,
          });
          return;
        }
        if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          onProgress({
            state: "downloading",
            downloadedBytes,
            totalBytes,
          });
          return;
        }
        onProgress({
          state: "installing",
          downloadedBytes,
          totalBytes,
        });
      },
      { timeout: 120_000 },
    );
  } finally {
    try {
      await update.close();
    } catch {
      // The installer result matters more than releasing its finished handle.
    }
  }
  onProgress({
    state: "restarting",
    downloadedBytes,
    totalBytes,
  });
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
  return true;
}

export async function selectStorageFolder(current: string): Promise<string> {
  if (!isTauriRuntime()) return current;
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Choose Aletheia storage",
  });
  return typeof selected === "string" ? selected : current;
}

export async function selectSourceFiles(): Promise<string[]> {
  if (!isTauriRuntime()) {
    return [
      "C:\\Synthetic\\records_valid.csv",
      "C:\\Synthetic\\nested\\records_two.txt",
      "C:\\Synthetic\\records_three.jsonl",
    ];
  }
  const selected = await open({
    directory: false,
    multiple: true,
    title: "Choose authorized dataset files",
    filters: [
      {
        name: "Supported datasets",
        extensions: ["txt", "csv", "tsv", "jsonl", "ndjson", "log", "gz"],
      },
    ],
  });
  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}

export async function selectSourceFolder(): Promise<string[]> {
  if (!isTauriRuntime()) return ["C:\\Synthetic"];
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Choose authorized dataset folder",
  });
  return typeof selected === "string" ? [selected] : [];
}

export async function selectDirectSearchSources(
  kind: "files" | "folder",
): Promise<string[]> {
  if (!isTauriRuntime()) {
    return kind === "folder"
      ? ["C:\\Synthetic\\Authorized corpus"]
      : ["C:\\Synthetic\\Authorized corpus\\synthetic.zip"];
  }
  const selected =
    kind === "folder"
      ? await open({
          directory: true,
          multiple: false,
          title: "Choose an authorized folder to scan",
        })
      : await open({
          directory: false,
          multiple: true,
          title: "Choose authorized sources to scan",
          filters: [
            {
              name: "Searchable local sources",
              extensions: [
                "txt",
                "csv",
                "tsv",
                "jsonl",
                "ndjson",
                "log",
                "gz",
                "zip",
                "rar",
              ],
            },
          ],
        });
  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}

export async function inspectSources(
  paths: string[],
): Promise<InspectionResult> {
  if (isTauriRuntime()) {
    return invoke<InspectionResult>("inspect_sources", { paths });
  }
  return syntheticInspection(paths);
}

export async function startImport(
  plan: ImportPlan,
): Promise<ImportStartResult> {
  if (isTauriRuntime()) {
    return invoke<ImportStartResult>("start_import", { plan });
  }
  const result = {
    jobId: crypto.randomUUID(),
    datasetId: crypto.randomUUID(),
  };
  const dataset: DatasetSummary = {
    id: result.datasetId,
    name: plan.datasetLabel,
    status: "ready",
    recordCount: 3,
    fileCount: plan.files.length,
    totalBytes: plan.files.reduce((sum, file) => sum + file.fileSize, 0),
    warningCount: 0,
    createdAt: new Date().toISOString(),
    lastIndexedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(
    "aletheia.browser.datasets",
    JSON.stringify([dataset]),
  );
  return result;
}

export async function listenImportProgress(
  callback: (progress: ImportProgress) => void,
): Promise<UnlistenFn> {
  if (isTauriRuntime()) {
    return listen<ImportProgress>("import-progress", (event) =>
      callback(event.payload),
    );
  }
  return () => undefined;
}

export async function getActiveImport(): Promise<ImportProgress | null> {
  if (isTauriRuntime()) {
    return invoke<ImportProgress | null>("get_active_import");
  }
  return null;
}

export async function pauseImport(jobId: string): Promise<void> {
  if (isTauriRuntime()) await invoke("pause_import", { jobId });
}

export async function resumeImport(jobId: string): Promise<void> {
  if (isTauriRuntime()) await invoke("resume_import", { jobId });
}

export async function resumeDatasetImport(
  datasetId: string,
): Promise<ImportStartResult> {
  if (isTauriRuntime()) {
    return invoke<ImportStartResult>("resume_dataset_import", { datasetId });
  }
  return { jobId: crypto.randomUUID(), datasetId };
}

export async function cancelImport(jobId: string): Promise<void> {
  if (isTauriRuntime()) await invoke("cancel_import", { jobId });
}

export async function listDatasets(): Promise<DatasetSummary[]> {
  if (isTauriRuntime()) return invoke<DatasetSummary[]>("list_datasets");
  const stored = window.localStorage.getItem("aletheia.browser.datasets");
  return stored ? (JSON.parse(stored) as DatasetSummary[]) : [];
}

export async function deleteDataset(datasetId: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("delete_dataset", { datasetId });
    return;
  }
  const datasets = await listDatasets();
  window.localStorage.setItem(
    "aletheia.browser.datasets",
    JSON.stringify(datasets.filter((dataset) => dataset.id !== datasetId)),
  );
}

const browserLiveSourcesKey = "aletheia.browser.live-sources";
const browserLiveSearchActivityKey = "aletheia.browser.live-search-activity";

export async function listLiveSources(): Promise<LiveSourceSummary[]> {
  if (isTauriRuntime()) {
    return invoke<LiveSourceSummary[]>("list_live_sources");
  }
  const stored = window.localStorage.getItem(browserLiveSourcesKey);
  return stored ? (JSON.parse(stored) as LiveSourceSummary[]) : [];
}

export async function createLiveSource(
  input: CreateLiveSourceInput,
): Promise<LiveSourceSummary> {
  if (isTauriRuntime()) {
    return invoke<LiveSourceSummary>("create_live_source", { input });
  }
  const source: LiveSourceSummary = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    paths: input.paths,
    includeArchives: input.includeArchives,
    createdAt: new Date().toISOString(),
  };
  const current = await listLiveSources();
  window.localStorage.setItem(
    browserLiveSourcesKey,
    JSON.stringify([source, ...current]),
  );
  return source;
}

export async function deleteLiveSource(id: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("delete_live_source", { id });
    return;
  }
  const current = await listLiveSources();
  window.localStorage.setItem(
    browserLiveSourcesKey,
    JSON.stringify(current.filter((source) => source.id !== id)),
  );
}

export async function listLiveSearchActivity(): Promise<LiveSearchActivity[]> {
  const stored = window.localStorage.getItem(browserLiveSearchActivityKey);
  if (!stored) return [];
  try {
    const activity = JSON.parse(stored) as unknown;
    return Array.isArray(activity)
      ? (activity as LiveSearchActivity[]).slice(0, 50)
      : [];
  } catch {
    return [];
  }
}

export async function recordLiveSearchActivity(
  activity: LiveSearchActivity,
): Promise<void> {
  const current = await listLiveSearchActivity();
  window.localStorage.setItem(
    browserLiveSearchActivityKey,
    JSON.stringify(
      [
        activity,
        ...current.filter((item) => item.jobId !== activity.jobId),
      ].slice(0, 50),
    ),
  );
}

export async function getOverviewStats(): Promise<OverviewStats> {
  if (isTauriRuntime()) return invoke<OverviewStats>("get_overview_stats");
  const [datasets, domains, identities] = await Promise.all([
    listDatasets(),
    listDomains("", 0, 1),
    listIdentities(),
  ]);
  if (!datasets.length) {
    return { identityGroupCount: 0, parentDomainCount: 0 };
  }
  return {
    identityGroupCount: identities.length,
    parentDomainCount: domains.total,
  };
}

export async function searchRecords(
  request: SearchRequest,
): Promise<SearchResponse> {
  if (isTauriRuntime()) {
    return invoke<SearchResponse>("search_records", { request });
  }
  const storedHistory = window.localStorage.getItem(browserSearchHistoryKey);
  const history = storedHistory
    ? (JSON.parse(storedHistory) as Array<{
        query: string;
        mode: SearchMode;
        createdAt: string;
      }>)
    : [];
  window.localStorage.setItem(
    browserSearchHistoryKey,
    JSON.stringify(
      [
        {
          query: request.query,
          mode: request.mode,
          createdAt: new Date().toISOString(),
        },
        ...history,
      ].slice(0, 200),
    ),
  );
  const inlineField = request.query.match(/^([a-z_]+):(.+)$/i);
  const query = (inlineField?.[2] ?? request.query)
    .trim()
    .replace(/^"|"$/g, "")
    .toLowerCase();
  const requestedField =
    request.fieldType ??
    (inlineField?.[1]?.toLowerCase() as FieldType | undefined);
  const hit = syntheticSearchHit();
  const candidates = hit.fields
    .filter((field) => !requestedField || field.fieldType === requestedField)
    .map((field) => field.displayValue.toLowerCase());
  const looksLikeBareDomain =
    !requestedField &&
    query.includes(".") &&
    !query.includes("@") &&
    !query.includes("/");
  if (requestedField === "domain" || looksLikeBareDomain) {
    candidates.push("portal.example.com", "example.com");
  }
  const matches = candidates.some((candidate) => {
    if (request.mode === "exact") return candidate === query;
    if (request.mode === "prefix") return candidate.startsWith(query);
    return candidate.includes(query);
  });
  return {
    total: matches ? 137 : 0,
    offset: request.offset,
    hits: matches
      ? Array.from(
          {
            length: Math.max(0, Math.min(request.limit, 137 - request.offset)),
          },
          (_, index) => syntheticSearchHit(request.offset + index),
        )
      : [],
  };
}

export async function searchIdentityRecords(
  request: SearchRequest,
): Promise<SearchResponse> {
  if (isTauriRuntime()) {
    return invoke<SearchResponse>("search_identity_records", { request });
  }
  const response = await searchRecords(request);
  return {
    ...response,
    hits: response.hits.map((hit) => ({
      ...hit,
      fields: hit.fields.map((field) => ({
        ...field,
        displayValue:
          field.fieldType === "email"
            ? "synthetic@example.test"
            : field.fieldType === "phone"
              ? "+12025550142"
              : field.displayValue,
      })),
    })),
  };
}

const browserDirectSearchListeners = new Set<
  (progress: DirectSearchProgress) => void
>();

interface BrowserDirectSearchJob {
  completionTimer: number | null;
  finish: () => void;
  progress: DirectSearchProgress;
}

const browserDirectSearchJobs = new Map<string, BrowserDirectSearchJob>();

function emitBrowserDirectSearch(progress: DirectSearchProgress) {
  browserDirectSearchListeners.forEach((listener) => listener(progress));
}

function scheduleBrowserDirectSearchCompletion(jobId: string, delay = 1_800) {
  const job = browserDirectSearchJobs.get(jobId);
  if (!job) return;
  if (job.completionTimer !== null) window.clearTimeout(job.completionTimer);
  job.completionTimer = window.setTimeout(job.finish, delay);
}

export async function listenDirectSearchProgress(
  callback: (progress: DirectSearchProgress) => void,
): Promise<UnlistenFn> {
  if (isTauriRuntime()) {
    return listen<DirectSearchProgress>("direct-search-progress", (event) =>
      callback(event.payload),
    );
  }
  browserDirectSearchListeners.add(callback);
  return () => browserDirectSearchListeners.delete(callback);
}

export async function startDirectSearch(
  request: DirectSearchRequest,
): Promise<DirectSearchStart> {
  if (isTauriRuntime()) {
    return invoke<DirectSearchStart>("start_direct_search", { request });
  }
  const jobId = crypto.randomUUID();
  const started = performance.now();
  const sourceCount = Math.max(1, request.paths.length);
  const queryCount = Math.max(
    1,
    new Set(
      request.query
        .split(/\r?\n/)
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ).size,
  );
  const primaryQuery = request.query.split(/\r?\n/)[0]?.trim() ?? request.query;
  const syntheticHit: DirectSearchHit = {
    id: crypto.randomUUID(),
    sourcePath: "C:\\Synthetic\\Authorized corpus\\synthetic.zip",
    sourceFile: "synthetic-authorized-source.txt",
    archiveEntry: request.includeArchives ? "records/synthetic.txt" : null,
    sourceLocation: "line 42",
    excerpt: `synthetic@example.com portal.example.com ${primaryQuery}`,
    matchReason:
      queryCount > 1
        ? "Batch value found"
        : request.mode === "exact"
          ? "Exact field match"
          : request.mode === "prefix"
            ? "Field prefix match"
            : "Line contains query",
    matchedQuery: primaryQuery,
  };
  const syntheticSecondHit: DirectSearchHit = {
    ...syntheticHit,
    id: crypto.randomUUID(),
    archiveEntry: request.includeArchives ? "records/synthetic-2.txt" : null,
    sourceLocation: "line 84",
    excerpt: "synthetic.second@example.com:account-1002:service.example.com",
  };
  const initialProgress: DirectSearchProgress = {
    jobId,
    sequence: 0,
    status: "running",
    currentSource: request.paths[0] ?? null,
    sourceCount,
    filesScanned: 0,
    totalBytes: 128 * 1024 * 1024,
    sourceBytesScanned: 0,
    contentBytesScanned: 0,
    matches: 0,
    elapsedMs: 0,
    bytesPerSecond: 0,
    estimatedRemainingMs: 1_800,
    queryCount,
    truncated: false,
    message: "Scanning saved Live sources",
    hits: [],
  };
  const job: BrowserDirectSearchJob = {
    completionTimer: null,
    progress: initialProgress,
    finish: () => {
      const active = browserDirectSearchJobs.get(jobId);
      if (!active || active.progress.status !== "running") return;
      const progress: DirectSearchProgress = {
        ...active.progress,
        sequence: active.progress.sequence + 1,
        status: "completed",
        currentSource: null,
        filesScanned: sourceCount,
        sourceBytesScanned: 128 * 1024 * 1024,
        contentBytesScanned: 384 * 1024 * 1024,
        matches: 2,
        elapsedMs: Math.max(1, Math.round(performance.now() - started)),
        bytesPerSecond: 196 * 1024 * 1024,
        estimatedRemainingMs: null,
        message: "Live search complete",
        hits: [syntheticHit, syntheticSecondHit],
      };
      active.progress = progress;
      active.completionTimer = null;
      emitBrowserDirectSearch(progress);
      browserDirectSearchJobs.delete(jobId);
    },
  };
  browserDirectSearchJobs.set(jobId, job);
  window.setTimeout(() => {
    const active = browserDirectSearchJobs.get(jobId);
    if (!active || active.progress.status !== "running") return;
    const progress: DirectSearchProgress = {
      ...active.progress,
      sequence: active.progress.sequence + 1,
      sourceBytesScanned: 32 * 1024 * 1024,
      contentBytesScanned: 96 * 1024 * 1024,
      matches: 1,
      elapsedMs: Math.max(1, Math.round(performance.now() - started)),
      bytesPerSecond: 96 * 1024 * 1024,
      estimatedRemainingMs: 450,
      message: "Streaming matching Live lines",
      hits: [syntheticHit],
    };
    active.progress = progress;
    emitBrowserDirectSearch(progress);
  }, 100);
  scheduleBrowserDirectSearchCompletion(jobId);
  return {
    jobId,
    sourceCount,
    totalBytes: 128 * 1024 * 1024,
    queryCount,
  };
}

export async function cancelDirectSearch(jobId: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("cancel_direct_search", { jobId });
    return;
  }
  const job = browserDirectSearchJobs.get(jobId);
  if (!job) return;
  if (job.completionTimer !== null) window.clearTimeout(job.completionTimer);
  job.progress = {
    ...job.progress,
    sequence: job.progress.sequence + 1,
    status: "cancelled",
    estimatedRemainingMs: null,
    message: "Live scan cancelled",
  };
  emitBrowserDirectSearch(job.progress);
  browserDirectSearchJobs.delete(jobId);
}

export async function pauseDirectSearch(jobId: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("pause_direct_search", { jobId });
    return;
  }
  const job = browserDirectSearchJobs.get(jobId);
  if (!job || job.progress.status !== "running") return;
  if (job.completionTimer !== null) window.clearTimeout(job.completionTimer);
  job.completionTimer = null;
  job.progress = {
    ...job.progress,
    sequence: job.progress.sequence + 1,
    status: "paused",
    bytesPerSecond: 0,
    estimatedRemainingMs: null,
    message: "Live scan paused",
  };
  emitBrowserDirectSearch(job.progress);
}

export async function resumeDirectSearch(jobId: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("resume_direct_search", { jobId });
    return;
  }
  const job = browserDirectSearchJobs.get(jobId);
  if (!job || job.progress.status !== "paused") return;
  job.progress = {
    ...job.progress,
    sequence: job.progress.sequence + 1,
    status: "running",
    estimatedRemainingMs: 400,
    message: "Live scan resumed",
  };
  emitBrowserDirectSearch(job.progress);
  scheduleBrowserDirectSearchCompletion(jobId, 400);
}

const browserLiveDomainEvidenceKey = "aletheia.browser.live-domain-evidence";

function browserDomainParent(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split(/[/?#]/, 1)[0]
    ?.replace(/\.$/, "");
  return normalized || value.trim().toLowerCase();
}

function readBrowserLiveDomainEvidence(): Array<
  StoredLiveDomainEvidence & { registrableDomain: string }
> {
  const stored = window.localStorage.getItem(browserLiveDomainEvidenceKey);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored) as unknown;
    return Array.isArray(parsed)
      ? (parsed as Array<
          StoredLiveDomainEvidence & { registrableDomain: string }
        >)
      : [];
  } catch {
    return [];
  }
}

export async function saveLiveDomainEvidence(
  input: SaveLiveDomainEvidenceInput,
): Promise<LiveDomainCollectionSummary> {
  if (isTauriRuntime()) {
    return invoke<LiveDomainCollectionSummary>("save_live_domain_evidence", {
      input,
    });
  }
  const registrableDomain = browserDomainParent(input.domain);
  const current = readBrowserLiveDomainEvidence();
  const additions = input.evidence.map((hit) => ({
    ...hit,
    registrableDomain,
    sourceId: input.sourceId,
    sourceName: input.sourceName,
    createdAt: new Date().toISOString(),
  }));
  const combined = [...additions, ...current].filter(
    (item, index, values) =>
      values.findIndex(
        (candidate) =>
          candidate.registrableDomain === item.registrableDomain &&
          candidate.sourcePath === item.sourcePath &&
          candidate.archiveEntry === item.archiveEntry &&
          candidate.sourceLocation === item.sourceLocation &&
          candidate.excerpt === item.excerpt,
      ) === index,
  );
  window.localStorage.setItem(
    browserLiveDomainEvidenceKey,
    JSON.stringify(combined),
  );
  const evidence = combined.filter(
    (item) => item.registrableDomain === registrableDomain,
  );
  return {
    registrableDomain,
    sourceCount: new Set(evidence.map((item) => item.sourceId)).size,
    evidenceCount: evidence.length,
    updatedAt: evidence[0]?.createdAt ?? new Date().toISOString(),
  };
}

export async function listLiveDomainCollections(
  query = "",
  offset = 0,
  limit = 25,
): Promise<LiveDomainCollectionResponse> {
  if (isTauriRuntime()) {
    return invoke<LiveDomainCollectionResponse>(
      "list_live_domain_collections",
      {
        query,
        offset,
        limit,
      },
    );
  }
  const normalized = query.trim().toLowerCase();
  const grouped = new Map<string, StoredLiveDomainEvidence[]>();
  for (const item of readBrowserLiveDomainEvidence()) {
    if (normalized && !item.registrableDomain.startsWith(normalized)) continue;
    const values = grouped.get(item.registrableDomain) ?? [];
    values.push(item);
    grouped.set(item.registrableDomain, values);
  }
  const collections = [...grouped.entries()]
    .map(([registrableDomain, evidence]) => ({
      registrableDomain,
      sourceCount: new Set(evidence.map((item) => item.sourceId)).size,
      evidenceCount: evidence.length,
      updatedAt: evidence
        .map((item) => item.createdAt)
        .sort()
        .at(-1) as string,
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return {
    total: collections.length,
    offset,
    collections: collections.slice(offset, offset + limit),
  };
}

export async function listLiveDomainEvidence(
  domain: string,
  offset = 0,
  limit = 25,
): Promise<LiveDomainEvidenceResponse> {
  if (isTauriRuntime()) {
    return invoke<LiveDomainEvidenceResponse>("list_live_domain_evidence", {
      domain,
      offset,
      limit,
    });
  }
  const registrableDomain = browserDomainParent(domain);
  const evidence = readBrowserLiveDomainEvidence().filter(
    (item) => item.registrableDomain === registrableDomain,
  );
  return {
    registrableDomain,
    total: evidence.length,
    offset,
    evidence: evidence.slice(offset, offset + limit),
  };
}

export async function clearLiveDomainEvidence(domain: string): Promise<number> {
  if (isTauriRuntime()) {
    return invoke<number>("clear_live_domain_evidence", { domain });
  }
  const registrableDomain = browserDomainParent(domain);
  const current = readBrowserLiveDomainEvidence();
  const next = current.filter(
    (item) => item.registrableDomain !== registrableDomain,
  );
  window.localStorage.setItem(
    browserLiveDomainEvidenceKey,
    JSON.stringify(next),
  );
  return current.length - next.length;
}

const syntheticDomains: DomainSummary[] = [
  {
    id: "domain-synthetic",
    hostname: "portal.example.co.uk",
    registrableDomain: "example.co.uk",
    publicSuffix: "co.uk",
    isSubdomain: true,
    recordCount: 3,
  },
  {
    id: "domain-parent-synthetic",
    hostname: "example.co.uk",
    registrableDomain: "example.co.uk",
    publicSuffix: "co.uk",
    isSubdomain: false,
    recordCount: 2,
  },
];

const syntheticDomainGroups: DomainGroupSummary[] = [
  {
    registrableDomain: "example.co.uk",
    publicSuffix: "co.uk",
    hostnameCount: syntheticDomains.length,
    recordCount: 67,
  },
  ...Array.from({ length: 72 }, (_, index) => ({
    registrableDomain: `synthetic-${String(index + 1).padStart(3, "0")}.test`,
    publicSuffix: "test",
    hostnameCount: 1,
    recordCount: 1,
  })),
];

export async function listDomains(
  query = "",
  offset = 0,
  limit = 50,
): Promise<DomainSearchResponse> {
  if (isTauriRuntime()) {
    return invoke<DomainSearchResponse>("list_domains", {
      query,
      offset,
      limit,
    });
  }
  const normalizedQuery = query.trim().toLowerCase();
  const groups = syntheticDomainGroups.filter(
    (group) =>
      !normalizedQuery ||
      group.registrableDomain.startsWith(normalizedQuery) ||
      (group.registrableDomain === "example.co.uk" &&
        syntheticDomains.some((domain) =>
          domain.hostname.startsWith(normalizedQuery),
        )),
  );
  return {
    total: groups.length,
    offset,
    groups: groups.slice(offset, offset + limit),
  };
}

export async function getDomainDetails(
  registrableDomain: string,
  hostname: string | null,
  hostnameQuery: string | null,
  datasetId: string | null,
  recordOffset = 0,
  recordLimit = 50,
): Promise<DomainDetailsResponse> {
  if (isTauriRuntime()) {
    return invoke<DomainDetailsResponse>("get_domain_details", {
      registrableDomain,
      hostname,
      hostnameQuery,
      datasetId,
      recordOffset,
      recordLimit,
    });
  }
  const records: DomainRecordSummary[] = Array.from(
    { length: registrableDomain === "example.co.uk" ? 67 : 1 },
    (_, index) => ({
      recordId: `domain-record-synthetic-${index}`,
      datasetId: "dataset-synthetic",
      datasetName: "Authorized synthetic fixture",
      sourceFile: "records_valid.csv",
      sourceLocation: `line ${index + 2}`,
      parser: "aletheia-parser/1",
      fields: [
        {
          name: "email",
          fieldType: "email",
          displayValue: "analyst@example.com",
          sensitive: false,
        },
        {
          name: "domain",
          fieldType: "domain",
          displayValue: "example.co.uk",
          sensitive: false,
        },
        ...(index === 0
          ? [
              {
                name: "source_url",
                fieldType: "url" as const,
                displayValue:
                  "https://portal.example.co.uk/authorized/synthetic/evidence/records/00000000000000000001",
                sensitive: false,
              },
            ]
          : []),
      ],
    }),
  );
  const filtered = datasetId
    ? records.filter((record) => record.datasetId === datasetId)
    : records;
  const hostnameRecords =
    hostname && hostname !== "portal.example.co.uk" ? [] : filtered;
  return {
    registrableDomain,
    selectedHostname: hostname,
    hostnames: syntheticDomains.filter(
      (item) =>
        !hostnameQuery ||
        item.hostname.startsWith(hostnameQuery.trim().toLowerCase()),
    ),
    breaches: [
      {
        datasetId: "dataset-synthetic",
        datasetName: "Authorized synthetic fixture",
        recordCount: hostnameRecords.length,
      },
    ],
    totalRecords: hostnameRecords.length,
    recordOffset,
    records: hostnameRecords.slice(recordOffset, recordOffset + recordLimit),
  };
}

export async function listIdentities(): Promise<IdentitySummary[]> {
  if (isTauriRuntime()) return invoke<IdentitySummary[]>("list_identities");
  const stored = window.localStorage.getItem("aletheia.browser.identities");
  const manual = stored ? (JSON.parse(stored) as IdentitySummary[]) : [];
  return [
    ...manual,
    {
      id: "identity-synthetic",
      displayLabel: "synthetic@example.test",
      confidenceLevel: "high",
      memberCount: 3,
      linkType: "exact_email",
      explanation: "exact_normalized_email",
      userStatus: "automatic",
    },
    {
      id: "identity-synthetic-phone",
      displayLabel: "+12025550142",
      confidenceLevel: "high",
      memberCount: 8,
      linkType: "exact_phone",
      explanation: "exact_normalized_phone",
      userStatus: "automatic",
    },
    {
      id: "identity-synthetic-service",
      displayLabel: "service-user-1001",
      confidenceLevel: "high",
      memberCount: 2,
      linkType: "exact_user_id",
      explanation: "exact_normalized_user_id",
      userStatus: "confirmed",
    },
  ];
}

export async function rebuildIdentities(): Promise<number> {
  if (isTauriRuntime()) return invoke<number>("rebuild_identities");
  return (await listIdentities()).length;
}

export async function rebuildDomains(): Promise<number> {
  if (isTauriRuntime()) return invoke<number>("rebuild_domains");
  return syntheticDomainGroups.length;
}

export async function listIdentityMembers(
  groupId: string,
  offset = 0,
  limit = 25,
  revealValues = false,
): Promise<IdentityMembersResponse> {
  if (isTauriRuntime()) {
    return invoke<IdentityMembersResponse>("list_identity_members", {
      groupId,
      offset,
      limit,
      revealValues,
    });
  }
  const storedMembers = window.localStorage.getItem(
    `aletheia.browser.identity-members.${groupId}`,
  );
  if (storedMembers) {
    const values = JSON.parse(storedMembers) as IdentityMember[];
    return {
      total: values.length,
      offset,
      members: values.slice(offset, offset + limit),
    };
  }
  const members = [
    {
      recordId: "record-synthetic",
      origin: "indexed" as const,
      datasetName: "Authorized synthetic fixture",
      sourceFile: "records_valid.csv",
      sourcePath: "C:\\Synthetic\\records_valid.csv",
      sourceLocation: "line 2",
      userStatus: "automatic",
      fields: [
        {
          name: "email",
          fieldType: "email" as const,
          displayValue: "synthetic@example.test",
          sensitive: false,
        },
        {
          name: "domain",
          fieldType: "domain" as const,
          displayValue: "example.test",
          sensitive: false,
        },
      ],
    },
    {
      recordId: "record-synthetic-2",
      origin: "indexed" as const,
      datasetName: "Authorized synthetic fixture",
      sourceFile: "records_valid.csv",
      sourcePath: "C:\\Synthetic\\records_valid.csv",
      sourceLocation: "line 3",
      userStatus: "automatic",
      fields: [
        {
          name: "email",
          fieldType: "email" as const,
          displayValue: "synthetic@example.test",
          sensitive: false,
        },
        {
          name: "username",
          fieldType: "username" as const,
          displayValue: "synthetic-user",
          sensitive: false,
        },
      ],
    },
  ];
  return {
    total: members.length,
    offset,
    members: members.slice(offset, offset + limit),
  };
}

export async function applyIdentityAction(
  input: IdentityActionInput,
): Promise<string> {
  if (isTauriRuntime()) {
    return invoke<string>("apply_identity_action", { input });
  }
  return crypto.randomUUID();
}

export async function createManualIdentity(
  input: ManualIdentityInput,
): Promise<string> {
  if (isTauriRuntime()) {
    return invoke<string>("create_manual_identity", { input });
  }
  const id = crypto.randomUUID();
  const current = await listIdentities();
  const manual = current.filter(
    (identity) => !identity.id.startsWith("identity-synthetic"),
  );
  manual.unshift({
    id,
    displayLabel: input.name,
    confidenceLevel: "user-confirmed",
    memberCount: input.recordIds.length + input.liveEvidence.length,
    linkType: input.liveEvidence.length
      ? input.recordIds.length
        ? "mixed_evidence_bundle"
        : "live_scan_bundle"
      : "manual_bundle",
    explanation: input.liveEvidence.length
      ? input.recordIds.length
        ? "reviewed_index_and_live_evidence"
        : "reviewed_live_scan_evidence"
      : "manual_search_bundle",
    userStatus: "confirmed",
  });
  window.localStorage.setItem(
    "aletheia.browser.identities",
    JSON.stringify(manual),
  );
  if (input.liveEvidence.length) {
    const members: IdentityMember[] = input.liveEvidence.map(
      (evidence, index) => ({
        recordId: `live:${id}:${index}`,
        origin: "live",
        datasetName: "Live scan",
        sourceFile: evidence.archiveEntry
          ? `${evidence.sourceFile} > ${evidence.archiveEntry}`
          : evidence.sourceFile,
        sourcePath: evidence.sourcePath,
        sourceLocation: evidence.sourceLocation,
        userStatus: "confirmed",
        fields: [
          {
            name: evidence.matchReason,
            fieldType: "unknown",
            displayValue: evidence.excerpt,
            sensitive: false,
          },
        ],
      }),
    );
    window.localStorage.setItem(
      `aletheia.browser.identity-members.${id}`,
      JSON.stringify(members),
    );
  }
  return id;
}

export async function saveSearch(
  name: string,
  query: string,
  filtersJson = "{}",
): Promise<SavedSearch> {
  if (isTauriRuntime()) {
    return invoke<SavedSearch>("save_search", {
      input: { name, query, filtersJson },
    });
  }
  const item: SavedSearch = {
    id: crypto.randomUUID(),
    name,
    query,
    filtersJson,
    createdAt: new Date().toISOString(),
  };
  const current = await listSavedSearches();
  window.localStorage.setItem(
    "aletheia.browser.saved-searches",
    JSON.stringify([item, ...current]),
  );
  return item;
}

export async function listSavedSearches(): Promise<SavedSearch[]> {
  if (isTauriRuntime()) return invoke<SavedSearch[]>("list_saved_searches");
  const stored = window.localStorage.getItem("aletheia.browser.saved-searches");
  return stored ? (JSON.parse(stored) as SavedSearch[]) : [];
}

export async function selectExportDestination(
  format: ExportFormat,
): Promise<string | null> {
  if (!isTauriRuntime()) return `C:\\Synthetic\\findings.${format}`;
  const extension = format === "markdown" ? "md" : format;
  return save({
    title: "Save findings",
    defaultPath: `aletheia-findings.${extension}`,
    filters: [
      { name: `${format.toUpperCase()} export`, extensions: [extension] },
    ],
  });
}

export async function exportRecords(
  request: ExportRequest,
): Promise<ExportResult> {
  if (isTauriRuntime()) {
    return invoke<ExportResult>("export_records", { request });
  }
  const exportId = crypto.randomUUID();
  const result = {
    exportId,
    destinationPath: request.destinationPath,
    manifestPath: `${request.destinationPath}.manifest.json`,
    recordCount: request.recordIds.length,
  };
  const current = await listExports();
  const history: ExportHistoryItem = {
    id: exportId,
    format: request.format,
    destinationPath: request.destinationPath,
    recordCount: request.recordIds.length,
    createdAt: new Date().toISOString(),
  };
  window.localStorage.setItem(
    browserExportsKey,
    JSON.stringify([history, ...current]),
  );
  return result;
}

export async function listExports(): Promise<ExportHistoryItem[]> {
  if (isTauriRuntime()) return invoke<ExportHistoryItem[]>("list_exports");
  const stored = window.localStorage.getItem(browserExportsKey);
  return stored ? (JSON.parse(stored) as ExportHistoryItem[]) : [];
}

export async function cleanupGenerated(request: CleanupRequest): Promise<void> {
  if (request.allGenerated || request.searchHistory) {
    window.localStorage.removeItem(browserLiveSearchActivityKey);
  }
  if (isTauriRuntime()) {
    await invoke("cleanup_generated", { request });
    return;
  }
  if (request.allGenerated) {
    window.localStorage.removeItem("aletheia.browser.datasets");
    window.localStorage.removeItem(browserLiveSourcesKey);
    window.localStorage.removeItem("aletheia.browser.saved-searches");
    window.localStorage.removeItem(browserExportsKey);
    window.localStorage.removeItem(browserSearchHistoryKey);
    window.localStorage.removeItem(browserLiveDomainEvidenceKey);
    return;
  }
  if (request.searchHistory)
    window.localStorage.removeItem(browserSearchHistoryKey);
}

export async function updateSecuritySettings(
  input: SecuritySettingsInput,
): Promise<Settings> {
  if (isTauriRuntime()) {
    return invoke<Settings>("update_security_settings", { input });
  }
  const next = { ...readBrowserSettings(), ...input, networkDisabled: true };
  window.localStorage.setItem(browserSettingsKey, JSON.stringify(next));
  return next;
}

function syntheticInspection(paths: string[] = []): InspectionResult {
  const mappings: FieldMapping[] = [
    ["email", "email", false],
    ["username", "username", false],
    ["phone", "phone", true],
    ["ip", "ip_address", false],
    ["url", "url", false],
    ["password", "password", true],
    ["password_hash", "password_hash", true],
    ["user_id", "user_id", false],
    ["record_date", "timestamp", false],
  ].map(([sourceName, fieldType, isSensitive]) => ({
    sourceName: sourceName as string,
    fieldType: fieldType as FieldType,
    confidence: 0.98,
    isSensitive: isSensitive as boolean,
  }));
  const expandedPaths = paths.flatMap((path) =>
    /\.[a-z0-9]+$/i.test(path)
      ? [path]
      : [
          `${path}\\records_valid.csv`,
          `${path}\\nested\\records_two.txt`,
          `${path}\\records_three.jsonl`,
        ],
  );
  const selectedPaths = expandedPaths.length
    ? expandedPaths
    : ["C:\\Synthetic\\records_valid.csv"];
  const files = selectedPaths.map((absolutePath, index) => {
    const fileName = absolutePath.split(/[\\/]/).at(-1) ?? "synthetic.txt";
    const format: SourceFormat = fileName.endsWith(".csv")
      ? "csv"
      : fileName.endsWith(".jsonl")
        ? "jsonl"
        : "text";
    const fileSize = 842 + index * 128;
    return {
      absolutePath,
      relativePath: absolutePath.replace(/^C:\\Synthetic\\?/i, ""),
      fileName,
      fileSize,
      modifiedAt: "2026-01-20T10:00:00Z",
      format,
      compressed: false,
      encoding: "UTF-8",
      lineEnding: "LF",
      delimiter: format === "csv" ? "comma" : null,
      hasHeader: format === "csv",
      estimatedRecords: 3 + index,
      columnCount: mappings.length,
      rowConsistency: 1,
      mappings,
      preview: [
        {
          sourceLocation: 2,
          values: [
            "analyst@example.com",
            "ava-research",
            "+12025550167",
            "198.51.100.25",
            "https://portal.example.com/login",
            "",
            "",
            "svc-1001",
            "2025-03-14",
          ],
        },
      ],
      warnings: [],
      eligible: true,
    } satisfies FileInspection;
  });
  return {
    files,
    rejectedPaths: [],
    totalBytes: files.reduce((total, file) => total + file.fileSize, 0),
  };
}

function syntheticSearchHit(index = 0): SearchHit {
  return {
    recordId: `record-synthetic-${index}`,
    datasetId: "dataset-synthetic",
    datasetName: "Authorized synthetic fixture",
    sourceFileId: "file-synthetic",
    sourceFile: "records_valid.csv",
    sourceLocation: `line ${index + 2}`,
    parser: "aletheia-parser/1",
    matchReason: "normalized field match",
    fields: [
      {
        name: "email",
        fieldType: "email",
        displayValue: "analyst@example.com",
        sensitive: false,
      },
      {
        name: "url",
        fieldType: "url",
        displayValue: "https://portal.example.com/login",
        sensitive: false,
      },
    ],
  };
}
