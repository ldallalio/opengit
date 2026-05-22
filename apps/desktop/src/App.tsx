import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState
} from "react";
import type { Branch, Commit, CommitFile, Conflict, FileChange, FileStatus, RepoSnapshot } from "@opengit/core";
import { Button, EmptyState, IconButton, Panel } from "@opengit/ui";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Bell,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Code2,
  FileText,
  FlaskConical,
  FolderOpen,
  Github,
  GitBranch,
  GitCommitHorizontal,
  GitFork,
  GitPullRequest,
  History,
  Link2,
  Maximize2,
  Minimize2,
  Moon,
  PackageOpen,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Shuffle,
  Sparkles,
  SquarePen,
  Sun,
  Terminal,
  Trash2,
  UploadCloud,
  UsersRound,
  Wrench,
  X
} from "lucide-react";
import { clsx } from "clsx";
import {
  addRemote,
  abortGitOperation,
  cherryPickCommit,
  chooseRepositoryFolder,
  checkoutBranch,
  continueGitOperation,
  commit,
  createBranch,
  createTag,
  deleteBranch,
  discardPaths,
  fetchRepo,
  clearAzureDevOpsPat,
  getCommitFileDiff,
  getCommitFiles,
  getConflictVersions,
  getAzureDevOpsStatus,
  getOpenAiStatus,
  generateAiCommitMessage,
  getDiff,
  isTauriRuntime,
  mergeBranch,
  openRepo,
  pullRepoFastForward,
  pullRepoRebase,
  pullRepo,
  pushRepo,
  rebaseOnto,
  refreshRepo,
  renameBranch,
  revertCommit,
  saveAzureDevOpsPat,
  saveOpenAiApiKey,
  markConflictResolved,
  stagePaths,
  stashApply,
  stashDrop,
  stashPush,
  clearOpenAiApiKey,
  testOpenAiApiKey,
  updateCommitMessage,
  unstagePaths,
  OpenGitApiError,
  resolveConflict,
  type ConflictStrategy,
  type ConflictVersions
} from "./api";
import { demoSnapshot } from "./demo";

type Theme = "dark" | "light";
type DiffMode = "commit" | "working";
type CenterView = "graph" | "diff" | "conflict";
type ResizeTarget =
  | "sidebar"
  | "detail"
  | "bottom"
  | "sidebarBranches"
  | "sidebarRemotes"
  | "sidebarStashes"
  | "detailSelection"
  | "bottomCommit"
  | "bottomOperations";
