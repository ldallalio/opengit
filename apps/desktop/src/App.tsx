import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type {
  Branch,
  BranchInspection,
  BranchStack,
  Commit,
  CommitFile,
  Conflict,
  FileChange,
  FileStatus,
  GitProvider,
  ProviderAccountStatus,
  ProviderRepoCatalog,
  ProviderRepository,
  ParallelLane,
  RepoSnapshot,
  UndoSnapshot
} from "@opengit/core";
import { Button, EmptyState, IconButton, Panel } from "@opengit/ui";
import {
  AlertTriangle,
  Activity,
  Bug,
  ArrowDownToLine,
  Bot,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Cloud,
  Code2,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitFork,
  Github,
  GitPullRequest,
  History,
  HardDrive,
  Eye,
  Link2,
  Maximize2,
  Minimize2,
  Moon,
  MoreHorizontal,
  PackageOpen,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shuffle,
  Sparkles,
  SquarePen,
  Sun,
  Terminal,
  Trash2,
  UploadCloud,
  UsersRound,
  X
} from "lucide-react";
import { clsx } from "clsx";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import {
  addBranchToStack,
  addRemote,
  abortGitOperation,
  applyLane,
  assignPathsToLane,
  cherryPickCommit,
  chooseCloneRootFolder,
  chooseRepositoryFolder,
  checkoutBranch,
  checkoutRemoteBranch,
  cloneRepo,
  continueGitOperation,
  commit,
  createBranch,
  createLane,
  createStack,
  createStackChild,
  createTag,
  deleteBranch,
  commitLane,
  discardLane,
  discardPaths,
  fetchRepo,
  clearAzureDevOpsPat,
  clearClaudeApiKey,
  clearGitHubPat,
  explainBranchChanges,
  saveClaudeApiKey,
  saveGitHubPat,
  testClaudeApiKey,
  choosePatchSavePath,
  deleteWorkingFile,
  exportFilePatch,
  getCommitFileDiff,
  getCommitFiles,
  getConflictVersions,
  getGlobalGitIdentity,
  setGlobalGitIdentity,
  ignoreAddPattern,
  openFileDefault,
  openFileInEditor,
  showFileInFolder,
  stashPushPaths,
  generateAiBranchName,
  generateAiCommitMessage,
  generateAiPrDescription,
  getDiff,
  listDirectoryFiles,
  listProviderRepositories,
  inspectBranch,
  isTauriRuntime,
  loadCommitPage,
  lookupCommit,
  mergeBranch,
  openRepo,
  pullRepoFastForward,
  pullRepoRebase,
  pullRepo,
  pushStack,
  pushRepo,
  rebaseOnto,
  refreshRepo,
  clearRepoLock,
  renameBranch,
  removeBranchFromStack,
  reorderStack,
  restackStack,
  revertCommit,
  saveAzureDevOpsPat,
  saveOpenAiApiKey,
  searchCommits,
  markConflictResolved,
  materializeLaneBranch,
  stagePaths,
  stashApply,
  stashDrop,
  stashPush,
  clearOpenAiApiKey,
  restoreUndoSnapshot,
  squashLastCommits,
  testOpenAiApiKey,
  updateCommitMessage,
  undoLastCommit,
  unstagePaths,
  unapplyLane,
  syncStackTrunk,
  OpenGitApiError,
  resolveConflict,
  type AiPrDescriptionSuggestion,
  type ConflictStrategy,
  type ConflictVersions,
  openExternalUrl
} from "./api";
import { demoSnapshot } from "./demo";
import {
  deriveCloneDestination,
  filterProviderRepositories,
  groupProviderRepositories,
  mergeRepositoryLocalMatches,
  type ProviderRepositoryFilters,
  type RepoCloneFilter,
  uniqueProjectNames
} from "./repositoryManagement";

type Theme = "dark" | "light";
type DiffMode = "commit" | "working";
type CenterView = "graph" | "diff" | "conflict";
type ResizeTarget =
  | "sidebar"
  | "detail"
  | "bottom"
  | "sidebarBranches"
  | "sidebarInspector"
  | "sidebarRemotes"
  | "sidebarStashes"
  | "detailSelection"
  | "bottomOperations";
type LayoutState = {
  sidebarWidth: number;
  detailWidth: number;
  bottomHeight: number;
  sidebarBranchesHeight: number;
  sidebarInspectorHeight: number;
  sidebarRemotesHeight: number;
  sidebarStashesHeight: number;
  detailSelectionHeight: number;
  bottomOperationsWidth: number;
  sidebarCollapsed: boolean;
  detailCollapsed: boolean;
  bottomCollapsed: boolean;
};
type HistoryColumnKey = "branch" | "graph" | "message" | "author" | "date" | "hash";
type HistoryColumnWidths = Record<HistoryColumnKey, number>;
type HistorySortDirection = "desc" | "asc";
type HistoryFilters = {
  query: string;
  author: string;
  type: string;
  dateDirection: HistorySortDirection;
};
type HistoryFilterColumn = "message" | "author" | "date";
type RefKind = "head" | "local" | "remote" | "tag" | "other";
type RefChip = { label: string; kind: RefKind; color: string; raw: string };
type DisplayBranch = Branch & { isRemote: boolean; isUnborn: boolean };
type BranchMenuTarget = {
  name: string;
  fullRef: string;
  kind: RefKind;
  source: "sidebar" | "graph" | "commit";
  commitSha?: string;
  upstream?: string;
  isCurrent: boolean;
  isProtected: boolean;
  isRemote: boolean;
  isTag: boolean;
  isUnborn: boolean;
  isCommitOnly?: boolean;
};
type BranchMenuState = {
  x: number;
  y: number;
  target: BranchMenuTarget;
};
type RefOverflowMenuState = {
  x: number;
  y: number;
  refs: RefChip[];
  commit: Commit;
};
type PushRecoveryState = {
  message: string;
  remote?: string;
  branch?: string;
};
type LockRecoveryState = {
  message: string;
  repoPath: string;
  lockPath: string;
  retry: () => Promise<boolean>;
};
type FileMenuState = {
  x: number;
  y: number;
  change: FileChange;
  staged: boolean;
};
type FileMenuAction =
  | "stage"
  | "unstage"
  | "discard"
  | "stash"
  | "ignore-file"
  | "ignore-ext"
  | "ignore-folder"
  | "open-editor"
  | "open-default"
  | "reveal"
  | "copy-path"
  | "create-patch"
  | "delete";
type FileMenuItem =
  | { type: "separator"; key: string }
  | { type: "item"; action: FileMenuAction; label: string; danger?: boolean };

function fileExtension(path: string) {
  const base = path.split("/").pop() ?? "";
  const index = base.lastIndexOf(".");
  return index > 0 ? base.slice(index + 1) : null;
}

function parentDirectory(path: string) {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : null;
}

function fileBasename(path: string) {
  return path.split("/").pop() ?? path;
}
type PromptRequest = {
  title: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
};
type ConfirmRequest = {
  message: string;
  title?: string;
  confirmLabel?: string;
};
type AiProviderPreference = "auto" | "openai" | "claude";
type BranchExplainState = {
  branch: string;
  loading: boolean;
  base?: string;
  markdown?: string;
  error?: string;
};
type BranchMenuAction =
  | "pull"
  | "push"
  | "set-upstream"
  | "merge"
  | "rebase"
  | "checkout"
  | "create-worktree"
  | "stack-create"
  | "stack-add"
  | "stack-child"
  | "stack-restack"
  | "stack-pr-plan"
  | "create-branch"
  | "cherry-pick"
  | "reset"
  | "revert"
  | "open-pr"
  | "explain"
  | "rename"
  | "delete"
  | "delete-remote"
  | "copy-name"
  | "copy-sha"
  | "copy-branch-link"
  | "copy-commit-link"
  | "create-patch"
  | "share-patch"
  | "pin-left"
  | "solo"
  | "create-tag"
  | "create-annotated-tag";
type BranchMenuItem =
  | { type: "separator"; key: string }
  | { type: "item"; action: BranchMenuAction; label: string; disabled?: boolean; danger?: boolean; hint?: string };
type GraphConnection = { from: number; to: number; color: string; terminal?: boolean };
type GraphRow = {
  commit: Commit;
  lane: number;
  lanesBefore: string[];
  lanesAfter: string[];
  connections: GraphConnection[];
  refs: RefChip[];
  maxLane: number;
  color: string;
};
type PreferenceSection =
  | "general"
  | "repositories"
  | "profiles"
  | "ssh"
  | "integrations"
  | "externalTools"
  | "notifications"
  | "commit"
  | "editor"
  | "terminal"
  | "experimental";

const defaultPath = localStorage.getItem("opengit:lastPath") ?? "/Users/logandallalio/Documents/OpenGit";
const graphColors = ["#58a6ff", "#b388ff", "#3fb950", "#ff7b72", "#e3b341", "#d2a8ff", "#79c0ff", "#a5d6ff", "#f0883e", "#8b949e"];
const graphLaneWidth = 18;
const graphRowHeight = 36;
const maxVisibleGraphLanes = 12;
const repoTabLimit = 9;
const autoRefreshIntervalMs = 2500;
const historyPageSize = 1000;
const historyLimitOptions = [100, 250, 500, 1000, 2000] as const;
const historyColumnStorageKey = "opengit:historyColumnWidths:v2";
const historyFilterStorageKey = "opengit:historyFilters";
const cloneRootStorageKey = "opengit:defaultCloneRoot";
const providerLocatedPathsStorageKey = "opengit:providerLocatedPaths";
const openAiConfiguredStorageKey = "opengit:openaiConfigured";
const azureDevOpsConfiguredStorageKey = "opengit:azureDevOpsConfigured";
const githubConfiguredStorageKey = "opengit:githubConfigured";
const githubLoginStorageKey = "opengit:githubLogin";
const claudeConfiguredStorageKey = "opengit:claudeConfigured";
const aiProviderStorageKey = "opengit:aiProvider";
const defaultHistoryFilters: HistoryFilters = {
  query: "",
  author: "",
  type: "",
  dateDirection: "desc"
};
const defaultHistoryColumnWidths: HistoryColumnWidths = {
  branch: 170,
  graph: 210,
  message: 620,
  author: 150,
  date: 152,
  hash: 82
};
const historyColumnLimits: Record<HistoryColumnKey, { min: number; max: number }> = {
  branch: { min: 130, max: 420 },
  graph: { min: 120, max: 480 },
  message: { min: 360, max: 1400 },
  author: { min: 110, max: 280 },
  date: { min: 116, max: 280 },
  hash: { min: 64, max: 180 }
};
const defaultLayout: LayoutState = {
  sidebarWidth: 320,
  detailWidth: 380,
  bottomHeight: 240,
  sidebarBranchesHeight: 420,
  sidebarInspectorHeight: 270,
  sidebarRemotesHeight: 145,
  sidebarStashesHeight: 145,
  detailSelectionHeight: 220,
  bottomOperationsWidth: 260,
  sidebarCollapsed: false,
  detailCollapsed: false,
  bottomCollapsed: false
};

type GitProfile = {
  id: string;
  name: string;
  authorName: string;
  authorEmail: string;
  color: string;
};

const gitProfileColors = ["#3fb68b", "#58a6ff", "#bc8cff", "#f778ba", "#e3b341", "#f0883e"];
const gitProfilesStorageKey = "opengit:profiles";
const activeGitProfileStorageKey = "opengit:activeProfile";
const gitProfileSyncStorageKey = "opengit:profileSyncGitConfig";

function defaultGitProfiles(): GitProfile[] {
  return [
    {
      id: "default",
      name: "Default Profile",
      authorName: "",
      authorEmail: "",
      color: gitProfileColors[0]
    }
  ];
}

function loadGitProfiles(): GitProfile[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(gitProfilesStorageKey) ?? "[]");
    if (!Array.isArray(parsed)) return defaultGitProfiles();
    const profiles = parsed.filter(
      (value): value is GitProfile =>
        typeof value === "object" &&
        value !== null &&
        typeof value.id === "string" &&
        typeof value.name === "string" &&
        typeof value.authorName === "string" &&
        typeof value.authorEmail === "string" &&
        typeof value.color === "string"
    );
    return profiles.length > 0 ? profiles : defaultGitProfiles();
  } catch {
    return defaultGitProfiles();
  }
}

function profileInitials(profile: GitProfile) {
  const source = profile.authorName.trim() || profile.name.trim();
  const parts = source.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : parts[0]?.[1] ?? "";
  return `${first}${second}`.toUpperCase();
}

const gitProfilesChangedEvent = "opengit:profiles-changed";

function readActiveGitProfile(): GitProfile | null {
  const profiles = loadGitProfiles();
  const activeId = localStorage.getItem(activeGitProfileStorageKey);
  return profiles.find((profile) => profile.id === activeId) ?? profiles[0] ?? null;
}

function useActiveGitProfile() {
  const [profile, setProfile] = useState<GitProfile | null>(readActiveGitProfile);

  useEffect(() => {
    const update = () => setProfile(readActiveGitProfile());
    window.addEventListener(gitProfilesChangedEvent, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(gitProfilesChangedEvent, update);
      window.removeEventListener("storage", update);
    };
  }, []);

  return profile;
}