type LayoutState = {
  sidebarWidth: number;
  detailWidth: number;
  bottomHeight: number;
  sidebarBranchesHeight: number;
  sidebarRemotesHeight: number;
  sidebarStashesHeight: number;
  detailSelectionHeight: number;
  bottomCommitWidth: number;
  bottomOperationsWidth: number;
  sidebarCollapsed: boolean;
  detailCollapsed: boolean;
  bottomCollapsed: boolean;
};
type HistoryColumnKey = "branch" | "graph" | "message" | "author" | "date" | "hash";
type HistoryColumnWidths = Record<HistoryColumnKey, number>;
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
type PushRecoveryState = {
  message: string;
  remote?: string;
  branch?: string;
};
type BranchMenuAction =
  | "pull"
  | "push"
  | "set-upstream"
  | "merge"
  | "rebase"
  | "checkout"
  | "create-worktree"
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
const graphColors = ["#7c68ee", "#6bbf7a", "#5ba0d0", "#e07070", "#e0b060", "#8c7bff", "#5bbf9d", "#ce6ca8", "#7aa5ff", "#b6a8ff"];
const graphLaneWidth = 16;
const graphRowHeight = 34;
const maxVisibleGraphLanes = 12;
const repoTabLimit = 9;
const historyLimitOptions = [100, 250, 500, 1000, 2000] as const;
const historyColumnStorageKey = "opengit:historyColumnWidths";
const defaultHistoryColumnWidths: HistoryColumnWidths = {
  branch: 150,
  graph: 180,
  message: 520,
  author: 126,
  date: 132,
  hash: 72
};
const historyColumnLimits: Record<HistoryColumnKey, { min: number; max: number }> = {
  branch: { min: 90, max: 360 },
  graph: { min: 88, max: 420 },
  message: { min: 240, max: 1200 },
  author: { min: 82, max: 260 },
  date: { min: 96, max: 260 },
  hash: { min: 54, max: 160 }
};
const defaultLayout: LayoutState = {
  sidebarWidth: 280,
  detailWidth: 340,
  bottomHeight: 260,
  sidebarBranchesHeight: 180,
  sidebarRemotesHeight: 145,
  sidebarStashesHeight: 145,
  detailSelectionHeight: 142,
  bottomCommitWidth: 330,
  bottomOperationsWidth: 260,
  sidebarCollapsed: false,
  detailCollapsed: false,
  bottomCollapsed: false
};

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
  const [openAiConfigured, setOpenAiConfigured] = useState(false);
  const [openAiModel, setOpenAiModel] = useState(localStorage.getItem("opengit:openaiModel") ?? "gpt-5-mini");
  const [azureDevOpsConfigured, setAzureDevOpsConfigured] = useState(false);
  const [preferredIntegration, setPreferredIntegration] = useState("OpenAI");
  const [aiGeneratingCommit, setAiGeneratingCommit] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [remoteName, setRemoteName] = useState("origin");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [stashMessage, setStashMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [loading, setLoading] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [preferencesSection, setPreferencesSection] = useState<PreferenceSection>("repositories");
  const [error, setError] = useState<string | null>(null);
  const [pushRecovery, setPushRecovery] = useState<PushRecoveryState | null>(null);
  const [recentRepos, setRecentRepos] = useState<string[]>(loadRecentRepos);
  const [repoTabs, setRepoTabs] = useState<string[]>(loadRepoTabs);
  const [layout, setLayout] = useState<LayoutState>(defaultLayout);
  const [historyColumnWidths, setHistoryColumnWidths] = useState<HistoryColumnWidths>(loadHistoryColumnWidths);
  const [branchMenu, setBranchMenu] = useState<BranchMenuState | null>(null);
  const [branchSwitcherOpen, setBranchSwitcherOpen] = useState(false);
  const [branchSearch, setBranchSearch] = useState("");
  const [operationLog, setOperationLog] = useState<string[]>([
    runningInTauri ? "OpenGit ready" : "Browser preview uses demo data"
  ]);

  const stagedChanges = useMemo(() => snapshot?.changes.filter((change) => change.staged) ?? [], [snapshot]);
  const unstagedChanges = useMemo(() => snapshot?.changes.filter((change) => change.unstaged) ?? [], [snapshot]);
  const activeDiffPath = diffMode === "commit" ? selectedCommitFile?.path : selectedFile?.path;
  const activeDiff = diffMode === "commit" ? commitDiff : diff;
  const activeDiffLoading = diffMode === "commit" && commitDiffLoading;
  const graphRows = useMemo(() => buildGraphRows(snapshot?.commits ?? []), [snapshot]);
  const activeConflictState = hasActiveConflictState(snapshot);
  const selectedConflict = useMemo(
    () => snapshot?.conflicts.find((conflict) => conflict.path === selectedConflictPath) ?? snapshot?.conflicts[0] ?? null,
    [snapshot, selectedConflictPath]
  );
  const selectedCommitIsHead = Boolean(selectedCommit && snapshot?.commits[0]?.sha === selectedCommit.sha);
  const topbarBranches = useMemo(() => (snapshot ? displayBranches(snapshot) : []), [snapshot]);
  const filteredTopbarBranches = useMemo(() => filterBranches(topbarBranches, branchSearch), [topbarBranches, branchSearch]);
  const activeRepoPath = snapshot?.repository.path ?? repoPath;
  const visibleRepoTabs = useMemo(() => uniqueRepoPaths([activeRepoPath, ...repoTabs]).slice(0, repoTabLimit), [activeRepoPath, repoTabs]);
  const contentGridStyle = {
    "--sidebar-track": layout.sidebarCollapsed ? "0px" : `${layout.sidebarWidth}px`,
    "--sidebar-handle-track": layout.sidebarCollapsed ? "0px" : "6px",
    "--detail-track": layout.detailCollapsed ? "0px" : `${layout.detailWidth}px`,
    "--detail-handle-track": layout.detailCollapsed ? "0px" : "6px",
    "--bottom-track": layout.bottomCollapsed ? "0px" : `${layout.bottomHeight}px`,
    "--bottom-handle-track": layout.bottomCollapsed ? "0px" : "6px",
    "--sidebar-branches-height": `${layout.sidebarBranchesHeight}px`,
    "--sidebar-remotes-height": `${layout.sidebarRemotesHeight}px`,
    "--sidebar-stashes-height": `${layout.sidebarStashesHeight}px`,
    "--detail-selection-height": `${layout.detailSelectionHeight}px`,
    "--bottom-commit-width": `${layout.bottomCommitWidth}px`,
    "--bottom-operations-width": `${layout.bottomOperationsWidth}px`
  } as CSSProperties;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("opengit:theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("opengit:openaiModel", openAiModel);
  }, [openAiModel]);

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
    let cancelled = false;
    void getOpenAiStatus()
      .then((status) => {
        if (!cancelled) setOpenAiConfigured(status.configured);
      })
      .catch((statusError) => {
        if (!cancelled) {
          const message = statusError instanceof Error ? statusError.message : String(statusError);
          setOperationLog((log) => [`OpenAI status check failed: ${message}`, ...log].slice(0, 8));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getAzureDevOpsStatus()
      .then((status) => {
        if (!cancelled) setAzureDevOpsConfigured(status.configured);
      })
      .catch((statusError) => {
        if (!cancelled) {
          const message = statusError instanceof Error ? statusError.message : String(statusError);
          setOperationLog((log) => [`Azure DevOps status check failed: ${message}`, ...log].slice(0, 8));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    if (!snapshot || !selectedFile) {
      setDiff("");
      return;
    }

    let cancelled = false;
    void getDiff(snapshot.repository.path, selectedFile.path, selectedFile.staged)
      .then((value) => {
        if (!cancelled) setDiff(value);
      })
      .catch((diffError) => {
        if (!cancelled) setDiff(String(diffError.message ?? diffError));
      });

    return () => {
      cancelled = true;
    };
  }, [snapshot, selectedFile]);

  useEffect(() => {
    if (!snapshot || !selectedCommit) {
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

    void getCommitFiles(snapshot.repository.path, selectedCommit.sha)
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
  }, [snapshot, selectedCommit]);

  useEffect(() => {
    if (!snapshot || !selectedCommit || !selectedCommitFile) {
      setCommitDiff("");
      return;
    }

    let cancelled = false;
    setCommitDiffLoading(true);
    void getCommitFileDiff(snapshot.repository.path, selectedCommit.sha, selectedCommitFile.path, selectedCommitFile.oldPath)
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
  }, [snapshot, selectedCommit, selectedCommitFile]);

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
    setSnapshot(next);
    setRepoPath(next.repository.path);
    localStorage.setItem("opengit:lastPath", next.repository.path);
    rememberRepo(next.repository.path);
    addRepoTab(next.repository.path);
    setSelectedCommit(next.commits[0] ?? null);
    setSelectedCommitMessage(next.commits[0]?.message ?? "");
    setSelectedFile(next.changes[0] ?? null);
    setSelectedConflictPath(next.conflicts[0]?.path ?? null);
    setDiffMode(next.commits.length > 0 ? "commit" : "working");
    setCenterView(hasActiveConflictState(next) ? "conflict" : "graph");
    setDiffExpanded(false);
  };

  const runSnapshotOperation = async (label: string, operation: () => Promise<RepoSnapshot>) => {
    setLoading(true);
    setError(null);
    setPushRecovery(null);
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
    } finally {
      setLoading(false);
    }
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
    setSelectedCommitMessage("");
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

  const openCommitDiff = (file: CommitFile) => {
    setSelectedCommitFile(file);
    setDiffMode("commit");
    setCenterView("diff");
  };

  const openWorkingDiff = (change: FileChange) => {
    setSelectedFile(change);
    setDiffMode("working");
    setCenterView("diff");
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

  const pendingBranchAction = (label: string) => {
    setBranchMenu(null);
    const message = `${label} is planned but not implemented yet.`;
    setError(message);
    setOperationLog((log) => [message, ...log].slice(0, 8));
  };

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

  const runBranchTargetOperation = (
    label: string,
    operation: (repo: string) => Promise<RepoSnapshot>,
    confirmMessage?: string
  ) => {
    const repo = requireRepo();
    if (!repo) return;
    setBranchMenu(null);
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    void runSnapshotOperation(label, () => operation(repo));
  };

  const handleBranchMenuAction = (action: BranchMenuAction, target: BranchMenuTarget) => {
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
      const message = target.isTag ? `Checkout tag '${target.name}'? This will detach HEAD.` : undefined;
      runBranchTargetOperation("Checkout branch", (repo) => checkoutBranch(repo, target.name), message);
      return;
    }

    if (action === "create-branch") {
      const defaultName = defaultBranchFromTarget(target);
      const nextName = window.prompt("New branch name", defaultName);
      if (!nextName?.trim()) {
        setBranchMenu(null);
        return;
      }
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
      const nextName = window.prompt("Rename branch", target.name);
      if (!nextName?.trim() || nextName.trim() === target.name) {
        setBranchMenu(null);
        return;
      }
      runBranchTargetOperation("Rename branch", (repo) => renameBranch(repo, target.name, nextName.trim()));
      return;
    }

    if (action === "delete") {
      runBranchTargetOperation("Delete branch", (repo) => deleteBranch(repo, target.name, false), `Delete branch '${target.name}'?`);
      return;
    }

    if (action === "create-tag" || action === "create-annotated-tag") {
      const tagName = window.prompt("Tag name", "");
      if (!tagName?.trim()) {
        setBranchMenu(null);
        return;
      }
      const message = action === "create-annotated-tag" ? window.prompt("Tag message", tagName.trim())?.trim() : undefined;
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
      target === "bottom" || target === "sidebarBranches" || target === "sidebarRemotes" || target === "sidebarStashes" || target === "detailSelection"
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
        if (target === "sidebarBranches") next.sidebarBranchesHeight = clamp(initial.sidebarBranchesHeight + deltaY, 80, 420);
        if (target === "sidebarRemotes") next.sidebarRemotesHeight = clamp(initial.sidebarRemotesHeight + deltaY, 80, 360);
        if (target === "sidebarStashes") next.sidebarStashesHeight = clamp(initial.sidebarStashesHeight + deltaY, 80, 360);
        if (target === "detailSelection") next.detailSelectionHeight = clamp(initial.detailSelectionHeight + deltaY, 80, 300);
        if (target === "bottomCommit") next.bottomCommitWidth = clamp(initial.bottomCommitWidth - deltaX, 230, 560);
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

  const commitChanges = () => {
    const repo = requireRepo();
    if (!repo) return;
    void runSnapshotOperation("Commit", () => commit(repo, commitMessage, amend)).then(() => {
      setCommitMessage("");
      setAmend(false);
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
      const suggestion = await generateAiCommitMessage(repo, openAiModel);
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
      if (runningInTauri) {
        void getOpenAiStatus()
          .then((status) => setOpenAiConfigured(status.configured))
          .catch(() => {
            setOpenAiConfigured(true);
          });
      }
    } finally {
      setAiGeneratingCommit(false);
    }
  };

  const updateSelectedCommitMessage = () => {
    const repo = requireRepo();
    if (!repo || !selectedCommit) return;
    if (!selectedCommitIsHead) {
      setError("Only the HEAD commit message can be updated safely right now. Older commit rewording needs a guarded rebase flow.");
      return;
    }
    if (stagedChanges.length > 0) {
      setError("Unstage files before updating the HEAD commit message so staged changes are not amended into it.");
      return;
    }
    if (!selectedCommitMessage.trim()) {
      setError("Commit message is required.");
      return;
    }
    void runSnapshotOperation("Update commit message", () => updateCommitMessage(repo, selectedCommit.sha, selectedCommitMessage.trim()));
  };

  const branchCreate = () => {
    const repo = requireRepo();
    if (!repo || !branchName.trim()) return;
    void runSnapshotOperation("Create branch", () => createBranch(repo, branchName.trim(), true)).then(() => setBranchName(""));
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

    if (branch.isRemote) {
      setError("Create a local branch from the remote branch before checking it out.");
      setBranchSwitcherOpen(false);
      return;
    }

    const repo = requireRepo();
    if (!repo) return;
    setBranchSwitcherOpen(false);
    setBranchSearch("");
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

  const forcePushAfterRejectedPush = () => {
    if (!snapshot || !pushRecovery) {
      return;
    }

    const branch = pushRecovery.branch ?? snapshot.currentBranch;
    const branchLabel = branch ? `'${branch}'` : "the current branch";
    if (!window.confirm(`Force push ${branchLabel} with --force-with-lease?`)) {
      return;
    }

    void runSnapshotOperation("Force push", () =>
      pushRepo(snapshot.repository.path, pushRecovery.remote, branch, true, false)
    );
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

  const abortCurrentGitOperation = () => {
    if (!snapshot) return;
    if (!window.confirm("Abort the current Git operation and return the repository to the previous state?")) return;
    void runSnapshotOperation("Abort operation", () => abortGitOperation(snapshot.repository.path));
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
          onOpenPalette={() => setPaletteOpen(true)}
        />

        <header className="topbar">
          <div className="repo-identity-strip" aria-label="Repository status">
            <button className="repo-identity-card repository-card" type="button" onClick={browseForRepository} disabled={loading}>
              <span>repository</span>
              <strong>{snapshot?.repository.name ?? repoNameFromPath(repoPath)}</strong>
              <small>{snapshot?.repository.path ?? repoPath}</small>
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
                <strong>{snapshot?.currentBranch ?? "No branch"}</strong>
                <small>{snapshot?.upstream ?? "local"}</small>
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
            <Button variant="primary" onClick={openCurrentPath} disabled={loading}>
              Open
            </Button>
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
                <span>{snapshot.currentBranch ?? "detached"}</span>
                {snapshot.upstream && <span>{snapshot.upstream}</span>}
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
            centerView === "diff" && diffExpanded && "diff-expanded",
            layout.sidebarCollapsed && "sidebar-collapsed",
            layout.detailCollapsed && "detail-collapsed",
            layout.bottomCollapsed && "bottom-collapsed"
          )}
          style={contentGridStyle}
        >
          <Sidebar
            snapshot={snapshot}
            branchName={branchName}
            stashMessage={stashMessage}
            setBranchName={setBranchName}
            remoteName={remoteName}
            remoteUrl={remoteUrl}
            setRemoteName={setRemoteName}
            setRemoteUrl={setRemoteUrl}
            setStashMessage={setStashMessage}
            createBranch={branchCreate}
            addRemote={addRepositoryRemote}
            stashCurrent={stashCurrent}
            deleteBranch={(name) => {
              const repo = requireRepo();
              if (repo && window.confirm(`Delete branch '${name}'?`)) {
                void runSnapshotOperation("Delete branch", () => deleteBranch(repo, name, false));
              }
            }}
            applyStash={(stash) => {
              const repo = requireRepo();
              if (repo) void runSnapshotOperation("Apply stash", () => stashApply(repo, stash));
            }}
            dropStash={(stash) => {
              const repo = requireRepo();
              if (repo && window.confirm(`Drop ${stash}?`)) {
                void runSnapshotOperation("Drop stash", () => stashDrop(repo, stash));
              }
            }}
            openBranchMenu={openBranchMenu}
            startResize={startResize}
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
                  <span>{snapshot ? `${snapshot.commits.length}/${historyLimit}` : "0"}</span>
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
                <EmptyState>No file selected</EmptyState>
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
                selectedSha={selectedCommit?.sha}
                snapshot={snapshot}
                commitMessage={commitMessage}
                setCommitMessage={setCommitMessage}
                columnWidths={historyColumnWidths}
                stagedCount={stagedChanges.length}
                unstagedCount={unstagedChanges.length}
                onColumnResizeStart={startHistoryColumnResize}
                onOpenBranchMenu={openBranchMenu}
                onOpenCommitMenu={(commitItem, event) => {
                  openBranchMenu(targetFromCommit(commitItem, snapshot), event);
                }}
                onSelect={(commitItem) => {
                  setSelectedCommit(commitItem);
                  setSelectedCommitMessage(commitItem.message);
                  setDiffMode("commit");
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
              <EmptyState>No repository open</EmptyState>
            )}
          </Panel>

          <ResizeHandle
            className="detail-resize"
            label="Resize detail sections"
            orientation="vertical"
            onPointerDown={(event) => startResize("detail", event)}
          />

          <aside className="detail-stack">
            <Panel title="Selection" className="selection-panel" actions={<GitCommitHorizontal size={15} />}>
              {selectedCommit ? (
                <div className="selection-detail">
                  <strong>{selectedCommit.message || "(no subject)"}</strong>
                  <span>{selectedCommit.sha}</span>
                  <span>{selectedCommit.author}</span>
                  <span>{selectedCommit.date}</span>
                  <span>{selectedCommit.parents.length} parent(s)</span>
                </div>
              ) : (
                <EmptyState>No commit selected</EmptyState>
              )}
            </Panel>
            <ResizeHandle
              className="detail-stack-resize"
              label="Resize selected commit details"
              orientation="horizontal"
              onPointerDown={(event) => startResize("detailSelection", event)}
            />

            <Panel title={`Changed Files (${commitFiles.length})`} className="changed-files-panel" actions={<FileText size={15} />}>
              <CommitFileList
                files={commitFiles}
                selected={selectedCommitFile}
                loading={commitFilesLoading}
                error={commitFileError}
                onSelect={openCommitDiff}
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
            <Panel title={`Changes (${snapshot?.changes.length ?? 0})`} className="changes-panel" actions={<ClipboardList size={15} />}>
              {snapshot ? (
                <div className="changes-grid">
                  <ChangeColumn
                    title={`Unstaged (${unstagedChanges.length})`}
                    changes={unstagedChanges}
                    selected={selectedFile}
                    onSelect={openWorkingDiff}
                    bulkAction={() => batchFileAction("Stage all", unstagedChanges, stagePaths)}
                    bulkDisabled={loading || unstagedChanges.length === 0}
                    bulkLabel="Stage All"
                    primaryAction={(change) => fileAction("Stage", change, stagePaths)}
                    primaryLabel="Stage"
                    secondaryAction={(change) => {
                      if (window.confirm(`Discard '${change.path}'?`)) {
                        fileAction("Discard", change, discardPaths);
                      }
                    }}
                  />
                  <ChangeColumn
                    title={`Staged (${stagedChanges.length})`}
                    changes={stagedChanges}
                    selected={selectedFile}
                    onSelect={openWorkingDiff}
                    bulkAction={() => batchFileAction("Unstage all", stagedChanges, unstagePaths)}
                    bulkDisabled={loading || stagedChanges.length === 0}
                    bulkLabel="Unstage All"
                    primaryAction={(change) => fileAction("Unstage", change, unstagePaths)}
                    primaryLabel="Unstage"
                    secondaryAction={(change) => {
                      if (window.confirm(`Discard '${change.path}'?`)) {
                        fileAction("Discard", change, discardPaths);
                      }
                    }}
                  />
                </div>
              ) : (
                <EmptyState>No working tree loaded</EmptyState>
              )}
            </Panel>
            <ResizeHandle
              className="bottom-commit-resize"
              label="Resize commit section"
              orientation="vertical"
              onPointerDown={(event) => startResize("bottomCommit", event)}
            />

            <Panel title="Commit" className="commit-panel" actions={<SquarePen size={15} />}>
              <div className="commit-box">
                {selectedCommit && (
                  <div className="selected-commit-editor">
                    <div>
                      <strong>Selected commit</strong>
                      <span>{shortSha(selectedCommit.sha)} · {selectedCommit.author}</span>
                    </div>
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
                        !selectedCommitIsHead ||
                        stagedChanges.length > 0 ||
                        !selectedCommitMessage.trim() ||
                        selectedCommitMessage.trim() === selectedCommit.message
                      }
                      onClick={updateSelectedCommitMessage}
                    >
                      Update Message
                    </Button>
                    {!selectedCommitIsHead && <small>Only HEAD message editing is enabled until guarded reword/rebase is added.</small>}
                    {selectedCommitIsHead && stagedChanges.length > 0 && <small>Unstage files before amending the HEAD message.</small>}
                  </div>
                )}
                <textarea
                  value={commitMessage}
                  onChange={(event) => setCommitMessage(event.target.value)}
                  placeholder="Commit message"
                  aria-label="Commit message"
                />
                <Button
                  className="ai-generate-button"
                  variant="secondary"
                  disabled={!snapshot || loading || aiGeneratingCommit || stagedChanges.length === 0}
                  onClick={() => void generateCommitMessage()}
                >
                  <Sparkles size={13} />
                  {aiGeneratingCommit ? "Generating" : "Generate Message"}
                </Button>
                <label className="check-row">
                  <input type="checkbox" checked={amend} onChange={(event) => setAmend(event.target.checked)} />
                  Amend
                </label>
                <Button variant="primary" disabled={!snapshot || loading || !commitMessage.trim()} onClick={commitChanges}>
                  Commit
                </Button>
              </div>
            </Panel>
            <ResizeHandle
              className="bottom-operations-resize"
              label="Resize operations section"
              orientation="vertical"
              onPointerDown={(event) => startResize("bottomOperations", event)}
            />

            <Panel title="Operations" className="operations-panel">
              <div className="operation-log">
                {operationLog.map((entry, index) => (
                  <span key={`${entry}-${index}`}>{entry}</span>
                ))}
              </div>
            </Panel>
          </section>
        </div>
      </section>

      {branchMenu && (
        <BranchContextMenu
          state={branchMenu}
          snapshot={snapshot}
          onAction={handleBranchMenuAction}
          onClose={() => setBranchMenu(null)}
        />
      )}

      {paletteOpen && (
        <CommandPalette
          close={() => setPaletteOpen(false)}
          commands={[
            ["Open repository", openCurrentPath],
            ["Browse for repository", browseForRepository],
            ["Preferences", () => setPreferencesOpen(true)],
            ["Refresh", refresh],
            ["Stage all changes", () => batchFileAction("Stage all", unstagedChanges, stagePaths)],
            ["Unstage all changes", () => batchFileAction("Unstage all", stagedChanges, unstagePaths)],
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
          preferredIntegration={preferredIntegration}
        />
      )}
    </main>
  );
}

function RepoTabStrip({
  tabs,
  activePath,
  loading,
  onOpen,
  onClose,
  onAdd,
  onOpenPalette
}: {
  tabs: string[];
  activePath: string;
  loading: boolean;
  onOpen: (path: string) => void;
  onClose: (path: string) => void;
  onAdd: () => void;
  onOpenPalette: () => void;
}) {
  return (
    <div className="repo-tabbar" aria-label="Open repositories">
      <div className="repo-tabbar-actions">
        <IconButton label="Open repository" onClick={onAdd} disabled={loading}>
          <FolderOpen size={15} />
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
      <div className="repo-tabbar-profile">
        <span>Default Profile</span>
      </div>
    </div>
  );
}

function BranchContextMenu({
  state,
  snapshot,
  onAction,
  onClose
}: {
  state: BranchMenuState;
  snapshot: RepoSnapshot | null;
  onAction: (action: BranchMenuAction, target: BranchMenuTarget) => void;
  onClose: () => void;
}) {
  const { target } = state;
  const items = branchMenuItems(target, snapshot);
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
            disabled={branch.isUnborn || branch.isRemote}
            onClick={() => onSelect(branch)}
          >
            <GitBranch size={14} />
            <span>{branch.name}</span>
            {branch.isCurrent && <small>current</small>}
            {branch.isRemote && <small>remote</small>}
          </button>
        ))}
        {branches.length === 0 && <EmptyState>No branches match</EmptyState>}
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

function Sidebar({
  snapshot,
  branchName,
  remoteName,
  remoteUrl,
  stashMessage,
  setBranchName,
  setRemoteName,
  setRemoteUrl,
  setStashMessage,
  createBranch,
  addRemote,
  stashCurrent,
  deleteBranch,
  applyStash,
  dropStash,
  openBranchMenu,
  startResize
}: {
  snapshot: RepoSnapshot | null;
  branchName: string;
  remoteName: string;
  remoteUrl: string;
  stashMessage: string;
  setBranchName: (value: string) => void;
  setRemoteName: (value: string) => void;
  setRemoteUrl: (value: string) => void;
  setStashMessage: (value: string) => void;
  createBranch: () => void;
  addRemote: () => void;
  stashCurrent: () => void;
  deleteBranch: (name: string) => void;
  applyStash: (stash: string) => void;
  dropStash: (stash: string) => void;
  openBranchMenu: (target: BranchMenuTarget, event: ReactMouseEvent<HTMLElement>) => void;
  startResize: (target: ResizeTarget, event: ReactPointerEvent) => void;
}) {
  return (
    <aside className="sidebar">
      <Panel title="Branches" className="sidebar-branches-panel" actions={<GitBranch size={15} />}>
        <div className="inline-create">
          <input value={branchName} onChange={(event) => setBranchName(event.target.value)} aria-label="New branch name" />
          <IconButton label="Create branch" onClick={createBranch}>
            <Plus size={15} />
          </IconButton>
        </div>
        <div className="nav-list">
          {snapshot ? (
            displayBranches(snapshot).map((branch) => (
              <div key={branch.fullRef} className={clsx("nav-row", branch.isCurrent && "active")}>
                <button
                  onClick={(event) => openBranchMenu(targetFromBranch(branch, "sidebar"), event)}
                  aria-haspopup="menu"
                  disabled={branch.isUnborn}
                >
                  <ChevronRight size={13} />
                  <span>{branch.name}</span>
                  {branch.isUnborn && <small>unborn</small>}
                  {branch.isRemote && <small>remote</small>}
                </button>
                {!branch.isProtected && !branch.isCurrent && !branch.isUnborn && !branch.isRemote && (
                  <IconButton label="Delete branch" onClick={() => deleteBranch(branch.name)}>
                    <Trash2 size={13} />
                  </IconButton>
                )}
              </div>
            ))
          ) : (
            <EmptyState>No branches</EmptyState>
          )}
        </div>
      </Panel>
      <ResizeHandle
        className="sidebar-section-resize"
        label="Resize branches section"
        orientation="horizontal"
        onPointerDown={(event) => startResize("sidebarBranches", event)}
      />

      <Panel title="Remotes" className="sidebar-remotes-panel" actions={<Boxes size={15} />}>
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
            <EmptyState>No remotes</EmptyState>
          )}
        </div>
      </Panel>
      <ResizeHandle
        className="sidebar-section-resize"
        label="Resize remotes section"
        orientation="horizontal"
        onPointerDown={(event) => startResize("sidebarRemotes", event)}
      />

      <Panel title="Stashes" className="sidebar-stashes-panel" actions={<PackageOpen size={15} />}>
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
            <EmptyState>No stashes</EmptyState>
          )}
        </div>
      </Panel>
      <ResizeHandle
        className="sidebar-section-resize"
        label="Resize stashes section"
        orientation="horizontal"
        onPointerDown={(event) => startResize("sidebarStashes", event)}
      />

      <Panel title="Pull Requests" className="sidebar-pull-requests-panel" actions={<GitPullRequest size={15} />}>
        <EmptyState>GitHub adapter pending</EmptyState>
      </Panel>
    </aside>
  );
}

function CommitGraphTable({
  rows,
  selectedSha,
  snapshot,
  commitMessage,
  setCommitMessage,
  columnWidths,
  stagedCount,
  unstagedCount,
  onColumnResizeStart,
  onOpenBranchMenu,
  onOpenCommitMenu,
  onSelect
}: {
  rows: GraphRow[];
  selectedSha?: string;
  snapshot: RepoSnapshot | null;
  commitMessage: string;
  setCommitMessage: (value: string) => void;
  columnWidths: HistoryColumnWidths;
  stagedCount: number;
  unstagedCount: number;
  onColumnResizeStart: (column: HistoryColumnKey, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onOpenBranchMenu: (target: BranchMenuTarget, event: ReactMouseEvent<HTMLElement>) => void;
  onOpenCommitMenu: (commit: Commit, event: ReactMouseEvent<HTMLElement>) => void;
  onSelect: (commit: Commit) => void;
}) {
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

  return (
    <div className="graph-history" style={style}>
      <div className="graph-history-header" role="row">
        {headers.map((header) => (
          <span key={header.key} className="history-column-header">
            <span>{header.label}</span>
            <button
              type="button"
              className="history-column-resize"
              aria-label={`Resize ${header.label} column`}
              onPointerDown={(event) => onColumnResizeStart(header.key, event)}
            />
          </span>
        ))}
      </div>
      <div className="graph-history-body">
        {snapshot && snapshot.changes.length > 0 && (
          <div className="graph-commit-row graph-wip-row" style={{ "--row-color": "var(--warning)" } as CSSProperties} role="row">
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
        {rows.map((row) => (
          <div
            key={row.commit.sha}
            className={clsx("graph-commit-row", selectedSha === row.commit.sha && "selected")}
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
                row.refs.slice(0, 3).map((ref) => (
                  <button
                    key={`${row.commit.sha}-${ref.label}`}
                    className={clsx("ref-chip", ref.kind, refToneClass(ref))}
                    style={{ "--ref-color": ref.color } as CSSProperties}
                    type="button"
                    aria-haspopup="menu"
                    onClick={(event) => onOpenBranchMenu(targetFromRef(ref, row.commit, snapshot), event)}
                  >
                    {ref.label}
                  </button>
                ))
              ) : (
                <span className="ref-placeholder" />
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
        ))}
      </div>
    </div>
  );
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
    return <EmptyState>Loading changed files</EmptyState>;
  }

  if (error) {
    return <div className="inline-error">{error}</div>;
  }

  if (files.length === 0) {
    return <EmptyState>No files changed for this commit</EmptyState>;
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
  secondaryAction
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
}) {
  return (
    <div className="change-column">
      <div className="change-column-header">
        <h3>{title}</h3>
        <Button className={clsx("bulk-action-button", bulkLabel.toLowerCase().startsWith("unstage") ? "unstage-all" : "stage-all")} variant="ghost" onClick={bulkAction} disabled={bulkDisabled}>
          {bulkLabel}
        </Button>
      </div>
      <div className="file-list">
        {changes.map((change) => (
          <div
            key={`${change.path}-${change.indexStatus}-${change.worktreeStatus}`}
            className={clsx("file-row", selected?.path === change.path && "selected")}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(change)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(change);
              }
            }}
          >
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
        ))}
        {changes.length === 0 && <EmptyState>None</EmptyState>}
      </div>
    </div>
  );
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
          <EmptyState>No unresolved files</EmptyState>
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
          <EmptyState>Loading conflict versions</EmptyState>
        ) : selectedConflict && versions ? (
          <div className="conflict-panes">
            <ConflictPane title="Current" text={versions.ours} />
            <ConflictPane title="Incoming" text={versions.theirs} />
            <ConflictPane title="Result" text={versions.working} large />
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

function ConflictPane({ title, text, large = false }: { title: string; text: string; large?: boolean }) {
  return (
    <div className={clsx("conflict-pane", large && "large")}>
      <div className="conflict-pane-title">{title}</div>
      <pre>{text || "(empty)"}</pre>
    </div>
  );
}

function SplitDiffViewer({ path, diff, loading = false }: { path: string; diff: string; loading?: boolean }) {
  const rows = useMemo(() => parseSplitDiff(diff), [diff]);

  return (
    <div className="diff-shell">
      <div className="diff-title">{path}</div>
      {loading ? (
        <EmptyState>Loading diff</EmptyState>
      ) : rows.length > 0 ? (
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
      ) : (
        <EmptyState>No diff available</EmptyState>
      )}
    </div>
  );
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
  preferredIntegration
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
  preferredIntegration: string;
}) {
  const [integration, setIntegration] = useState("OpenAI");
  const [openAiKey, setOpenAiKey] = useState("");
  const [openAiBusy, setOpenAiBusy] = useState(false);
  const [openAiMessage, setOpenAiMessage] = useState<string | null>(null);
  const [azureDevOpsPat, setAzureDevOpsPat] = useState("");
  const [azureDevOpsBusy, setAzureDevOpsBusy] = useState(false);
  const [azureDevOpsMessage, setAzureDevOpsMessage] = useState<string | null>(null);
  const openAiStatusMessage = runningInTauri
    ? `Status: ${openAiConfigured ? "API key configured" : "No API key saved"}. Staged file names, stats, and a capped staged diff are sent only when you request generation.`
    : "Status: Browser preview cannot save secure OpenAI keys. Open the Tauri desktop window to store the key in the operating system keychain.";
  const azureDevOpsStatusMessage = runningInTauri
    ? `Status: ${azureDevOpsConfigured ? "PAT configured" : "No PAT saved"}. The token is injected only into Git child processes for Azure DevOps HTTPS remotes.`
    : "Status: Browser preview cannot save secure Azure DevOps tokens. Open the Tauri desktop window to store the PAT in the operating system keychain.";

  useEffect(() => {
    setIntegration(preferredIntegration);
  }, [preferredIntegration]);
  const sections: Array<{ id: PreferenceSection; label: string; icon: typeof Settings }> = [
    { id: "general", label: "General", icon: Settings },
    { id: "repositories", label: "Repositories", icon: FolderOpen },
    { id: "profiles", label: "Profiles", icon: UsersRound },
    { id: "ssh", label: "SSH", icon: ShieldCheck },
    { id: "integrations", label: "Integrations", icon: Plug },
    { id: "externalTools", label: "External Tools", icon: Wrench },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "commit", label: "Commit", icon: GitCommitHorizontal },
    { id: "editor", label: "Editor", icon: FileText },
    { id: "terminal", label: "In-App Terminal", icon: Terminal },
    { id: "experimental", label: "Experimental", icon: FlaskConical }
  ];

  return (
    <div className="preferences-backdrop" role="dialog" aria-modal="true" aria-label="Preferences">
      <aside className="preferences-nav">
        <button className="preferences-exit" onClick={close}>
          <ArrowUpFromLine size={18} />
          Exit Preferences
        </button>

        <div className="profile-block">
          <span>Current profile</span>
          <div className="profile-card">
            <strong>LD</strong>
            <span>Default Profile</span>
          </div>
        </div>

        <div className="preferences-nav-group">
          <span>Preferences</span>
          {sections.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={clsx("preference-nav-item", section === item.id && "active")}
                onClick={() => setSection(item.id)}
              >
                <Icon size={17} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="preferences-nav-group repo-specific">
          <span>Repo-Specific Preferences</span>
          <button className="preference-nav-item" onClick={() => setSection("repositories")}>
            <FolderOpen size={16} />
            <span>{snapshot ? `Repo: ${snapshot.repository.name}` : "No repo open"}</span>
          </button>
        </div>
      </aside>

      <section className="preferences-content">
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

        {section === "repositories" && (
          <PreferenceSection title="Repositories">
            <SettingRow label="Open Repository" description="Use the native folder picker instead of typing a path.">
              <Button variant="primary" onClick={() => void browseForRepository()}>
                Browse with Finder
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
                <EmptyState>No recent repositories yet</EmptyState>
              )}
            </div>
          </PreferenceSection>
        )}

        {section === "integrations" && (
          <PreferenceSection title="Integrations">
            <div className="integration-layout">
              <div className="integration-list">
                {[
                  { label: "OpenAI", icon: Sparkles },
                  { label: "GitHub", icon: Github },
                  { label: "GitHub Enterprise Server", icon: Github },
                  { label: "GitLab", icon: GitFork },
                  { label: "Bitbucket", icon: Boxes },
                  { label: "Azure DevOps", icon: Link2 },
                  { label: "Jira Cloud", icon: ClipboardList },
                  { label: "Trello", icon: ClipboardList }
                ].map(({ label, icon: Icon }) => (
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
                  </SettingRow>
                  <div className="settings-note">{azureDevOpsStatusMessage}</div>
                  <div className="settings-note">
                    OpenGit does not rewrite remote URLs. For Azure HTTPS remotes, the backend adds a scoped Git HTTP extra header for the Azure host only, so the PAT is not printed in URLs or command arguments.
                  </div>
                  {azureDevOpsMessage && <div className="settings-note">{azureDevOpsMessage}</div>}
                </div>
              ) : (
                <div className="integration-detail">
                  <h3>{integration}</h3>
                  <p>Provider account support is planned after the local Git workflow stabilizes.</p>
                  <Button variant="secondary" disabled>
                    Connect {integration}
                  </Button>
                  <div className="settings-note">
                    Future scope: OAuth, PR list, PR creation, checks, reviewers, labels, and branch protection awareness.
                  </div>
                </div>
              )}
            </div>
          </PreferenceSection>
        )}

        {section !== "general" && section !== "repositories" && section !== "integrations" && (
          <PreferenceSection title={titleForPreferenceSection(section)}>
            <div className="settings-placeholder">
              <span>This section is reserved for the next implementation pass.</span>
              <p>Keeping the structure in place now prevents repo, SSH, provider, editor, and terminal settings from becoming scattered across the main workspace.</p>
            </div>
          </PreferenceSection>
        )}
      </section>
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
  if (tone === "integrate") return "#6bbf7a";
  if (tone === "origin-master") return "#5ba0d0";
  if (tone === "bug") return "#e07070";
  if (kind === "tag") return "#e0b060";
  if (kind === "head") return "#7c68ee";
  return colorForId(label);
}

function refTone(label: string) {
  const normalized = label.toLowerCase();
  if (normalized === "integrate" || normalized.endsWith("/integrate")) return "integrate";
  if (normalized === "origin/master" || normalized === "origin/main" || normalized === "master" || normalized === "main" || normalized.endsWith("/master") || normalized.endsWith("/main")) {
    return "origin-master";
  }
  if (normalized.includes("bug") || normalized.includes("fix")) return "bug";
  return "feature";
}

function refToneClass(ref: RefChip) {
  if (ref.kind === "tag") return "tag-tone";
  return `${refTone(ref.label)}-tone`;
}

function renderCommitMessage(message: string): ReactNode {
  const match = message.match(/^(chore|fix|feat|merge)(\([^)]+\))?(!)?:?\s*(.*)$/i);
  if (!match) return <span className="commit-body">{message}</span>;

  const [, type, scope, bang, body] = match;
  return (
    <>
      <span className="commit-type">{type}</span>
      {scope && <span className="commit-scope">{scope}</span>}
      {bang && <span className="commit-type">{bang}</span>}
      {body && (
        <>
          <span className="commit-separator"> </span>
          <span className="commit-body">{body}</span>
        </>
      )}
    </>
  );
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

function branchMenuItems(target: BranchMenuTarget, snapshot: RepoSnapshot | null): BranchMenuItem[] {
  const currentBranch = snapshot?.currentBranch ?? "current branch";
  const hasRemote = (snapshot?.remotes.length ?? 0) > 0;
  const localBranch = !target.isRemote && !target.isTag && !target.isUnborn && !target.isCommitOnly;
  const branchRef = target.isCommitOnly ? "commit" : target.isTag ? "tag" : target.isRemote ? "remote branch" : "branch";
  const canCheckout = target.isTag || (localBranch && !target.isCurrent);
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
      label: target.isTag ? "Checkout tag" : "Checkout",
      disabled: !canCheckout,
      hint: target.isCommitOnly ? "not a branch" : target.isRemote ? "create local branch here" : target.isCurrent ? "already checked out" : undefined
    },
    { type: "item", action: "create-worktree", label: `Create worktree from ${target.name}`, disabled: true, hint: "post-MVP" },
    { type: "separator", key: "commit" },
    { type: "item", action: "create-branch", label: "Create branch here", disabled: target.isUnborn },
    { type: "item", action: "cherry-pick", label: "Cherry pick commit", disabled: !target.commitSha },
    { type: "item", action: "reset", label: `Reset ${currentBranch} to this commit`, disabled: true, hint: "destructive action pending" },
    { type: "item", action: "revert", label: "Revert commit", disabled: !target.commitSha },
    { type: "separator", key: "provider" },
    { type: "item", action: "open-pr", label: `Start a pull request from ${target.name}`, disabled: true, hint: "GitHub adapter pending" },
    { type: "item", action: "explain", label: "Explain Branch Changes (Preview)", disabled: true, hint: "AI adapter pending" },
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
    {
      type: "item",
      action: "delete-remote",
      label: target.isRemote ? `Delete ${target.name}` : `Delete remote for ${target.name}`,
      danger: true,
      disabled: true,
      hint: "remote delete pending"
    },
    { type: "separator", key: "copy" },
    { type: "item", action: "copy-name", label: target.isTag ? "Copy tag name" : "Copy branch name" },
    { type: "item", action: "copy-sha", label: "Copy commit sha", disabled: !target.commitSha },
    { type: "item", action: "copy-branch-link", label: `Copy link to ${target.isTag ? "tag" : "branch"}`, disabled: true, hint: "provider URL pending" },
    { type: "item", action: "copy-commit-link", label: "Copy link to this commit on remote", disabled: true, hint: "provider URL pending" },
    { type: "separator", key: "patch" },
    { type: "item", action: "create-patch", label: "Create patch from commit", disabled: true, hint: "post-MVP" },
    { type: "item", action: "share-patch", label: "Share commit as Cloud Patch", disabled: true, hint: "post-MVP" },
    { type: "separator", key: "view" },
    { type: "item", action: "pin-left", label: "Pin to Left", disabled: true, hint: "post-MVP" },
    { type: "item", action: "solo", label: "Solo", disabled: true, hint: "post-MVP" },
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

function findBranchByName(snapshot: RepoSnapshot, name: string) {
  return snapshot.branches.find((branch) => branch.name === name || branch.fullRef === name || normalizeRefLabel(branch.fullRef) === name);
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