function loadRecentRepos() {
  try {
    const parsed = JSON.parse(localStorage.getItem("opengit:recentRepos") ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function uniqueRepoPaths(paths: string[]) {
  return paths.filter((path, index, items) => path.trim() && items.indexOf(path) === index);
}

function loadRepoTabs() {
  try {
    const parsed = JSON.parse(localStorage.getItem("opengit:repoTabs") ?? "[]");
    const stored = Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
    return uniqueRepoPaths([defaultPath, ...stored, ...loadRecentRepos()]).slice(0, repoTabLimit);
  } catch {
    return uniqueRepoPaths([defaultPath, ...loadRecentRepos()]).slice(0, repoTabLimit);
  }
}

function loadHistoryLimit() {
  const parsed = Number(localStorage.getItem("opengit:historyLimit"));
  return historyLimitOptions.includes(parsed as (typeof historyLimitOptions)[number]) ? parsed : 250;
}

function repoSnapshotSignature(snapshot: RepoSnapshot) {
  return JSON.stringify({
    repository: snapshot.repository,
    currentBranch: snapshot.currentBranch,
    upstream: snapshot.upstream,
    ahead: snapshot.ahead,
    behind: snapshot.behind,
    changes: snapshot.changes,
    branches: snapshot.branches,
    remotes: snapshot.remotes,
    stashes: snapshot.stashes,
    commits: snapshot.commits.map((commit) => ({
      sha: commit.sha,
      parents: commit.parents,
      message: commit.message,
      refs: commit.refs
    })),
    conflicts: snapshot.conflicts,
    undoSnapshots: snapshot.undoSnapshots,
    branchStacks: snapshot.branchStacks,
    parallelLanes: snapshot.parallelLanes,
    worktrees: snapshot.worktrees,
    activeOperation: snapshot.activeOperation
  });
}

function defaultBranchRef(snapshot: RepoSnapshot) {
  return snapshot.currentBranch ?? snapshot.branches.find((branch) => branch.isCurrent)?.fullRef ?? snapshot.branches[0]?.fullRef ?? null;
}

function snapshotHasBranchRef(snapshot: RepoSnapshot, ref: string) {
  return snapshot.branches.some((branch) => branch.name === ref || branch.fullRef === ref || normalizeRefLabel(branch.fullRef) === ref);
}

function findMatchingChange(changes: FileChange[], current: FileChange | null) {
  if (!current) return changes[0] ?? null;
  return (
    changes.find(
      (change) =>
        change.path === current.path &&
        change.oldPath === current.oldPath &&
        change.staged === current.staged &&
        change.unstaged === current.unstaged
    ) ??
    changes.find((change) => change.path === current.path && change.oldPath === current.oldPath) ??
    changes[0] ??
    null
  );
}

function loadHistoryColumnWidths(): HistoryColumnWidths {
  try {
    const parsed = JSON.parse(localStorage.getItem(historyColumnStorageKey) ?? "{}") as Partial<HistoryColumnWidths>;
    return (Object.keys(defaultHistoryColumnWidths) as HistoryColumnKey[]).reduce((widths, key) => {
      const value = Number(parsed[key]);
      const limits = historyColumnLimits[key];
      widths[key] = Number.isFinite(value) ? clamp(value, limits.min, limits.max) : defaultHistoryColumnWidths[key];
      return widths;
    }, { ...defaultHistoryColumnWidths });
  } catch {
    return defaultHistoryColumnWidths;
  }
}

function saveHistoryColumnWidths(widths: HistoryColumnWidths) {
  localStorage.setItem(historyColumnStorageKey, JSON.stringify(widths));
}

function loadHistoryFilters(): HistoryFilters {
  try {
    const parsed = JSON.parse(localStorage.getItem(historyFilterStorageKey) ?? "{}") as Partial<HistoryFilters>;
    return {
      query: typeof parsed.query === "string" ? parsed.query : defaultHistoryFilters.query,
      author: typeof parsed.author === "string" ? parsed.author : defaultHistoryFilters.author,
      type: typeof parsed.type === "string" ? parsed.type : defaultHistoryFilters.type,
      dateDirection: parsed.dateDirection === "asc" ? "asc" : defaultHistoryFilters.dateDirection
    };
  } catch {
    return defaultHistoryFilters;
  }
}

function loadDefaultCloneRoot() {
  return localStorage.getItem(cloneRootStorageKey) ?? "/Users/logandallalio/Documents";
}

function loadProviderLocatedPaths() {
  try {
    const parsed = JSON.parse(localStorage.getItem(providerLocatedPathsStorageKey) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
      : {};
  } catch {
    return {};
  }
}

function loadStoredCredentialFlag(key: string) {
  return localStorage.getItem(key) === "true";
}

function loadAiProviderPreference(): AiProviderPreference {
  const value = localStorage.getItem(aiProviderStorageKey);
  return value === "openai" || value === "claude" ? value : "auto";
}

function azureProviderStatus(configured: boolean): ProviderAccountStatus {
  return {
    provider: "azure-devops",
    configured,
    status: configured ? "connected" : "unavailable",
    label: "Azure DevOps",
    detail: configured
      ? "Saved-token state is remembered locally. The keychain is checked only when you use Azure DevOps."
      : "OpenGit will check the keychain only when you save a PAT or refresh repositories."
  };
}

function githubProviderStatus(configured: boolean): ProviderAccountStatus {
  return {
    provider: "github",
    configured,
    status: configured ? "connected" : "unavailable",
    label: "GitHub",
    detail: configured
      ? "Saved-token state is remembered locally. The keychain is checked only when you use GitHub."
      : "OpenGit will check the keychain only when you save a PAT or refresh repositories."
  };
}

type ProviderWebInfo = {
  provider: GitProvider;
  webUrl: string;
};

/**
 * Derive the provider web URL for a repository from its origin remote so
 * browser links work without any provider API call.
 */
function providerWebInfo(snapshot: RepoSnapshot | null): ProviderWebInfo | null {
  const remote = snapshot?.remotes.find((item) => item.name === "origin") ?? snapshot?.remotes[0];
  const url = remote?.fetchUrl ?? remote?.pushUrl;
  if (!url) return null;

  const trimmed = url.trim().replace(/\.git$/i, "");
  const scpLike = trimmed.match(/^(?:[^@\s]+@)?([^:/\s]+):(.+)$/);
  const parsed = (() => {
    try {
      return new URL(trimmed.replace(/^(https?:\/\/)[^/@\s]+@/i, "$1"));
    } catch {
      return null;
    }
  })();
  const host = (parsed?.hostname ?? scpLike?.[1] ?? "").toLowerCase().replace(/^ssh\./, "");
  const parts = (parsed?.pathname ?? scpLike?.[2] ?? "")
    .split("/")
    .map((part) => decodeURIComponent(part).trim())
    .filter(Boolean);

  if (host === "github.com" && parts.length >= 2) {
    return { provider: "github", webUrl: `https://github.com/${parts[0]}/${parts[1]}` };
  }
  if (host === "dev.azure.com") {
    // https clone: org/project/_git/repo — ssh clone (v3): v3/org/project/repo
    if (parts.length >= 4 && parts[2].toLowerCase() === "_git") {
      return { provider: "azure-devops", webUrl: `https://dev.azure.com/${parts[0]}/${parts[1]}/_git/${parts[3]}` };
    }
    if (parts.length >= 4 && parts[0].toLowerCase() === "v3") {
      return { provider: "azure-devops", webUrl: `https://dev.azure.com/${parts[1]}/${parts[2]}/_git/${parts[3]}` };
    }
  }
  if (host.endsWith(".visualstudio.com") && parts.length >= 3 && parts[1].toLowerCase() === "_git") {
    const org = host.slice(0, -".visualstudio.com".length);
    return { provider: "azure-devops", webUrl: `https://dev.azure.com/${org}/${parts[0]}/_git/${parts[2]}` };
  }
  return null;
}

function stripRemotePrefix(target: BranchMenuTarget) {
  if (!target.isRemote) return target.name;
  const index = target.name.indexOf("/");
  return index > 0 ? target.name.slice(index + 1) : target.name;
}

function providerBranchUrl(info: ProviderWebInfo, branch: string) {
  return info.provider === "github"
    ? `${info.webUrl}/tree/${encodeURIComponent(branch)}`
    : `${info.webUrl}?version=GB${encodeURIComponent(branch)}`;
}

function providerCommitUrl(info: ProviderWebInfo, sha: string) {
  return `${info.webUrl}/commit/${sha}`;
}

function providerPrCreateUrl(info: ProviderWebInfo, branch: string) {
  return info.provider === "github"
    ? `${info.webUrl}/compare/${encodeURIComponent(branch)}?expand=1`
    : `${info.webUrl}/pullrequestcreate?sourceRef=${encodeURIComponent(branch)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export default function App() {
  const runningInTauri = isTauriRuntime();
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("opengit:theme") as Theme) || "dark");
  const [repoPath, setRepoPath] = useState(defaultPath);
  const [historyLimit, setHistoryLimit] = useState(loadHistoryLimit);
  const [snapshot, setSnapshot] = useState<RepoSnapshot | null>(() => (runningInTauri ? null : demoSnapshot));
  const [selectedCommit, setSelectedCommit] = useState<Commit | null>(snapshot?.commits[0] ?? null);
  const [worktreeSelected, setWorktreeSelected] = useState(false);
  const [selectedBranchRef, setSelectedBranchRef] = useState<string | null>(snapshot?.currentBranch ?? null);
  const [branchInspection, setBranchInspection] = useState<BranchInspection | null>(null);
  const [branchInspectionLoading, setBranchInspectionLoading] = useState(false);
  const [branchInspectionError, setBranchInspectionError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<FileChange | null>(snapshot?.changes[0] ?? null);
  const [selectedCommitFile, setSelectedCommitFile] = useState<CommitFile | null>(null);
  const [selectedConflictPath, setSelectedConflictPath] = useState<string | null>(snapshot?.conflicts[0]?.path ?? null);
  const [conflictVersions, setConflictVersions] = useState<ConflictVersions | null>(null);
  const [conflictVersionsLoading, setConflictVersionsLoading] = useState(false);
  const [conflictVersionsError, setConflictVersionsError] = useState<string | null>(null);
  const [commitFiles, setCommitFiles] = useState<CommitFile[]>([]);
  const [commitFileError, setCommitFileError] = useState<string | null>(null);
  const [diff, setDiff] = useState("");
  const [commitDiff, setCommitDiff] = useState("");
  const [diffMode, setDiffMode] = useState<DiffMode>("commit");
  const [centerView, setCenterView] = useState<CenterView>("graph");
  const [diffExpanded, setDiffExpanded] = useState(false);
  const [commitFilesLoading, setCommitFilesLoading] = useState(false);
  const [commitDiffLoading, setCommitDiffLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [selectedCommitMessage, setSelectedCommitMessage] = useState(snapshot?.commits[0]?.message ?? "");
  const [commitEditorOpen, setCommitEditorOpen] = useState(false);
  const [openAiConfigured, setOpenAiConfigured] = useState(() => loadStoredCredentialFlag(openAiConfiguredStorageKey));
  const [openAiModel, setOpenAiModel] = useState(localStorage.getItem("opengit:openaiModel") ?? "gpt-5-mini");
  const [azureDevOpsConfigured, setAzureDevOpsConfigured] = useState(() => loadStoredCredentialFlag(azureDevOpsConfiguredStorageKey));
  const [githubConfigured, setGithubConfigured] = useState(() => loadStoredCredentialFlag(githubConfiguredStorageKey));
  const [githubLogin, setGithubLogin] = useState<string | null>(() => localStorage.getItem(githubLoginStorageKey));
  const [claudeConfigured, setClaudeConfigured] = useState(() => loadStoredCredentialFlag(claudeConfiguredStorageKey));
  const [aiProvider, setAiProvider] = useState<AiProviderPreference>(() => loadAiProviderPreference());
  const [preferredIntegration, setPreferredIntegration] = useState("OpenAI");
  const [repositoryManagementOpen, setRepositoryManagementOpen] = useState(false);
  const [providerAccounts, setProviderAccounts] = useState<ProviderAccountStatus[]>(() => [
    azureProviderStatus(loadStoredCredentialFlag(azureDevOpsConfiguredStorageKey)),
    githubProviderStatus(loadStoredCredentialFlag(githubConfiguredStorageKey))
  ]);
  const [branchExplain, setBranchExplain] = useState<BranchExplainState | null>(null);
  const [providerCatalog, setProviderCatalog] = useState<ProviderRepoCatalog | null>(runningInTauri ? null : null);
  const [providerLoading, setProviderLoading] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [cloneRoot, setCloneRoot] = useState(loadDefaultCloneRoot);
  const [providerLocatedPaths, setProviderLocatedPaths] = useState<Record<string, string>>(loadProviderLocatedPaths);
  const [providerFilters, setProviderFilters] = useState<ProviderRepositoryFilters>({
    search: "",
    provider: "all",
    project: "all",
    cloneStatus: "all"
  });
  const [aiGeneratingCommit, setAiGeneratingCommit] = useState(false);
  const [aiGeneratingBranch, setAiGeneratingBranch] = useState(false);
  const [aiGeneratingPr, setAiGeneratingPr] = useState(false);
  const [aiPrDraft, setAiPrDraft] = useState<AiPrDescriptionSuggestion | null>(null);
  const [sidebarBranchFilter, setSidebarBranchFilter] = useState("");
  const [remoteName, setRemoteName] = useState("origin");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [stashMessage, setStashMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [loading, setLoading] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [preferencesSection, setPreferencesSection] = useState<PreferenceSection>("repositories");
  const [error, setError] = useState<string | null>(null);
  const [promptRequest, setPromptRequest] = useState<PromptRequest | null>(null);
  const promptResolverRef = useRef<((value: string | null) => void) | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const confirmResolverRef = useRef<((value: boolean) => void) | null>(null);
  const [pushRecovery, setPushRecovery] = useState<PushRecoveryState | null>(null);
  const [lockRecovery, setLockRecovery] = useState<LockRecoveryState | null>(null);
  const [recentRepos, setRecentRepos] = useState<string[]>(loadRecentRepos);
  const [repoTabs, setRepoTabs] = useState<string[]>(loadRepoTabs);
  const [layout, setLayout] = useState<LayoutState>(defaultLayout);
  const [historyColumnWidths, setHistoryColumnWidths] = useState<HistoryColumnWidths>(loadHistoryColumnWidths);
  const [historyFilters, setHistoryFilters] = useState<HistoryFilters>(loadHistoryFilters);
  const [historySearchResults, setHistorySearchResults] = useState<Commit[] | null>(null);
  const [historySearchLoading, setHistorySearchLoading] = useState(false);
  const [historySearchError, setHistorySearchError] = useState<string | null>(null);
  const [historyPagedCommits, setHistoryPagedCommits] = useState<Commit[]>([]);
  const [historySupplementalCommits, setHistorySupplementalCommits] = useState<Commit[]>([]);
  const [historyHasMorePages, setHistoryHasMorePages] = useState(false);
  const [historyPagingExhausted, setHistoryPagingExhausted] = useState(false);
  const [historyPageLoading, setHistoryPageLoading] = useState(false);
  const [branchMenu, setBranchMenu] = useState<BranchMenuState | null>(null);
  const [refOverflowMenu, setRefOverflowMenu] = useState<RefOverflowMenuState | null>(null);
  const [fileMenu, setFileMenu] = useState<FileMenuState | null>(null);
  const [branchSwitcherOpen, setBranchSwitcherOpen] = useState(false);
  const [branchSearch, setBranchSearch] = useState("");
  const [operationLog, setOperationLog] = useState<string[]>([
    runningInTauri ? "OpenGit ready" : "Browser preview uses demo data"
  ]);
  const [selectedStackId, setSelectedStackId] = useState<string | null>(null);
  const [selectedLaneId, setSelectedLaneId] = useState<string | null>(snapshot?.parallelLanes[0]?.id ?? null);
  const [parallelMode, setParallelMode] = useState(false);
  const snapshotRef = useRef<RepoSnapshot | null>(snapshot);
  const historyLimitRef = useRef(historyLimit);
  const loadingRef = useRef(loading);
  const commitEditorOpenRef = useRef(commitEditorOpen);
  const autoRefreshInFlightRef = useRef(false);
  const autoRefreshErrorRef = useRef<string | null>(null);

  const stagedChanges = useMemo(() => snapshot?.changes.filter((change) => change.staged) ?? [], [snapshot]);
  const unstagedChanges = useMemo(() => snapshot?.changes.filter((change) => change.unstaged) ?? [], [snapshot]);
  const activeDiffPath = diffMode === "commit" ? selectedCommitFile?.path : selectedFile?.path;
  const activeDiff = diffMode === "commit" ? commitDiff : diff;
  const activeDiffLoading = diffMode === "commit" && commitDiffLoading;
  const historySearchQuery = historyFilters.query.trim();
  const historyBackendSearchActive = runningInTauri && Boolean(historySearchQuery);
  const historyLoadedCommits = useMemo(
    () => uniqueCommitsBySha([...(snapshot?.commits ?? []), ...historyPagedCommits, ...historySupplementalCommits]),
    [historyPagedCommits, historySupplementalCommits, snapshot]
  );
  const historySourceCommits = historyBackendSearchActive ? historySearchResults ?? [] : historyLoadedCommits;
  const filteredHistoryCommits = useMemo(
    () => filterHistoryCommits(historySourceCommits, historyBackendSearchActive ? { ...historyFilters, query: "" } : historyFilters),
    [historyBackendSearchActive, historyFilters, historySourceCommits]
  );
  const historyAuthors = useMemo(() => uniqueHistoryAuthors(historyLoadedCommits), [historyLoadedCommits]);
  const historyTypes = useMemo(() => uniqueHistoryTypes(historyLoadedCommits), [historyLoadedCommits]);
  const historyFiltersActive = areHistoryFiltersActive(historyFilters);
  const historyMayHaveMorePages = Boolean(
    runningInTauri &&
      snapshot &&
      !historyBackendSearchActive &&
      !historyPagingExhausted &&
      (historyHasMorePages || (historyPagedCommits.length === 0 && snapshot.commits.length >= historyLimit))
  );
  const graphRows = useMemo(() => buildGraphRows(filteredHistoryCommits), [filteredHistoryCommits]);
  const activeConflictState = hasActiveConflictState(snapshot);
  const selectedConflict = useMemo(
    () => snapshot?.conflicts.find((conflict) => conflict.path === selectedConflictPath) ?? snapshot?.conflicts[0] ?? null,
    [snapshot, selectedConflictPath]
  );
  const selectedCommitIsHead = Boolean(selectedCommit && snapshot?.commits[0]?.sha === selectedCommit.sha);
  const topbarBranches = useMemo(() => (snapshot ? displayBranches(snapshot) : []), [snapshot]);
  const filteredTopbarBranches = useMemo(() => filterBranches(topbarBranches, branchSearch), [topbarBranches, branchSearch]);
  const activeRepoPath = snapshot?.repository.path ?? repoPath;
  const selectedStack = useMemo(
    () => snapshot?.branchStacks.find((stack) => stack.id === selectedStackId) ?? null,
    [snapshot, selectedStackId]
  );
  const selectedLane = useMemo(
    () => snapshot?.parallelLanes.find((lane) => lane.id === selectedLaneId) ?? snapshot?.parallelLanes[0] ?? null,
    [snapshot, selectedLaneId]
  );
  const hasWorkingChanges = (snapshot?.changes.length ?? 0) > 0;
  const laneByPath = useMemo(() => buildLanePathMap(snapshot?.parallelLanes ?? []), [snapshot]);
  const laneFilteredUnstagedChanges = useMemo(
    () => filterChangesByLane(unstagedChanges, parallelMode ? selectedLaneId : undefined, laneByPath),
    [unstagedChanges, parallelMode, selectedLaneId, laneByPath]
  );
  const laneFilteredStagedChanges = useMemo(
    () => filterChangesByLane(stagedChanges, parallelMode ? selectedLaneId : undefined, laneByPath),
    [stagedChanges, parallelMode, selectedLaneId, laneByPath]
  );
  const workingChangesCount = snapshot?.changesTruncated
    ? `${snapshot.changes.length.toLocaleString()} of ${(snapshot.totalChanges ?? snapshot.changes.length).toLocaleString()}`
    : `${snapshot?.changes.length ?? 0}`;
  const inspectorFileTitle = worktreeSelected ? `Working Changes (${workingChangesCount})` : `Changed Files (${commitFiles.length})`;
  const visibleRepoTabs = useMemo(() => uniqueRepoPaths([activeRepoPath, ...repoTabs]).slice(0, repoTabLimit), [activeRepoPath, repoTabs]);
  const providerLocalPaths = useMemo(
    () => uniqueRepoPaths([activeRepoPath, ...repoTabs, ...recentRepos, ...Object.values(providerLocatedPaths)]),
    [activeRepoPath, providerLocatedPaths, recentRepos, repoTabs]
  );
  const providerRepositories = useMemo(
    () => (providerCatalog ? mergeRepositoryLocalMatches(providerCatalog.repositories, [], providerLocatedPaths, activeRepoPath) : []),
    [activeRepoPath, providerCatalog, providerLocatedPaths]
  );
  const filteredProviderRepositories = useMemo(
    () => filterProviderRepositories(providerRepositories, providerFilters),
    [providerFilters, providerRepositories]
  );
  const providerRepositoryGroups = useMemo(() => groupProviderRepositories(filteredProviderRepositories), [filteredProviderRepositories]);
  const providerProjectNames = useMemo(() => uniqueProjectNames(providerRepositories), [providerRepositories]);
  const contentGridStyle = {
    "--sidebar-track": layout.sidebarCollapsed ? "0px" : `${layout.sidebarWidth}px`,
    "--sidebar-handle-track": layout.sidebarCollapsed ? "0px" : "6px",
    "--detail-track": layout.detailCollapsed ? "0px" : `${layout.detailWidth}px`,
    "--detail-handle-track": layout.detailCollapsed ? "0px" : "6px",
    "--bottom-track": layout.bottomCollapsed ? "0px" : hasWorkingChanges ? `${layout.bottomHeight}px` : "44px",
    "--bottom-handle-track": layout.bottomCollapsed ? "0px" : "6px",
    "--sidebar-branches-height": `${layout.sidebarBranchesHeight}px`,
    "--sidebar-inspector-height": `${layout.sidebarInspectorHeight}px`,
    "--sidebar-remotes-height": `${layout.sidebarRemotesHeight}px`,
    "--sidebar-stashes-height": `${layout.sidebarStashesHeight}px`,
    "--detail-selection-height": `${layout.detailSelectionHeight}px`,
    "--bottom-operations-width": `${layout.bottomOperationsWidth}px`
  } as CSSProperties;

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    historyLimitRef.current = historyLimit;
  }, [historyLimit]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    commitEditorOpenRef.current = commitEditorOpen;
  }, [commitEditorOpen]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("opengit:theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("opengit:openaiModel", openAiModel);
  }, [openAiModel]);

  useEffect(() => {
    localStorage.setItem(openAiConfiguredStorageKey, String(openAiConfigured));
  }, [openAiConfigured]);

  useEffect(() => {
    localStorage.setItem(azureDevOpsConfiguredStorageKey, String(azureDevOpsConfigured));
    localStorage.setItem(githubConfiguredStorageKey, String(githubConfigured));
    setProviderAccounts([azureProviderStatus(azureDevOpsConfigured), githubProviderStatus(githubConfigured)]);
  }, [azureDevOpsConfigured, githubConfigured]);

  useEffect(() => {
    if (githubLogin) {
      localStorage.setItem(githubLoginStorageKey, githubLogin);
    } else {
      localStorage.removeItem(githubLoginStorageKey);
    }
  }, [githubLogin]);

  useEffect(() => {
    localStorage.setItem(claudeConfiguredStorageKey, String(claudeConfigured));
  }, [claudeConfigured]);

  useEffect(() => {
    localStorage.setItem(aiProviderStorageKey, aiProvider);
  }, [aiProvider]);

  useEffect(() => {
    localStorage.setItem(historyFilterStorageKey, JSON.stringify(historyFilters));
  }, [historyFilters]);

  useEffect(() => {
    setHistoryPagedCommits([]);
    setHistorySupplementalCommits([]);
    setHistoryHasMorePages(false);
    setHistoryPagingExhausted(false);
    setHistoryPageLoading(false);
  }, [historyLimit, snapshot?.repository.path]);

  useEffect(() => {
    if (!snapshot || !historyBackendSearchActive) {
      setHistorySearchResults(null);
      setHistorySearchLoading(false);
      setHistorySearchError(null);
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setHistorySearchLoading(true);
      setHistorySearchError(null);
      void searchCommits(snapshot.repository.path, historySearchQuery, historyLimit)
        .then((commits) => {
          if (!cancelled) setHistorySearchResults(commits);
        })
        .catch((searchError) => {
          if (!cancelled) {
            setHistorySearchResults([]);
            setHistorySearchError(searchError instanceof Error ? searchError.message : String(searchError));
          }
        })
        .finally(() => {
          if (!cancelled) setHistorySearchLoading(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [historyBackendSearchActive, historyLimit, historySearchQuery, snapshot]);

  useEffect(() => {
    if (!snapshot || !activeConflictState) {
      setConflictVersions(null);
      setConflictVersionsError(null);
      return;
    }

    const path = selectedConflict?.path ?? snapshot.conflicts[0]?.path;
    if (!path) {
      setConflictVersions(null);
      setConflictVersionsError(null);
      return;
    }

    if (selectedConflictPath !== path) {
      setSelectedConflictPath(path);
    }

    let cancelled = false;
    setConflictVersionsLoading(true);
    setConflictVersionsError(null);
    void getConflictVersions(snapshot.repository.path, path)
      .then((versions) => {
        if (!cancelled) setConflictVersions(versions);
      })
      .catch((versionsError) => {
        if (!cancelled) {
          setConflictVersions(null);
          setConflictVersionsError(versionsError instanceof Error ? versionsError.message : String(versionsError));
        }
      })
      .finally(() => {
        if (!cancelled) setConflictVersionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeConflictState, selectedConflict?.path, selectedConflictPath, snapshot]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "r") {
        event.preventDefault();
        void refresh();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    if (!branchMenu) return;

    const closeMenu = () => setBranchMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setBranchMenu(null);
      }
    };

    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [branchMenu]);

  useEffect(() => {
    if (!refOverflowMenu) return;

    const closeMenu = () => setRefOverflowMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setRefOverflowMenu(null);
      }
    };

    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [refOverflowMenu]);

  useEffect(() => {
    if (!fileMenu) return;

    const closeMenu = () => setFileMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFileMenu(null);
      }
    };

    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [fileMenu]);

  useEffect(() => {
    if (!branchSwitcherOpen) return;

    const closeSwitcher = () => setBranchSwitcherOpen(false);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setBranchSwitcherOpen(false);
      }
    };

    window.addEventListener("pointerdown", closeSwitcher);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeSwitcher);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [branchSwitcherOpen]);

  useEffect(() => {
    if (!snapshot) {
      setSelectedStackId(null);
      setSelectedLaneId(null);
      setParallelMode(false);
      setSelectedBranchRef(null);
      return;
    }
    if (selectedStackId && !snapshot.branchStacks.some((stack) => stack.id === selectedStackId)) {
      setSelectedStackId(snapshot.branchStacks[0]?.id ?? null);
    }
    if (selectedLaneId && !snapshot.parallelLanes.some((lane) => lane.id === selectedLaneId)) {
      setSelectedLaneId(snapshot.parallelLanes[0]?.id ?? null);
    }
    if (!selectedBranchRef) {
      setSelectedBranchRef(snapshot.currentBranch ?? snapshot.branches.find((branch) => branch.isCurrent)?.fullRef ?? snapshot.branches[0]?.fullRef ?? null);
    }
  }, [snapshot, selectedBranchRef, selectedLaneId, selectedStackId]);

  useEffect(() => {
    if (!snapshot || !selectedBranchRef) {
      setBranchInspection(null);
      setBranchInspectionError(null);
      setBranchInspectionLoading(false);
      return;
    }

    let cancelled = false;
    setBranchInspectionLoading(true);
    setBranchInspectionError(null);
    void inspectBranch(snapshot.repository.path, selectedBranchRef)
      .then((inspection) => {
        if (!cancelled) setBranchInspection(inspection);
      })
      .catch((inspectionError) => {
        if (!cancelled) {
          setBranchInspection(null);
          setBranchInspectionError(inspectionError instanceof Error ? inspectionError.message : String(inspectionError));
        }
      })
      .finally(() => {
        if (!cancelled) setBranchInspectionLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [snapshot?.repository.head, snapshot?.repository.path, snapshot?.changes.length, selectedBranchRef]);

  useEffect(() => {
    const currentRepoPath = snapshot?.repository.path;
    if (!currentRepoPath || !selectedFile) {
      setDiff("");
      return;
    }

    // Untracked directories (e.g. `docs/`) have no file diff — expand them instead.
    if (selectedFile.path.endsWith("/")) {
      setDiff("");
      return;
    }

    const isUntracked = selectedFile.status === "untracked";
    let cancelled = false;
    void getDiff(currentRepoPath, selectedFile.path, selectedFile.staged, isUntracked)
      .then((value) => {
        if (!cancelled) setDiff(value);
      })
      .catch((diffError) => {
        if (!cancelled) setDiff(String(diffError.message ?? diffError));
      });

    return () => {
      cancelled = true;
    };
  }, [snapshot?.repository.path, selectedFile]);

  useEffect(() => {
    const currentRepoPath = snapshot?.repository.path;
    if (!currentRepoPath || !selectedCommit) {
      setCommitFiles([]);
      setSelectedCommitFile(null);
      setCommitDiff("");
      setCommitFileError(null);
      return;
    }

    let cancelled = false;
    setCommitFilesLoading(true);
    setCommitFileError(null);
    setCommitFiles([]);
    setSelectedCommitFile(null);
    setCommitDiff("");

    void getCommitFiles(currentRepoPath, selectedCommit.sha)
      .then((files) => {
        if (cancelled) return;
        setCommitFiles(files);
        setSelectedCommitFile(files[0] ?? null);
      })
      .catch((filesError) => {
        if (cancelled) return;
        setCommitFileError(String(filesError.message ?? filesError));
      })
      .finally(() => {
        if (!cancelled) setCommitFilesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [snapshot?.repository.path, selectedCommit?.sha]);

  useEffect(() => {
    const currentRepoPath = snapshot?.repository.path;
    if (!currentRepoPath || !selectedCommit || !selectedCommitFile) {
      setCommitDiff("");
      return;
    }

    let cancelled = false;
    setCommitDiffLoading(true);
    void getCommitFileDiff(currentRepoPath, selectedCommit.sha, selectedCommitFile.path, selectedCommitFile.oldPath)
      .then((value) => {
        if (!cancelled) setCommitDiff(value);
      })
      .catch((diffError) => {
        if (!cancelled) setCommitDiff(String(diffError.message ?? diffError));
      })
      .finally(() => {
        if (!cancelled) setCommitDiffLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [snapshot?.repository.path, selectedCommit?.sha, selectedCommitFile?.path, selectedCommitFile?.oldPath]);

  const rememberRepo = (path: string) => {
    setRecentRepos((current) => {
      const next = [path, ...current.filter((item) => item !== path)].slice(0, 12);
      localStorage.setItem("opengit:recentRepos", JSON.stringify(next));
      return next;
    });
  };

  const setRepoTabsState = (nextTabs: string[]) => {
    const next = uniqueRepoPaths(nextTabs).slice(0, repoTabLimit);
    localStorage.setItem("opengit:repoTabs", JSON.stringify(next));
    return next;
  };

  const addRepoTab = (path: string) => {
    setRepoTabs((current) => setRepoTabsState([path, ...current]));
  };

  const setSnapshotState = (next: RepoSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
    setRepoPath(next.repository.path);
    localStorage.setItem("opengit:lastPath", next.repository.path);
    rememberRepo(next.repository.path);
    addRepoTab(next.repository.path);
    setSelectedBranchRef(defaultBranchRef(next));
    setSelectedCommit(next.commits[0] ?? null);
    setSelectedCommitMessage(next.commits[0]?.message ?? "");
    setWorktreeSelected(worktreeSelected && next.changes.length > 0);
    setCommitEditorOpen(false);
    setSelectedFile(next.changes[0] ?? null);
    setSelectedConflictPath(next.conflicts[0]?.path ?? null);
    setDiffMode(next.commits.length > 0 ? "commit" : "working");
    setCenterView(hasActiveConflictState(next) ? "conflict" : "graph");
    setDiffExpanded(false);
  };

  const applyAutoSnapshot = useCallback((next: RepoSnapshot) => {
    const previous = snapshotRef.current;
    if (previous && repoSnapshotSignature(previous) === repoSnapshotSignature(next)) {
      return false;
    }

    snapshotRef.current = next;
    setSnapshot(next);
    setRepoPath(next.repository.path);
    localStorage.setItem("opengit:lastPath", next.repository.path);
    setSelectedBranchRef((current) => (current && snapshotHasBranchRef(next, current) ? current : defaultBranchRef(next)));
    setSelectedCommit((current) => {
      const selected = current ? next.commits.find((commit) => commit.sha === current.sha) ?? null : next.commits[0] ?? null;
      if (!commitEditorOpenRef.current && selected?.sha !== current?.sha) {
        setSelectedCommitMessage(selected?.message ?? "");
      }
      return selected;
    });
    setWorktreeSelected((current) => current && next.changes.length > 0);
    setSelectedFile((current) => findMatchingChange(next.changes, current));
    setSelectedConflictPath((current) => (current && next.conflicts.some((conflict) => conflict.path === current) ? current : next.conflicts[0]?.path ?? null));
    setDiffMode((current) => (current === "commit" && next.commits.length === 0 ? "working" : current));
    setCenterView((current) => {
      const previouslyConflicted = previous ? hasActiveConflictState(previous) : false;
      const nowConflicted = hasActiveConflictState(next);
      if (!previouslyConflicted && nowConflicted) return "conflict";
      if (current === "conflict" && !nowConflicted) return "graph";
      return current;
    });
    return true;
  }, []);

  useEffect(() => {
    const activePath = snapshot?.repository.path;
    if (!runningInTauri || !activePath) return;

    let disposed = false;
    const refreshFromDisk = async () => {
      if (disposed || document.visibilityState === "hidden" || loadingRef.current || autoRefreshInFlightRef.current) return;

      autoRefreshInFlightRef.current = true;
      try {
        const next = await refreshRepo(activePath, historyLimitRef.current);
        if (disposed || loadingRef.current || snapshotRef.current?.repository.path !== activePath) return;

        const changed = applyAutoSnapshot(next);
        autoRefreshErrorRef.current = null;
        if (changed) {
          setOperationLog((log) => ["Repository updated from disk", ...log].slice(0, 8));
        }
      } catch (refreshError) {
        if (disposed) return;
        const message = refreshError instanceof Error ? refreshError.message : String(refreshError);
        if (autoRefreshErrorRef.current !== message) {
          autoRefreshErrorRef.current = message;
          setOperationLog((log) => [`Auto refresh failed: ${message}`, ...log].slice(0, 8));
        }
      } finally {
        autoRefreshInFlightRef.current = false;
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "hidden") {
        void refreshFromDisk();
      }
    };

    const intervalId = window.setInterval(refreshFromDisk, autoRefreshIntervalMs);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [applyAutoSnapshot, runningInTauri, snapshot?.repository.path]);

  const runSnapshotOperation = async (label: string, operation: () => Promise<RepoSnapshot>) => {
    setLoading(true);
    setError(null);
    setPushRecovery(null);
    setLockRecovery(null);
    try {
      const next = await operation();
      setSnapshotState(next);
      if (hasActiveConflictState(next)) {
        setOperationLog((log) => [`${label} stopped: resolve conflicts`, ...log].slice(0, 8));
      } else {
        setOperationLog((log) => [`${label} complete`, ...log].slice(0, 8));
      }
    } catch (operationError) {
      const message = operationError instanceof Error ? operationError.message : String(operationError);
      const apiError = operationError instanceof OpenGitApiError ? operationError : null;
      if (apiError?.code === "GIT_LOCK_EXISTS") {
        const lockPath = parseLockPath(apiError.detail);
        const lockRepoPath = snapshot?.repository.path ?? repoPath;
        if (lockPath && lockRepoPath) {
          setLockRecovery({
            message,
            repoPath: lockRepoPath,
            lockPath,
            retry: () => runSnapshotOperation(label, operation)
          });
          setOperationLog((log) => [`${label} blocked: Git lock present`, ...log].slice(0, 8));
        } else {
          setError(message);
          setOperationLog((log) => [`${label} failed: ${message}`, ...log].slice(0, 8));
        }
        return false;
      }
      if (apiError?.code === "PUSH_NON_FAST_FORWARD") {
        setPushRecovery(buildPushRecoveryState(message, apiError.detail, snapshot));
        setOperationLog((log) => [`${label} rejected: ${message}`, ...log].slice(0, 8));
      } else {
        setError(message);
        setOperationLog((log) => [`${label} failed: ${message}`, ...log].slice(0, 8));
      }
      if (apiError?.code === "AZURE_DEVOPS_TOKEN_MISSING") {
        setPreferredIntegration("Azure DevOps");
        setPreferencesSection("integrations");
        setPreferencesOpen(true);
      }
      return false;
    } finally {
      setLoading(false);
    }
    return true;
  };

  const openRepositoryPath = (path: string, limit = historyLimit) =>
    runSnapshotOperation("Open repository", () => openRepo(path, limit));

  const openCurrentPath = () => openRepositoryPath(repoPath);

  const closeRepoTab = (path: string) => {
    const nextTabs = visibleRepoTabs.filter((item) => item !== path);
    setRepoTabs(setRepoTabsState(nextTabs));
    if (path !== activeRepoPath) return;

    const nextPath = nextTabs[0];
    if (nextPath) {
      void openRepositoryPath(nextPath);
      return;
    }

    setSnapshot(null);
    setSelectedCommit(null);
    setSelectedBranchRef(null);
    setBranchInspection(null);
    setBranchInspectionError(null);
    setWorktreeSelected(false);
    setSelectedCommitMessage("");
    setCommitEditorOpen(false);
    setSelectedFile(null);
    setSelectedCommitFile(null);
    setSelectedConflictPath(null);
    setConflictVersions(null);
    setConflictVersionsError(null);
    setCommitFiles([]);
    setCommitDiff("");
    setDiff("");
    setRepoPath("");
    localStorage.removeItem("opengit:lastPath");
    setOperationLog((log) => ["Closed repository tab", ...log].slice(0, 8));
  };

  const browseForRepository = async () => {
    setError(null);
    try {
      const selected = await chooseRepositoryFolder();
      if (!selected) return;
      await openRepositoryPath(selected);
    } catch (operationError) {
      const message = operationError instanceof Error ? operationError.message : String(operationError);
      setError(message);
      setOperationLog((log) => [`Open repository failed: ${message}`, ...log].slice(0, 8));
    }
  };

  const forgetRecentRepo = (path: string) => {
    setRecentRepos((current) => {
      const next = current.filter((item) => item !== path);
      localStorage.setItem("opengit:recentRepos", JSON.stringify(next));
      return next;
    });
  };

  const clearRecentRepos = () => {
    localStorage.removeItem("opengit:recentRepos");
    setRecentRepos([]);
  };

  const refresh = () => {
    if (!snapshot) return openCurrentPath();
    return runSnapshotOperation("Refresh", () => refreshRepo(snapshot.repository.path, historyLimit));
  };

  const changeHistoryLimit = (value: number) => {
    setHistoryLimit(value);
    localStorage.setItem("opengit:historyLimit", String(value));
    if (snapshot) {
      void runSnapshotOperation("Reload history", () => refreshRepo(snapshot.repository.path, value));
    }
  };

  const loadMoreHistory = async () => {
    if (!snapshot || historyPageLoading || historyBackendSearchActive) return;

    const repoPath = snapshot.repository.path;
    const skip = snapshot.commits.length + historyPagedCommits.length;
    setHistoryPageLoading(true);
    setError(null);

    try {
      const page = await loadCommitPage(repoPath, skip, historyPageSize);
      setHistoryPagedCommits((current) => uniqueCommitsBySha([...current, ...page.commits]));
      setHistoryHasMorePages(page.hasMore);
      setHistoryPagingExhausted(!page.hasMore);
      setOperationLog((log) => [`Loaded ${page.commits.length} more commit${page.commits.length === 1 ? "" : "s"}`, ...log].slice(0, 8));
    } catch (pageError) {
      setError(pageError instanceof Error ? pageError.message : String(pageError));
    } finally {
      setHistoryPageLoading(false);
    }
  };

  const refreshProviderRepositories = async (provider?: GitProvider, localPaths = providerLocalPaths) => {
    setProviderLoading(true);
    setProviderError(null);

    // Query the requested provider, otherwise every configured provider —
    // falling back to both so first-time users still get the token prompts.
    const configuredProviders: GitProvider[] = [
      ...(azureDevOpsConfigured ? (["azure-devops"] as const) : []),
      ...(githubConfigured ? (["github"] as const) : [])
    ];
    const providers: GitProvider[] = provider
      ? [provider]
      : configuredProviders.length > 0
        ? configuredProviders
        : ["azure-devops", "github"];

    const catalogs: ProviderRepoCatalog[] = [];
    const failures: Array<{ provider: GitProvider; error: unknown }> = [];
    for (const item of providers) {
      try {
        const catalog = await listProviderRepositories(item, localPaths);
        if (item === "azure-devops") setAzureDevOpsConfigured(true);
        if (item === "github") setGithubConfigured(true);
        catalogs.push(catalog);
      } catch (operationError) {
        failures.push({ provider: item, error: operationError });
        if (operationError instanceof OpenGitApiError) {
          if (operationError.code === "AZURE_DEVOPS_TOKEN_MISSING") setAzureDevOpsConfigured(false);
          if (operationError.code === "GITHUB_TOKEN_MISSING") setGithubConfigured(false);
        }
      }
    }

    if (catalogs.length > 0) {
      const merged: ProviderRepoCatalog = {
        provider: catalogs.length === 1 ? catalogs[0].provider : "unknown",
        accounts: catalogs.flatMap((catalog) => catalog.accounts),
        projects: catalogs.flatMap((catalog) => catalog.projects),
        repositories: catalogs.flatMap((catalog) => catalog.repositories),
        refreshedAt: catalogs[catalogs.length - 1].refreshedAt
      };
      setProviderCatalog(merged);
      setOperationLog((log) => [`Repository catalog refreshed: ${merged.repositories.length} repos`, ...log].slice(0, 8));
      if (failures.length > 0) {
        const message = failures
          .map(({ provider: failed, error }) => `${failed}: ${error instanceof Error ? error.message : String(error)}`)
          .join(" — ");
        setOperationLog((log) => [`Some providers failed: ${message}`, ...log].slice(0, 8));
      }
    } else {
      const message = failures
        .map(({ provider: failed, error }) => `${failed}: ${error instanceof Error ? error.message : String(error)}`)
        .join(" — ");
      setProviderError(message || "No repository providers are configured.");
      setOperationLog((log) => [`Repository catalog failed: ${message}`, ...log].slice(0, 8));
      const tokenIssue = failures.find(
        ({ error }) =>
          error instanceof OpenGitApiError &&
          ["AZURE_DEVOPS_TOKEN_MISSING", "AZURE_DEVOPS_AUTH_FAILED", "GITHUB_TOKEN_MISSING", "GITHUB_AUTH_FAILED"].includes(error.code)
      );
      if (tokenIssue) {
        setPreferredIntegration(tokenIssue.provider === "github" ? "GitHub" : "Azure DevOps");
        setPreferencesSection("integrations");
        setPreferencesOpen(true);
      }
    }
    setProviderLoading(false);
  };

  const openRepositoryManagement = () => {
    setRepositoryManagementOpen(true);
    void refreshProviderRepositories();
  };

  const chooseDefaultCloneRoot = async () => {
    const selected = await chooseCloneRootFolder();
    if (!selected) return;
    setCloneRoot(selected);
    localStorage.setItem(cloneRootStorageKey, selected);
  };

  const cloneProviderRepository = (repo: ProviderRepository) => {
    if (!repo.cloneUrl?.url) {
      setProviderError("This repository does not include an HTTPS clone URL.");
      return;
    }
    const destination = deriveCloneDestination(cloneRoot, repo.name);
    if (!destination.ok) {
      setProviderError(destination.message);
      return;
    }
    void runSnapshotOperation(`Clone ${repo.name}`, () => cloneRepo(repo.cloneUrl!.url, destination.path, historyLimit));
  };

  const openProviderRepository = (repo: ProviderRepository) => {
    const path = repo.localMatch.path;
    if (path && (repo.localMatch.status === "cloned" || repo.localMatch.status === "current")) {
      void openRepositoryPath(path);
      return;
    }
    cloneProviderRepository(repo);
  };

  const locateProviderRepository = async (repo: ProviderRepository) => {
    const selected = await chooseRepositoryFolder();
    if (!selected) return;
    const next = { ...providerLocatedPaths, [repo.id]: selected };
    setProviderLocatedPaths(next);
    localStorage.setItem(providerLocatedPathsStorageKey, JSON.stringify(next));
    await openRepositoryPath(selected);
    void refreshProviderRepositories(repo.provider, uniqueRepoPaths([activeRepoPath, ...repoTabs, ...recentRepos, ...Object.values(next), selected]));
  };

  const openCommitDiff = (file: CommitFile) => {
    setWorktreeSelected(false);
    setSelectedCommitFile(file);
    setDiffMode("commit");
    setCenterView("diff");
  };

  const openWorkingDiff = (change: FileChange) => {
    setWorktreeSelected(true);
    setSelectedFile(change);
    setDiffMode("working");
    setCenterView("diff");
  };

  const loadFolderChildren = (dir: string): Promise<FileChange[]> => {
    const repo = snapshot?.repository.path;
    if (!repo) return Promise.resolve([]);
    return listDirectoryFiles(repo, dir);
  };

  const openBranchMenu = (target: BranchMenuTarget, event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const menuWidth = 360;
    const menuHeight = 560;
    setBranchMenu({
      target,
      x: clamp(event.clientX, 8, Math.max(8, window.innerWidth - menuWidth - 8)),
      y: clamp(event.clientY, 8, Math.max(8, window.innerHeight - menuHeight - 8))
    });
  };

  const openRefOverflowMenu = (refs: RefChip[], commit: Commit, event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const menuWidth = 300;
    const menuHeight = 420;
    setBranchMenu(null);
    setRefOverflowMenu({
      refs,
      commit,
      x: clamp(event.clientX, 8, Math.max(8, window.innerWidth - menuWidth - 8)),
      y: clamp(event.clientY, 8, Math.max(8, window.innerHeight - menuHeight - 8))
    });
  };

  const openFileMenu = (change: FileChange, staged: boolean, event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const menuWidth = 320;
    const menuHeight = 520;
    setBranchMenu(null);
    setFileMenu({
      change,
      staged,
      x: clamp(event.clientX, 8, Math.max(8, window.innerWidth - menuWidth - 8)),
      y: clamp(event.clientY, 8, Math.max(8, window.innerHeight - menuHeight - 8))
    });
  };

  const runFileMenuAction = async (action: FileMenuAction, menu: FileMenuState) => {
    setFileMenu(null);
    const { change, staged } = menu;
    const repo = requireRepo();
    if (!repo) return;

    switch (action) {
      case "stage":
        fileAction("Stage", change, stagePaths);
        break;
      case "unstage":
        fileAction("Unstage", change, unstagePaths);
        break;
      case "discard":
        if (await confirmAction(`Discard '${change.path}'?`, { title: "Discard changes", confirmLabel: "Discard" })) {
          fileAction("Discard", change, discardPaths);
        }
        break;
      case "stash":
        void runSnapshotOperation("Stash file", () => stashPushPaths(repo, [change.path], `OpenGit: stash ${change.path}`));
        break;
      case "ignore-file":
        void runSnapshotOperation("Ignore file", () => ignoreAddPattern(repo, `/${change.path}`));
        break;
      case "ignore-ext": {
        const extension = fileExtension(change.path);
        if (extension) {
          void runSnapshotOperation("Ignore extension", () => ignoreAddPattern(repo, `*.${extension}`));
        }
        break;
      }
      case "ignore-folder": {
        const directory = parentDirectory(change.path);
        if (directory) {
          void runSnapshotOperation("Ignore folder", () => ignoreAddPattern(repo, `/${directory}/`));
        }
        break;
      }
      case "open-editor":
        openFileInEditor(repo, change.path).catch((error) => setError(error instanceof Error ? error.message : String(error)));
        break;
      case "open-default":
        openFileDefault(repo, change.path).catch((error) => setError(error instanceof Error ? error.message : String(error)));
        break;
      case "reveal":
        showFileInFolder(repo, change.path).catch((error) => setError(error instanceof Error ? error.message : String(error)));
        break;
      case "copy-path":
        try {
          await navigator.clipboard.writeText(`${repo}/${change.path}`);
          setOperationLog((log) => [`Copied path for ${fileBasename(change.path)}`, ...log].slice(0, 8));
        } catch {
          setError("Clipboard is unavailable in this environment.");
        }
        break;
      case "create-patch": {
        const destination = await choosePatchSavePath(`${fileBasename(change.path)}.patch`);
        if (!destination) return;
        try {
          await exportFilePatch(repo, change.path, staged, destination);
          setOperationLog((log) => [`Saved patch to ${destination}`, ...log].slice(0, 8));
        } catch (error) {
          setError(error instanceof Error ? error.message : String(error));
        }
        break;
      }
      case "delete":
        if (await confirmAction(`Delete '${change.path}' from disk? Untracked files cannot be recovered by Git.`, { title: "Delete file", confirmLabel: "Delete" })) {
          void runSnapshotOperation("Delete file", () => deleteWorkingFile(repo, change.path));
        }
        break;
    }
  };

  const selectBranchForInspection = (target: BranchMenuTarget | DisplayBranch | Branch) => {
    setSelectedBranchRef(branchRefForInspection(target));
  };

  const checkoutInspectedBranch = (inspection: BranchInspection) => {
    if (inspection.kind === "remote") {
      runBranchTargetOperation("Checkout remote branch", (repo) => checkoutRemoteBranch(repo, inspection.branch.name));
      return;
    }
    const message = inspection.kind === "tag" ? `Checkout tag '${inspection.branch.name}'? This will detach HEAD.` : undefined;
    runBranchTargetOperation("Checkout branch", (repo) => checkoutBranch(repo, inspection.branch.name), message);
  };

  const fetchForInspectedBranch = () => {
    const repo = requireRepo();
    if (!repo) return;
    void runSnapshotOperation("Fetch", () => fetchRepo(repo));
  };

  const pullInspectedBranch = (inspection: BranchInspection) => {
    if (!inspection.branch.isCurrent) {
      setError("Checkout this branch before pulling so OpenGit does not update the wrong working tree.");
      return;
    }
    const repo = requireRepo();
    if (!repo) return;
    void runSnapshotOperation("Pull fast-forward", () => pullRepoFastForward(repo));
  };

  const pushInspectedBranch = (inspection: BranchInspection) => {
    const repo = requireRepo();
    const remote = snapshot?.remotes[0];
    if (!repo) return;
    if (!remote) {
      setError("Add a remote before pushing.");
      return;
    }
    if (inspection.kind !== "local" && inspection.kind !== "unknown") {
      setError("Only local branches can be pushed.");
      return;
    }
    void runSnapshotOperation("Push branch", () => pushRepo(repo, remote.name, inspection.branch.name, false, !inspection.upstream));
  };

  const openInspectorBranchMenu = (inspection: BranchInspection, event: ReactMouseEvent<HTMLElement>) => {
    openBranchMenu(targetFromInspection(inspection), event);
  };

  const pendingBranchAction = (label: string) => {
    setBranchMenu(null);
    const message = `${label} is planned but not implemented yet.`;
    setError(message);
    setOperationLog((log) => [message, ...log].slice(0, 8));
  };

  // In-app text prompt. Replaces window.prompt, which Tauri's macOS WebView (WKWebView)
  // does not implement -- it returns null without showing a dialog, so prompt-based flows
  // silently fail in the built desktop app.
  const promptText = useCallback((request: PromptRequest) => {
    return new Promise<string | null>((resolve) => {
      promptResolverRef.current?.(null);
      promptResolverRef.current = resolve;
      setPromptRequest(request);
    });
  }, []);

  const resolvePrompt = useCallback((value: string | null) => {
    const resolver = promptResolverRef.current;
    promptResolverRef.current = null;
    setPromptRequest(null);
    resolver?.(value);
  }, []);

  // In-app confirm. Replaces window.confirm for the same reason as promptText:
  // Tauri's macOS WebView (WKWebView) does not implement it and returns falsy
  // without showing a dialog, so confirm-gated flows silently no-op.
  const confirmAction = useCallback((message: string, options?: Omit<ConfirmRequest, "message">) => {
    return new Promise<boolean>((resolve) => {
      confirmResolverRef.current?.(false);
      confirmResolverRef.current = resolve;
      setConfirmRequest({ message, ...options });
    });
  }, []);

  const resolveConfirm = useCallback((value: boolean) => {
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmRequest(null);
    resolver?.(value);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const checkForUpdate = async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (cancelled || !update) return;
        const install = await confirmAction(
          `OpenGit ${update.version} is available. Download and install it now? The app restarts when the update finishes.`,
          { title: "Update available", confirmLabel: "Install update" }
        );
        if (!install) return;
        await update.downloadAndInstall();
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      } catch {
        /* update checks are best-effort; never block startup on them */
      }
    };
    void checkForUpdate();
    return () => {
      cancelled = true;
    };
  }, [confirmAction]);

  const copyMenuText = async (label: string, value?: string) => {
    setBranchMenu(null);
    if (!value) {
      setError(`${label} is unavailable for this item.`);
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setOperationLog((log) => [`Copied ${label}`, ...log].slice(0, 8));
    } catch {
      setError("Clipboard is unavailable in this environment.");
    }
  };

  const runBranchTargetOperation = async (
    label: string,
    operation: (repo: string) => Promise<RepoSnapshot>,
    confirmMessage?: string
  ) => {
    const repo = requireRepo();
    if (!repo) return;
    setBranchMenu(null);
    if (confirmMessage && !(await confirmAction(confirmMessage, { title: label }))) return;
    void runSnapshotOperation(label, () => operation(repo));
  };

  const handleBranchMenuAction = async (action: BranchMenuAction, target: BranchMenuTarget) => {
    const branchRecord = snapshot ? findBranchByName(snapshot, target.name) : undefined;
    const currentBranch = snapshot?.currentBranch ?? "current branch";
    const remote = snapshot?.remotes[0];

    if (action === "copy-name") {
      void copyMenuText(target.isTag ? "tag name" : "branch name", target.name);
      return;
    }

    if (action === "copy-sha") {
      void copyMenuText("commit SHA", target.commitSha);
      return;
    }

    if (action === "open-pr" || action === "copy-branch-link" || action === "copy-commit-link") {
      const webInfo = providerWebInfo(snapshot);
      if (!webInfo) {
        setBranchMenu(null);
        setError("This repository has no recognized GitHub or Azure DevOps remote.");
        return;
      }
      if (action === "copy-commit-link") {
        void copyMenuText("commit link", target.commitSha ? providerCommitUrl(webInfo, target.commitSha) : undefined);
        return;
      }
      const branchName = stripRemotePrefix(target);
      if (action === "copy-branch-link") {
        void copyMenuText("branch link", providerBranchUrl(webInfo, branchName));
        return;
      }
      setBranchMenu(null);
      void openExternalUrl(providerPrCreateUrl(webInfo, branchName));
      setOperationLog((log) => [`Opened pull request page for ${branchName}`, ...log].slice(0, 8));
      return;
    }

    if (action === "explain") {
      setBranchMenu(null);
      const repo = requireRepo();
      if (!repo) return;
      const branchName = stripRemotePrefix(target);
      setBranchExplain({ branch: branchName, loading: true });
      void explainBranchChanges(repo, target.isRemote ? target.name : branchName, openAiModel, aiProvider)
        .then((result) => {
          setBranchExplain({ branch: result.branch, base: result.base, markdown: result.markdown, loading: false });
        })
        .catch((explainError) => {
          setBranchExplain({
            branch: branchName,
            loading: false,
            error: explainError instanceof Error ? explainError.message : String(explainError)
          });
        });
      return;
    }

    if (action === "pull") {
      runBranchTargetOperation("Pull fast-forward", (repo) => pullRepoFastForward(repo));
      return;
    }

    if (action === "push") {
      if (!remote) {
        setBranchMenu(null);
        setError("Add a remote before pushing.");
        return;
      }
      runBranchTargetOperation("Push branch", (repo) => pushRepo(repo, remote.name, target.name, false, !branchRecord?.upstream));
      return;
    }

    if (action === "set-upstream") {
      if (!remote) {
        setBranchMenu(null);
        setError("Add a remote before setting upstream.");
        return;
      }
      runBranchTargetOperation("Set upstream", (repo) => pushRepo(repo, remote.name, target.name, false, true));
      return;
    }

    if (action === "merge") {
      runBranchTargetOperation(
        "Merge branch",
        (repo) => mergeBranch(repo, target.name),
        `Merge '${target.name}' into '${currentBranch}'?`
      );
      return;
    }

    if (action === "rebase") {
      runBranchTargetOperation(
        "Rebase branch",
        (repo) => rebaseOnto(repo, target.name),
        `Rebase '${currentBranch}' onto '${target.name}'?`
      );
      return;
    }

    if (action === "checkout") {
      if (target.isRemote) {
        runBranchTargetOperation("Checkout remote branch", (repo) => checkoutRemoteBranch(repo, target.name));
        return;
      }
      const message = target.isTag ? `Checkout tag '${target.name}'? This will detach HEAD.` : undefined;
      runBranchTargetOperation("Checkout branch", (repo) => checkoutBranch(repo, target.name), message);
      return;
    }

    if (action === "stack-create") {
      setBranchMenu(null);
      createStackFromBranch(target.name);
      return;
    }

    if (action === "stack-add") {
      setBranchMenu(null);
      addBranchToSelectedStack(target.name);
      return;
    }

    if (action === "stack-child") {
      setBranchMenu(null);
      createChildBranchForStack(target.name);
      return;
    }

    if (action === "stack-restack") {
      setBranchMenu(null);
      restackSelectedStack();
      return;
    }

    if (action === "stack-pr-plan") {
      setBranchMenu(null);
      prepareSelectedStackPrChain();
      return;
    }

    if (action === "create-branch") {
      const defaultName = defaultBranchFromTarget(target);
      setBranchMenu(null);
      const nextName = await promptText({
        title: "Create branch",
        label: `New branch from ${target.commitSha ? shortSha(target.commitSha) : target.name}`,
        defaultValue: defaultName,
        placeholder: "feature/my-branch",
        confirmLabel: "Create branch"
      });
      if (!nextName?.trim()) return;
      runBranchTargetOperation("Create branch", (repo) => createBranch(repo, nextName.trim(), true, target.commitSha ?? target.name));
      return;
    }

    if (action === "cherry-pick" && target.commitSha) {
      runBranchTargetOperation(
        "Cherry-pick commit",
        (repo) => cherryPickCommit(repo, target.commitSha!),
        `Cherry-pick commit ${shortSha(target.commitSha)} onto '${currentBranch}'?`
      );
      return;
    }

    if (action === "revert" && target.commitSha) {
      runBranchTargetOperation(
        "Revert commit",
        (repo) => revertCommit(repo, target.commitSha!),
        `Revert commit ${shortSha(target.commitSha)} on '${currentBranch}'?`
      );
      return;
    }

    if (action === "rename") {
      setBranchMenu(null);
      const nextName = await promptText({
        title: "Rename branch",
        label: `Rename '${target.name}' to`,
        defaultValue: target.name,
        confirmLabel: "Rename"
      });
      if (!nextName?.trim() || nextName.trim() === target.name) return;
      runBranchTargetOperation("Rename branch", (repo) => renameBranch(repo, target.name, nextName.trim()));
      return;
    }

    if (action === "delete") {
      runBranchTargetOperation("Delete branch", (repo) => deleteBranch(repo, target.name, false), `Delete branch '${target.name}'?`);
      return;
    }

    if (action === "create-tag" || action === "create-annotated-tag") {
      setBranchMenu(null);
      const tagName = await promptText({
        title: action === "create-annotated-tag" ? "Create annotated tag" : "Create tag",
        label: `Tag ${target.commitSha ? shortSha(target.commitSha) : target.name}`,
        placeholder: "v1.0.0",
        confirmLabel: "Create tag"
      });
      if (!tagName?.trim()) return;
      const message =
        action === "create-annotated-tag"
          ? (await promptText({ title: "Tag message", label: `Annotation for '${tagName.trim()}'`, defaultValue: tagName.trim() }))?.trim()
          : undefined;
      runBranchTargetOperation("Create tag", (repo) => createTag(repo, tagName.trim(), target.commitSha ?? target.name, message));
      return;
    }

    pendingBranchAction(menuPendingLabel(action));
  };

  const toggleLayoutSection = (section: "sidebar" | "detail" | "bottom") => {
    setLayout((current) => {
      if (section === "sidebar") return { ...current, sidebarCollapsed: !current.sidebarCollapsed };
      if (section === "detail") return { ...current, detailCollapsed: !current.detailCollapsed };
      return { ...current, bottomCollapsed: !current.bottomCollapsed };
    });
  };

  const startResize = (target: ResizeTarget, event: ReactPointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const initial = layout;
    const resizeClass =
      target === "bottom" || target === "sidebarBranches" || target === "sidebarInspector" || target === "sidebarRemotes" || target === "sidebarStashes" || target === "detailSelection"
        ? "resizing-layout-horizontal"
        : "resizing-layout-vertical";

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      setLayout((current) => {
        const next = { ...current };
        if (target === "sidebar") next.sidebarWidth = clamp(initial.sidebarWidth + deltaX, 180, 520);
        if (target === "detail") next.detailWidth = clamp(initial.detailWidth - deltaX, 260, 680);
        if (target === "bottom") next.bottomHeight = clamp(initial.bottomHeight - deltaY, 150, 520);
        if (target === "sidebarBranches") next.sidebarBranchesHeight = clamp(initial.sidebarBranchesHeight + deltaY, 180, 760);
        if (target === "sidebarInspector") next.sidebarInspectorHeight = clamp(initial.sidebarInspectorHeight + deltaY, 180, 760);
        if (target === "sidebarRemotes") next.sidebarRemotesHeight = clamp(initial.sidebarRemotesHeight + deltaY, 80, 360);
        if (target === "sidebarStashes") next.sidebarStashesHeight = clamp(initial.sidebarStashesHeight + deltaY, 80, 360);
        if (target === "detailSelection") next.detailSelectionHeight = clamp(initial.detailSelectionHeight + deltaY, 120, 460);
        if (target === "bottomOperations") next.bottomOperationsWidth = clamp(initial.bottomOperationsWidth - deltaX, 180, 480);
        return next;
      });
    };

    const stopResize = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      document.body.classList.remove("resizing-layout", resizeClass);
    };

    document.body.classList.add("resizing-layout", resizeClass);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  };

  const startHistoryColumnResize = (column: HistoryColumnKey, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const initialWidth = historyColumnWidths[column];
    const limits = historyColumnLimits[column];

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      setHistoryColumnWidths((current) => {
        const next = {
          ...current,
          [column]: clamp(initialWidth + deltaX, limits.min, limits.max)
        };
        saveHistoryColumnWidths(next);
        return next;
      });
    };

    const stopResize = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      document.body.classList.remove("resizing-layout", "resizing-history-column");
    };

    document.body.classList.add("resizing-layout", "resizing-history-column");
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  };

  const requireRepo = () => {
    if (!snapshot) {
      setError("Open a repository first.");
      return null;
    }
    return snapshot.repository.path;
  };

  const createBranchInteractive = async () => {
    const repo = requireRepo();
    if (!repo || !snapshot) return;
    const base =
      snapshot.currentBranch && !["HEAD", "(detached)"].includes(snapshot.currentBranch)
        ? snapshot.currentBranch
        : undefined;
    const nextName = await promptText({
      title: "New branch",
      label: base ? `New branch from '${base}'` : "New branch from current HEAD",
      placeholder: "feature/my-branch",
      confirmLabel: "Create branch"
    });
    if (!nextName?.trim()) return;
    await runSnapshotOperation("Create branch", () => createBranch(repo, nextName.trim(), true, base));
    setOperationLog((log) => [`Created branch ${nextName.trim()}`, ...log].slice(0, 8));
  };

  const fileAction = (label: string, change: FileChange, operation: (repo: string, paths: string[]) => Promise<RepoSnapshot>) => {
    const repo = requireRepo();
    if (!repo) return;
    void runSnapshotOperation(label, () => operation(repo, [change.path]));
  };

  const batchFileAction = (
    label: string,
    changes: FileChange[],
    operation: (repo: string, paths: string[]) => Promise<RepoSnapshot>
  ) => {
    const repo = requireRepo();
    if (!repo || changes.length === 0) return;
    const paths = [...new Set(changes.map((change) => change.path))];
    void runSnapshotOperation(label, () => operation(repo, paths));
  };

  const createStackFromBranch = async (branchName?: string) => {
    const repo = requireRepo();
    if (!repo || !snapshot) return;
    const currentBranch = branchName ?? snapshot.currentBranch ?? "";
    if (!currentBranch || currentBranch === "HEAD" || currentBranch === "(detached)") {
      setError("Checkout or select a local branch before creating a stack.");
      return;
    }
    const defaultTrunk = snapshot.branches.find((branch) => branch.name === "main" || branch.name === "master")?.name ?? currentBranch;
    const trunk = await promptText({ title: "Create stack", label: "Trunk branch", defaultValue: defaultTrunk, confirmLabel: "Next" });
    if (!trunk?.trim()) return;
    const name = await promptText({ title: "Create stack", label: "Stack name", defaultValue: `${currentBranch} stack`, confirmLabel: "Create stack" });
    if (!name?.trim()) return;
    const branches = currentBranch === trunk.trim() ? [] : [currentBranch];
    void runSnapshotOperation("Create stack", () => createStack(repo, name.trim(), trunk.trim(), branches)).then(() => {
      setOperationLog((log) => [`Created stack ${name.trim()}`, ...log].slice(0, 8));
    });
  };

  const addBranchToSelectedStack = (branchName?: string) => {
    const repo = requireRepo();
    if (!repo || !snapshot) return;
    const stack = selectedStack ?? snapshot.branchStacks[0];
    const branch = branchName ?? snapshot.currentBranch;
    if (!stack) {
      createStackFromBranch(branch ?? undefined);
      return;
    }
    if (!branch || branch === "HEAD" || branch === "(detached)") {
      setError("Select a local branch to add to the stack.");
      return;
    }
    void runSnapshotOperation("Add branch to stack", () => addBranchToStack(repo, stack.id, branch));
  };

  const createChildBranchForStack = async (baseBranch?: string) => {
    const repo = requireRepo();
    if (!repo || !selectedStack) {
      setError("Select a stack before creating a child branch.");
      return;
    }
    const base = baseBranch ?? selectedStack.items.at(-1)?.branch ?? selectedStack.trunk;
    const name = await promptText({
      title: "Create child branch",
      label: `Child of '${base.replace(/^origin\//, "")}'`,
      defaultValue: `${base.replace(/^origin\//, "")}-child`,
      confirmLabel: "Create branch"
    });
    if (!name?.trim()) return;
    void runSnapshotOperation("Create stack child branch", () => createStackChild(repo, selectedStack.id, base, name.trim()));
  };

  const restackSelectedStack = async () => {
    const repo = requireRepo();
    if (!repo || !selectedStack) {
      setError("Select a stack before restacking.");
      return;
    }
    if (!(await confirmAction(`Restack '${selectedStack.name}' from ${selectedStack.trunk}? OpenGit will create a safety snapshot first.`, { title: "Restack stack", confirmLabel: "Restack" }))) return;
    void runSnapshotOperation("Restack stack", () => restackStack(repo, selectedStack.id));
  };

  const syncSelectedStackTrunk = async () => {
    const repo = requireRepo();
    if (!repo || !selectedStack) return;
    if (!(await confirmAction(`Checkout and fast-forward pull trunk '${selectedStack.trunk}'?`, { title: "Sync trunk" }))) return;
    void runSnapshotOperation("Sync stack trunk", () => syncStackTrunk(repo, selectedStack.id));
  };

  const pushSelectedStack = () => {
    const repo = requireRepo();
    if (!repo || !selectedStack) return;
    void runSnapshotOperation("Push stack", () => pushStack(repo, selectedStack.id));
  };

  const prepareSelectedStackPrChain = () => {
    if (!selectedStack) return;
    const lines = selectedStack.items.map((item) => `${item.branch} -> base ${item.baseBranch}`).join("\n");
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(lines).catch(() => undefined);
    }
    setOperationLog((log) => [`Prepared PR chain for ${selectedStack.name}`, ...log].slice(0, 8));
  };

  const reorderSelectedStackBranch = (branch: string, direction: -1 | 1) => {
    const repo = requireRepo();
    if (!repo || !selectedStack) return;
    const names = selectedStack.items.map((item) => item.branch);
    const index = names.indexOf(branch);
    const nextIndex = index + direction;
    if (index === -1 || nextIndex < 0 || nextIndex >= names.length) return;
    [names[index], names[nextIndex]] = [names[nextIndex], names[index]];
    void runSnapshotOperation("Reorder stack", () => reorderStack(repo, selectedStack.id, names));
  };

  const removeSelectedStackBranch = async (branch: string) => {
    const repo = requireRepo();
    if (!repo || !selectedStack) return;
    if (!(await confirmAction(`Remove '${branch}' from '${selectedStack.name}'? This does not delete the branch.`, { title: "Remove from stack", confirmLabel: "Remove" }))) return;
    void runSnapshotOperation("Remove branch from stack", () => removeBranchFromStack(repo, selectedStack.id, branch));
  };

  const createLaneFromChanges = async (changes: FileChange[] = selectedFile ? [selectedFile] : []) => {
    const repo = requireRepo();
    if (!repo || !snapshot) return;
    const paths = [...new Set(changes.map((change) => change.path))];
    if (paths.length === 0) {
      setError("Select at least one changed file before creating a parallel lane.");
      return;
    }
    const name = await promptText({
      title: "Create parallel lane",
      label: "Lane name",
      defaultValue: laneNameFromPath(paths[0]),
      confirmLabel: "Create lane"
    });
    if (!name?.trim()) return;
    const targetBranch = snapshot.currentBranch && !["HEAD", "(detached)"].includes(snapshot.currentBranch) ? snapshot.currentBranch : "main";
    void runSnapshotOperation("Create parallel lane", () => createLane(repo, name.trim(), targetBranch, paths)).then(() => {
      setParallelMode(true);
    });
  };

  const assignChangeToLane = async (change: FileChange) => {
    const repo = requireRepo();
    if (!repo || !snapshot) return;
    if (snapshot.parallelLanes.length === 0) {
      void createLaneFromChanges([change]);
      return;
    }
    const defaultLane = selectedLane ?? snapshot.parallelLanes[0];
    const laneName = await promptText({
      title: "Assign to lane",
      label: `Lane for '${change.path}'`,
      defaultValue: defaultLane.name,
      confirmLabel: "Assign"
    });
    if (!laneName?.trim()) return;
    const lane = snapshot.parallelLanes.find((item) => item.name === laneName.trim()) ?? defaultLane;
    void runSnapshotOperation("Assign file to lane", () => assignPathsToLane(repo, lane.id, [change.path]));
  };

  const applySelectedLane = () => {
    const repo = requireRepo();
    if (!repo || !selectedLane) return;
    void runSnapshotOperation("Apply lane", () => applyLane(repo, selectedLane.id));
  };

  const unapplySelectedLane = () => {
    const repo = requireRepo();
    if (!repo || !selectedLane) return;
    void runSnapshotOperation("Unapply lane", () => unapplyLane(repo, selectedLane.id));
  };

  const commitSelectedLane = async () => {
    const repo = requireRepo();
    if (!repo || !selectedLane) return;
    const message = await promptText({
      title: "Commit lane",
      label: `Commit message for '${selectedLane.name}'`,
      defaultValue: commitMessage || selectedLane.name,
      confirmLabel: "Commit"
    });
    if (!message?.trim()) return;
    void runSnapshotOperation("Commit lane", () => commitLane(repo, selectedLane.id, message.trim()));
  };

  const discardSelectedLane = async () => {
    const repo = requireRepo();
    if (!repo || !selectedLane) return;
    if (!(await confirmAction(`Discard lane '${selectedLane.name}'? OpenGit will create a safety snapshot first.`, { title: "Discard lane", confirmLabel: "Discard" }))) return;
    void runSnapshotOperation("Discard lane", () => discardLane(repo, selectedLane.id));
  };

  const materializeSelectedLane = async () => {
    const repo = requireRepo();
    if (!repo || !selectedLane) return;
    const branchName = await promptText({
      title: "Materialize lane as branch",
      label: "Branch name",
      defaultValue: `${selectedLane.targetBranch}-${selectedLane.name}`.replace(/\s+/g, "-"),
      confirmLabel: "Create branch"
    });
    if (!branchName?.trim()) return;
    void runSnapshotOperation("Materialize lane branch", () => materializeLaneBranch(repo, selectedLane.id, branchName.trim()));
  };

  const commitChanges = () => {
    const repo = requireRepo();
    if (!repo) return;
    void runSnapshotOperation("Commit", () => commit(repo, commitMessage, amend)).then((committed) => {
      if (committed) {
        setCommitMessage("");
        setAmend(false);
      }
    });
  };

  const generateCommitMessage = async () => {
    const repo = requireRepo();
    if (!repo) return;
    if (stagedChanges.length === 0) {
      setError("Stage files before generating a commit message.");
      return;
    }

    setAiGeneratingCommit(true);
    setError(null);
    try {
      const suggestion = await generateAiCommitMessage(repo, openAiModel, aiProvider);
      const nextMessage = [suggestion.summary, suggestion.description].filter((part) => part.trim()).join("\n\n");
      setCommitMessage(nextMessage);
      setOperationLog((log) => ["Generated commit message from staged files", ...log].slice(0, 8));
    } catch (operationError) {
      const message = operationError instanceof Error ? operationError.message : String(operationError);
      setError(message);
      setOperationLog((log) => [`AI commit message failed: ${message}`, ...log].slice(0, 8));
      if (operationError instanceof OpenGitApiError && operationError.code === "OPENAI_KEY_MISSING") {
        setOpenAiConfigured(false);
        setPreferencesSection("integrations");
        setPreferencesOpen(true);
        return;
      }
    } finally {
      setAiGeneratingCommit(false);
    }
  };

  const generateBranchName = async () => {
    const repo = requireRepo();
    if (!repo) return;

    setAiGeneratingBranch(true);
    setError(null);
    try {
      const suggestion = await generateAiBranchName(repo, openAiModel);
      const nextName = await promptText({
        title: "Create branch from AI suggestion",
        label: "Branch name",
        defaultValue: suggestion.name,
        confirmLabel: "Create branch"
      });
      if (!nextName?.trim()) return;
      await runSnapshotOperation("Create AI-named branch", () => createBranch(repo, nextName.trim(), true));
      setOperationLog((log) => ["Generated branch name from current changes", ...log].slice(0, 8));
    } catch (operationError) {
      const message = operationError instanceof Error ? operationError.message : String(operationError);
      setError(message);
      setOperationLog((log) => [`AI branch name failed: ${message}`, ...log].slice(0, 8));
      if (operationError instanceof OpenGitApiError && operationError.code === "OPENAI_KEY_MISSING") {
        setOpenAiConfigured(false);
        setPreferencesSection("integrations");
        setPreferencesOpen(true);
      }
    } finally {
      setAiGeneratingBranch(false);
    }
  };

  const generatePrDescription = async () => {
    const repo = requireRepo();
    if (!repo) return;

    setAiGeneratingPr(true);
    setError(null);
    try {
      const suggestion = await generateAiPrDescription(repo, openAiModel, aiProvider);
      setAiPrDraft(suggestion);
      setOperationLog((log) => ["Generated PR title and description from branch diff", ...log].slice(0, 8));
    } catch (operationError) {
      const message = operationError instanceof Error ? operationError.message : String(operationError);
      setError(message);
      setOperationLog((log) => [`AI PR text failed: ${message}`, ...log].slice(0, 8));
      if (operationError instanceof OpenGitApiError && operationError.code === "OPENAI_KEY_MISSING") {
        setOpenAiConfigured(false);
        setPreferencesSection("integrations");
        setPreferencesOpen(true);
      }
    } finally {
      setAiGeneratingPr(false);
    }
  };

  const updateSelectedCommitMessage = async () => {
    const repo = requireRepo();
    if (!repo || !selectedCommit) return;
    if (selectedCommitIsHead && stagedChanges.length > 0) {
      setError("Unstage files before updating the HEAD commit message so staged changes are not amended into it.");
      return;
    }
    if (!selectedCommitIsHead && (snapshot?.changes.length ?? 0) > 0) {
      setError("Older commit editing requires a clean working tree. Commit, stash, or discard local changes first.");
      return;
    }
    if (!selectedCommitMessage.trim()) {
      setError("Commit message is required.");
      return;
    }
    if (!selectedCommitIsHead) {
      const confirmed = await confirmAction(
        "Reword this older commit? OpenGit will create a safety snapshot, then rewrite the current branch's linear history. If the branch was pushed, you may need force-with-lease.",
        { title: "Reword commit", confirmLabel: "Reword" }
      );
      if (!confirmed) return;
    }
    void runSnapshotOperation("Update commit message", () => updateCommitMessage(repo, selectedCommit.sha, selectedCommitMessage.trim()));
  };

  const undoLastCommitAction = async () => {
    const repo = requireRepo();
    if (!repo) return;
    if (!(await confirmAction("Undo the last commit and keep its changes unstaged? OpenGit will create a safety snapshot first.", { title: "Undo last commit", confirmLabel: "Undo" }))) return;
    void runSnapshotOperation("Undo last commit", () => undoLastCommit(repo));
  };

  const squashLastCommitsAction = async () => {
    const repo = requireRepo();
    if (!repo) return;
    const defaultMessage = selectedCommitMessage.trim() || selectedCommit?.message || snapshot?.commits[0]?.message || "";
    const message = await promptText({
      title: "Squash last two commits",
      label: "Message for squashed commit",
      defaultValue: defaultMessage,
      confirmLabel: "Continue"
    });
    if (!message?.trim()) return;
    if (!(await confirmAction("Squash the last two linear commits? OpenGit will create a safety snapshot first.", { title: "Squash commits", confirmLabel: "Squash" }))) return;
    void runSnapshotOperation("Squash last commits", () => squashLastCommits(repo, message.trim()));
  };

  const restoreUndoSnapshotAction = async (snapshotId: string, label: string) => {
    const repo = requireRepo();
    if (!repo) return;
    if (!(await confirmAction(`Restore safety snapshot '${label}'? Current HEAD and patches will be snapshotted first.`, { title: "Restore snapshot", confirmLabel: "Restore" }))) return;
    void runSnapshotOperation("Restore safety snapshot", () => restoreUndoSnapshot(repo, snapshotId));
  };

  const copyPrDraft = async () => {
    if (!aiPrDraft) return;
    const body = `${aiPrDraft.title}\n\n${aiPrDraft.description}`.trim();
    try {
      await navigator.clipboard.writeText(body);
      setOperationLog((log) => ["Copied PR draft", ...log].slice(0, 8));
    } catch {
      setError("Clipboard is unavailable in this environment.");
    }
  };

  const applySelectedCommit = (commitItem: Commit) => {
    setSelectedCommit(commitItem);
    setWorktreeSelected(false);
    setSelectedCommitMessage(commitItem.message);
    setCommitEditorOpen(false);
    setDiffMode("commit");
    setCenterView("graph");
    setDiffExpanded(false);
  };

  const selectCommitBySha = (sha: string) => {
    const commitItem = historyLoadedCommits.find((item) => item.sha === sha);
    if (commitItem) {
      applySelectedCommit(commitItem);
      return;
    }

    if (!snapshot || !runningInTauri) {
      setError("That commit is outside the loaded history window. Load more history to show it.");
      return;
    }

    setError(null);
    void lookupCommit(snapshot.repository.path, sha)
      .then((fetchedCommit) => {
        setHistorySupplementalCommits((current) => uniqueCommitsBySha([...current, fetchedCommit]));
        applySelectedCommit(fetchedCommit);
        setOperationLog((log) => [`Loaded commit ${shortSha(fetchedCommit.sha)}`, ...log].slice(0, 8));
      })
      .catch((lookupError) => {
        setError(lookupError instanceof Error ? lookupError.message : String(lookupError));
      });
  };

  const stashCurrent = () => {
    const repo = requireRepo();
    if (!repo) return;
    void runSnapshotOperation("Stash", () => stashPush(repo, stashMessage)).then(() => setStashMessage(""));
  };

  const addRepositoryRemote = () => {
    const repo = requireRepo();
    if (!repo || !remoteName.trim() || !remoteUrl.trim()) return;
    void runSnapshotOperation("Add remote", () => addRemote(repo, remoteName.trim(), remoteUrl.trim())).then(() => {
      setRemoteName("origin");
      setRemoteUrl("");
    });
  };

  const switchBranchFromTopbar = (branch: DisplayBranch) => {
    if (branch.isCurrent || branch.isUnborn) {
      setBranchSwitcherOpen(false);
      return;
    }

    const repo = requireRepo();
    if (!repo) return;
    setBranchSwitcherOpen(false);
    setBranchSearch("");
    if (branch.isRemote) {
      void runSnapshotOperation("Checkout remote branch", () => checkoutRemoteBranch(repo, branch.name));
      return;
    }
    void runSnapshotOperation("Checkout branch", () => checkoutBranch(repo, branch.name));
  };

  const pushCurrentBranch = () => {
    if (!snapshot) {
      setError("Open a repository before pushing.");
      return;
    }

    const currentBranch = snapshot.currentBranch;
    if (!currentBranch || currentBranch === "(detached)" || currentBranch === "HEAD") {
      setError("Checkout a branch before pushing.");
      return;
    }

    const remote = snapshot.remotes[0];
    if (!remote) {
      setError("Add a remote before pushing.");
      setOperationLog((log) => ["Push blocked: add a remote before pushing", ...log].slice(0, 8));
      return;
    }

    if (!snapshot.upstream) {
      void runSnapshotOperation("Push and set upstream", () =>
        pushRepo(snapshot.repository.path, remote.name, currentBranch, false, true)
      );
      return;
    }

    void runSnapshotOperation("Push", () => pushRepo(snapshot.repository.path));
  };

  const pullFastForwardAfterRejectedPush = () => {
    if (!snapshot) {
      setPushRecovery(null);
      return;
    }

    void runSnapshotOperation("Pull fast-forward", () => pullRepoFastForward(snapshot.repository.path));
  };

  const pullRebaseAfterRejectedPush = () => {
    if (!snapshot) {
      setPushRecovery(null);
      return;
    }

    void runSnapshotOperation("Pull rebase", () => pullRepoRebase(snapshot.repository.path));
  };

  const forcePushAfterRejectedPush = async () => {
    if (!snapshot || !pushRecovery) {
      return;
    }

    const branch = pushRecovery.branch ?? snapshot.currentBranch;
    const branchLabel = branch ? `'${branch}'` : "the current branch";
    if (!(await confirmAction(`Force push ${branchLabel} with --force-with-lease?`, { title: "Force push", confirmLabel: "Force push" }))) {
      return;
    }

    void runSnapshotOperation("Force push", () =>
      pushRepo(snapshot.repository.path, pushRecovery.remote, branch, true, false)
    );
  };

  const clearLockAndRetry = async () => {
    if (!lockRecovery) return;
    const recovery = lockRecovery;
    setLockRecovery(null);
    setLoading(true);
    setError(null);
    try {
      const cleared = await clearRepoLock(recovery.repoPath, recovery.lockPath);
      setSnapshotState(cleared);
      setOperationLog((log) => ["Cleared Git lock", ...log].slice(0, 8));
    } catch (clearError) {
      const message = clearError instanceof Error ? clearError.message : String(clearError);
      setError(message);
      setOperationLog((log) => [`Clear lock failed: ${message}`, ...log].slice(0, 8));
      setLoading(false);
      return;
    }
    setLoading(false);
    await recovery.retry();
  };

  const resolveSelectedConflict = (strategy: ConflictStrategy) => {
    if (!snapshot || !selectedConflict) return;
    void runSnapshotOperation(`Resolve ${selectedConflict.path}`, () =>
      resolveConflict(snapshot.repository.path, selectedConflict.path, strategy)
    );
  };

  const markSelectedConflictResolved = () => {
    if (!snapshot || !selectedConflict) return;
    void runSnapshotOperation(`Mark ${selectedConflict.path} resolved`, () =>
      markConflictResolved(snapshot.repository.path, selectedConflict.path)
    );
  };

  const continueCurrentGitOperation = () => {
    if (!snapshot) return;
    void runSnapshotOperation("Continue operation", () => continueGitOperation(snapshot.repository.path));
  };

  const abortCurrentGitOperation = async () => {
    if (!snapshot) return;
    if (!(await confirmAction("Abort the current Git operation and return the repository to the previous state?", { title: "Abort operation", confirmLabel: "Abort" }))) return;
    void runSnapshotOperation("Abort operation", () => abortGitOperation(snapshot.repository.path));
  };

  const openIssueReport = async () => {
    let version = "dev";
    if (isTauri()) {
      try {
        version = await getVersion();
      } catch {
        /* fall back to "dev" outside the Tauri shell */
      }
    }
    const body = [
      "### Describe the issue",
      "",
      "",
      "### Environment",
      `- OpenGit: ${version}`,
      `- Platform: ${navigator.platform}`,
      `- User agent: ${navigator.userAgent}`
    ].join("\n");
    await openExternalUrl(`https://github.com/ldallalio/opengit/issues/new?body=${encodeURIComponent(body)}`);
  };

  return (
    <main className="app-shell">
      <aside className="rail" aria-label="Primary">
        <div className="brand-mark">
          <GitFork size={21} />
        </div>
        <IconButton label="Search commands" onClick={() => setPaletteOpen(true)}>
          <Search size={18} />
        </IconButton>
        <IconButton label="Refresh" onClick={refresh} disabled={loading}>
          <RefreshCw size={18} />
        </IconButton>
        <IconButton label="Fetch" onClick={() => snapshot && runSnapshotOperation("Fetch", () => fetchRepo(snapshot.repository.path))}>
          <ArrowDownToLine size={18} />
        </IconButton>
        <IconButton label="Pull" onClick={() => snapshot && runSnapshotOperation("Pull", () => pullRepo(snapshot.repository.path))}>
          <Shuffle size={18} />
        </IconButton>
        <IconButton label="Push" onClick={pushCurrentBranch} disabled={!snapshot || loading}>
          <UploadCloud size={18} />
        </IconButton>
        <div className="rail-spacer" />
        <IconButton label="Report an issue" onClick={() => void openIssueReport()}>
          <Bug size={18} />
        </IconButton>
        <IconButton label="Preferences" onClick={() => setPreferencesOpen(true)}>
          <Settings size={18} />
        </IconButton>
        <IconButton label="Toggle theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </IconButton>
      </aside>

      <section className="workspace">
        <RepoTabStrip
          tabs={visibleRepoTabs}
          activePath={activeRepoPath}
          loading={loading}
          onOpen={(path) => void openRepositoryPath(path)}
          onClose={closeRepoTab}
          onAdd={browseForRepository}
          onOpenRepositoryManagement={openRepositoryManagement}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenProfiles={() => {
            setPreferencesSection("profiles");
            setPreferencesOpen(true);
          }}
        />

        <header className="topbar">
          <div className="repo-identity-strip" aria-label="Repository status">
            <button className="repo-identity-card repository-card" type="button" onClick={browseForRepository} disabled={loading}>
              <span>repository</span>
              <strong title={snapshot?.repository.name ?? repoNameFromPath(repoPath)}>{snapshot?.repository.name ?? repoNameFromPath(repoPath)}</strong>
              <small title={snapshot?.repository.path ?? repoPath}>{snapshot?.repository.path ?? repoPath}</small>
              <ChevronRight size={14} />
            </button>
            <div className="branch-switcher-wrap" onPointerDown={(event) => event.stopPropagation()}>
              <button
                className="repo-identity-card branch-card"
                type="button"
                onClick={() => {
                  setBranchSearch("");
                  setBranchSwitcherOpen((open) => !open);
                }}
                disabled={!snapshot || topbarBranches.length === 0}
                aria-haspopup="menu"
                aria-expanded={branchSwitcherOpen}
              >
                <span>branch</span>
                <strong title={snapshot?.currentBranch ?? "No branch"}>{snapshot?.currentBranch ?? "No branch"}</strong>
                <small title={snapshot?.upstream ?? "local"}>{snapshot?.upstream ?? "local"}</small>
                <ChevronDown size={14} />
              </button>
              {branchSwitcherOpen && (
                <BranchSwitcher
                  branches={filteredTopbarBranches}
                  query={branchSearch}
                  setQuery={setBranchSearch}
                  onSelect={switchBranchFromTopbar}
                />
              )}
            </div>
          </div>
          <div className="repo-open">
            <PackageOpen size={18} />
            <input value={repoPath} onChange={(event) => setRepoPath(event.target.value)} aria-label="Repository path" />
            <IconButton label="Browse for repository" onClick={browseForRepository} disabled={loading}>
              <FolderOpen size={16} />
            </IconButton>
            <IconButton label="Repository Management" onClick={openRepositoryManagement} disabled={loading}>
              <Cloud size={16} />
            </IconButton>
            <Button variant="primary" onClick={openCurrentPath} disabled={loading}>
              Open
            </Button>
          </div>
          <div className="topbar-git-actions" aria-label="Git toolbar">
            <IconButton label="Fetch" onClick={() => snapshot && runSnapshotOperation("Fetch", () => fetchRepo(snapshot.repository.path))} disabled={!snapshot || loading}>
              <ArrowDownToLine size={15} />
            </IconButton>
            <IconButton label="Pull" onClick={() => snapshot && runSnapshotOperation("Pull", () => pullRepo(snapshot.repository.path))} disabled={!snapshot || loading}>
              <Shuffle size={15} />
            </IconButton>
            <IconButton label="Push" onClick={pushCurrentBranch} disabled={!snapshot || loading}>
              <UploadCloud size={15} />
            </IconButton>
          </div>
          <div className="layout-controls" aria-label="Layout controls">
            <IconButton
              label={layout.sidebarCollapsed ? "Expand left sections" : "Collapse left sections"}
              className={clsx(layout.sidebarCollapsed && "muted")}
              onClick={() => toggleLayoutSection("sidebar")}
            >
              <GitBranch size={15} />
            </IconButton>
            <IconButton
              label={layout.detailCollapsed ? "Expand detail sections" : "Collapse detail sections"}
              className={clsx(layout.detailCollapsed && "muted")}
              onClick={() => toggleLayoutSection("detail")}
            >
              <FileText size={15} />
            </IconButton>
            <IconButton
              label={layout.bottomCollapsed ? "Expand bottom sections" : "Collapse bottom sections"}
              className={clsx(layout.bottomCollapsed && "muted")}
              onClick={() => toggleLayoutSection("bottom")}
            >
              <ClipboardList size={15} />
            </IconButton>
          </div>
          <div className="repo-state">
            {snapshot && (
              <>
                <span className={clsx("state-pill", snapshot.repository.worktreeState)}>{snapshot.repository.worktreeState}</span>
                <span className="repo-state-ref" title={snapshot.currentBranch ?? "detached"}>{snapshot.currentBranch ?? "detached"}</span>
                {snapshot.upstream && <span className="repo-state-ref" title={snapshot.upstream}>{snapshot.upstream}</span>}
                <span>+{snapshot.ahead}</span>
                <span>-{snapshot.behind}</span>
                {!runningInTauri && <span className="state-pill preview">browser preview</span>}
              </>
            )}
          </div>
        </header>

        {error && (
          <div className="error-banner" role="alert">
            <AlertTriangle size={16} />
            <span>{error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss error">
              <X size={14} />
            </button>
          </div>
        )}

        {pushRecovery && (
          <div className="push-recovery-banner" role="alert">
            <AlertTriangle size={16} />
            <span>{pushRecovery.message}</span>
            <div className="push-recovery-actions">
              <button className="banner-action pull" onClick={pullFastForwardAfterRejectedPush} disabled={loading}>
                Pull (fast-forward if possible)
              </button>
              <button className="banner-action rebase" onClick={pullRebaseAfterRejectedPush} disabled={loading}>
                Pull Rebase
              </button>
              <button className="banner-action force" onClick={forcePushAfterRejectedPush} disabled={loading}>
                Force Push
              </button>
              <button className="banner-action cancel" onClick={() => setPushRecovery(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {lockRecovery && (
          <div className="push-recovery-banner" role="alert">
            <AlertTriangle size={16} />
            <span>{lockRecovery.message}</span>
            <div className="push-recovery-actions">
              <button className="banner-action pull" onClick={() => void clearLockAndRetry()} disabled={loading}>
                Clear lock &amp; retry
              </button>
              <button className="banner-action cancel" onClick={() => setLockRecovery(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {snapshot?.changesTruncated && (
          <div className="error-banner" role="alert">
            <AlertTriangle size={16} />
            <span>
              This repository has {snapshot.totalChanges?.toLocaleString() ?? "many"} working-tree changes — showing the
              first {snapshot.changes.length.toLocaleString()} to stay responsive. This usually means build output or a
              vendored folder is not in <code>.gitignore</code>.
            </span>
          </div>
        )}

        {activeConflictState && snapshot && (
          <div className="conflict-recovery-banner" role="alert">
            <AlertTriangle size={16} />
            <span>{conflictBannerMessage(snapshot)}</span>
            <div className="push-recovery-actions">
              <button className="banner-action pull" onClick={() => setCenterView("conflict")} disabled={loading}>
                Open Resolver
              </button>
              <button className="banner-action" onClick={continueCurrentGitOperation} disabled={loading || snapshot.conflicts.length > 0}>
                Continue
              </button>
              <button className="banner-action force" onClick={abortCurrentGitOperation} disabled={loading}>
                Abort
              </button>
            </div>
          </div>
        )}

        <div
          className={clsx(
            "content-grid",
            !hasWorkingChanges && "no-working-changes",
            centerView === "diff" && diffExpanded && "diff-expanded",
            layout.sidebarCollapsed && "sidebar-collapsed",
            layout.detailCollapsed && "detail-collapsed",
            layout.bottomCollapsed && "bottom-collapsed"
          )}
          style={contentGridStyle}
        >
          <Sidebar
            snapshot={snapshot}
            sidebarBranchFilter={sidebarBranchFilter}
            stashMessage={stashMessage}
            setSidebarBranchFilter={setSidebarBranchFilter}
            remoteName={remoteName}
            remoteUrl={remoteUrl}
            setRemoteName={setRemoteName}
            setRemoteUrl={setRemoteUrl}
            setStashMessage={setStashMessage}
            addRemote={addRepositoryRemote}
            stashCurrent={stashCurrent}
            createBranchInteractive={() => void createBranchInteractive()}
            generateBranchName={() => void generateBranchName()}
            aiGeneratingBranch={aiGeneratingBranch}
            selectedBranchRef={selectedBranchRef}
            branchInspection={branchInspection}
            branchInspectionLoading={branchInspectionLoading}
            branchInspectionError={branchInspectionError}
            selectBranch={selectBranchForInspection}
            checkoutInspectedBranch={checkoutInspectedBranch}
            fetchForInspectedBranch={fetchForInspectedBranch}
            pullInspectedBranch={pullInspectedBranch}
            pushInspectedBranch={pushInspectedBranch}
            openInspectorBranchMenu={openInspectorBranchMenu}
            selectCommitBySha={selectCommitBySha}
            deleteBranch={async (name) => {
              const repo = requireRepo();
              if (repo && (await confirmAction(`Delete branch '${name}'?`, { title: "Delete branch", confirmLabel: "Delete" }))) {
                void runSnapshotOperation("Delete branch", () => deleteBranch(repo, name, false));
              }
            }}
            applyStash={(stash) => {
              const repo = requireRepo();
              if (repo) void runSnapshotOperation("Apply stash", () => stashApply(repo, stash));
            }}
            dropStash={async (stash) => {
              const repo = requireRepo();
              if (repo && (await confirmAction(`Drop ${stash}?`, { title: "Drop stash", confirmLabel: "Drop" }))) {
                void runSnapshotOperation("Drop stash", () => stashDrop(repo, stash));
              }
            }}
            openBranchMenu={openBranchMenu}
            startResize={startResize}
            selectedStackId={selectedStackId}
            selectedLaneId={selectedLaneId}
            parallelMode={parallelMode}
            setSelectedStackId={setSelectedStackId}
            setSelectedLaneId={setSelectedLaneId}
            setParallelMode={setParallelMode}
            createStackFromBranch={() => createStackFromBranch()}
            addBranchToSelectedStack={() => addBranchToSelectedStack()}
            createChildBranchForStack={() => createChildBranchForStack()}
            restackSelectedStack={restackSelectedStack}
            syncSelectedStackTrunk={syncSelectedStackTrunk}
            pushSelectedStack={pushSelectedStack}
            prepareSelectedStackPrChain={prepareSelectedStackPrChain}
            reorderSelectedStackBranch={reorderSelectedStackBranch}
            removeSelectedStackBranch={removeSelectedStackBranch}
            applySelectedLane={applySelectedLane}
            unapplySelectedLane={unapplySelectedLane}
            commitSelectedLane={commitSelectedLane}
            discardSelectedLane={discardSelectedLane}
            materializeSelectedLane={materializeSelectedLane}
          />

          <ResizeHandle
            className="sidebar-resize"
            label="Resize left sections"
            orientation="vertical"
            onPointerDown={(event) => startResize("sidebar", event)}
          />

          <Panel
            title={centerView === "diff" ? "Diff Review" : centerView === "conflict" ? "Conflict Resolver" : "History"}
            className={clsx(
              "history-panel",
              centerView === "diff" && "diff-review-panel",
              centerView === "conflict" && "conflict-review-panel",
              diffExpanded && "expanded"
            )}
            actions={
              centerView === "diff" ? (
                <div className="history-panel-actions">
                  <IconButton
                    label={diffExpanded ? "Restore diff size" : "Expand diff"}
                    onClick={() => setDiffExpanded((expanded) => !expanded)}
                  >
                    {diffExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                  </IconButton>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setCenterView("graph");
                      setDiffExpanded(false);
                    }}
                  >
                    Close Diff
                  </Button>
                  <Code2 size={15} />
                </div>
              ) : centerView === "conflict" ? (
                <div className="history-panel-actions">
                  <span>{snapshot ? `${snapshot.conflicts.length} unresolved` : "0 unresolved"}</span>
                  <Button variant="ghost" onClick={continueCurrentGitOperation} disabled={!snapshot || snapshot.conflicts.length > 0 || loading}>
                    Continue
                  </Button>
                  <Button variant="ghost" onClick={abortCurrentGitOperation} disabled={!snapshot || loading}>
                    Abort
                  </Button>
                  <Shuffle size={15} />
                </div>
              ) : (
                <div className="history-panel-actions">
                  <label className="history-search">
                    <Search size={13} />
                    <input
                      value={historyFilters.query}
                      onChange={(event) => setHistoryFilters((current) => ({ ...current, query: event.target.value }))}
                      placeholder="Search commits"
                      aria-label="Search commits"
                    />
                    {historyFilters.query && (
                      <button
                        type="button"
                        aria-label="Clear commit search"
                        onClick={() => setHistoryFilters((current) => ({ ...current, query: "" }))}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </label>
                  <span>
                    {snapshot
                      ? historyBackendSearchActive
                        ? historySearchLoading
                          ? "searching"
                          : `${filteredHistoryCommits.length} match${filteredHistoryCommits.length === 1 ? "" : "es"}`
                      : historyFiltersActive
                        ? `${filteredHistoryCommits.length}/${historyLoadedCommits.length}`
                        : historyPagedCommits.length > 0 || historyMayHaveMorePages
                          ? `${historyLoadedCommits.length}${historyMayHaveMorePages ? "+" : ""}`
                          : `${snapshot.commits.length}/${historyLimit}`
                      : "0"}
                  </span>
                  {historyFiltersActive && (
                    <Button variant="ghost" onClick={() => setHistoryFilters(defaultHistoryFilters)}>
                      Clear Filters
                    </Button>
                  )}
                  {historyMayHaveMorePages && (
                    <Button variant="ghost" onClick={() => void loadMoreHistory()} disabled={historyPageLoading || loading}>
                      {historyPageLoading ? "Loading" : "Load More"}
                    </Button>
                  )}
                  <select
                    value={historyLimit}
                    onChange={(event) => changeHistoryLimit(Number(event.target.value))}
                    aria-label="History commit limit"
                    disabled={loading}
                  >
                    {historyLimitOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <History size={15} />
                </div>
              )
            }
          >
            {centerView === "diff" ? (
              activeDiffPath ? (
                <SplitDiffViewer path={activeDiffPath} diff={activeDiff} loading={activeDiffLoading} />
              ) : (
                <EmptyState>
                  <FileText size={24} />
                  <span>No file selected</span>
                </EmptyState>
              )
            ) : centerView === "conflict" && snapshot ? (
              <ConflictResolver
                conflicts={snapshot.conflicts}
                worktreeState={snapshot.repository.worktreeState}
                selectedPath={selectedConflict?.path ?? null}
                versions={conflictVersions}
                loading={conflictVersionsLoading}
                error={conflictVersionsError}
                onSelectPath={setSelectedConflictPath}
                onResolve={resolveSelectedConflict}
                onMarkResolved={markSelectedConflictResolved}
                onContinue={continueCurrentGitOperation}
                onAbort={abortCurrentGitOperation}
              />
            ) : snapshot && (snapshot.commits.length > 0 || snapshot.changes.length > 0) ? (
              <CommitGraphTable
                rows={graphRows}
                selectedSha={worktreeSelected ? undefined : selectedCommit?.sha}
                wipSelected={worktreeSelected}
                snapshot={snapshot}
                commitMessage={commitMessage}
                setCommitMessage={setCommitMessage}
                columnWidths={historyColumnWidths}
                filters={historyFilters}
                historySearchLoading={historySearchLoading}
                historySearchError={historySearchError}
                backendSearchActive={historyBackendSearchActive}
                authors={historyAuthors}
                types={historyTypes}
                stagedCount={stagedChanges.length}
                unstagedCount={unstagedChanges.length}
                selectedStack={selectedStack}
                onColumnResizeStart={startHistoryColumnResize}
                onFilterChange={(next) => setHistoryFilters((current) => ({ ...current, ...next }))}
                onOpenBranchMenu={openBranchMenu}
                onOpenRefOverflow={openRefOverflowMenu}
                onSelectBranch={selectBranchForInspection}
                onOpenCommitMenu={(commitItem, event) => {
                  openBranchMenu(targetFromCommit(commitItem, snapshot), event);
                }}
                onSelect={(commitItem) => {
                  setSelectedCommit(commitItem);
                  setWorktreeSelected(false);
                  setSelectedCommitMessage(commitItem.message);
                  setCommitEditorOpen(false);
                  setDiffMode("commit");
                  setCenterView("graph");
                  setDiffExpanded(false);
                }}
                onSelectWorktree={() => {
                  setWorktreeSelected(true);
                  setSelectedFile(snapshot.changes[0] ?? null);
                  setSelectedCommitFile(null);
                  setCommitEditorOpen(false);
                  setDiffMode("working");
                  setCenterView("graph");
                  setDiffExpanded(false);
                }}
              />
            ) : snapshot ? (
              <div className="empty-workspace">
                <GitCommitHorizontal size={28} />
                <strong>No commits yet</strong>
                <span>{snapshot.changes.length} working tree item(s) ready for the first commit.</span>
              </div>
            ) : (
              <EmptyState>
                <PackageOpen size={24} />
                <span>No repository open</span>
              </EmptyState>
            )}
          </Panel>

          <ResizeHandle
            className="detail-resize"
            label="Resize detail sections"
            orientation="vertical"
            onPointerDown={(event) => startResize("detail", event)}
          />

          <aside className="detail-stack">
            <Panel
              title={selectedStack ? "Stack Detail" : worktreeSelected ? "Working Directory" : "Commit Detail"}
              className="selection-panel"
              actions={selectedStack ? <GitFork size={15} /> : worktreeSelected ? <ClipboardList size={15} /> : <GitCommitHorizontal size={15} />}
            >
              {selectedStack ? (
                <StackDetail
                  stack={selectedStack}
                  onRestack={restackSelectedStack}
                  onSync={syncSelectedStackTrunk}
                  onPush={pushSelectedStack}
                  onPrPlan={prepareSelectedStackPrChain}
                  onRemove={removeSelectedStackBranch}
                />
              ) : worktreeSelected && snapshot ? (
                <WorktreeDetail
                  snapshot={snapshot}
                  stagedCount={stagedChanges.length}
                  unstagedCount={unstagedChanges.length}
                  selectedFile={selectedFile}
                  onSelectFile={openWorkingDiff}
                />
              ) : (
                <CommitDetail
                  commit={selectedCommit}
                  selectedCommitMessage={selectedCommitMessage}
                  setSelectedCommitMessage={setSelectedCommitMessage}
                  commitEditorOpen={commitEditorOpen}
                  setCommitEditorOpen={setCommitEditorOpen}
                  selectedCommitIsHead={selectedCommitIsHead}
                  stagedChanges={stagedChanges}
                  workingChangeCount={snapshot?.changes.length ?? 0}
                  loading={loading}
                  onSelectParent={selectCommitBySha}
                  onUpdateMessage={updateSelectedCommitMessage}
                  onUndoLastCommit={undoLastCommitAction}
                  onSquashLastCommits={squashLastCommitsAction}
                />
              )}
            </Panel>
            <ResizeHandle
              className="detail-stack-resize"
              label="Resize selected commit details"
              orientation="horizontal"
              onPointerDown={(event) => startResize("detailSelection", event)}
            />

            <Panel title={inspectorFileTitle} className="changed-files-panel" actions={<FileText size={15} />}>
              {worktreeSelected ? (
                <WorktreeChangeList
                  changes={snapshot?.changes ?? []}
                  selected={selectedFile}
                  onSelect={openWorkingDiff}
                  loadFolderChildren={loadFolderChildren}
                />
              ) : (
                <CommitFileList
                  files={commitFiles}
                  selected={selectedCommitFile}
                  loading={commitFilesLoading}
                  error={commitFileError}
                  onSelect={openCommitDiff}
                />
              )}
            </Panel>

            <Panel
              title="Commit"
              className="right-commit-panel"
              defaultCollapsed={!snapshot || !hasWorkingChanges}
              actions={<SquarePen size={15} />}
            >
              <CommitComposer
                snapshot={snapshot}
                stagedChanges={stagedChanges}
                commitMessage={commitMessage}
                setCommitMessage={setCommitMessage}
                amend={amend}
                setAmend={setAmend}
                loading={loading}
                aiGeneratingBranch={aiGeneratingBranch}
                aiGeneratingCommit={aiGeneratingCommit}
                aiGeneratingPr={aiGeneratingPr}
                aiPrDraft={aiPrDraft}
                generateBranchName={() => void generateBranchName()}
                generateCommitMessage={() => void generateCommitMessage()}
                generatePrDescription={() => void generatePrDescription()}
                copyPrDraft={() => void copyPrDraft()}
                commitChanges={commitChanges}
              />
            </Panel>
          </aside>

          <ResizeHandle
            className="bottom-resize"
            label="Resize bottom sections"
            orientation="horizontal"
            onPointerDown={(event) => startResize("bottom", event)}
          />

          <section className="bottom-area">
            <Panel
              title={`Changes (${snapshot?.changes.length ?? 0})`}
              className="changes-panel"
              actions={
                <span className="panel-action-group">
                  <IconButton
                    label={parallelMode ? "Hide parallel lane controls" : "Show parallel lane controls"}
                    className={clsx(parallelMode && "active")}
                    onClick={() => setParallelMode((value) => !value)}
                    disabled={!snapshot}
                  >
                    <Shuffle size={14} />
                  </IconButton>
                  <ClipboardList size={15} />
                </span>
              }
            >
              {snapshot ? (
                <div className={clsx("changes-workflow", (parallelMode || snapshot.parallelLanes.length > 0) && "parallel-visible", parallelMode && "parallel-active")}>
                  {(parallelMode || snapshot.parallelLanes.length > 0) && (
                    <ParallelLaneBar
                      lanes={snapshot.parallelLanes}
                      selectedLaneId={selectedLaneId}
                      parallelMode={parallelMode}
                      onSelectLane={setSelectedLaneId}
                      onToggleParallel={() => setParallelMode((value) => !value)}
                      onCreateLane={() => createLaneFromChanges(selectedFile ? [selectedFile] : unstagedChanges.slice(0, 1))}
                      onApply={applySelectedLane}
                      onUnapply={unapplySelectedLane}
                      onCommit={commitSelectedLane}
                    />
                  )}
                  <div className="changes-grid">
                    <ChangeColumn
                      title={`Unstaged (${laneFilteredUnstagedChanges.length})`}
                      changes={laneFilteredUnstagedChanges}
                      selected={selectedFile}
                      onSelect={openWorkingDiff}
                      bulkAction={() => batchFileAction("Stage all", laneFilteredUnstagedChanges, stagePaths)}
                      bulkDisabled={loading || laneFilteredUnstagedChanges.length === 0}
                      bulkLabel="Stage All"
                      primaryAction={(change) => fileAction("Stage", change, stagePaths)}
                      primaryLabel="Stage"
                      secondaryAction={async (change) => {
                        if (await confirmAction(`Discard '${change.path}'?`, { title: "Discard changes", confirmLabel: "Discard" })) {
                          fileAction("Discard", change, discardPaths);
                        }
                      }}
                      laneForChange={(change) => (parallelMode || snapshot.parallelLanes.length > 0 ? laneByPath.get(change.path) : undefined)}
                      assignLane={parallelMode ? assignChangeToLane : undefined}
                      createLaneFromChange={parallelMode ? (change) => createLaneFromChanges([change]) : undefined}
                      onFileMenu={(change, event) => openFileMenu(change, false, event)}
                      loadFolderChildren={loadFolderChildren}
                    />
                    <ChangeColumn
                      title={`Staged (${laneFilteredStagedChanges.length})`}
                      changes={laneFilteredStagedChanges}
                      selected={selectedFile}
                      onSelect={openWorkingDiff}
                      bulkAction={() => batchFileAction("Unstage all", laneFilteredStagedChanges, unstagePaths)}
                      bulkDisabled={loading || laneFilteredStagedChanges.length === 0}
                      bulkLabel="Unstage All"
                      primaryAction={(change) => fileAction("Unstage", change, unstagePaths)}
                      primaryLabel="Unstage"
                      secondaryAction={async (change) => {
                        if (await confirmAction(`Discard '${change.path}'?`, { title: "Discard changes", confirmLabel: "Discard" })) {
                          fileAction("Discard", change, discardPaths);
                        }
                      }}
                      laneForChange={(change) => (parallelMode || snapshot.parallelLanes.length > 0 ? laneByPath.get(change.path) : undefined)}
                      assignLane={parallelMode ? assignChangeToLane : undefined}
                      createLaneFromChange={parallelMode ? (change) => createLaneFromChanges([change]) : undefined}
                      onFileMenu={(change, event) => openFileMenu(change, true, event)}
                      loadFolderChildren={loadFolderChildren}
                    />
                  </div>
                </div>
              ) : (
                <EmptyState>
                  <ClipboardList size={24} />
                  <span>No working tree loaded</span>
                </EmptyState>
              )}
            </Panel>
            <ResizeHandle
              className="bottom-operations-resize"
              label="Resize operations section"
              orientation="vertical"
              onPointerDown={(event) => startResize("bottomOperations", event)}
            />

            <Panel title="Activity" className="operations-panel" defaultCollapsed actions={<Activity size={15} />}>
              <ActivityPanel
                snapshots={snapshot?.undoSnapshots ?? []}
                operationLog={operationLog}
                loading={loading}
                onRestore={restoreUndoSnapshotAction}
              />
            </Panel>
          </section>
        </div>
      </section>

      {branchMenu && (
        <BranchContextMenu
          state={branchMenu}
          snapshot={snapshot}
          providerLinks={providerWebInfo(snapshot)}
          aiConfigured={openAiConfigured || claudeConfigured}
          onAction={handleBranchMenuAction}
          onClose={() => setBranchMenu(null)}
        />
      )}

      {branchExplain && (
        <BranchExplainDialog
          state={branchExplain}
          onCopy={() => {
            if (!branchExplain.markdown) return;
            void navigator.clipboard
              .writeText(branchExplain.markdown)
              .then(() => setOperationLog((log) => ["Copied branch explanation", ...log].slice(0, 8)))
              .catch(() => setError("Clipboard is unavailable in this environment."));
          }}
          onClose={() => setBranchExplain(null)}
        />
      )}

      {refOverflowMenu && (
        <RefOverflowMenu
          state={refOverflowMenu}
          onSelect={(ref) => {
            selectBranchForInspection(targetFromRef(ref, refOverflowMenu.commit, snapshot));
            setRefOverflowMenu(null);
          }}
          onOpenBranchMenu={(ref, event) => {
            openBranchMenu(targetFromRef(ref, refOverflowMenu.commit, snapshot), event);
          }}
          onClose={() => setRefOverflowMenu(null)}
        />
      )}

      {fileMenu && (
        <FileContextMenu
          state={fileMenu}
          onAction={(action) => void runFileMenuAction(action, fileMenu)}
          onClose={() => setFileMenu(null)}
        />
      )}

      {paletteOpen && (
        <CommandPalette
          close={() => setPaletteOpen(false)}
          commands={[
            ["Open repository", openCurrentPath],
            ["Browse for repository", browseForRepository],
            ["Repository Management", openRepositoryManagement],
            ["Preferences", () => setPreferencesOpen(true)],
            ["Refresh", refresh],
            ["Stage all changes", () => batchFileAction("Stage all", unstagedChanges, stagePaths)],
            ["Unstage all changes", () => batchFileAction("Unstage all", stagedChanges, unstagePaths)],
            ["Generate branch name", () => void generateBranchName()],
            ["Generate PR text", () => void generatePrDescription()],
            ["Create stack", () => createStackFromBranch()],
            ["Add branch to stack", () => addBranchToSelectedStack()],
            ["Restack current stack", restackSelectedStack],
            ["Create parallel lane", () => createLaneFromChanges(selectedFile ? [selectedFile] : unstagedChanges.slice(0, 1))],
            ["Assign selected file to lane", () => selectedFile && assignChangeToLane(selectedFile)],
            ["Apply lane", applySelectedLane],
            ["Unapply lane", unapplySelectedLane],
            ["Commit lane", commitSelectedLane],
            ["Undo last commit", undoLastCommitAction],
            ["Squash last two commits", squashLastCommitsAction],
            ["Fetch", () => snapshot && runSnapshotOperation("Fetch", () => fetchRepo(snapshot.repository.path))],
            ["Pull", () => snapshot && runSnapshotOperation("Pull", () => pullRepo(snapshot.repository.path))],
            ["Push", pushCurrentBranch],
            ["Toggle theme", () => setTheme(theme === "dark" ? "light" : "dark")]
          ]}
        />
      )}
      {preferencesOpen && (
        <PreferencesPanel
          close={() => setPreferencesOpen(false)}
          section={preferencesSection}
          setSection={setPreferencesSection}
          theme={theme}
          setTheme={setTheme}
          snapshot={snapshot}
          recentRepos={recentRepos}
          browseForRepository={browseForRepository}
          openRecentRepo={(path) => void openRepositoryPath(path)}
          forgetRecentRepo={forgetRecentRepo}
          clearRecentRepos={clearRecentRepos}
          runningInTauri={runningInTauri}
          openAiConfigured={openAiConfigured}
          setOpenAiConfigured={setOpenAiConfigured}
          openAiModel={openAiModel}
          setOpenAiModel={setOpenAiModel}
          azureDevOpsConfigured={azureDevOpsConfigured}
          setAzureDevOpsConfigured={setAzureDevOpsConfigured}
          githubConfigured={githubConfigured}
          setGithubConfigured={setGithubConfigured}
          githubLogin={githubLogin}
          setGithubLogin={setGithubLogin}
          claudeConfigured={claudeConfigured}
          setClaudeConfigured={setClaudeConfigured}
          aiProvider={aiProvider}
          setAiProvider={setAiProvider}
          preferredIntegration={preferredIntegration}
          openRepositoryManagement={openRepositoryManagement}
        />
      )}
      {repositoryManagementOpen && (
        <RepositoryManagementPanel
          close={() => setRepositoryManagementOpen(false)}
          runningInTauri={runningInTauri}
          azureDevOpsConfigured={azureDevOpsConfigured}
          providerAccounts={providerAccounts}
          catalog={providerCatalog}
          repositories={providerRepositories}
          groups={providerRepositoryGroups}
          projectNames={providerProjectNames}
          filters={providerFilters}
          setFilters={setProviderFilters}
          loading={providerLoading}
          error={providerError}
          cloneRoot={cloneRoot}
          chooseCloneRoot={chooseDefaultCloneRoot}
          refresh={() => void refreshProviderRepositories()}
          openIntegrations={() => {
            setPreferredIntegration("Azure DevOps");
            setPreferencesSection("integrations");
            setPreferencesOpen(true);
          }}
          cloneRepository={cloneProviderRepository}
          openRepository={openProviderRepository}
          locateRepository={(repo) => void locateProviderRepository(repo)}
        />
      )}
      {promptRequest && (
        <PromptDialog
          request={promptRequest}
          onSubmit={(value) => resolvePrompt(value)}
          onCancel={() => resolvePrompt(null)}
        />
      )}
      {confirmRequest && (
        <ConfirmDialog
          request={confirmRequest}
          onConfirm={() => resolveConfirm(true)}
          onCancel={() => resolveConfirm(false)}
        />
      )}
    </main>
  );
}

function PromptDialog({
  request,
  onSubmit,
  onCancel
}: {
  request: PromptRequest;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(request.defaultValue ?? "");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  return (
    <div className="prompt-backdrop" onMouseDown={onCancel}>
      <div
        className="prompt-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={request.title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(value);
          }}
        >
          <div className="prompt-header">
            <h2>{request.title}</h2>
            <IconButton label="Close" onClick={onCancel}>
              <X size={14} />
            </IconButton>
          </div>
          {request.label && <label htmlFor="prompt-dialog-input">{request.label}</label>}
          <input
            id="prompt-dialog-input"
            ref={inputRef}
            value={value}
            placeholder={request.placeholder}
            aria-label={request.label ?? request.title}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
              }
            }}
          />
          <div className="prompt-actions">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!value.trim()}>
              {request.confirmLabel ?? "OK"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BranchExplainDialog({
  state,
  onCopy,
  onClose
}: {
  state: BranchExplainState;
  onCopy: () => void;
  onClose: () => void;
}) {
  return (
    <div className="prompt-backdrop" onMouseDown={onClose}>
      <div
        className="prompt-dialog branch-explain-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Explanation of ${state.branch}`}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <div className="confirm-body">
          <div className="prompt-header">
            <h2>Explain {state.branch}</h2>
            <IconButton label="Close explanation" onClick={onClose}>
              <X size={14} />
            </IconButton>
          </div>
          {state.loading ? (
            <p className="prompt-message">Analyzing branch changes with AI…</p>
          ) : state.error ? (
            <p className="prompt-message">{state.error}</p>
          ) : (
            <>
              {state.base && <p className="prompt-message">Compared against {state.base}.</p>}
              <pre className="branch-explain-markdown">{state.markdown}</pre>
            </>
          )}
          <div className="prompt-actions">
            <Button type="button" variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button type="button" variant="primary" onClick={onCopy} disabled={state.loading || !state.markdown}>
              Copy Markdown
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({
  request,
  onConfirm,
  onCancel
}: {
  request: ConfirmRequest;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="prompt-backdrop" onMouseDown={onCancel}>
      <div
        className="prompt-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={request.title ?? "Confirm"}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      >
        <div className="confirm-body">
          <div className="prompt-header">
            <h2>{request.title ?? "Confirm"}</h2>
            <IconButton label="Close" onClick={onCancel}>
              <X size={14} />
            </IconButton>
          </div>
          <p className="prompt-message">{request.message}</p>
          <div className="prompt-actions">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="button" variant="danger" onClick={onConfirm} autoFocus>
              {request.confirmLabel ?? "OK"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RepoTabStrip({
  tabs,
  activePath,
  loading,
  onOpen,
  onClose,
  onAdd,
  onOpenRepositoryManagement,
  onOpenPalette,
  onOpenProfiles
}: {
  tabs: string[];
  activePath: string;
  loading: boolean;
  onOpen: (path: string) => void;
  onClose: (path: string) => void;
  onAdd: () => void;
  onOpenRepositoryManagement: () => void;
  onOpenPalette: () => void;
  onOpenProfiles: () => void;
}) {
  const activeProfile = useActiveGitProfile();

  return (
    <div className="repo-tabbar" aria-label="Open repositories">
      <div className="repo-tabbar-actions">
        <IconButton label="Open repository" onClick={onAdd} disabled={loading}>
          <FolderOpen size={15} />
        </IconButton>
        <IconButton label="Repository Management" onClick={onOpenRepositoryManagement} disabled={loading}>
          <Cloud size={15} />
        </IconButton>
        <IconButton label="Command palette" onClick={onOpenPalette}>
          <Terminal size={15} />
        </IconButton>
      </div>
      <div className="repo-tabs" role="tablist" aria-label="Repository tabs">
        {tabs.map((path) => {
          const active = path === activePath;
          return (
            <div key={path} className={clsx("repo-tab", active && "active")}>
              <button
                className="repo-tab-main"
                type="button"
                role="tab"
                aria-selected={active}
                title={path}
                disabled={loading || active}
                onClick={() => onOpen(path)}
              >
                <GitBranch size={13} />
                <span>{repoNameFromPath(path)}</span>
              </button>
              <button className="repo-tab-close" type="button" aria-label={`Close ${repoNameFromPath(path)}`} onClick={() => onClose(path)}>
                <X size={12} />
              </button>
            </div>
          );
        })}
        <button className="repo-tab-add" type="button" onClick={onAdd} disabled={loading} aria-label="Open another repository">
          <Plus size={15} />
        </button>
      </div>
      <button className="repo-tabbar-profile" type="button" onClick={onOpenProfiles} title="Manage profiles">
        <span className="profile-avatar" style={{ background: activeProfile?.color }}>
          {activeProfile ? profileInitials(activeProfile) : "?"}
        </span>
        <span className="repo-tabbar-profile-name">{activeProfile?.name ?? "Profiles"}</span>
        <ChevronDown size={13} />
      </button>
    </div>
  );
}

function BranchContextMenu({
  state,
  snapshot,
  providerLinks,
  aiConfigured,
  onAction,
  onClose
}: {
  state: BranchMenuState;
  snapshot: RepoSnapshot | null;
  providerLinks: ProviderWebInfo | null;
  aiConfigured: boolean;
  onAction: (action: BranchMenuAction, target: BranchMenuTarget) => void;
  onClose: () => void;
}) {
  const { target } = state;
  const items = branchMenuItems(target, snapshot, { providerLinks, aiConfigured });
  const menuStyle = {
    left: state.x,
    top: state.y,
    maxHeight: `calc(100vh - ${state.y + 12}px)`
  } as CSSProperties;

  return (
    <div className="branch-context-menu" style={menuStyle} role="menu" aria-label={`${target.name} actions`} onPointerDown={(event) => event.stopPropagation()}>
      <div className="branch-context-menu-header">
        <span className={clsx("status-chip", target.isCommitOnly ? "commit" : target.isTag ? "tag" : target.isRemote ? "remote" : "branch")}>
          {target.isCommitOnly ? "commit" : target.isTag ? "tag" : target.isRemote ? "remote" : target.isCurrent ? "current" : "branch"}
        </span>
        <strong>{target.name}</strong>
        {target.commitSha && <code>{shortSha(target.commitSha)}</code>}
        <IconButton label="Close branch menu" onClick={onClose}>
          <X size={13} />
        </IconButton>
      </div>
      <div className="branch-context-menu-list">
        {items.map((item) =>
          item.type === "separator" ? (
            <div key={item.key} className="branch-menu-separator" role="separator" />
          ) : (
            <button
              key={`${item.action}-${item.label}`}
              type="button"
              role="menuitem"
              className={clsx(item.danger && "danger")}
              disabled={item.disabled}
              title={item.hint}
              onClick={() => onAction(item.action, target)}
            >
              <span>{item.label}</span>
              {item.hint && <small>{item.hint}</small>}
            </button>
          )
        )}
      </div>
    </div>
  );
}

function RefOverflowMenu({
  state,
  onSelect,
  onOpenBranchMenu,
  onClose
}: {
  state: RefOverflowMenuState;
  onSelect: (ref: RefChip) => void;
  onOpenBranchMenu: (ref: RefChip, event: ReactMouseEvent<HTMLElement>) => void;
  onClose: () => void;
}) {
  const { refs, commit } = state;
  const menuStyle = {
    left: state.x,
    top: state.y,
    maxHeight: `calc(100vh - ${state.y + 12}px)`
  } as CSSProperties;

  return (
    <div
      className="branch-context-menu ref-overflow-menu"
      style={menuStyle}
      role="menu"
      aria-label={`Refs at ${shortSha(commit.sha)}`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="branch-context-menu-header">
        <span className="status-chip branch">{refs.length} ref{refs.length === 1 ? "" : "s"}</span>
        <strong>Refs at this commit</strong>
        <code>{shortSha(commit.sha)}</code>
        <IconButton label="Close ref list" onClick={onClose}>
          <X size={13} />
        </IconButton>
      </div>
      <div className="branch-context-menu-list">
        {refs.map((ref) => (
          <button
            key={`${commit.sha}-${ref.label}`}
            type="button"
            role="menuitem"
            className="ref-overflow-row"
            title={`Inspect ${ref.raw} (right-click for actions)`}
            onClick={() => onSelect(ref)}
            onContextMenu={(event) => {
              event.preventDefault();
              onOpenBranchMenu(ref, event);
            }}
          >
            <span className="ref-overflow-dot" style={{ background: ref.color } as CSSProperties} />
            <span className="ref-overflow-label">{ref.label}</span>
            <small className={clsx("ref-overflow-kind", ref.kind)}>{ref.kind}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function FileContextMenu({
  state,
  onAction,
  onClose
}: {
  state: FileMenuState;
  onAction: (action: FileMenuAction) => void;
  onClose: () => void;
}) {
  const { change, staged } = state;
  const extension = fileExtension(change.path);
  const directory = parentDirectory(change.path);
  const items: FileMenuItem[] = [
    { type: "item", action: staged ? "unstage" : "stage", label: staged ? "Unstage" : "Stage" },
    { type: "item", action: "discard", label: "Discard changes", danger: true },
    { type: "item", action: "stash", label: "Stash file" },
    { type: "separator", key: "sep-ignore" },
    { type: "item", action: "ignore-file", label: "Ignore this file" },
    ...(extension ? [{ type: "item", action: "ignore-ext", label: `Ignore all *.${extension} files` } as FileMenuItem] : []),
    ...(directory ? [{ type: "item", action: "ignore-folder", label: `Ignore folder '${directory}'` } as FileMenuItem] : []),
    { type: "separator", key: "sep-open" },
    { type: "item", action: "open-editor", label: "Open in VS Code" },
    { type: "item", action: "open-default", label: "Open file in default program" },
    { type: "item", action: "reveal", label: "Show in Finder" },
    { type: "separator", key: "sep-copy" },
    { type: "item", action: "copy-path", label: "Copy file path" },
    { type: "item", action: "create-patch", label: "Create patch from file changes" },
    { type: "separator", key: "sep-danger" },
    { type: "item", action: "delete", label: "Delete file", danger: true }
  ];
  const menuStyle = {
    left: state.x,
    top: state.y,
    maxHeight: `calc(100vh - ${state.y + 12}px)`
  } as CSSProperties;

  return (
    <div
      className="branch-context-menu"
      style={menuStyle}
      role="menu"
      aria-label={`${change.path} actions`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="branch-context-menu-header">
        <span className={clsx("status-chip", change.status)}>{statusLabel(change)}</span>
        <strong title={change.path}>{fileBasename(change.path)}</strong>
        <IconButton label="Close file menu" onClick={onClose}>
          <X size={13} />
        </IconButton>
      </div>
      <div className="branch-context-menu-list">
        {items.map((item) =>
          item.type === "separator" ? (
            <div key={item.key} className="branch-menu-separator" role="separator" />
          ) : (
            <button
              key={`${item.action}-${item.label}`}
              type="button"
              role="menuitem"
              className={clsx(item.danger && "danger")}
              onClick={() => onAction(item.action)}
            >
              <span>{item.label}</span>
            </button>
          )
        )}
      </div>
    </div>
  );
}

function BranchSwitcher({
  branches,
  query,
  setQuery,
  onSelect
}: {
  branches: DisplayBranch[];
  query: string;
  setQuery: (value: string) => void;
  onSelect: (branch: DisplayBranch) => void;
}) {
  return (
    <div className="branch-switcher" role="menu" aria-label="Switch branch">
      <div className="branch-switcher-search">
        <Search size={15} />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search branches" aria-label="Search branches" />
      </div>
      <div className="branch-switcher-list">
        {branches.map((branch) => (
          <button
            key={branch.fullRef}
            type="button"
            role="menuitem"
            className={clsx(branch.isCurrent && "active")}
            disabled={branch.isUnborn}
            onClick={() => onSelect(branch)}
          >
            <GitBranch size={14} />
            <span>{branch.name}</span>
            {branch.isCurrent && <small>current</small>}
            {branch.isRemote && <small>remote</small>}
          </button>
        ))}
        {branches.length === 0 && (
          <EmptyState>
            <GitBranch size={24} />
            <span>No branches match</span>
          </EmptyState>
        )}
      </div>
    </div>
  );
}

function ResizeHandle({
  className,
  label,
  orientation,
  onPointerDown
}: {
  className?: string;
  label: string;
  orientation: "horizontal" | "vertical";
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className={clsx("resize-handle", `resize-handle-${orientation}`, className)}
      aria-label={label}
      onPointerDown={onPointerDown}
    />
  );
}

function CommitComposer({
  snapshot,
  stagedChanges,
  commitMessage,
  setCommitMessage,
  amend,
  setAmend,
  loading,
  aiGeneratingBranch,
  aiGeneratingCommit,
  aiGeneratingPr,
  aiPrDraft,
  generateBranchName,
  generateCommitMessage,
  generatePrDescription,
  copyPrDraft,
  commitChanges
}: {
  snapshot: RepoSnapshot | null;
  stagedChanges: FileChange[];
  commitMessage: string;
  setCommitMessage: (value: string) => void;
  amend: boolean;
  setAmend: (value: boolean) => void;
  loading: boolean;
  aiGeneratingBranch: boolean;
  aiGeneratingCommit: boolean;
  aiGeneratingPr: boolean;
  aiPrDraft: AiPrDescriptionSuggestion | null;
  generateBranchName: () => void;
  generateCommitMessage: () => void;
  generatePrDescription: () => void;
  copyPrDraft: () => void;
  commitChanges: () => void;
}) {
  return (
    <div className="commit-box">
      <textarea
        value={commitMessage}
        onChange={(event) => setCommitMessage(event.target.value)}
        placeholder="Commit message"
        aria-label="Commit message"
      />
      <label className="check-row">
        <input type="checkbox" checked={amend} onChange={(event) => setAmend(event.target.checked)} />
        Amend
      </label>
      <details className="commit-more-tools">
        <summary>AI tools</summary>
        <div className="ai-assist-row">
          <Button
            variant="secondary"
            disabled={!snapshot || loading || aiGeneratingBranch}
            onClick={generateBranchName}
          >
            <Sparkles size={13} />
            {aiGeneratingBranch ? "Naming" : "Branch Name"}
          </Button>
          <Button
            variant="secondary"
            disabled={!snapshot || loading || aiGeneratingPr}
            onClick={generatePrDescription}
          >
            <FileText size={13} />
            {aiGeneratingPr ? "Drafting" : "PR Text"}
          </Button>
        </div>
        {aiPrDraft && (
          <div className="ai-pr-draft">
            <div>
              <strong>{aiPrDraft.title}</strong>
              <IconButton label="Copy PR draft" onClick={copyPrDraft}>
                <ClipboardList size={13} />
              </IconButton>
            </div>
            <pre>{aiPrDraft.description}</pre>
          </div>
        )}
      </details>
      <div className="commit-footer">
        <Button
          className="ai-generate-button"
          variant="secondary"
          disabled={!snapshot || loading || aiGeneratingCommit || stagedChanges.length === 0}
          onClick={generateCommitMessage}
        >
          <Sparkles size={13} />
          {aiGeneratingCommit ? "Generating" : "Generate Message"}
        </Button>
        <Button className="commit-submit-button" variant="primary" disabled={!snapshot || loading || !commitMessage.trim()} onClick={commitChanges}>
          Commit
        </Button>
      </div>
    </div>
  );
}

function Sidebar({
  snapshot,
  sidebarBranchFilter,
  remoteName,
  remoteUrl,
  stashMessage,
  setSidebarBranchFilter,
  setRemoteName,
  setRemoteUrl,
  setStashMessage,
  addRemote,
  stashCurrent,
  createBranchInteractive,
  generateBranchName,
  aiGeneratingBranch,
  selectedBranchRef,
  branchInspection,
  branchInspectionLoading,
  branchInspectionError,
  selectBranch,
  checkoutInspectedBranch,
  fetchForInspectedBranch,
  pullInspectedBranch,
  pushInspectedBranch,
  openInspectorBranchMenu,
  selectCommitBySha,
  deleteBranch,
  applyStash,
  dropStash,
  openBranchMenu,
  startResize,
  selectedStackId,
  selectedLaneId,
  parallelMode,
  setSelectedStackId,
  setSelectedLaneId,
  setParallelMode,
  createStackFromBranch,
  addBranchToSelectedStack,
  createChildBranchForStack,
  restackSelectedStack,
  syncSelectedStackTrunk,
  pushSelectedStack,
  prepareSelectedStackPrChain,
  reorderSelectedStackBranch,
  removeSelectedStackBranch,
  applySelectedLane,
  unapplySelectedLane,
  commitSelectedLane,
  discardSelectedLane,
  materializeSelectedLane
}: {
  snapshot: RepoSnapshot | null;
  sidebarBranchFilter: string;
  remoteName: string;
  remoteUrl: string;
  stashMessage: string;
  setSidebarBranchFilter: (value: string) => void;
  setRemoteName: (value: string) => void;
  setRemoteUrl: (value: string) => void;
  setStashMessage: (value: string) => void;
  addRemote: () => void;
  stashCurrent: () => void;
  createBranchInteractive: () => void;
  generateBranchName: () => void;
  aiGeneratingBranch: boolean;
  selectedBranchRef: string | null;
  branchInspection: BranchInspection | null;
  branchInspectionLoading: boolean;
  branchInspectionError: string | null;
  selectBranch: (target: BranchMenuTarget | DisplayBranch | Branch) => void;
  checkoutInspectedBranch: (inspection: BranchInspection) => void;
  fetchForInspectedBranch: () => void;
  pullInspectedBranch: (inspection: BranchInspection) => void;
  pushInspectedBranch: (inspection: BranchInspection) => void;
  openInspectorBranchMenu: (inspection: BranchInspection, event: ReactMouseEvent<HTMLElement>) => void;
  selectCommitBySha: (sha: string) => void;
  deleteBranch: (name: string) => void;
  applyStash: (stash: string) => void;
  dropStash: (stash: string) => void;
  openBranchMenu: (target: BranchMenuTarget, event: ReactMouseEvent<HTMLElement>) => void;
  startResize: (target: ResizeTarget, event: ReactPointerEvent) => void;
  selectedStackId: string | null;
  selectedLaneId: string | null;
  parallelMode: boolean;
  setSelectedStackId: (id: string | null) => void;
  setSelectedLaneId: (id: string | null) => void;
  setParallelMode: (value: boolean | ((current: boolean) => boolean)) => void;
  createStackFromBranch: () => void;
  addBranchToSelectedStack: () => void;
  createChildBranchForStack: () => void;
  restackSelectedStack: () => void;
  syncSelectedStackTrunk: () => void;
  pushSelectedStack: () => void;
  prepareSelectedStackPrChain: () => void;
  reorderSelectedStackBranch: (branch: string, direction: -1 | 1) => void;
  removeSelectedStackBranch: (branch: string) => void;
  applySelectedLane: () => void;
  unapplySelectedLane: () => void;
  commitSelectedLane: () => void;
  discardSelectedLane: () => void;
  materializeSelectedLane: () => void;
}) {
  const branchRows = snapshot ? filterBranches(displayBranches(snapshot), sidebarBranchFilter) : [];
  const selectedStack = snapshot?.branchStacks.find((stack) => stack.id === selectedStackId) ?? null;
  const selectedLane = snapshot?.parallelLanes.find((lane) => lane.id === selectedLaneId) ?? null;
  const localBranches = branchRows.filter((branch) => !branch.isRemote);
  const remoteBranches = branchRows.filter((branch) => branch.isRemote);

  return (
    <aside className="sidebar">
      <Panel
        title="Branches"
        className="sidebar-branches-panel"
        actions={
          <span className="panel-action-group">
            <IconButton
              label="New branch"
              className="branch-create-action"
              onClick={createBranchInteractive}
              disabled={!snapshot}
            >
              <Plus size={14} />
            </IconButton>
            <IconButton label="Generate branch name" onClick={generateBranchName} disabled={!snapshot || aiGeneratingBranch}>
              <Sparkles size={13} />
            </IconButton>
          </span>
        }
      >
        <div className="branch-filter">
          <Search size={13} aria-hidden="true" />
          <input
            value={sidebarBranchFilter}
            onChange={(event) => setSidebarBranchFilter(event.target.value)}
            aria-label="Filter branches"
            placeholder="Filter branches"
            disabled={!snapshot}
          />
        </div>
        <div className="nav-list">
          {snapshot ? (
            branchRows.length > 0 ? (
              <>
                <BranchGroup
                  title="Local"
                  branches={localBranches}
                  selectedBranchRef={selectedBranchRef}
                  selectBranch={selectBranch}
                  openBranchMenu={openBranchMenu}
                  deleteBranch={deleteBranch}
                />
                <BranchGroup
                  title="Remote"
                  branches={remoteBranches}
                  selectedBranchRef={selectedBranchRef}
                  selectBranch={selectBranch}
                  openBranchMenu={openBranchMenu}
                  deleteBranch={deleteBranch}
                />
              </>
            ) : (
              <EmptyState>
                <GitBranch size={24} />
                <span>No branches match</span>
              </EmptyState>
            )
          ) : (
            <EmptyState>
              <GitBranch size={24} />
              <span>No branches</span>
            </EmptyState>
          )}
        </div>
      </Panel>
      <ResizeHandle
        className="sidebar-section-resize sidebar-branches-resize"
        label="Resize branches section"
        orientation="horizontal"
        onPointerDown={(event) => startResize("sidebarBranches", event)}
      />

      <Panel title="Branch Inspector" className="branch-inspector-panel" actions={<GitBranch size={15} />}>
        <BranchInspector
          inspection={branchInspection}
          selectedBranchRef={selectedBranchRef}
          loading={branchInspectionLoading}
          error={branchInspectionError}
          hasWorkingChanges={(snapshot?.changes.length ?? 0) > 0}
          onCheckout={checkoutInspectedBranch}
          onFetch={fetchForInspectedBranch}
          onPull={pullInspectedBranch}
          onPush={pushInspectedBranch}
          onMore={openInspectorBranchMenu}
          onSelectCommit={selectCommitBySha}
        />
      </Panel>
      <ResizeHandle
        className="sidebar-section-resize sidebar-inspector-resize"
        label="Resize branch inspector section"
        orientation="horizontal"
        onPointerDown={(event) => startResize("sidebarInspector", event)}
      />

      <Panel
        title="Workflows"
        className="sidebar-workflows-panel"
        defaultCollapsed
        actions={<GitFork size={15} />}
      >
        <div className="workflow-launcher">
          <div className="workflow-launcher-actions">
            <Button variant="secondary" onClick={createStackFromBranch} disabled={!snapshot}>Create Stack</Button>
            <Button variant="secondary" onClick={() => setParallelMode((current) => !current)} disabled={!snapshot}>
              {parallelMode ? "Hide Lanes" : "Show Lanes"}
            </Button>
          </div>
          {snapshot?.branchStacks.length ? (
            <div className="stack-list">
              {snapshot.branchStacks.map((stack) => (
                <div key={stack.id} className={clsx("stack-card", selectedStackId === stack.id && "active")}>
                  <button type="button" className="stack-card-header" onClick={() => setSelectedStackId(stack.id)}>
                    <GitFork size={14} />
                    <span>
                      <strong>{stack.name}</strong>
                      <small>{stack.trunk} · {stack.items.length} branch{stack.items.length === 1 ? "" : "es"}</small>
                    </span>
                    <em className={clsx("workflow-status", stack.status)}>{stack.status}</em>
                  </button>
                  {selectedStackId === stack.id && (
                    <div className="stack-tree">
                      <div className="stack-tree-row trunk">
                        <span>{stack.trunk}</span>
                        <small>trunk</small>
                      </div>
                      {stack.items.map((item) => (
                        <div key={item.id} className="stack-tree-row">
                          <span>{item.branch}</span>
                          <small>{item.status}</small>
                          <div>
                            <IconButton label="Move branch up" onClick={() => reorderSelectedStackBranch(item.branch, -1)}>
                              <ArrowDownToLine className="rotate-up" size={12} />
                            </IconButton>
                            <IconButton label="Move branch down" onClick={() => reorderSelectedStackBranch(item.branch, 1)}>
                              <ArrowDownToLine size={12} />
                            </IconButton>
                            <IconButton label="Remove from stack" onClick={() => removeSelectedStackBranch(item.branch)}>
                              <X size={12} />
                            </IconButton>
                          </div>
                        </div>
                      ))}
                      <div className="stack-actions">
                        <Button variant="ghost" onClick={createChildBranchForStack}>Child</Button>
                        <Button variant="ghost" onClick={restackSelectedStack}>Restack</Button>
                        <Button variant="ghost" onClick={syncSelectedStackTrunk}>Sync</Button>
                        <Button variant="ghost" onClick={pushSelectedStack}>Push</Button>
                        <Button variant="ghost" onClick={prepareSelectedStackPrChain}>PR Chain</Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="workflow-empty">No stacks yet. Create one from the current branch when you need a branch chain.</p>
          )}
          {selectedStack && (
            <Button className="stack-wide-action" variant="secondary" onClick={addBranchToSelectedStack}>
              Add current branch to {selectedStack.name}
            </Button>
          )}
          {snapshot?.parallelLanes.length ? (
            <div className="lane-list">
              {snapshot.parallelLanes.map((lane) => (
                <button
                  key={lane.id}
                  type="button"
                  className={clsx("lane-card", selectedLaneId === lane.id && "active")}
                  onClick={() => setSelectedLaneId(lane.id)}
                >
                  <span>
                    <strong>{lane.name}</strong>
                    <small>{lane.targetBranch} · {lane.paths.length} file{lane.paths.length === 1 ? "" : "s"}</small>
                  </span>
                  <em className={clsx("workflow-status", lane.status)}>{lane.applied ? "applied" : lane.status}</em>
                </button>
              ))}
            </div>
          ) : (
            <p className="workflow-empty">No parallel lanes. Turn on lanes in Changes when you want file-level patch lanes.</p>
          )}
          {selectedLane && (
            <div className="lane-actions">
              <Button variant="ghost" onClick={applySelectedLane} disabled={selectedLane.applied}>Apply</Button>
              <Button variant="ghost" onClick={unapplySelectedLane} disabled={!selectedLane.applied}>Unapply</Button>
              <Button variant="ghost" onClick={commitSelectedLane}>Commit</Button>
              <Button variant="ghost" onClick={materializeSelectedLane}>Branch</Button>
              <Button variant="danger" onClick={discardSelectedLane}>Discard</Button>
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Remotes" className="sidebar-remotes-panel" defaultCollapsed actions={<Boxes size={15} />}>
        <div className="remote-create">
          <input value={remoteName} onChange={(event) => setRemoteName(event.target.value)} aria-label="Remote name" />
          <input value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} aria-label="Remote URL" placeholder="git@github.com:owner/repo.git" />
          <IconButton label="Add remote" onClick={addRemote} disabled={!snapshot || !remoteName.trim() || !remoteUrl.trim()}>
            <Plus size={15} />
          </IconButton>
        </div>
        <div className="nav-list">
          {snapshot && snapshot.remotes.length > 0 ? (
            snapshot.remotes.map((remote) => (
              <div key={remote.name} className="remote-row">
                <strong>{remote.name}</strong>
                <span>{remote.fetchUrl ?? "no fetch url"}</span>
              </div>
            ))
          ) : (
            <EmptyState>
              <Boxes size={24} />
              <span>No remotes</span>
            </EmptyState>
          )}
        </div>
      </Panel>
      <ResizeHandle
        className="sidebar-section-resize sidebar-remotes-resize"
        label="Resize remotes section"
        orientation="horizontal"
        onPointerDown={(event) => startResize("sidebarRemotes", event)}
      />

      <Panel title="Stashes" className="sidebar-stashes-panel" defaultCollapsed={!snapshot || snapshot.stashes.length === 0} actions={<PackageOpen size={15} />}>
        <div className="inline-create">
          <input value={stashMessage} onChange={(event) => setStashMessage(event.target.value)} aria-label="Stash message" />
          <IconButton label="Create stash" onClick={stashCurrent}>
            <Plus size={15} />
          </IconButton>
        </div>
        <div className="nav-list">
          {snapshot && snapshot.stashes.length > 0 ? (
            snapshot.stashes.map((stash) => (
              <div key={stash.index} className="stash-row">
                <button onClick={() => applyStash(stash.index)}>
                  <span>{stash.index}</span>
                  <small>{stash.message}</small>
                </button>
                <IconButton label="Drop stash" onClick={() => dropStash(stash.index)}>
                  <Trash2 size={13} />
                </IconButton>
              </div>
            ))
          ) : (
            <EmptyState>
              <PackageOpen size={24} />
              <span>No stashes</span>
            </EmptyState>
          )}
        </div>
      </Panel>
      <ResizeHandle
        className="sidebar-section-resize sidebar-stashes-resize"
        label="Resize stashes section"
        orientation="horizontal"
        onPointerDown={(event) => startResize("sidebarStashes", event)}
      />

      <Panel title="Pull Requests" className="sidebar-pull-requests-panel" defaultCollapsed actions={<GitPullRequest size={15} />}>
        <EmptyState>
          <GitPullRequest size={24} />
          <span>GitHub adapter pending</span>
        </EmptyState>
      </Panel>
    </aside>
  );
}

function BranchGroup({
  title,
  branches,
  selectedBranchRef,
  selectBranch,
  openBranchMenu,
  deleteBranch
}: {
  title: string;
  branches: DisplayBranch[];
  selectedBranchRef: string | null;
  selectBranch: (target: DisplayBranch) => void;
  openBranchMenu: (target: BranchMenuTarget, event: ReactMouseEvent<HTMLElement>) => void;
  deleteBranch: (name: string) => void;
}) {
  if (branches.length === 0) return null;

  return (
    <section className="branch-group" aria-label={`${title} branches`}>
      <div className="branch-group-header">
        <span>{title}</span>
        <small>{branches.length}</small>
      </div>
      {branches.map((branch) => {
        const menuTarget = targetFromBranch(branch, "sidebar");
        return (
          <div
            key={branch.fullRef}
            className={clsx("nav-row", branch.isCurrent && "active", branchIsSelected(branch, selectedBranchRef) && "focused")}
            onContextMenu={(event) => {
              event.preventDefault();
              openBranchMenu(menuTarget, event);
            }}
          >
            <button type="button" onClick={() => selectBranch(branch)} disabled={branch.isUnborn}>
              <GitBranch size={13} />
              <span>{branch.name}</span>
              {branch.isCurrent && <small>current</small>}
              {branch.isUnborn && <small>unborn</small>}
              {branch.isRemote && <small>remote</small>}
            </button>
            <span className="nav-row-actions">
              <IconButton label={`${branch.name} actions`} onClick={(event) => openBranchMenu(menuTarget, event)}>
                <MoreHorizontal size={13} />
              </IconButton>
              {!branch.isProtected && !branch.isCurrent && !branch.isUnborn && !branch.isRemote && (
                <IconButton label="Delete branch" onClick={() => deleteBranch(branch.name)}>
                  <Trash2 size={13} />
                </IconButton>
              )}
            </span>
          </div>
        );
      })}
    </section>
  );
}

function BranchInspector({
  inspection,
  selectedBranchRef,
  loading,
  error,
  hasWorkingChanges,
  onCheckout,
  onFetch,
  onPull,
  onPush,
  onMore,
  onSelectCommit
}: {
  inspection: BranchInspection | null;
  selectedBranchRef: string | null;
  loading: boolean;
  error: string | null;
  hasWorkingChanges: boolean;
  onCheckout: (inspection: BranchInspection) => void;
  onFetch: () => void;
  onPull: (inspection: BranchInspection) => void;
  onPush: (inspection: BranchInspection) => void;
  onMore: (inspection: BranchInspection, event: ReactMouseEvent<HTMLElement>) => void;
  onSelectCommit: (sha: string) => void;
}) {
  if (!selectedBranchRef) {
    return (
      <EmptyState>
        <GitBranch size={24} />
        <span>Select a branch</span>
      </EmptyState>
    );
  }

  if (loading && !inspection) {
    return (
      <EmptyState>
        <RefreshCw size={22} />
        <span>Inspecting branch</span>
      </EmptyState>
    );
  }

  if (error) {
    return <div className="branch-inspector-error">{error}</div>;
  }

  if (!inspection) {
    return (
      <EmptyState>
        <GitBranch size={24} />
        <span>Select a branch</span>
      </EmptyState>
    );
  }

  const upstreamCounts = inspection.aheadBehindUpstream;
  const defaultCounts = inspection.aheadBehindDefault;
  const compareCounts = upstreamCounts ?? defaultCounts;
  const compareLabel = upstreamCounts ? inspection.upstream : inspection.defaultBranch;
  const canCheckout = !inspection.branch.isCurrent;
  const canPull = inspection.branch.isCurrent && inspection.kind !== "tag";
  const canPush = inspection.kind === "local" || inspection.kind === "unknown";

  return (
    <div className="branch-inspector">
      <div className="branch-inspector-header">
        <div>
          <strong title={inspection.branch.name}>{inspection.branch.name}</strong>
          <span>
            {inspection.kind}
            {inspection.branch.isCurrent ? " · current" : ""}
          </span>
        </div>
        <span className={clsx("branch-health-badge", inspection.status)}>{branchInspectionStatusLabel(inspection.status)}</span>
      </div>

      <div className="branch-inspector-actions">
        <Button variant="secondary" onClick={() => onCheckout(inspection)} disabled={!canCheckout}>
          Checkout
        </Button>
        <Button variant="ghost" onClick={onFetch}>
          Fetch
        </Button>
        <Button variant="ghost" onClick={() => onPull(inspection)} disabled={!canPull}>
          Pull
        </Button>
        <Button variant="ghost" onClick={() => onPush(inspection)} disabled={!canPush}>
          Push
        </Button>
        <IconButton label="More branch actions" onClick={(event) => onMore(inspection, event)}>
          <MoreHorizontal size={14} />
        </IconButton>
      </div>

      <dl className="branch-inspector-meta">
        <div>
          <dt>Upstream</dt>
          <dd title={inspection.upstream}>{inspection.upstream ?? "Not set"}</dd>
        </div>
        <div>
          <dt>Last updated</dt>
          <dd>{inspection.lastCommit ? formatDate(inspection.lastCommit.date) : "Unknown"}</dd>
        </div>
      </dl>

      <div className="branch-inspector-summary">
        <div>
          <span>Ahead</span>
          <strong>{compareCounts?.ahead ?? 0}</strong>
        </div>
        <div>
          <span>Behind</span>
          <strong>{compareCounts?.behind ?? 0}</strong>
        </div>
        <small>{compareLabel ? `Compared with ${compareLabel}` : "No comparison ref"}</small>
      </div>

      {inspection.branch.isCurrent && hasWorkingChanges && (
        <div className="branch-inspector-warning">
          <AlertTriangle size={13} />
          <span>Current branch has local working changes.</span>
        </div>
      )}

      <section className="branch-inspector-section branch-inspector-commits-section">
        <div className="branch-inspector-section-heading">
          <GitCommitHorizontal size={13} />
          <span>Commits</span>
          {inspection.recentCommits.length > 0 && (
            <em className="branch-inspector-count">{inspection.recentCommits.length}{inspection.recentCommits.length >= 200 ? "+" : ""}</em>
          )}
        </div>
        <div className="branch-inspector-commits">
          {inspection.recentCommits.length > 0 ? (
            inspection.recentCommits.map((commit) => (
              <button key={commit.sha} type="button" onClick={() => onSelectCommit(commit.sha)} title={commit.sha}>
                <span>{shortSha(commit.sha)}</span>
                <strong>{commit.message || "(no subject)"}</strong>
                <small>{commit.author} · {formatDate(commit.date)}</small>
              </button>
            ))
          ) : (
            <span className="branch-inspector-muted">No commits found.</span>
          )}
          {inspection.recentCommits.length >= 200 && (
            <small className="branch-inspector-muted">Showing the latest 200. Use the history graph for the full log.</small>
          )}
        </div>
      </section>

      <section className="branch-inspector-section">
        <div className="branch-inspector-section-heading">
          <FileText size={13} />
          <span>Diff Summary</span>
        </div>
        {inspection.diffSummary ? (
          <div className="branch-inspector-diff">
            <div className="branch-inspector-diff-stat">
              <strong>{inspection.diffSummary.fileCount}</strong>
              <span>files vs {inspection.diffSummary.baseRef}</span>
              {(inspection.diffSummary.additions !== undefined || inspection.diffSummary.deletions !== undefined) && (
                <small>
                  +{inspection.diffSummary.additions ?? 0} -{inspection.diffSummary.deletions ?? 0}
                </small>
              )}
            </div>
            <div className="branch-inspector-files">
              {inspection.diffSummary.files.slice(0, 6).map((file) => (
                <div key={`${file.status}-${file.oldPath ?? ""}-${file.path}`} className="branch-inspector-file" title={file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path}>
                  <span className={clsx("status-chip", file.status)}>{statusLabel(file)}</span>
                  <span>{file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path}</span>
                </div>
              ))}
              {inspection.diffSummary.fileCount > 6 && <small className="branch-inspector-muted">+{inspection.diffSummary.fileCount - 6} more files</small>}
            </div>
          </div>
        ) : (
          <span className="branch-inspector-muted">No comparison available.</span>
        )}
      </section>
    </div>
  );
}

function CommitGraphTable({
  rows,
  selectedSha,
  wipSelected,
  snapshot,
  commitMessage,
  setCommitMessage,
  columnWidths,
  filters,
  historySearchLoading,
  historySearchError,
  backendSearchActive,
  authors,
  types,
  stagedCount,
  unstagedCount,
  selectedStack,
  onColumnResizeStart,
  onFilterChange,
  onOpenBranchMenu,
  onOpenRefOverflow,
  onSelectBranch,
  onOpenCommitMenu,
  onSelect,
  onSelectWorktree
}: {
  rows: GraphRow[];
  selectedSha?: string;
  wipSelected: boolean;
  snapshot: RepoSnapshot | null;
  commitMessage: string;
  setCommitMessage: (value: string) => void;
  columnWidths: HistoryColumnWidths;
  filters: HistoryFilters;
  historySearchLoading: boolean;
  historySearchError: string | null;
  backendSearchActive: boolean;
  authors: string[];
  types: string[];
  stagedCount: number;
  unstagedCount: number;
  selectedStack: BranchStack | null;
  onColumnResizeStart: (column: HistoryColumnKey, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onFilterChange: (next: Partial<HistoryFilters>) => void;
  onOpenBranchMenu: (target: BranchMenuTarget, event: ReactMouseEvent<HTMLElement>) => void;
  onOpenRefOverflow: (refs: RefChip[], commit: Commit, event: ReactMouseEvent<HTMLElement>) => void;
  onSelectBranch: (target: BranchMenuTarget) => void;
  onOpenCommitMenu: (commit: Commit, event: ReactMouseEvent<HTMLElement>) => void;
  onSelect: (commit: Commit) => void;
  onSelectWorktree: () => void;
}) {
  const [openFilterColumn, setOpenFilterColumn] = useState<HistoryFilterColumn | null>(null);
  const showWorktreeRow = Boolean(snapshot && snapshot.changes.length > 0 && !hasCommitNarrowingHistoryFilters(filters));
  const hasSearchQuery = Boolean(filters.query.trim());
  const naturalLaneCount = Math.min(maxVisibleGraphLanes, Math.max(4, Math.max(...rows.map((row) => row.maxLane), 1)));
  const visibleLaneCount = Math.max(4, Math.min(naturalLaneCount, Math.floor((columnWidths.graph - 24) / graphLaneWidth)));
  const graphWidth = columnWidths.graph;
  const historyMinWidth = Object.values(columnWidths).reduce((total, width) => total + width, 0);
  const style = {
    "--branch-column-width": `${columnWidths.branch}px`,
    "--graph-width": `${columnWidths.graph}px`,
    "--message-column-width": `${columnWidths.message}px`,
    "--author-column-width": `${columnWidths.author}px`,
    "--date-column-width": `${columnWidths.date}px`,
    "--hash-column-width": `${columnWidths.hash}px`,
    "--history-min-width": `${historyMinWidth}px`
  } as CSSProperties;
  const headers: Array<{ key: HistoryColumnKey; label: string }> = [
    { key: "branch", label: "Branch / Tag" },
    { key: "graph", label: "Graph" },
    { key: "message", label: "Commit Message" },
    { key: "author", label: "Author" },
    { key: "date", label: "Date / Time" },
    { key: "hash", label: "Hash" }
  ];
  const activeFilterLabels: Partial<Record<HistoryFilterColumn, string>> = {
    message: filters.type ? filters.type : undefined,
    author: filters.author ? filters.author : undefined,
    date: filters.dateDirection === "asc" ? "Oldest" : undefined
  };

  return (
    <div className="graph-history" style={style}>
      <div className="graph-history-header" role="row">
        {headers.map((header) => {
          const filterColumn = isHistoryFilterColumn(header.key) ? header.key : null;
          return (
            <span key={header.key} className={clsx("history-column-header", filterColumn && "filterable")}>
              {filterColumn ? (
                <>
                  <button
                    type="button"
                    className={clsx("history-column-label", activeFilterLabels[filterColumn] && "active")}
                    aria-haspopup="menu"
                    aria-expanded={openFilterColumn === filterColumn}
                    onClick={() => setOpenFilterColumn((current) => (current === filterColumn ? null : filterColumn))}
                  >
                    <span>{header.label}</span>
                    {activeFilterLabels[filterColumn] && <small>{activeFilterLabels[filterColumn]}</small>}
                    <ChevronDown size={11} />
                  </button>
                  {openFilterColumn === filterColumn && (
                    <HistoryFilterMenu
                      column={filterColumn}
                      filters={filters}
                      authors={authors}
                      types={types}
                      onFilterChange={(next) => {
                        onFilterChange(next);
                        setOpenFilterColumn(null);
                      }}
                    />
                  )}
                </>
              ) : (
                <span>{header.label}</span>
              )}
              <button
                type="button"
                className="history-column-resize"
                aria-label={`Resize ${header.label} column`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onColumnResizeStart(header.key, event);
                }}
              />
            </span>
          );
        })}
      </div>
      <div className="graph-history-body">
        {showWorktreeRow && snapshot && (
          <div
            className={clsx("graph-commit-row graph-wip-row", wipSelected && "selected")}
            style={{ "--row-color": "var(--warning)" } as CSSProperties}
            role="button"
            tabIndex={0}
            onClick={onSelectWorktree}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectWorktree();
              }
            }}
          >
            <span className="branch-tag-cell">
              <span className="ref-chip wip">WIP</span>
            </span>
            <span className="graph-cell graph-wip-cell" aria-hidden="true">
              <span />
            </span>
            <span className="graph-message-cell wip-message-cell">
              <input
                value={commitMessage}
                onChange={(event) => setCommitMessage(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onFocus={onSelectWorktree}
                onKeyDown={(event) => event.stopPropagation()}
                placeholder="// WIP"
                aria-label="Inline commit message"
              />
              <small>
                {snapshot.changes.length} file{snapshot.changes.length === 1 ? "" : "s"} changed
              </small>
            </span>
            <span className="graph-author-cell wip-counts">
              {unstagedCount > 0 && <span>Unstaged {unstagedCount}</span>}
              {stagedCount > 0 && <span>Staged {stagedCount}</span>}
            </span>
            <span className="graph-date-cell">{formatDateTime(new Date().toISOString())}</span>
            <span className="graph-hash-cell working">working</span>
          </div>
        )}
        {rows.length === 0 && (
          <div className="graph-filter-empty">
            <Search size={16} />
            <strong>
              {historySearchLoading
                ? "Searching commits"
                : historySearchError
                  ? "Commit search failed"
                  : hasSearchQuery
                    ? "No commits match this search"
                    : "No commits match these filters"}
            </strong>
            <span>
              {historySearchLoading
                ? "Checking all locally known refs for matching commits."
                : historySearchError
                  ? historySearchError
                  : hasSearchQuery
                    ? backendSearchActive
                      ? "No locally known commit matches this SHA, message, author, ref, or date."
                      : "The loaded history has no matching SHA, message, author, ref, or date."
                : "Clear the active history filters to show the full graph."}
            </span>
          </div>
        )}
        {rows.map((row) => {
          const rowStackItem = selectedStack ? stackItemForCommit(row.commit, selectedStack) : null;
          return (
          <div
            key={row.commit.sha}
            className={clsx("graph-commit-row", selectedSha === row.commit.sha && "selected", rowStackItem && "stack-highlight")}
            style={{ "--row-color": row.color } as CSSProperties}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(row.commit)}
            onContextMenu={(event) => onOpenCommitMenu(row.commit, event)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(row.commit);
              }
            }}
          >
            <span className="branch-tag-cell">
              {row.refs.length > 0 ? (
                <>
                  {row.refs.slice(0, 2).map((ref) => (
                    <button
                      key={`${row.commit.sha}-${ref.label}`}
                      className={clsx("ref-chip", ref.kind, refToneClass(ref))}
                      style={{ "--ref-color": ref.color } as CSSProperties}
                      type="button"
                      aria-label={`Inspect ${ref.label}`}
                      title={ref.raw}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectBranch(targetFromRef(ref, row.commit, snapshot));
                      }}
                      onContextMenu={(event) => onOpenBranchMenu(targetFromRef(ref, row.commit, snapshot), event)}
                    >
                      {ref.label}
                    </button>
                  ))}
                  {row.refs.length > 2 && (
                    <button
                      type="button"
                      className="ref-chip ref-chip-overflow"
                      aria-haspopup="menu"
                      aria-label={`Show ${row.refs.length - 2} more ref${row.refs.length - 2 === 1 ? "" : "s"} at ${shortSha(row.commit.sha)}`}
                      title={row.refs.slice(2).map((ref) => ref.label).join("\n")}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenRefOverflow(row.refs, row.commit, event);
                      }}
                      onContextMenu={(event) => {
                        event.stopPropagation();
                        onOpenRefOverflow(row.refs, row.commit, event);
                      }}
                    >
                      +{row.refs.length - 2}
                    </button>
                  )}
                  {rowStackItem && <span className={clsx("stack-row-chip", rowStackItem.status)}>{rowStackItem.status}</span>}
                </>
              ) : (
                rowStackItem ? <span className={clsx("stack-row-chip", rowStackItem.status)}>{rowStackItem.branch}</span> : <span className="ref-placeholder" />
              )}
            </span>
            <CommitGraphSvg row={row} width={graphWidth} laneCount={visibleLaneCount} />
            <span className="graph-message-cell">
              <strong>{renderCommitMessage(row.commit.message || "(no subject)")}</strong>
              {row.commit.parents.length > 1 && <small>{row.commit.parents.length} parents</small>}
            </span>
            <span className="graph-author-cell">{row.commit.author}</span>
            <span className="graph-date-cell">{formatDateTime(row.commit.date)}</span>
            <span className={clsx("graph-hash-cell", snapshot?.commits[0]?.sha === row.commit.sha && "active-head")}>{shortSha(row.commit.sha)}</span>
          </div>
          );
        })}
      </div>
    </div>
  );
}

function HistoryFilterMenu({
  column,
  filters,
  authors,
  types,
  onFilterChange
}: {
  column: HistoryFilterColumn;
  filters: HistoryFilters;
  authors: string[];
  types: string[];
  onFilterChange: (next: Partial<HistoryFilters>) => void;
}) {
  if (column === "author") {
    return (
      <div className="history-filter-menu" role="menu" aria-label="Filter by author">
        <button type="button" className={!filters.author ? "selected" : undefined} onClick={() => onFilterChange({ author: "" })}>
          All authors
        </button>
        {authors.map((author) => (
          <button
            key={author}
            type="button"
            className={filters.author === author ? "selected" : undefined}
            onClick={() => onFilterChange({ author })}
          >
            {author}
          </button>
        ))}
      </div>
    );
  }

  if (column === "message") {
    return (
      <div className="history-filter-menu" role="menu" aria-label="Filter by commit type">
        <button type="button" className={!filters.type ? "selected" : undefined} onClick={() => onFilterChange({ type: "" })}>
          All types
        </button>
        {types.map((type) => (
          <button key={type} type="button" className={filters.type === type ? "selected" : undefined} onClick={() => onFilterChange({ type })}>
            {type}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="history-filter-menu" role="menu" aria-label="Sort by date">
      <button
        type="button"
        className={filters.dateDirection === "desc" ? "selected" : undefined}
        onClick={() => onFilterChange({ dateDirection: "desc" })}
      >
        Newest first
      </button>
      <button
        type="button"
        className={filters.dateDirection === "asc" ? "selected" : undefined}
        onClick={() => onFilterChange({ dateDirection: "asc" })}
      >
        Oldest first
      </button>
    </div>
  );
}

function isHistoryFilterColumn(key: HistoryColumnKey): key is HistoryFilterColumn {
  return key === "message" || key === "author" || key === "date";
}

function CommitGraphSvg({ row, width, laneCount }: { row: GraphRow; width: number; laneCount: number }) {
  const laneX = (lane: number) => 12 + lane * graphLaneWidth;
  const centerY = graphRowHeight / 2;
  const visibleLane = (lane: number) => Math.min(lane, laneCount - 1);
  const visibleBefore = row.lanesBefore.slice(0, laneCount);
  const visibleAfter = row.lanesAfter.slice(0, laneCount);

  return (
    <span className="graph-cell" aria-hidden="true">
      <svg width={width} height={graphRowHeight} viewBox={`0 0 ${width} ${graphRowHeight}`}>
        {visibleBefore.map((sha, lane) => (
          <line
            key={`top-${sha}-${lane}`}
            x1={laneX(lane)}
            x2={laneX(lane)}
            y1="0"
            y2={centerY}
            stroke={colorForId(sha)}
            strokeWidth="2"
            strokeLinecap="round"
            opacity={sha === row.commit.sha ? 0.95 : 0.68}
          />
        ))}
        {visibleAfter.map((sha, lane) => (
          <line
            key={`bottom-${sha}-${lane}`}
            x1={laneX(lane)}
            x2={laneX(lane)}
            y1={centerY}
            y2={graphRowHeight}
            stroke={colorForId(sha)}
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.68"
          />
        ))}
        {row.connections.map((connection, index) => {
          if (connection.from >= laneCount && connection.to >= laneCount) return null;
          const from = visibleLane(connection.from);
          const to = visibleLane(connection.to);
          const fromX = laneX(from);
          const toX = laneX(to);
          const midY = graphRowHeight - 8;
          const path =
            from === to
              ? `M ${fromX} ${centerY} L ${toX} ${graphRowHeight}`
              : `M ${fromX} ${centerY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${graphRowHeight}`;
          return (
            <path
              key={`${row.commit.sha}-${connection.to}-${index}`}
              d={path}
              fill="none"
              stroke={connection.color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={connection.terminal ? "3 4" : undefined}
              opacity={connection.terminal ? 0.52 : 0.82}
            />
          );
        })}
        <circle cx={laneX(visibleLane(row.lane))} cy={centerY} r="4" fill={row.color} stroke="var(--graph-area)" strokeWidth="2" />
        <circle cx={laneX(visibleLane(row.lane))} cy={centerY} r="6.4" fill="none" stroke={row.color} strokeWidth="1" opacity="0.35" />
      </svg>
    </span>
  );
}

function StackDetail({
  stack,
  onRestack,
  onSync,
  onPush,
  onPrPlan,
  onRemove
}: {
  stack: BranchStack;
  onRestack: () => void;
  onSync: () => void;
  onPush: () => void;
  onPrPlan: () => void;
  onRemove: (branch: string) => void;
}) {
  return (
    <div className="selection-detail stack-detail-card">
      <div className="stack-detail-header">
        <GitFork size={20} />
        <span>
          <strong>{stack.name}</strong>
          <small>{stack.trunk} · {stack.status}</small>
        </span>
      </div>
      <dl className="commit-detail-meta">
        <div>
          <dt>Trunk</dt>
          <dd>{stack.trunk}</dd>
        </div>
        <div>
          <dt>Branches</dt>
          <dd>{stack.items.length}</dd>
        </div>
      </dl>
      {stack.lastOperation && <p className="stack-last-operation">{stack.lastOperation}</p>}
      <div className="stack-detail-list">
        {stack.items.map((item) => (
          <div key={item.id} className="stack-detail-row">
            <span>
              <strong>{item.branch}</strong>
              <small>base {item.baseBranch}</small>
            </span>
            <em className={clsx("workflow-status", item.status)}>{item.status}</em>
            <IconButton label="Remove from stack" onClick={() => onRemove(item.branch)}>
              <X size={12} />
            </IconButton>
          </div>
        ))}
        {stack.items.length === 0 && (
          <EmptyState>
            <GitBranch size={24} />
            <span>No branches in this stack</span>
          </EmptyState>
        )}
      </div>
      <div className="stack-detail-actions">
        <Button variant="ghost" onClick={onRestack}>Restack</Button>
        <Button variant="ghost" onClick={onSync}>Sync Trunk</Button>
        <Button variant="ghost" onClick={onPush}>Push Stack</Button>
        <Button variant="secondary" onClick={onPrPlan}>Prepare PR Chain</Button>
      </div>
    </div>
  );
}

function WorktreeDetail({
  snapshot,
  stagedCount,
  unstagedCount,
  selectedFile,
  onSelectFile
}: {
  snapshot: RepoSnapshot;
  stagedCount: number;
  unstagedCount: number;
  selectedFile: FileChange | null;
  onSelectFile: (change: FileChange) => void;
}) {
  const changedCount = snapshot.changes.length;
  const currentBranch = snapshot.branches.find((branch) => branch.isCurrent);

  return (
    <div className="selection-detail worktree-detail-card">
      <div className="worktree-detail-header">
        <ClipboardList size={18} />
        <div>
          <strong>Working directory</strong>
          <span>{snapshot.repository.worktreeState}</span>
        </div>
      </div>
      <p className="worktree-detail-message">
        {changedCount} file{changedCount === 1 ? "" : "s"} changed on {currentBranch?.name ?? snapshot.repository.head ?? "current branch"}.
      </p>
      <dl className="commit-detail-meta">
        <div>
          <dt>Unstaged</dt>
          <dd>{unstagedCount}</dd>
        </div>
        <div>
          <dt>Staged</dt>
          <dd>{stagedCount}</dd>
        </div>
      </dl>
      {selectedFile ? (
        <button type="button" className="worktree-selected-file" onClick={() => onSelectFile(selectedFile)}>
          <span className={clsx("status-chip", selectedFile.status)}>{statusLabel(selectedFile)}</span>
          <span>{selectedFile.oldPath ? `${selectedFile.oldPath} -> ${selectedFile.path}` : selectedFile.path}</span>
        </button>
      ) : (
        <span className="commit-detail-note">Select a changed file to review its diff.</span>
      )}
    </div>
  );
}

function CommitDetail({
  commit,
  selectedCommitMessage,
  setSelectedCommitMessage,
  commitEditorOpen,
  setCommitEditorOpen,
  selectedCommitIsHead,
  stagedChanges,
  workingChangeCount,
  loading,
  onSelectParent,
  onUpdateMessage,
  onUndoLastCommit,
  onSquashLastCommits
}: {
  commit: Commit | null;
  selectedCommitMessage: string;
  setSelectedCommitMessage: (value: string) => void;
  commitEditorOpen: boolean;
  setCommitEditorOpen: (value: boolean | ((current: boolean) => boolean)) => void;
  selectedCommitIsHead: boolean;
  stagedChanges: FileChange[];
  workingChangeCount: number;
  loading: boolean;
  onSelectParent: (sha: string) => void;
  onUpdateMessage: () => void;
  onUndoLastCommit: () => void;
  onSquashLastCommits: () => void;
}) {
  if (!commit) {
    return (
      <EmptyState>
        <GitCommitHorizontal size={24} />
        <span>No commit selected</span>
      </EmptyState>
    );
  }

  return (
    <div className="selection-detail commit-detail-card">
      <div className="commit-detail-author">
        <span className="commit-detail-author-icon" aria-hidden="true">
          <GitCommitHorizontal size={14} />
        </span>
        <div className="commit-detail-author-text">
          <strong>{commit.author}</strong>
          <span>{formatDateTime(commit.date)}</span>
        </div>
      </div>
      <div className="commit-detail-message-block">
        <div className="commit-detail-message-heading">
          <span>Message</span>
          <Button variant="ghost" onClick={() => setCommitEditorOpen((open) => !open)}>
            {commitEditorOpen ? "Done" : "Edit"}
          </Button>
        </div>
        {commitEditorOpen ? (
          <div className="selected-commit-editor inline">
            <textarea
              value={selectedCommitMessage}
              onChange={(event) => setSelectedCommitMessage(event.target.value)}
              placeholder="Selected commit message"
              aria-label="Selected commit message"
            />
            <Button
              variant="secondary"
              disabled={
                loading ||
                (selectedCommitIsHead ? stagedChanges.length > 0 : workingChangeCount > 0) ||
                !selectedCommitMessage.trim() ||
                selectedCommitMessage.trim() === commit.message
              }
              onClick={onUpdateMessage}
            >
              Update Message
            </Button>
            {!selectedCommitIsHead && workingChangeCount === 0 && (
              <small>Older commit edits rewrite linear local history after creating a safety snapshot.</small>
            )}
            {!selectedCommitIsHead && workingChangeCount > 0 && <small>Clean the working tree before rewording older commits.</small>}
            {selectedCommitIsHead && stagedChanges.length > 0 && <small>Unstage files before amending the HEAD message.</small>}
            <div className="commit-edit-actions">
              <Button variant="secondary" disabled={loading} onClick={onUndoLastCommit}>
                Undo Last Commit
              </Button>
              <Button variant="secondary" disabled={loading} onClick={onSquashLastCommits}>
                Squash Last 2
              </Button>
            </div>
          </div>
        ) : (
          <p className="commit-detail-message">{commit.message || "(no subject)"}</p>
        )}
      </div>
      <dl className="commit-detail-meta">
        <div>
          <dt>Hash</dt>
          <dd title={commit.sha}>{shortSha(commit.sha)}</dd>
        </div>
        <div>
          <dt>Parents</dt>
          <dd>{commit.parents.length}</dd>
        </div>
      </dl>
      {commit.parents.length > 0 && (
        <div className="commit-parent-links" aria-label="Parent commits">
          {commit.parents.map((parent) => (
            <button key={parent} type="button" onClick={() => onSelectParent(parent)} title={parent}>
              {shortSha(parent)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const isUntrackedFolder = (change: FileChange) => change.status === "untracked" && change.path.endsWith("/");

type FolderChildState = FileChange[] | "loading" | "error";

function useFolderChildren(loadFolderChildren?: (dir: string) => Promise<FileChange[]>) {
  const [expanded, setExpanded] = useState<Record<string, FolderChildState>>({});

  const toggle = async (dir: string) => {
    if (expanded[dir]) {
      setExpanded((current) => {
        const { [dir]: _removed, ...rest } = current;
        return rest;
      });
      return;
    }
    setExpanded((current) => ({ ...current, [dir]: "loading" }));
    try {
      const files = loadFolderChildren ? await loadFolderChildren(dir) : [];
      setExpanded((current) => ({ ...current, [dir]: files }));
    } catch {
      setExpanded((current) => ({ ...current, [dir]: "error" }));
    }
  };

  return { expanded, toggle };
}

function WorktreeChangeList({
  changes,
  selected,
  onSelect,
  loadFolderChildren
}: {
  changes: FileChange[];
  selected: FileChange | null;
  onSelect: (change: FileChange) => void;
  loadFolderChildren?: (dir: string) => Promise<FileChange[]>;
}) {
  const { expanded, toggle } = useFolderChildren(loadFolderChildren);
  if (changes.length === 0) {
    return (
      <EmptyState>
        <ClipboardList size={24} />
        <span>No working changes</span>
      </EmptyState>
    );
  }

  const renderRow = (change: FileChange, child = false) => (
    <button
      key={`${change.status}-${change.oldPath ?? ""}-${change.path}-${change.staged}-${change.unstaged}`}
      className={clsx("file-row", "commit-file-row", "worktree-change-row", child && "file-row-child", selected?.path === change.path && "selected")}
      onClick={() => onSelect(change)}
      aria-pressed={selected?.path === change.path}
    >
      <span className={clsx("status-chip", change.status)}>{statusLabel(change)}</span>
      <span>{change.oldPath ? `${change.oldPath} -> ${change.path}` : change.path}</span>
      <small className={clsx("worktree-file-state", change.staged && "staged", change.unstaged && "unstaged")}>
        {change.staged && change.unstaged ? "staged + unstaged" : change.staged ? "staged" : "unstaged"}
      </small>
    </button>
  );

  return (
    <div className="file-list commit-file-list">
      {changes.map((change) => {
        if (!isUntrackedFolder(change)) return renderRow(change);
        const state = expanded[change.path];
        const open = Boolean(state);
        return (
          <div key={`folder-${change.path}`} className="file-folder-group">
            <button
              className={clsx("file-row", "commit-file-row", "worktree-change-row", "file-folder-row")}
              onClick={() => void toggle(change.path)}
              aria-expanded={open}
            >
              <span className="folder-caret">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
              <span className={clsx("status-chip", change.status)}>{statusLabel(change)}</span>
              <span>{change.path}</span>
            </button>
            {state === "loading" && <div className="file-folder-note">Loading…</div>}
            {state === "error" && <div className="file-folder-note">Could not list folder</div>}
            {Array.isArray(state) && state.length === 0 && <div className="file-folder-note">Empty folder</div>}
            {Array.isArray(state) && state.map((child) => renderRow(child, true))}
          </div>
        );
      })}
    </div>
  );
}

function CommitFileList({
  files,
  selected,
  loading,
  error,
  onSelect
}: {
  files: CommitFile[];
  selected: CommitFile | null;
  loading: boolean;
  error: string | null;
  onSelect: (file: CommitFile) => void;
}) {
  if (loading) {
    return (
      <EmptyState>
        <ClipboardList size={24} />
        <span>Loading changed files</span>
      </EmptyState>
    );
  }

  if (error) {
    return <div className="inline-error">{error}</div>;
  }

  if (files.length === 0) {
    return (
      <EmptyState>
        <FileText size={24} />
        <span>No files changed for this commit</span>
      </EmptyState>
    );
  }

  return (
    <div className="file-list commit-file-list">
      {files.map((file) => (
        <button
          key={`${file.status}-${file.oldPath ?? ""}-${file.path}`}
          className={clsx("file-row", "commit-file-row", selected?.path === file.path && "selected")}
          onClick={() => onSelect(file)}
          aria-pressed={selected?.path === file.path}
        >
          <span className={clsx("status-chip", file.status)}>{statusLabel(file)}</span>
          <span>{file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path}</span>
        </button>
      ))}
    </div>
  );
}

function ParallelLaneBar({
  lanes,
  selectedLaneId,
  parallelMode,
  onSelectLane,
  onToggleParallel,
  onCreateLane,
  onApply,
  onUnapply,
  onCommit
}: {
  lanes: ParallelLane[];
  selectedLaneId: string | null;
  parallelMode: boolean;
  onSelectLane: (id: string | null) => void;
  onToggleParallel: () => void;
  onCreateLane: () => void;
  onApply: () => void;
  onUnapply: () => void;
  onCommit: () => void;
}) {
  const selectedLane = lanes.find((lane) => lane.id === selectedLaneId) ?? null;

  return (
    <div className="parallel-lane-bar">
      <div className="parallel-lane-heading">
        <span>
          <Shuffle size={13} />
          Parallel Lanes
        </span>
        <button type="button" className={clsx(parallelMode && "active")} onClick={onToggleParallel}>
          {parallelMode ? "Filtering lane" : "Show all changes"}
        </button>
      </div>
      <div className="parallel-lane-chips">
        <button type="button" className={!selectedLaneId ? "active" : undefined} onClick={() => onSelectLane(null)}>
          Unassigned
        </button>
        {lanes.map((lane) => (
          <button
            key={lane.id}
            type="button"
            className={clsx(selectedLaneId === lane.id && "active", lane.status)}
            onClick={() => onSelectLane(lane.id)}
            title={`${lane.targetBranch} · ${lane.paths.length} files`}
          >
            <span>{lane.name}</span>
            <small>{lane.applied ? "applied" : lane.status}</small>
          </button>
        ))}
        <button type="button" className="create-lane-chip" onClick={onCreateLane}>
          <Plus size={12} />
          New Lane
        </button>
      </div>
      {selectedLane ? (
        <div className="parallel-lane-detail">
          <span>{selectedLane.targetBranch}</span>
          <span>{shortSha(selectedLane.baseHead || "unknown")}</span>
          <span>{selectedLane.paths.length} file{selectedLane.paths.length === 1 ? "" : "s"}</span>
          <Button variant="ghost" onClick={onApply} disabled={selectedLane.applied}>Apply</Button>
          <Button variant="ghost" onClick={onUnapply} disabled={!selectedLane.applied}>Unapply</Button>
          <Button variant="ghost" onClick={onCommit}>Commit Lane</Button>
        </div>
      ) : lanes.length === 0 ? (
        <div className="parallel-empty-inline">No parallel lanes yet.</div>
      ) : (
        <div className="parallel-empty-inline">Showing unassigned changes.</div>
      )}
    </div>
  );
}

function ChangeColumn({
  title,
  changes,
  selected,
  onSelect,
  bulkAction,
  bulkDisabled,
  bulkLabel,
  primaryAction,
  primaryLabel,
  secondaryAction,
  laneForChange,
  assignLane,
  createLaneFromChange,
  onFileMenu,
  loadFolderChildren
}: {
  title: string;
  changes: FileChange[];
  selected: FileChange | null;
  onSelect: (change: FileChange) => void;
  bulkAction: () => void;
  bulkDisabled: boolean;
  bulkLabel: string;
  primaryAction: (change: FileChange) => void;
  primaryLabel: string;
  secondaryAction: (change: FileChange) => void;
  laneForChange?: (change: FileChange) => ParallelLane | undefined;
  assignLane?: (change: FileChange) => void;
  createLaneFromChange?: (change: FileChange) => void;
  onFileMenu?: (change: FileChange, event: ReactMouseEvent<HTMLElement>) => void;
  loadFolderChildren?: (dir: string) => Promise<FileChange[]>;
}) {
  const emptyLabel = title.toLowerCase().startsWith("staged") ? "No staged changes" : "No unstaged changes";
  const { expanded, toggle } = useFolderChildren(loadFolderChildren);

  const renderChangeRow = (change: FileChange, child = false) => {
    const lane = laneForChange?.(change);
    return (
      <div
        key={`${change.path}-${change.indexStatus}-${change.worktreeStatus}`}
        className={clsx("file-row", child && "file-row-child", lane && "lane-owned", selected?.path === change.path && "selected")}
        role="button"
        tabIndex={0}
        onClick={() => onSelect(change)}
        onContextMenu={(event) => onFileMenu?.(change, event)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(change);
          }
        }}
      >
        <span className={clsx("status-chip", change.status)}>{statusLabel(change)}</span>
        <span>
          {change.path}
          {lane && <em className="lane-owner-chip">{lane.name}</em>}
        </span>
        <span className="file-actions">
          {assignLane && (
            <IconButton
              label={lane ? "Move to lane" : "Assign to lane"}
              onClick={(event) => {
                event.stopPropagation();
                assignLane(change);
              }}
            >
              <GitFork size={13} />
            </IconButton>
          )}
          {createLaneFromChange && !lane && (
            <IconButton
              label="Create lane from file"
              onClick={(event) => {
                event.stopPropagation();
                createLaneFromChange(change);
              }}
            >
              <Plus size={13} />
            </IconButton>
          )}
          <IconButton
            label={primaryLabel}
            onClick={(event) => {
              event.stopPropagation();
              primaryAction(change);
            }}
          >
            <Check size={13} />
          </IconButton>
          <IconButton
            label="View diff"
            onClick={(event) => {
              event.stopPropagation();
              onSelect(change);
            }}
          >
            <Eye size={13} />
          </IconButton>
          <IconButton
            label="Discard"
            onClick={(event) => {
              event.stopPropagation();
              secondaryAction(change);
            }}
          >
            <Trash2 size={13} />
          </IconButton>
        </span>
      </div>
    );
  };

  return (
    <div className="change-column">
      <div className="change-column-header">
        <h3>{title}</h3>
        <Button className={clsx("bulk-action-button", bulkLabel.toLowerCase().startsWith("unstage") ? "unstage-all" : "stage-all")} variant="ghost" onClick={bulkAction} disabled={bulkDisabled}>
          {bulkLabel}
        </Button>
      </div>
      <div className="file-list">
        {changes.map((change) => {
          if (isUntrackedFolder(change)) {
            const state = expanded[change.path];
            const open = Boolean(state);
            return (
              <div key={`folder-${change.path}`} className="file-folder-group">
                <div
                  className={clsx("file-row", "file-folder-row")}
                  role="button"
                  tabIndex={0}
                  onClick={() => void toggle(change.path)}
                  onContextMenu={(event) => onFileMenu?.(change, event)}
                  aria-expanded={open}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void toggle(change.path);
                    }
                  }}
                >
                  <span className="folder-caret">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
                  <span className={clsx("status-chip", change.status)}>{statusLabel(change)}</span>
                  <span>{change.path}</span>
                  <span className="file-actions">
                    <IconButton
                      label={primaryLabel}
                      onClick={(event) => {
                        event.stopPropagation();
                        primaryAction(change);
                      }}
                    >
                      <Check size={13} />
                    </IconButton>
                    <IconButton
                      label="Discard"
                      onClick={(event) => {
                        event.stopPropagation();
                        secondaryAction(change);
                      }}
                    >
                      <Trash2 size={13} />
                    </IconButton>
                  </span>
                </div>
                {state === "loading" && <div className="file-folder-note">Loading…</div>}
                {state === "error" && <div className="file-folder-note">Could not list folder</div>}
                {Array.isArray(state) && state.length === 0 && <div className="file-folder-note">Empty folder</div>}
                {Array.isArray(state) && state.map((child) => renderChangeRow(child, true))}
              </div>
            );
          }
          return renderChangeRow(change);
        })}
        {changes.length === 0 && (
          <EmptyState>
            <ClipboardList size={24} />
            <span>{emptyLabel}</span>
          </EmptyState>
        )}
      </div>
    </div>
  );
}

function ActivityPanel({
  snapshots,
  operationLog,
  loading,
  onRestore
}: {
  snapshots: UndoSnapshot[];
  operationLog: string[];
  loading: boolean;
  onRestore: (snapshotId: string, label: string) => void;
}) {
  return (
    <div className="activity-panel-body">
      <section className="undo-timeline" aria-label="Safety snapshots">
        <div className="activity-subheader">
          <span>Undo Timeline</span>
          <small>{snapshots.length}</small>
        </div>
        {snapshots.length > 0 ? (
          snapshots.slice(0, 6).map((snapshot) => (
            <button
              key={snapshot.id}
              type="button"
              className="undo-row"
              disabled={loading}
              title={`${snapshot.label} · ${snapshot.id}`}
              onClick={() => onRestore(snapshot.id, snapshot.label)}
            >
              <History size={13} />
              <span>
                <strong>{snapshot.label}</strong>
                <small>
                  {snapshot.branch ?? "detached"} · {formatUndoSnapshotTime(snapshot.createdAt)}
                </small>
              </span>
            </button>
          ))
        ) : (
          <EmptyState>
            <History size={24} />
            <span>No safety snapshots yet</span>
          </EmptyState>
        )}
      </section>
      <section className="operation-log-section" aria-label="Operation log">
        <div className="activity-subheader">
          <span>Log</span>
          <small>{operationLog.length}</small>
        </div>
        <div className="operation-log">
          {operationLog.map((entry, index) => (
            <span key={`${entry}-${index}`}>{entry}</span>
          ))}
        </div>
      </section>
    </div>
  );
}

function RepositoryManagementPanel({
  close,
  runningInTauri,
  azureDevOpsConfigured,
  providerAccounts,
  catalog,
  repositories,
  groups,
  projectNames,
  filters,
  setFilters,
  loading,
  error,
  cloneRoot,
  chooseCloneRoot,
  refresh,
  openIntegrations,
  cloneRepository,
  openRepository,
  locateRepository
}: {
  close: () => void;
  runningInTauri: boolean;
  azureDevOpsConfigured: boolean;
  providerAccounts: ProviderAccountStatus[];
  catalog: ProviderRepoCatalog | null;
  repositories: ProviderRepository[];
  groups: ReturnType<typeof groupProviderRepositories>;
  projectNames: string[];
  filters: ProviderRepositoryFilters;
  setFilters: (filters: ProviderRepositoryFilters) => void;
  loading: boolean;
  error: string | null;
  cloneRoot: string;
  chooseCloneRoot: () => void | Promise<void>;
  refresh: () => void;
  openIntegrations: () => void;
  cloneRepository: (repo: ProviderRepository) => void;
  openRepository: (repo: ProviderRepository) => void;
  locateRepository: (repo: ProviderRepository) => void;
}) {
  const azureStatus = providerAccounts.find((account) => account.provider === "azure-devops");
  const providerCount = providerAccounts.filter((account) => account.configured).length;
  const repoCount = catalog?.repositories.length ?? repositories.length;
  const clonedCount = repositories.filter((repo) => repo.localMatch.status === "cloned" || repo.localMatch.status === "current").length;
  const updateFilter = <K extends keyof ProviderRepositoryFilters>(key: K, value: ProviderRepositoryFilters[K]) => {
    setFilters({ ...filters, [key]: value });
  };

  return (
    <div className="repo-management-backdrop" role="dialog" aria-modal="true" aria-label="Repository Management">
      <header className="repo-management-header">
        <div className="repo-management-heading">
          <span>
            <Cloud size={16} />
            Repository Management
          </span>
          <strong>{repoCount} cloud repositories</strong>
        </div>
        <div className="repo-management-context">
          <button className="preferences-repo-chip" onClick={openIntegrations}>
            <Plug size={14} />
            <span>{azureStatus?.label ?? "Azure DevOps"}</span>
          </button>
          <button className="preferences-exit" onClick={close}>
            <X size={15} />
            Close
          </button>
        </div>
      </header>

      <div className="repo-management-toolbar" aria-label="Repository management actions">
        <Button variant="secondary" onClick={refresh} disabled={loading}>
          <RefreshCw size={14} />
          Browse
        </Button>
        <Button variant="secondary" disabled>
          <Download size={14} />
          Clone
        </Button>
        <Button variant="secondary" disabled>
          <Plus size={14} />
          Init
        </Button>
        <Button variant="secondary" disabled>
          <Boxes size={14} />
          New Workspace
        </Button>
        <Button variant="secondary" onClick={openIntegrations}>
          <Plug size={14} />
          Integrations
        </Button>
        <div className="repo-management-summary">
          <span>{providerCount} connected</span>
          <span>{clonedCount} local</span>
          <span>{runningInTauri ? "desktop" : "browser preview"}</span>
        </div>
      </div>

      <section className="repo-management-controls">
        <div className="repo-management-search">
          <Search size={15} />
          <input
            value={filters.search}
            onChange={(event) => updateFilter("search", event.target.value)}
            placeholder="Search repositories"
            aria-label="Search repositories"
          />
        </div>
        <select value={filters.provider} onChange={(event) => updateFilter("provider", event.target.value)}>
          <option value="all">All providers</option>
          <option value="azure-devops">Azure DevOps</option>
          <option value="github">GitHub</option>
        </select>
        <select value={filters.project} onChange={(event) => updateFilter("project", event.target.value)}>
          <option value="all">All projects</option>
          {projectNames.map((project) => (
            <option key={project} value={project}>
              {project}
            </option>
          ))}
        </select>
        <select value={filters.cloneStatus} onChange={(event) => updateFilter("cloneStatus", event.target.value as RepoCloneFilter)}>
          <option value="all">All local states</option>
          <option value="cloned">Cloned</option>
          <option value="not-cloned">Not cloned</option>
          <option value="missing-path">Missing path</option>
        </select>
        <button className="repo-management-root" onClick={() => void chooseCloneRoot()} title={cloneRoot}>
          <HardDrive size={14} />
          <span>{cloneRoot || "Choose clone root"}</span>
        </button>
      </section>

      <main className="repo-management-content">
        {error ? (
          <RepoManagementEmpty icon={<AlertTriangle size={26} />} title={error} actionLabel="Refresh" action={refresh} />
        ) : loading ? (
          <RepoManagementEmpty icon={<RefreshCw size={26} />} title="Refreshing repositories" />
        ) : !catalog ? (
          <RepoManagementEmpty icon={<Cloud size={26} />} title={runningInTauri ? "No provider catalog loaded" : "Browser preview repositories"} actionLabel="Refresh" action={refresh} />
        ) : repositories.length === 0 ? (
          <RepoManagementEmpty icon={<PackageOpen size={26} />} title="No repositories returned" actionLabel="Refresh" action={refresh} />
        ) : groups.length === 0 ? (
          <RepoManagementEmpty icon={<Search size={26} />} title="No repositories match the filters" />
        ) : (
          <div className="repo-management-table" role="table" aria-label="Cloud repositories">
            <div className="repo-management-table-head" role="row">
              <span />
              <span>Repository</span>
              <span>Project</span>
              <span>Provider</span>
              <span>Branch</span>
              <span>Local</span>
              <span>Actions</span>
            </div>
            {groups.map((group) => (
              <section key={group.key} className="repo-management-group">
                <div className="repo-management-group-header">
                  <ChevronDown size={14} />
                  <strong>{group.accountName}</strong>
                  <span>{group.projectName}</span>
                  <small>{group.repositories.length}</small>
                </div>
                {group.repositories.map((repo) => {
                  const destination = deriveCloneDestination(cloneRoot, repo.name);
                  const canClone = Boolean(repo.cloneUrl?.url) && repo.localMatch.status !== "cloned" && repo.localMatch.status !== "current";
                  const canOpen = Boolean(repo.localMatch.path) && (repo.localMatch.status === "cloned" || repo.localMatch.status === "current");
                  return (
                    <div key={repo.id} className="repo-management-row" role="row">
                      <span className="repo-management-check" aria-hidden="true" />
                      <div className="repo-management-repo-cell">
                        <strong>{repo.name}</strong>
                        <small title={repo.cloneUrl?.safeUrl ?? "No clone URL"}>{repo.cloneUrl?.safeUrl ?? "No clone URL"}</small>
                      </div>
                      <span>{repo.projectName ?? "No project"}</span>
                      <span>{providerLabel(repo.provider, repo.accountName)}</span>
                      <span>{repo.defaultBranch ?? "unknown"}</span>
                      <span className={clsx("repo-management-state", repo.localMatch.status)} title={repo.localMatch.path ?? destination.path}>
                        {localMatchLabel(repo)}
                      </span>
                      <div className="repo-management-actions">
                        <IconButton label={canOpen ? "Open repository" : "Clone repository"} onClick={() => openRepository(repo)} disabled={loading || (!canOpen && !canClone)}>
                          {canOpen ? <FolderOpen size={13} /> : <Download size={13} />}
                        </IconButton>
                        <IconButton label="Locate in filesystem" onClick={() => locateRepository(repo)} disabled={loading}>
                          <HardDrive size={13} />
                        </IconButton>
                        <IconButton label="Refresh repositories" onClick={refresh} disabled={loading}>
                          <RefreshCw size={13} />
                        </IconButton>
                        <IconButton label="Open provider link" disabled={!repo.webUrl} onClick={() => repo.webUrl && void openExternalUrl(repo.webUrl)}>
                          <ExternalLink size={13} />
                        </IconButton>
                      </div>
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function RepoManagementEmpty({ icon, title, actionLabel, action }: { icon: ReactNode; title: string; actionLabel?: string; action?: () => void }) {
  return (
    <div className="repo-management-empty">
      {icon}
      <strong>{title}</strong>
      {actionLabel && action && (
        <Button variant="secondary" onClick={action}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

function providerLabel(provider: GitProvider, accountName: string) {
  if (provider === "azure-devops") return `Azure / ${accountName}`;
  if (provider === "github") return `GitHub / ${accountName}`;
  return accountName || provider;
}

function localMatchLabel(repo: ProviderRepository) {
  if (repo.localMatch.status === "current") return "open";
  if (repo.localMatch.status === "cloned") return repo.localMatch.path ? "cloned" : "local";
  if (repo.localMatch.status === "missing-path") return "missing path";
  return repo.cloneUrl?.kind === "https" ? "clone ready" : "no clone";
}

function CommandPalette({
  close,
  commands
}: {
  close: () => void;
  commands: Array<[string, () => void | false | null | Promise<void>]>;
}) {
  return (
    <div className="palette-backdrop" onMouseDown={close}>
      <div className="palette" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <div className="palette-search">
          <Search size={16} />
          <input autoFocus placeholder="Command" aria-label="Command" />
          <IconButton label="Close" onClick={close}>
            <X size={14} />
          </IconButton>
        </div>
        <div className="palette-list">
          {commands.map(([label, action]) => (
            <button
              key={label}
              onClick={() => {
                void action();
                close();
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

type SplitDiffRow =
  | { kind: "hunk"; header: string }
  | {
      kind: "context" | "changed" | "removed" | "added";
      leftNumber?: number;
      rightNumber?: number;
      leftText?: string;
      rightText?: string;
    };

function ConflictResolver({
  conflicts,
  worktreeState,
  selectedPath,
  versions,
  loading,
  error,
  onSelectPath,
  onResolve,
  onMarkResolved,
  onContinue,
  onAbort
}: {
  conflicts: Conflict[];
  worktreeState: string;
  selectedPath: string | null;
  versions: ConflictVersions | null;
  loading: boolean;
  error: string | null;
  onSelectPath: (path: string) => void;
  onResolve: (strategy: ConflictStrategy) => void;
  onMarkResolved: () => void;
  onContinue: () => void;
  onAbort: () => void;
}) {
  const selectedConflict = conflicts.find((conflict) => conflict.path === selectedPath) ?? conflicts[0] ?? null;

  return (
    <div className="conflict-shell">
      <aside className="conflict-list" aria-label="Conflicted files">
        <div className="conflict-list-header">
          <strong>{conflicts.length} conflict{conflicts.length === 1 ? "" : "s"}</strong>
          <span>{worktreeStateLabel(worktreeState)}</span>
        </div>
        {conflicts.length > 0 ? (
          conflicts.map((conflict) => (
            <button
              key={conflict.path}
              className={clsx("conflict-file-row", selectedConflict?.path === conflict.path && "selected")}
              onClick={() => onSelectPath(conflict.path)}
            >
              <span className="status-chip conflicted">!</span>
              <span>{conflict.path}</span>
              <small>{conflict.kind}</small>
            </button>
          ))
        ) : (
          <EmptyState>
            <Check size={24} />
            <span>No unresolved files</span>
          </EmptyState>
        )}
      </aside>

      <section className="conflict-detail">
        <div className="conflict-toolbar">
          <div>
            <strong>{selectedConflict?.path ?? "No conflict selected"}</strong>
            <span>{conflicts.length > 0 ? "Choose a side, combine both, or edit the file and mark it resolved." : "All conflicts are staged. Continue the Git operation when ready."}</span>
          </div>
          <div className="conflict-toolbar-actions">
            <Button variant="ghost" onClick={() => onResolve("ours")} disabled={!selectedConflict || loading}>
              Accept Current
            </Button>
            <Button variant="ghost" onClick={() => onResolve("theirs")} disabled={!selectedConflict || loading}>
              Accept Incoming
            </Button>
            <Button variant="ghost" onClick={() => onResolve("both")} disabled={!selectedConflict || loading}>
              Accept Both
            </Button>
            <Button variant="ghost" onClick={onMarkResolved} disabled={!selectedConflict || loading}>
              Mark Resolved
            </Button>
          </div>
        </div>

        {error ? (
          <div className="inline-error">{error}</div>
        ) : loading ? (
          <EmptyState>
            <AlertTriangle size={24} />
            <span>Loading conflict versions</span>
          </EmptyState>
        ) : selectedConflict && versions ? (
          <div className="conflict-panes">
            <ConflictPane title="Current" text={versions.ours} />
            <ConflictPane title="Incoming" text={versions.theirs} />
            <ConflictPane title="Result" text={versions.working} diff={versions.diff} large />
          </div>
        ) : (
          <div className="conflict-complete">
            <Check size={24} />
            <strong>No unresolved conflicts</strong>
            <span>Continue or abort the current Git operation.</span>
            <div>
              <Button onClick={onContinue}>Continue</Button>
              <Button variant="ghost" onClick={onAbort}>
                Abort
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function ConflictPane({ title, text, diff, large = false }: { title: string; text: string; diff?: string; large?: boolean }) {
  const diffRows = useMemo(() => parseSplitDiff(diff ?? ""), [diff]);

  return (
    <div className={clsx("conflict-pane", large && "large")}>
      <div className="conflict-pane-title">{title}</div>
      {diffRows.length > 0 ? <VisualDiff rows={diffRows} /> : <pre>{text || "(empty)"}</pre>}
    </div>
  );
}

function SplitDiffViewer({ path, diff, loading = false }: { path: string; diff: string; loading?: boolean }) {
  const rows = useMemo(() => parseSplitDiff(diff), [diff]);
  const fileKind = useMemo(() => diffFileKind(diff), [diff]);

  return (
    <div className="diff-shell">
      <div className="diff-title">{path}</div>
      {loading ? (
        <EmptyState>
          <FileText size={24} />
          <span>Loading diff</span>
        </EmptyState>
      ) : rows.length > 0 ? (
        <VisualDiff rows={rows} mode={fileKind} />
      ) : (
        <EmptyState>
          <FileText size={24} />
          <span>No diff available</span>
        </EmptyState>
      )}
    </div>
  );
}

function VisualDiff({ rows, mode = "modified" }: { rows: SplitDiffRow[]; mode?: DiffFileKind }) {
  // A brand-new file has no "before" and a deleted file has no "after", so a
  // two-column Old/New view just shows a wasted empty side. Collapse to one column.
  if (mode !== "modified") {
    const side = mode === "added" ? "right" : "left";
    return (
      <div className="visual-diff-view">
        <div className="visual-diff-grid single">
          <div className="diff-side-header">{mode === "added" ? "New file" : "Deleted file"}</div>
          {rows.map((row, index) =>
            row.kind === "hunk" ? (
              <div key={`${row.header}-${index}`} className="diff-hunk-row">
                {row.header}
              </div>
            ) : (
              <div key={`${row.leftNumber ?? "-"}-${row.rightNumber ?? "-"}-${index}`} className="diff-row">
                <div className={clsx("diff-line-number", lineClass(row.kind, side))}>
                  {(side === "right" ? row.rightNumber : row.leftNumber) ?? ""}
                </div>
                <div className={clsx("diff-code", lineClass(row.kind, side))}>
                  {(side === "right" ? row.rightText : row.leftText) ?? ""}
                </div>
              </div>
            )
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="visual-diff-view">
      <div className="visual-diff-grid">
        <div className="diff-side-header">Old</div>
        <div className="diff-side-header">New</div>
        {rows.map((row, index) =>
          row.kind === "hunk" ? (
            <div key={`${row.header}-${index}`} className="diff-hunk-row">
              {row.header}
            </div>
          ) : (
            <div key={`${row.leftNumber ?? "-"}-${row.rightNumber ?? "-"}-${index}`} className="diff-row">
              <div className={clsx("diff-line-number", lineClass(row.kind, "left"))}>{row.leftNumber ?? ""}</div>
              <div className={clsx("diff-code", lineClass(row.kind, "left"))}>
                {row.leftText ?? ""}
              </div>
              <div className={clsx("diff-line-number", lineClass(row.kind, "right"))}>{row.rightNumber ?? ""}</div>
              <div className={clsx("diff-code", lineClass(row.kind, "right"))}>
                {row.rightText ?? ""}
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}

type DiffFileKind = "added" | "deleted" | "modified";

/** Classify a unified diff so a pure add/delete can render as a single column. */
function diffFileKind(raw: string): DiffFileKind {
  if (/^new file mode/m.test(raw) || /^--- \/dev\/null/m.test(raw)) return "added";
  if (/^deleted file mode/m.test(raw) || /^\+\+\+ \/dev\/null/m.test(raw)) return "deleted";
  return "modified";
}

function parseSplitDiff(raw: string): SplitDiffRow[] {
  if (!raw.trim()) return [];

  const rows: SplitDiffRow[] = [];
  const removedBuffer: Array<{ number: number; text: string }> = [];
  let leftLine = 0;
  let rightLine = 0;

  const flushRemoved = () => {
    while (removedBuffer.length > 0) {
      const removed = removedBuffer.shift();
      if (!removed) continue;
      rows.push({
        kind: "removed",
        leftNumber: removed.number,
        leftText: removed.text
      });
    }
  };

  for (const line of raw.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("diff --git ") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
      continue;
    }

    if (line.startsWith("@@")) {
      flushRemoved();
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      leftLine = match ? Number(match[1]) : leftLine;
      rightLine = match ? Number(match[2]) : rightLine;
      rows.push({ kind: "hunk", header: line });
      continue;
    }

    if (line.startsWith("-")) {
      removedBuffer.push({ number: leftLine, text: line.slice(1) });
      leftLine += 1;
      continue;
    }

    if (line.startsWith("+")) {
      const addedText = line.slice(1);
      const removed = removedBuffer.shift();
      if (removed) {
        rows.push({
          kind: "changed",
          leftNumber: removed.number,
          rightNumber: rightLine,
          leftText: removed.text,
          rightText: addedText
        });
      } else {
        rows.push({
          kind: "added",
          rightNumber: rightLine,
          rightText: addedText
        });
      }
      rightLine += 1;
      continue;
    }

    if (line.startsWith(" ")) {
      flushRemoved();
      const text = line.slice(1);
      rows.push({
        kind: "context",
        leftNumber: leftLine,
        rightNumber: rightLine,
        leftText: text,
        rightText: text
      });
      leftLine += 1;
      rightLine += 1;
      continue;
    }

    if (line.trim()) {
      flushRemoved();
      rows.push({ kind: "hunk", header: line });
    }
  }

  flushRemoved();
  return rows;
}

function lineClass(kind: Exclude<SplitDiffRow["kind"], "hunk">, side: "left" | "right") {
  if (kind === "context") return "context";
  if (kind === "removed") return side === "left" ? "removed" : "blank";
  if (kind === "added") return side === "right" ? "added" : "blank";
  return side === "left" ? "removed" : "added";
}

function PreferencesPanel({
  close,
  section,
  setSection,
  theme,
  setTheme,
  snapshot,
  recentRepos,
  browseForRepository,
  openRecentRepo,
  forgetRecentRepo,
  clearRecentRepos,
  runningInTauri,
  openAiConfigured,
  setOpenAiConfigured,
  openAiModel,
  setOpenAiModel,
  azureDevOpsConfigured,
  setAzureDevOpsConfigured,
  githubConfigured,
  setGithubConfigured,
  githubLogin,
  setGithubLogin,
  claudeConfigured,
  setClaudeConfigured,
  aiProvider,
  setAiProvider,
  preferredIntegration,
  openRepositoryManagement
}: {
  close: () => void;
  section: PreferenceSection;
  setSection: (section: PreferenceSection) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  snapshot: RepoSnapshot | null;
  recentRepos: string[];
  browseForRepository: () => void | Promise<void>;
  openRecentRepo: (path: string) => void;
  forgetRecentRepo: (path: string) => void;
  clearRecentRepos: () => void;
  runningInTauri: boolean;
  openAiConfigured: boolean;
  setOpenAiConfigured: (configured: boolean) => void;
  openAiModel: string;
  setOpenAiModel: (model: string) => void;
  azureDevOpsConfigured: boolean;
  setAzureDevOpsConfigured: (configured: boolean) => void;
  githubConfigured: boolean;
  setGithubConfigured: (configured: boolean) => void;
  githubLogin: string | null;
  setGithubLogin: (login: string | null) => void;
  claudeConfigured: boolean;
  setClaudeConfigured: (configured: boolean) => void;
  aiProvider: AiProviderPreference;
  setAiProvider: (provider: AiProviderPreference) => void;
  preferredIntegration: string;
  openRepositoryManagement: () => void;
}) {
  const [integration, setIntegration] = useState("OpenAI");
  const [profiles, setProfiles] = useState<GitProfile[]>(loadGitProfiles);
  const [activeProfileId, setActiveProfileId] = useState(
    () => localStorage.getItem(activeGitProfileStorageKey) ?? loadGitProfiles()[0]?.id ?? "default"
  );
  const [syncGitConfig, setSyncGitConfig] = useState(() => localStorage.getItem(gitProfileSyncStorageKey) !== "false");
  const [profileDialog, setProfileDialog] = useState<{ mode: "create" } | { mode: "edit"; profile: GitProfile } | null>(null);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [openAiKey, setOpenAiKey] = useState("");
  const [openAiBusy, setOpenAiBusy] = useState(false);
  const [openAiMessage, setOpenAiMessage] = useState<string | null>(null);
  const [azureDevOpsPat, setAzureDevOpsPat] = useState("");
  const [azureDevOpsBusy, setAzureDevOpsBusy] = useState(false);
  const [azureDevOpsMessage, setAzureDevOpsMessage] = useState<string | null>(null);
  const [githubPat, setGithubPat] = useState("");
  const [githubBusy, setGithubBusy] = useState(false);
  const [githubMessage, setGithubMessage] = useState<string | null>(null);
  const [claudeKey, setClaudeKey] = useState("");
  const [claudeBusy, setClaudeBusy] = useState(false);
  const [claudeMessage, setClaudeMessage] = useState<string | null>(null);
  const openAiStatusMessage = runningInTauri
    ? `Saved-state: ${openAiConfigured ? "API key remembered" : "not checked at startup"}. OpenGit checks the keychain only when you save, test, or generate.`
    : "Status: Browser preview cannot save secure OpenAI keys. Open the Tauri desktop window to store the key in the operating system keychain.";
  const azureDevOpsStatusMessage = runningInTauri
    ? `Saved-state: ${azureDevOpsConfigured ? "PAT remembered" : "not checked at startup"}. OpenGit checks the keychain only when you save the PAT or use Azure DevOps.`
    : "Status: Browser preview cannot save secure Azure DevOps tokens. Open the Tauri desktop window to store the PAT in the operating system keychain.";

  const githubStatusMessage = runningInTauri
    ? `Saved-state: ${githubConfigured ? (githubLogin ? `connected as ${githubLogin}` : "PAT remembered") : "not checked at startup"}. OpenGit checks the keychain only when you save the PAT or use GitHub.`
    : "Status: Browser preview cannot save secure GitHub tokens. Open the Tauri desktop window to store the PAT in the operating system keychain.";
  const claudeStatusMessage = runningInTauri
    ? `Saved-state: ${claudeConfigured ? "API key remembered" : "not checked at startup"}. OpenGit checks the keychain only when you save, test, or generate.`
    : "Status: Browser preview cannot save secure Claude keys. Open the Tauri desktop window to store the key in the operating system keychain.";

  const availableIntegrations: Array<{ label: string; icon: typeof Settings }> = [
    { label: "OpenAI", icon: Sparkles },
    { label: "Claude (Anthropic)", icon: Bot },
    { label: "Azure DevOps", icon: Link2 },
    { label: "GitHub", icon: Github }
  ];

  useEffect(() => {
    setIntegration(availableIntegrations.some((item) => item.label === preferredIntegration) ? preferredIntegration : "OpenAI");
  }, [preferredIntegration]);

  useEffect(() => {
    localStorage.setItem(gitProfilesStorageKey, JSON.stringify(profiles));
    window.dispatchEvent(new Event(gitProfilesChangedEvent));
  }, [profiles]);

  useEffect(() => {
    localStorage.setItem(activeGitProfileStorageKey, activeProfileId);
    window.dispatchEvent(new Event(gitProfilesChangedEvent));
  }, [activeProfileId]);

  useEffect(() => {
    localStorage.setItem(gitProfileSyncStorageKey, String(syncGitConfig));
  }, [syncGitConfig]);

  useEffect(() => {
    if (!runningInTauri) return;
    const needsSeed = profiles.some((profile) => profile.id === "default" && !profile.authorName && !profile.authorEmail);
    if (!needsSeed) return;
    void getGlobalGitIdentity()
      .then((identity) => {
        if (!identity.name && !identity.email) return;
        setProfiles((current) =>
          current.map((profile) =>
            profile.id === "default" && !profile.authorName && !profile.authorEmail
              ? { ...profile, authorName: identity.name ?? "", authorEmail: identity.email ?? "" }
              : profile
          )
        );
      })
      .catch(() => undefined);
  }, [runningInTauri, profiles]);

  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0];

  const applyProfileIdentity = async (profile: GitProfile, context: string) => {
    if (!syncGitConfig) {
      setProfileMessage(`${context} .gitconfig sync is off, so git identity was not changed.`);
      return;
    }
    if (!runningInTauri) {
      setProfileMessage(`${context} Browser preview cannot write .gitconfig — open the desktop window to sync.`);
      return;
    }
    if (!profile.authorName.trim() || !profile.authorEmail.trim()) {
      setProfileMessage(`${context} Set an author name and email to sync .gitconfig.`);
      return;
    }
    try {
      await setGlobalGitIdentity(profile.authorName, profile.authorEmail);
      setProfileMessage(`${context} Global .gitconfig now uses ${profile.authorName} <${profile.authorEmail}>.`);
    } catch (error) {
      setProfileMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const activateProfile = (profile: GitProfile) => {
    setActiveProfileId(profile.id);
    void applyProfileIdentity(profile, `Switched to ${profile.name}.`);
  };

  const saveProfile = (values: Omit<GitProfile, "id">, existingId?: string) => {
    if (existingId) {
      const updated = { ...values, id: existingId };
      setProfiles((current) => current.map((profile) => (profile.id === existingId ? updated : profile)));
      if (existingId === activeProfileId) {
        void applyProfileIdentity(updated, `Updated ${updated.name}.`);
      }
    } else {
      const created = { ...values, id: crypto.randomUUID() };
      setProfiles((current) => [...current, created]);
    }
    setProfileDialog(null);
  };

  const deleteProfile = (id: string) => {
    setProfiles((current) => {
      if (current.length <= 1) return current;
      const remaining = current.filter((profile) => profile.id !== id);
      if (id === activeProfileId && remaining[0]) {
        setActiveProfileId(remaining[0].id);
      }
      return remaining;
    });
  };

  const sections: Array<{ id: PreferenceSection; label: string; icon: typeof Settings }> = [
    { id: "general", label: "General", icon: Settings },
    { id: "profiles", label: "Profiles", icon: UsersRound },
    { id: "repositories", label: "Repositories", icon: FolderOpen },
    { id: "integrations", label: "Integrations", icon: Plug }
  ];
  const activeSectionTitle = titleForPreferenceSection(section);

  return (
    <div className="preferences-backdrop" role="dialog" aria-modal="true" aria-label="Preferences">
      <header className="preferences-header">
        <div className="preferences-heading">
          <span>
            <Settings size={16} />
            OpenGit Settings
          </span>
          <strong>{activeSectionTitle}</strong>
        </div>
        <div className="preferences-context">
          <button className="profile-card" onClick={() => setSection("profiles")} title="Manage profiles">
            <span className="profile-avatar" style={{ background: activeProfile?.color }}>
              {activeProfile ? profileInitials(activeProfile) : "?"}
            </span>
            <span>{activeProfile?.name ?? "No profile"}</span>
            <ChevronDown size={13} />
          </button>
          <button className="preferences-repo-chip" onClick={() => setSection("repositories")}>
            <FolderOpen size={14} />
            <span>{snapshot ? snapshot.repository.name : "No repo open"}</span>
          </button>
          <button className="preferences-exit" onClick={close}>
            <X size={15} />
            Close
          </button>
        </div>
      </header>

      <nav className="preferences-tabs" aria-label="Settings sections">
        {sections.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={clsx("preference-tab", section === item.id && "active")}
              onClick={() => setSection(item.id)}
              aria-pressed={section === item.id}
            >
              <Icon size={14} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <main className="preferences-content">
        {section === "general" && (
          <PreferenceSection title="General">
            <SettingRow label="Theme" description="Controls the local OpenGit interface only.">
              <div className="segmented-control">
                <button className={clsx(theme === "dark" && "active")} onClick={() => setTheme("dark")}>
                  Dark
                </button>
                <button className={clsx(theme === "light" && "active")} onClick={() => setTheme("light")}>
                  Light
                </button>
              </div>
            </SettingRow>
            <SettingRow label="Runtime" description={runningInTauri ? "Desktop mode with native Git access." : "Browser preview with demo data."}>
              <span className="settings-pill">{runningInTauri ? "desktop" : "browser preview"}</span>
            </SettingRow>
          </PreferenceSection>
        )}

        {section === "profiles" && (
          <PreferenceSection title="Profiles">
            <p className="preference-lead">
              Profiles store your commit author identity so you can switch between work and personal setups. The active profile can keep
              your global git config in sync.
            </p>
            <SettingRow
              label="Keep my .gitconfig updated"
              description="When checked, switching profiles writes user.name and user.email to your global .gitconfig."
            >
              <input
                type="checkbox"
                checked={syncGitConfig}
                onChange={(event) => setSyncGitConfig(event.target.checked)}
                aria-label="Keep .gitconfig updated with the active profile"
              />
            </SettingRow>
            <div className="settings-list">
              <div className="settings-list-header">
                <h3>My Profiles</h3>
                <Button variant="primary" onClick={() => setProfileDialog({ mode: "create" })}>
                  <Plus size={14} />
                  Add a Profile
                </Button>
              </div>
              <div className="profile-table-head" aria-hidden="true">
                <span />
                <span>Profile Name</span>
                <span>Author Name</span>
                <span>Author Email</span>
                <span />
              </div>
              {profiles.map((profile) => {
                const isActive = profile.id === activeProfileId;
                return (
                  <div key={profile.id} className={clsx("profile-row", isActive && "active")}>
                    <button
                      type="button"
                      className="profile-row-main"
                      onClick={() => activateProfile(profile)}
                      aria-pressed={isActive}
                      title={isActive ? `${profile.name} is active` : `Switch to ${profile.name}`}
                    >
                      <span className="profile-avatar" style={{ background: profile.color }}>
                        {profileInitials(profile)}
                        {isActive && (
                          <em className="profile-active-check">
                            <Check size={9} />
                          </em>
                        )}
                      </span>
                      <strong>{profile.name}</strong>
                      <span>{profile.authorName || "—"}</span>
                      <span>{profile.authorEmail || "—"}</span>
                    </button>
                    <div className="profile-row-actions">
                      <IconButton label={`Edit ${profile.name}`} onClick={() => setProfileDialog({ mode: "edit", profile })}>
                        <SquarePen size={13} />
                      </IconButton>
                      <IconButton
                        label={`Delete ${profile.name}`}
                        onClick={() => deleteProfile(profile.id)}
                        disabled={profiles.length <= 1}
                      >
                        <Trash2 size={13} />
                      </IconButton>
                    </div>
                  </div>
                );
              })}
            </div>
            {profileMessage && <div className="settings-note">{profileMessage}</div>}
          </PreferenceSection>
        )}

        {section === "repositories" && (
          <PreferenceSection title="Repositories">
            <SettingRow label="Open Repository" description="Use the native folder picker instead of typing a path.">
              <Button variant="primary" onClick={() => void browseForRepository()}>
                Browse with Finder
              </Button>
            </SettingRow>
            <SettingRow label="Repository Management" description="Browse connected cloud repositories, clone new repos, or open local matches.">
              <Button variant="secondary" onClick={openRepositoryManagement}>
                Open Manager
              </Button>
            </SettingRow>
            <SettingRow label="Current Repository" description="The repository currently loaded in the workspace.">
              <code>{snapshot?.repository.path ?? "No repository open"}</code>
            </SettingRow>
            <div className="settings-list">
              <div className="settings-list-header">
                <h3>Recent Repositories</h3>
                <Button variant="ghost" onClick={clearRecentRepos} disabled={recentRepos.length === 0}>
                  Clear
                </Button>
              </div>
              {recentRepos.length > 0 ? (
                recentRepos.map((path) => (
                  <div key={path} className="repo-pref-row">
                    <button onClick={() => openRecentRepo(path)}>
                      <FolderOpen size={15} />
                      <span>{path}</span>
                    </button>
                    <IconButton label="Remove recent repository" onClick={() => forgetRecentRepo(path)}>
                      <Trash2 size={13} />
                    </IconButton>
                  </div>
                ))
              ) : (
                <EmptyState>
                  <FolderOpen size={24} />
                  <span>No recent repositories yet</span>
                </EmptyState>
              )}
            </div>
          </PreferenceSection>
        )}

        {section === "integrations" && (
          <PreferenceSection title="Integrations">
            <div className="integration-layout">
              <div className="integration-list">
                {availableIntegrations.map(({ label, icon: Icon }) => (
                  <button key={label} className={clsx(integration === label && "active")} onClick={() => setIntegration(label)}>
                    <Icon size={16} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
              {integration === "OpenAI" ? (
                <div className="integration-detail">
                  <h3>OpenAI</h3>
                  <p>Used only when you click Generate Message. OpenGit sends the staged diff context to OpenAI to draft a commit summary and description.</p>
                  <SettingRow label="API Key" description="Stored in the operating system keychain through the Rust backend, not localStorage. The value is never displayed after saving.">
                    <div className="secret-setting">
                      <input
                        value={openAiKey}
                        onChange={(event) => setOpenAiKey(event.target.value)}
                        type="password"
                        placeholder={runningInTauri ? (openAiConfigured ? "API key saved" : "sk-...") : "Open desktop window to save key"}
                        disabled={!runningInTauri}
                        aria-label="OpenAI API key"
                      />
                      <div className="secret-actions">
                        <Button
                          variant="primary"
                          disabled={!runningInTauri || openAiBusy || !openAiKey.trim()}
                          onClick={async () => {
                            setOpenAiBusy(true);
                            setOpenAiMessage(null);
                            try {
                              const status = await saveOpenAiApiKey(openAiKey);
                              setOpenAiConfigured(status.configured);
                              setOpenAiKey("");
                              setOpenAiMessage("OpenAI API key saved.");
                            } catch (error) {
                              setOpenAiMessage(error instanceof Error ? error.message : String(error));
                            } finally {
                              setOpenAiBusy(false);
                            }
                          }}
                        >
                          Save Key
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={!runningInTauri || openAiBusy}
                          onClick={async () => {
                            setOpenAiBusy(true);
                            setOpenAiMessage(null);
                            try {
                              const result = await testOpenAiApiKey();
                              if (result.configured) {
                                setOpenAiConfigured(true);
                              }
                              setOpenAiMessage(result.message);
                            } catch (error) {
                              setOpenAiMessage(error instanceof Error ? error.message : String(error));
                            } finally {
                              setOpenAiBusy(false);
                            }
                          }}
                        >
                          Test Key
                        </Button>
                        <Button
                          variant="danger"
                          disabled={!runningInTauri || openAiBusy || !openAiConfigured}
                          onClick={async () => {
                            setOpenAiBusy(true);
                            setOpenAiMessage(null);
                            try {
                              const status = await clearOpenAiApiKey();
                              setOpenAiConfigured(status.configured);
                              setOpenAiMessage("OpenAI API key removed.");
                            } catch (error) {
                              setOpenAiMessage(error instanceof Error ? error.message : String(error));
                            } finally {
                              setOpenAiBusy(false);
                            }
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  </SettingRow>
                  <SettingRow label="Model" description="Used for commit summary generation. The default follows the current small GPT-5 model family.">
                    <input value={openAiModel} onChange={(event) => setOpenAiModel(event.target.value)} aria-label="OpenAI model" />
                  </SettingRow>
                  <div className="settings-note">{openAiStatusMessage}</div>
                  {openAiMessage && <div className="settings-note">{openAiMessage}</div>}
                </div>
              ) : integration === "Azure DevOps" ? (
                <div className="integration-detail">
                  <h3>Azure DevOps</h3>
                  <p>Used for HTTPS remotes on dev.azure.com and visualstudio.com when Git fetch, pull, push, or clone needs credentials.</p>
                  <SettingRow label="Personal Access Token" description="Stored in the operating system keychain through the Rust backend. Use a PAT with Code read/write access for repositories you push to.">
                    <div className="secret-setting">
                      <input
                        value={azureDevOpsPat}
                        onChange={(event) => setAzureDevOpsPat(event.target.value)}
                        type="password"
                        placeholder={runningInTauri ? (azureDevOpsConfigured ? "PAT saved" : "Azure DevOps PAT") : "Open desktop window to save PAT"}
                        disabled={!runningInTauri}
                        aria-label="Azure DevOps personal access token"
                      />
                      <div className="secret-actions">
                        <Button
                          variant="primary"
                          disabled={!runningInTauri || azureDevOpsBusy || !azureDevOpsPat.trim()}
                          onClick={async () => {
                            setAzureDevOpsBusy(true);
                            setAzureDevOpsMessage(null);
                            try {
                              const status = await saveAzureDevOpsPat(azureDevOpsPat);
                              setAzureDevOpsConfigured(status.configured);
                              setAzureDevOpsPat("");
                              setAzureDevOpsMessage("Azure DevOps PAT saved.");
                            } catch (error) {
                              setAzureDevOpsMessage(error instanceof Error ? error.message : String(error));
                            } finally {
                              setAzureDevOpsBusy(false);
                            }
                          }}
                        >
                          Save PAT
                        </Button>
                        <Button
                          variant="danger"
                          disabled={!runningInTauri || azureDevOpsBusy || !azureDevOpsConfigured}
                          onClick={async () => {
                            setAzureDevOpsBusy(true);
                            setAzureDevOpsMessage(null);
                            try {
                              const status = await clearAzureDevOpsPat();
                              setAzureDevOpsConfigured(status.configured);
                              setAzureDevOpsMessage("Azure DevOps PAT removed.");
                            } catch (error) {
                              setAzureDevOpsMessage(error instanceof Error ? error.message : String(error));
                            } finally {
                              setAzureDevOpsBusy(false);
                            }
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  </SettingRow>
                  <div className="settings-note">{azureDevOpsStatusMessage}</div>
                  <div className="settings-note">
                    OpenGit does not rewrite remote URLs. For Azure HTTPS remotes, the backend adds a scoped Git HTTP extra header for the Azure host only, so the PAT is not printed in URLs or command arguments.
                  </div>
                  <Button variant="secondary" onClick={openRepositoryManagement}>
                    Open Repository Management
                  </Button>
                  {azureDevOpsMessage && <div className="settings-note">{azureDevOpsMessage}</div>}
                </div>
              ) : integration === "GitHub" ? (
                <div className="integration-detail">
                  <h3>GitHub</h3>
                  <p>Used to browse and clone your GitHub repositories in Repository Management and to build provider links.</p>
                  <SettingRow label="Personal Access Token" description="Stored in the operating system keychain through the Rust backend. Use a fine-grained or classic PAT with repo read access.">
                    <div className="secret-setting">
                      <input
                        value={githubPat}
                        onChange={(event) => setGithubPat(event.target.value)}
                        type="password"
                        placeholder={runningInTauri ? (githubConfigured ? "PAT saved" : "GitHub PAT") : "Open desktop window to save PAT"}
                        disabled={!runningInTauri}
                        aria-label="GitHub personal access token"
                      />
                      <div className="secret-actions">
                        <Button
                          variant="primary"
                          disabled={!runningInTauri || githubBusy || !githubPat.trim()}
                          onClick={async () => {
                            setGithubBusy(true);
                            setGithubMessage(null);
                            try {
                              const status = await saveGitHubPat(githubPat);
                              setGithubConfigured(status.configured);
                              setGithubLogin(status.login ?? null);
                              setGithubPat("");
                              setGithubMessage(status.login ? `GitHub PAT saved. Connected as ${status.login}${status.name ? ` (${status.name})` : ""}.` : "GitHub PAT saved.");
                            } catch (error) {
                              setGithubMessage(error instanceof Error ? error.message : String(error));
                            } finally {
                              setGithubBusy(false);
                            }
                          }}
                        >
                          Save &amp; Test PAT
                        </Button>
                        <Button
                          variant="danger"
                          disabled={!runningInTauri || githubBusy || !githubConfigured}
                          onClick={async () => {
                            setGithubBusy(true);
                            setGithubMessage(null);
                            try {
                              const status = await clearGitHubPat();
                              setGithubConfigured(status.configured);
                              setGithubLogin(null);
                              setGithubMessage("GitHub PAT removed.");
                            } catch (error) {
                              setGithubMessage(error instanceof Error ? error.message : String(error));
                            } finally {
                              setGithubBusy(false);
                            }
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  </SettingRow>
                  <div className="settings-note">{githubStatusMessage}</div>
                  <div className="settings-note">Saving validates the token against the GitHub API before it is stored, so a mistyped PAT never lands in the keychain.</div>
                  <Button variant="secondary" onClick={openRepositoryManagement}>
                    Open Repository Management
                  </Button>
                  {githubMessage && <div className="settings-note">{githubMessage}</div>}
                </div>
              ) : integration === "Claude (Anthropic)" ? (
                <div className="integration-detail">
                  <h3>Claude (Anthropic)</h3>
                  <p>Used for AI commit messages, PR text, and branch explanations. OpenGit sends the Git context to Anthropic when Claude is the selected provider.</p>
                  <SettingRow label="API Key" description="Stored in the operating system keychain through the Rust backend, not localStorage. Use a console.anthropic.com API key.">
                    <div className="secret-setting">
                      <input
                        value={claudeKey}
                        onChange={(event) => setClaudeKey(event.target.value)}
                        type="password"
                        placeholder={runningInTauri ? (claudeConfigured ? "API key saved" : "sk-ant-...") : "Open desktop window to save key"}
                        disabled={!runningInTauri}
                        aria-label="Claude API key"
                      />
                      <div className="secret-actions">
                        <Button
                          variant="primary"
                          disabled={!runningInTauri || claudeBusy || !claudeKey.trim()}
                          onClick={async () => {
                            setClaudeBusy(true);
                            setClaudeMessage(null);
                            try {
                              const status = await saveClaudeApiKey(claudeKey);
                              setClaudeConfigured(status.configured);
                              setClaudeKey("");
                              setClaudeMessage("Claude API key saved.");
                            } catch (error) {
                              setClaudeMessage(error instanceof Error ? error.message : String(error));
                            } finally {
                              setClaudeBusy(false);
                            }
                          }}
                        >
                          Save Key
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={!runningInTauri || claudeBusy}
                          onClick={async () => {
                            setClaudeBusy(true);
                            setClaudeMessage(null);
                            try {
                              const result = await testClaudeApiKey();
                              if (result.configured) {
                                setClaudeConfigured(true);
                              }
                              setClaudeMessage(result.message);
                            } catch (error) {
                              setClaudeMessage(error instanceof Error ? error.message : String(error));
                            } finally {
                              setClaudeBusy(false);
                            }
                          }}
                        >
                          Test Key
                        </Button>
                        <Button
                          variant="danger"
                          disabled={!runningInTauri || claudeBusy || !claudeConfigured}
                          onClick={async () => {
                            setClaudeBusy(true);
                            setClaudeMessage(null);
                            try {
                              const status = await clearClaudeApiKey();
                              setClaudeConfigured(status.configured);
                              setClaudeMessage("Claude API key removed.");
                            } catch (error) {
                              setClaudeMessage(error instanceof Error ? error.message : String(error));
                            } finally {
                              setClaudeBusy(false);
                            }
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  </SettingRow>
                  <SettingRow label="AI provider" description="Which provider handles AI generation. Auto uses whichever single key exists; Claude wins when both are configured.">
                    <select value={aiProvider} onChange={(event) => setAiProvider(event.target.value as AiProviderPreference)} aria-label="AI provider">
                      <option value="auto">Auto</option>
                      <option value="openai">OpenAI</option>
                      <option value="claude">Claude</option>
                    </select>
                  </SettingRow>
                  <div className="settings-note">{claudeStatusMessage}</div>
                  {claudeMessage && <div className="settings-note">{claudeMessage}</div>}
                </div>
              ) : null}
            </div>
          </PreferenceSection>
        )}

        {section !== "general" && section !== "profiles" && section !== "repositories" && section !== "integrations" && (
          <PreferenceSection title={titleForPreferenceSection(section)}>
            <div className="settings-placeholder">
              <span>This section is reserved for the next implementation pass.</span>
              <p>Keeping the structure in place now prevents repo, SSH, provider, editor, and terminal settings from becoming scattered across the main workspace.</p>
            </div>
          </PreferenceSection>
        )}
      </main>

      {profileDialog && (
        <ProfileDialog
          profile={profileDialog.mode === "edit" ? profileDialog.profile : null}
          onSave={(values) => saveProfile(values, profileDialog.mode === "edit" ? profileDialog.profile.id : undefined)}
          onCancel={() => setProfileDialog(null)}
        />
      )}
    </div>
  );
}

function ProfileDialog({
  profile,
  onSave,
  onCancel
}: {
  profile: GitProfile | null;
  onSave: (values: Omit<GitProfile, "id">) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(profile?.name ?? "");
  const [authorName, setAuthorName] = useState(profile?.authorName ?? "");
  const [authorEmail, setAuthorEmail] = useState(profile?.authorEmail ?? "");
  const [color, setColor] = useState(profile?.color ?? gitProfileColors[1]);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, []);

  const preview: GitProfile = { id: "preview", name, authorName, authorEmail, color };
  const canSave = name.trim().length > 0;

  return (
    <div className="prompt-backdrop" onMouseDown={onCancel}>
      <div
        className="prompt-dialog profile-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={profile ? "Edit profile" : "Add a profile"}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSave) return;
            onSave({ name: name.trim(), authorName: authorName.trim(), authorEmail: authorEmail.trim(), color });
          }}
        >
          <div className="prompt-header">
            <h2>{profile ? "Edit Profile" : "Add a Profile"}</h2>
            <IconButton label="Close" onClick={onCancel}>
              <X size={14} />
            </IconButton>
          </div>

          <div className="profile-dialog-identity">
            <span className="profile-avatar large" style={{ background: color }}>
              {profileInitials(preview)}
            </span>
            <div className="profile-color-picker" role="radiogroup" aria-label="Profile color">
              {gitProfileColors.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={clsx("profile-color-swatch", option === color && "active")}
                  style={{ background: option }}
                  onClick={() => setColor(option)}
                  role="radio"
                  aria-checked={option === color}
                  aria-label={`Profile color ${option}`}
                />
              ))}
            </div>
          </div>

          <label htmlFor="profile-dialog-name">Profile Name</label>
          <input
            id="profile-dialog-name"
            ref={nameInputRef}
            value={name}
            placeholder="Work"
            onChange={(event) => setName(event.target.value)}
          />

          <label htmlFor="profile-dialog-author">Author Name</label>
          <input
            id="profile-dialog-author"
            value={authorName}
            placeholder="Your commit author name"
            onChange={(event) => setAuthorName(event.target.value)}
          />

          <label htmlFor="profile-dialog-email">Author Email</label>
          <input
            id="profile-dialog-email"
            value={authorEmail}
            type="email"
            placeholder="you@example.com"
            onChange={(event) => setAuthorEmail(event.target.value)}
          />

          <div className="prompt-actions">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!canSave}>
              {profile ? "Save Changes" : "Create Profile"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PreferenceSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="preference-section">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

function SettingRow({
  label,
  description,
  children
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div>
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
      <div>{children}</div>
    </div>
  );
}

function titleForPreferenceSection(section: PreferenceSection) {
  const titles: Record<PreferenceSection, string> = {
    general: "General",
    repositories: "Repositories",
    profiles: "Profiles",
    ssh: "SSH",
    integrations: "Integrations",
    externalTools: "External Tools",
    notifications: "Notifications",
    commit: "Commit",
    editor: "Editor",
    terminal: "In-App Terminal",
    experimental: "Experimental"
  };
  return titles[section];
}

function filterHistoryCommits(commits: Commit[], filters: HistoryFilters): Commit[] {
  const searchTerms = historySearchTerms(filters.query);
  const filtered = commits.filter((commitItem) => {
    if (filters.author && commitItem.author !== filters.author) return false;
    if (filters.type && commitMessageType(commitItem.message) !== filters.type) return false;
    if (searchTerms.length > 0 && !commitMatchesHistorySearch(commitItem, searchTerms)) return false;
    return true;
  });

  if (filters.dateDirection === "asc") {
    return [...filtered].sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
  }

  return filtered;
}

function uniqueCommitsBySha(commits: Commit[]) {
  const seen = new Set<string>();
  return commits.filter((commitItem) => {
    if (seen.has(commitItem.sha)) return false;
    seen.add(commitItem.sha);
    return true;
  });
}

function historySearchTerms(query: string) {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function commitMatchesHistorySearch(commitItem: Commit, terms: string[]) {
  const searchableText = [
    commitItem.sha,
    shortSha(commitItem.sha),
    commitItem.author,
    commitItem.authorEmail,
    commitItem.message,
    commitItem.refs.join(" "),
    commitItem.date,
    formatDateTime(commitItem.date)
  ]
    .join(" ")
    .toLowerCase();

  return terms.every((term) => searchableText.includes(term));
}

function uniqueHistoryAuthors(commits: Commit[]) {
  return [...new Set(commits.map((commitItem) => commitItem.author).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" })
  );
}

function uniqueHistoryTypes(commits: Commit[]) {
  const types = [...new Set(commits.map((commitItem) => commitMessageType(commitItem.message)).filter(Boolean))];
  const preferredOrder = ["fix", "feat", "chore", "merge", "docs", "refactor", "test", "build", "ci", "perf", "style", "revert", "wip"];
  return types.sort((left, right) => {
    const leftIndex = preferredOrder.indexOf(left);
    const rightIndex = preferredOrder.indexOf(right);
    if (leftIndex !== -1 || rightIndex !== -1) {
      return (leftIndex === -1 ? preferredOrder.length : leftIndex) - (rightIndex === -1 ? preferredOrder.length : rightIndex);
    }
    return left.localeCompare(right);
  });
}

function commitMessageType(message: string) {
  const trimmed = message.trim();
  if (/^merge\b/i.test(trimmed)) return "merge";
  const match = trimmed.match(/^([a-z][a-z0-9-]*)(\([^)]+\))?!?:/i);
  return match?.[1]?.toLowerCase() ?? "";
}

function areHistoryFiltersActive(filters: HistoryFilters) {
  return Boolean(filters.query.trim() || filters.author || filters.type || filters.dateDirection !== defaultHistoryFilters.dateDirection);
}

function hasCommitNarrowingHistoryFilters(filters: HistoryFilters) {
  return Boolean(filters.query.trim() || filters.author || filters.type);
}

function buildGraphRows(commits: Commit[]): GraphRow[] {
  const rows: GraphRow[] = [];
  let lanes: string[] = [];
  const visibleShas = new Set(commits.map((commitItem) => commitItem.sha));

  for (const commitItem of commits) {
    let lane = lanes.indexOf(commitItem.sha);
    if (lane === -1) {
      lanes = [commitItem.sha, ...lanes];
      lane = 0;
    }

    const lanesBefore = [...lanes];
    const nextLanes = [...lanes];
    nextLanes.splice(lane, 1);

    const connections = commitItem.parents.map((parent, index) => {
      if (!visibleShas.has(parent)) {
        return {
          from: lane,
          to: lane,
          color: colorForId(parent),
          terminal: true
        };
      }

      const preferredLane = lane + index;
      const targetLane = placeGraphParent(nextLanes, parent, preferredLane);
      return {
        from: lane,
        to: targetLane,
        color: colorForId(parent)
      };
    });

    lanes = dedupeLanes(nextLanes);

    rows.push({
      commit: commitItem,
      lane,
      lanesBefore,
      lanesAfter: [...lanes],
      connections,
      refs: parseCommitRefs(commitItem.refs),
      maxLane: Math.max(lanesBefore.length, lanes.length, lane + 1),
      color: colorForId(commitItem.sha)
    });
  }

  return rows;
}

function placeGraphParent(lanes: string[], parent: string, preferredLane: number) {
  const existingLane = lanes.indexOf(parent);
  if (existingLane !== -1) return existingLane;

  const safeLane = Math.max(0, Math.min(preferredLane, lanes.length));
  lanes.splice(safeLane, 0, parent);
  return safeLane;
}

function dedupeLanes(lanes: string[]) {
  const seen = new Set<string>();
  return lanes.filter((sha) => {
    if (seen.has(sha)) return false;
    seen.add(sha);
    return true;
  });
}

function parseCommitRefs(refs: string[]): RefChip[] {
  return refs.flatMap((rawRef) =>
    rawRef
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => {
        const label = normalizeRefLabel(value);
        const kind = refKind(value, label);
        return {
          label,
          kind,
          raw: value,
          color: refColor(label, kind)
        };
      })
  );
}

function normalizeRefLabel(value: string) {
  if (value.startsWith("HEAD -> ")) return value.replace("HEAD -> ", "");
  if (value.startsWith("tag: ")) return value.replace("tag: ", "");
  return value.replace(/^refs\/heads\//, "").replace(/^refs\/remotes\//, "");
}

function refKind(value: string, label: string): RefKind {
  if (value.startsWith("HEAD -> ")) return "head";
  if (value.startsWith("tag: ")) return "tag";
  if (label.includes("/")) return "remote";
  if (value.startsWith("refs/")) return "other";
  return "local";
}

function colorForId(value: string) {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return graphColors[hash % graphColors.length];
}

function refColor(label: string, kind: RefKind) {
  const tone = refTone(label);
  if (kind === "remote") return "#8b949e";
  if (kind === "tag" || tone === "release") return "#e3b341";
  if (tone === "main") return "#79c0ff";
  if (tone === "wip") return "#ff7b72";
  if (kind === "head") return "#b388ff";
  return colorForId(label);
}

function refTone(label: string) {
  const normalized = label.toLowerCase();
  if (normalized.includes("wip")) return "wip";
  if (normalized.includes("release") || /^v?\d+\.\d+/.test(normalized)) return "release";
  if (normalized === "integrate" || normalized.endsWith("/integrate")) return "main";
  if (normalized === "origin/master" || normalized === "origin/main" || normalized === "master" || normalized === "main" || normalized.endsWith("/master") || normalized.endsWith("/main")) {
    return "main";
  }
  return "feature";
}

function refToneClass(ref: RefChip) {
  if (ref.kind === "remote") return "remote-tone";
  if (ref.kind === "tag") return "release-tone";
  return `${refTone(ref.label)}-tone`;
}

function renderCommitMessage(message: string): ReactNode {
  const mergeMatch = message.match(/^(merge)\b\s*(.*)$/i);
  if (mergeMatch) {
    const [, type, body] = mergeMatch;
    return (
      <>
        <span className="commit-type commit-type-merge">{type}</span>
        {body && (
          <>
            <span className="commit-separator"> </span>
            <span className="commit-body">{body}</span>
          </>
        )}
      </>
    );
  }

  const match = message.match(/^([a-z][a-z0-9-]*)(\([^)]+\))?(!)?:\s*(.*)$/i);
  if (!match) return <span className="commit-body">{message}</span>;

  const [, type, scope, bang, body] = match;
  const normalizedType = type.toLowerCase();
  return (
    <>
      <span className={clsx("commit-type", `commit-type-${normalizedType}`)}>{type}</span>
      {scope && <span className="commit-scope">{scope}</span>}
      {bang && <span className={clsx("commit-type", `commit-type-${normalizedType}`)}>{bang}</span>}
      {body && (
        <>
          <span className="commit-separator"> </span>
          <span className="commit-body">{body}</span>
        </>
      )}
    </>
  );
}

function buildLanePathMap(lanes: ParallelLane[]) {
  const map = new Map<string, ParallelLane>();
  for (const lane of lanes) {
    for (const lanePath of lane.paths) {
      map.set(lanePath.path, lane);
    }
  }
  return map;
}

function filterChangesByLane(changes: FileChange[], selectedLaneId: string | null | undefined, laneByPath: Map<string, ParallelLane>) {
  if (selectedLaneId === undefined) return changes;
  if (!selectedLaneId) return changes.filter((change) => !laneByPath.has(change.path));
  return changes.filter((change) => laneByPath.get(change.path)?.id === selectedLaneId);
}

function laneNameFromPath(path: string) {
  const base = path
    .split("/")
    .filter(Boolean)
    .at(-1)
    ?.replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim();
  return base ? `${base} lane` : "Parallel lane";
}

function stackItemForCommit(commit: Commit, stack: BranchStack) {
  const refs = parseCommitRefs(commit.refs).map((ref) => ref.label);
  return stack.items.find((item) => refs.includes(item.branch) || refs.includes(`origin/${item.branch}`)) ?? null;
}

function parseLockPath(detail: string | undefined): string | null {
  if (!detail) return null;
  return detail.match(/Unable to create '([^']+\.lock)'/)?.[1] ?? null;
}

function buildPushRecoveryState(message: string, detail: string | undefined, snapshot: RepoSnapshot | null): PushRecoveryState {
  const rejectedBranch = detail?.match(/\[rejected\]\s+(\S+)\s+->\s+(\S+)/)?.[1];
  const currentBranch = snapshot?.currentBranch && !["HEAD", "(detached)"].includes(snapshot.currentBranch)
    ? snapshot.currentBranch
    : undefined;
  const branch = rejectedBranch ?? currentBranch;
  const upstreamRemote = snapshot?.upstream?.split("/")[0];
  const remote = upstreamRemote || snapshot?.remotes[0]?.name;

  return {
    message,
    remote,
    branch
  };
}

function hasActiveConflictState(snapshot: RepoSnapshot | null) {
  if (!snapshot) return false;
  return snapshot.conflicts.length > 0 || ["merging", "rebasing", "cherry-picking"].includes(snapshot.repository.worktreeState);
}

function conflictBannerMessage(snapshot: RepoSnapshot) {
  if (snapshot.activeOperation) {
    return `${snapshot.activeOperation.label}: ${snapshot.activeOperation.status}.`;
  }
  const state = worktreeStateLabel(snapshot.repository.worktreeState);
  if (snapshot.conflicts.length > 0) {
    return `${state} stopped with ${snapshot.conflicts.length} unresolved conflict${snapshot.conflicts.length === 1 ? "" : "s"}.`;
  }
  return `${state} is ready to continue.`;
}

function worktreeStateLabel(state: string) {
  if (state === "rebasing") return "Rebase";
  if (state === "cherry-picking") return "Cherry-pick";
  if (state === "merging") return "Merge";
  return "Git operation";
}

function statusLabel(change: { status: FileStatus }) {
  if (change.status === "untracked") return "U";
  if (change.status === "renamed") return "R";
  if (change.status === "copied") return "C";
  if (change.status === "deleted") return "D";
  if (change.status === "added") return "A";
  if (change.status === "conflicted") return "!";
  return "M";
}

function branchMenuItems(
  target: BranchMenuTarget,
  snapshot: RepoSnapshot | null,
  options?: { providerLinks?: ProviderWebInfo | null; aiConfigured?: boolean }
): BranchMenuItem[] {
  const currentBranch = snapshot?.currentBranch ?? "current branch";
  const hasRemote = (snapshot?.remotes.length ?? 0) > 0;
  const localBranch = !target.isRemote && !target.isTag && !target.isUnborn && !target.isCommitOnly;
  const branchRef = target.isCommitOnly ? "commit" : target.isTag ? "tag" : target.isRemote ? "remote branch" : "branch";
  const canCheckout = target.isTag || target.isRemote || (localBranch && !target.isCurrent);
  const canMerge = !target.isCurrent && !target.isTag && !target.isUnborn && !target.isCommitOnly;
  const canRebase = !target.isCurrent && !target.isTag && !target.isUnborn && !target.isCommitOnly;
  const canDelete = localBranch && !target.isCurrent && !target.isProtected;

  return [
    {
      type: "item",
      action: "pull",
      label: "Pull (fast-forward if possible)",
      disabled: !target.isCurrent || target.isTag || target.isRemote || target.isCommitOnly,
      hint: target.isCommitOnly ? "not a branch" : !target.isCurrent ? "checkout first" : undefined
    },
    {
      type: "item",
      action: "push",
      label: "Push",
      disabled: !localBranch || !hasRemote,
      hint: !hasRemote ? "add remote first" : !localBranch ? `not a local ${branchRef}` : undefined
    },
    {
      type: "item",
      action: "set-upstream",
      label: "Set Upstream",
      disabled: !localBranch || !hasRemote,
      hint: !hasRemote ? "add remote first" : !localBranch ? `not a local ${branchRef}` : undefined
    },
    { type: "separator", key: "integrate" },
    {
      type: "item",
      action: "merge",
      label: `Merge ${target.name} into ${currentBranch}`,
      disabled: !canMerge,
      hint: target.isCurrent ? "already checked out" : target.isTag ? "tags cannot be merged here" : target.isCommitOnly ? "not a branch" : undefined
    },
    {
      type: "item",
      action: "rebase",
      label: `Rebase ${currentBranch} onto ${target.name}`,
      disabled: !canRebase,
      hint: target.isCurrent ? "already checked out" : target.isTag ? "tags cannot be rebased here" : target.isCommitOnly ? "not a branch" : undefined
    },
    { type: "separator", key: "checkout" },
    {
      type: "item",
      action: "checkout",
      label: target.isTag ? "Checkout tag" : target.isRemote ? "Checkout (create local & track)" : "Checkout",
      disabled: !canCheckout,
      hint: target.isCommitOnly ? "not a branch" : target.isCurrent ? "already checked out" : undefined
    },
    { type: "separator", key: "stack" },
    { type: "item", action: "stack-create", label: `Create stack from ${target.name}`, disabled: !localBranch },
    { type: "item", action: "stack-add", label: `Add ${target.name} to selected stack`, disabled: !localBranch || !(snapshot?.branchStacks.length ?? 0) },
    { type: "item", action: "stack-child", label: `Create child branch from ${target.name}`, disabled: !localBranch },
    { type: "item", action: "stack-restack", label: "Restack selected stack", disabled: !(snapshot?.branchStacks.length ?? 0) },
    { type: "item", action: "stack-pr-plan", label: "Prepare stack PR chain", disabled: !(snapshot?.branchStacks.length ?? 0) },
    { type: "separator", key: "commit" },
    { type: "item", action: "create-branch", label: "Create branch here", disabled: target.isUnborn },
    { type: "item", action: "cherry-pick", label: "Cherry pick commit", disabled: !target.commitSha },
    { type: "item", action: "revert", label: "Revert commit", disabled: !target.commitSha },
    { type: "separator", key: "manage" },
    {
      type: "item",
      action: "rename",
      label: `Rename ${target.name}`,
      disabled: !localBranch,
      hint: !localBranch ? `not a local ${branchRef}` : undefined
    },
    {
      type: "item",
      action: "delete",
      label: `Delete ${target.name}`,
      danger: true,
      disabled: !canDelete,
      hint: target.isCurrent ? "current branch" : target.isProtected ? "protected branch" : !localBranch ? `not a local ${branchRef}` : undefined
    },
    ...(options?.providerLinks
      ? ([
          { type: "separator", key: "provider" },
          {
            type: "item",
            action: "open-pr",
            label: `Start pull request from ${target.name}`,
            disabled: target.isTag || target.isCommitOnly || target.isUnborn,
            hint: target.isTag || target.isCommitOnly ? "not a branch" : undefined
          },
          { type: "item", action: "copy-branch-link", label: "Copy branch link", disabled: target.isTag || target.isCommitOnly || target.isUnborn },
          { type: "item", action: "copy-commit-link", label: "Copy commit link", disabled: !target.commitSha }
        ] satisfies BranchMenuItem[])
      : []),
    ...(options?.aiConfigured
      ? ([
          { type: "separator", key: "ai" },
          {
            type: "item",
            action: "explain",
            label: `Explain changes on ${target.name}`,
            disabled: target.isTag || target.isCommitOnly || target.isUnborn,
            hint: target.isTag || target.isCommitOnly ? "not a branch" : undefined
          }
        ] satisfies BranchMenuItem[])
      : []),
    { type: "separator", key: "copy" },
    { type: "item", action: "copy-name", label: target.isTag ? "Copy tag name" : "Copy branch name" },
    { type: "item", action: "copy-sha", label: "Copy commit sha", disabled: !target.commitSha },
    { type: "separator", key: "tags" },
    { type: "item", action: "create-tag", label: "Create tag here", disabled: target.isUnborn },
    { type: "item", action: "create-annotated-tag", label: "Create annotated tag here", disabled: target.isUnborn }
  ];
}

function menuPendingLabel(action: BranchMenuAction) {
  const labels: Record<BranchMenuAction, string> = {
    pull: "Pull",
    push: "Push",
    "set-upstream": "Set upstream",
    merge: "Merge",
    rebase: "Rebase",
    checkout: "Checkout",
    "create-worktree": "Create worktree",
    "stack-create": "Create stack",
    "stack-add": "Add branch to stack",
    "stack-child": "Create stack child branch",
    "stack-restack": "Restack stack",
    "stack-pr-plan": "Prepare stack PR chain",
    "create-branch": "Create branch",
    "cherry-pick": "Cherry pick",
    reset: "Reset branch",
    revert: "Revert commit",
    "open-pr": "Pull request creation",
    explain: "Explain branch changes",
    rename: "Rename branch",
    delete: "Delete branch",
    "delete-remote": "Delete remote branch",
    "copy-name": "Copy name",
    "copy-sha": "Copy SHA",
    "copy-branch-link": "Copy branch link",
    "copy-commit-link": "Copy commit link",
    "create-patch": "Create patch",
    "share-patch": "Share patch",
    "pin-left": "Pin to Left",
    solo: "Solo",
    "create-tag": "Create tag",
    "create-annotated-tag": "Create annotated tag"
  };
  return labels[action];
}

function targetFromBranch(branch: DisplayBranch, source: BranchMenuTarget["source"]): BranchMenuTarget {
  return {
    name: branch.name,
    fullRef: branch.fullRef,
    kind: branch.isRemote ? "remote" : branch.isCurrent ? "head" : "local",
    source,
    upstream: branch.upstream,
    isCurrent: branch.isCurrent,
    isProtected: branch.isProtected,
    isRemote: branch.isRemote,
    isTag: false,
    isUnborn: branch.isUnborn
  };
}

function targetFromCommit(commit: Commit, snapshot: RepoSnapshot | null): BranchMenuTarget {
  const ref = parseCommitRefs(commit.refs).find((item) => item.kind !== "tag") ?? parseCommitRefs(commit.refs)[0];
  if (ref) {
    return {
      ...targetFromRef(ref, commit, snapshot),
      source: "commit"
    };
  }

  return {
    name: shortSha(commit.sha),
    fullRef: commit.sha,
    kind: "other",
    source: "commit",
    commitSha: commit.sha,
    isCurrent: snapshot?.commits[0]?.sha === commit.sha,
    isProtected: false,
    isRemote: false,
    isTag: false,
    isUnborn: false,
    isCommitOnly: true
  };
}

function targetFromRef(ref: RefChip, commit: Commit, snapshot: RepoSnapshot | null): BranchMenuTarget {
  const branch = snapshot ? findBranchByName(snapshot, ref.label) : undefined;
  const isTag = ref.kind === "tag";
  const isRemote = ref.kind === "remote" || branch?.fullRef.startsWith("refs/remotes/") === true;

  return {
    name: ref.label,
    fullRef: branch?.fullRef ?? ref.raw,
    kind: ref.kind,
    source: "graph",
    commitSha: commit.sha,
    upstream: branch?.upstream,
    isCurrent: branch?.isCurrent ?? (snapshot?.currentBranch === ref.label && ref.kind !== "remote" && !isTag),
    isProtected: branch?.isProtected ?? ["main", "master", "develop", "dev", "release"].includes(ref.label),
    isRemote,
    isTag,
    isUnborn: false
  };
}

function targetFromInspection(inspection: BranchInspection): BranchMenuTarget {
  return {
    name: inspection.branch.name,
    fullRef: inspection.branch.fullRef,
    kind: inspection.branch.isCurrent ? "head" : inspection.kind === "tag" ? "tag" : inspection.kind === "remote" ? "remote" : "local",
    source: "sidebar",
    commitSha: inspection.headSha,
    upstream: inspection.upstream,
    isCurrent: inspection.branch.isCurrent,
    isProtected: inspection.branch.isProtected,
    isRemote: inspection.kind === "remote",
    isTag: inspection.kind === "tag",
    isUnborn: false
  };
}

function findBranchByName(snapshot: RepoSnapshot, name: string) {
  return snapshot.branches.find((branch) => branch.name === name || branch.fullRef === name || normalizeRefLabel(branch.fullRef) === name);
}

function branchRefForInspection(target: BranchMenuTarget | DisplayBranch | Branch) {
  return target.fullRef || target.name;
}

function branchIsSelected(branch: Branch, selectedBranchRef: string | null) {
  if (!selectedBranchRef) return false;
  return branch.name === selectedBranchRef || branch.fullRef === selectedBranchRef || normalizeRefLabel(branch.fullRef) === selectedBranchRef;
}

function branchInspectionStatusLabel(status: BranchInspection["status"]) {
  if (status === "up-to-date") return "Up to date";
  if (status === "no-upstream") return "No upstream";
  if (status === "current") return "Current";
  if (status === "ahead") return "Needs push";
  if (status === "behind") return "Behind";
  if (status === "diverged") return "Diverged";
  return "Unknown";
}

function defaultBranchFromTarget(target: BranchMenuTarget) {
  const normalized = target.name
    .replace(/^origin\//, "")
    .replace(/[^A-Za-z0-9._/-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized ? `${normalized}-work` : "new-branch";
}

function filterBranches(branches: DisplayBranch[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? branches.filter((branch) => branch.name.toLowerCase().includes(normalizedQuery) || branch.upstream?.toLowerCase().includes(normalizedQuery))
    : branches;

  return [...filtered].sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    if (a.isRemote !== b.isRemote) return a.isRemote ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

function displayBranches(snapshot: RepoSnapshot): DisplayBranch[] {
  if (snapshot.branches.length > 0) {
    return snapshot.branches.map((branch) => ({
      ...branch,
      isRemote: branch.fullRef.startsWith("refs/remotes/"),
      isUnborn: false
    }));
  }

  const name = snapshot.currentBranch && snapshot.currentBranch !== "(detached)" ? snapshot.currentBranch : "main";
  return [
    {
      name,
      fullRef: `refs/heads/${name}`,
      isCurrent: true,
      isProtected: name === "main" || name === "master",
      isRemote: false,
      isUnborn: true
    }
  ];
}

function repoNameFromPath(path: string) {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.split("/").filter(Boolean).at(-1) ?? "Open repository";
}

function shortSha(sha: string) {
  return sha.slice(0, 7);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatUndoSnapshotTime(value: string) {
  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}
