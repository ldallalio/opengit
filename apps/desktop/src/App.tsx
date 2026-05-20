import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from "react";
import type { Commit, CommitFile, FileChange, FileStatus, RepoSnapshot } from "@opengit/core";
import { Button, EmptyState, IconButton, Panel } from "@opengit/ui";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Bell,
  Boxes,
  Check,
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
  Moon,
  PackageOpen,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Shuffle,
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
  chooseRepositoryFolder,
  checkoutBranch,
  commit,
  createBranch,
  deleteBranch,
  discardPaths,
  fetchRepo,
  getCommitFileDiff,
  getCommitFiles,
  getDiff,
  isTauriRuntime,
  openRepo,
  pullRepo,
  pushRepo,
  refreshRepo,
  stagePaths,
  stashApply,
  stashDrop,
  stashPush,
  unstagePaths
} from "./api";
import { demoSnapshot } from "./demo";

type Theme = "dark" | "light";
type DiffMode = "commit" | "working";
type RefKind = "head" | "local" | "remote" | "tag" | "other";
type RefChip = { label: string; kind: RefKind; color: string };
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
const graphColors = ["#34d399", "#a855f7", "#38bdf8", "#f97316", "#ef4444", "#facc15", "#22c55e", "#ec4899", "#818cf8", "#14b8a6"];
const graphLaneWidth = 18;
const graphRowHeight = 42;
const maxVisibleGraphLanes = 12;
const historyLimitOptions = [100, 250, 500, 1000, 2000] as const;

function loadRecentRepos() {
  try {
    const parsed = JSON.parse(localStorage.getItem("opengit:recentRepos") ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function loadHistoryLimit() {
  const parsed = Number(localStorage.getItem("opengit:historyLimit"));
  return historyLimitOptions.includes(parsed as (typeof historyLimitOptions)[number]) ? parsed : 250;
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
  const [commitFiles, setCommitFiles] = useState<CommitFile[]>([]);
  const [commitFileError, setCommitFileError] = useState<string | null>(null);
  const [diff, setDiff] = useState("");
  const [commitDiff, setCommitDiff] = useState("");
  const [diffMode, setDiffMode] = useState<DiffMode>("commit");
  const [commitFilesLoading, setCommitFilesLoading] = useState(false);
  const [commitDiffLoading, setCommitDiffLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
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
  const [recentRepos, setRecentRepos] = useState<string[]>(loadRecentRepos);
  const [operationLog, setOperationLog] = useState<string[]>([
    runningInTauri ? "OpenGit ready" : "Browser preview uses demo data"
  ]);

  const stagedChanges = useMemo(() => snapshot?.changes.filter((change) => change.staged) ?? [], [snapshot]);
  const unstagedChanges = useMemo(() => snapshot?.changes.filter((change) => change.unstaged) ?? [], [snapshot]);
  const activeDiffPath = diffMode === "commit" ? selectedCommitFile?.path : selectedFile?.path;
  const activeDiff = diffMode === "commit" ? commitDiff : diff;
  const activeDiffLoading = diffMode === "commit" && commitDiffLoading;
  const graphRows = useMemo(() => buildGraphRows(snapshot?.commits ?? []), [snapshot]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("opengit:theme", theme);
  }, [theme]);

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

  const setSnapshotState = (next: RepoSnapshot) => {
    setSnapshot(next);
    setRepoPath(next.repository.path);
    localStorage.setItem("opengit:lastPath", next.repository.path);
    rememberRepo(next.repository.path);
    setSelectedCommit(next.commits[0] ?? null);
    setSelectedFile(next.changes[0] ?? null);
    setDiffMode(next.commits.length > 0 ? "commit" : "working");
  };

  const runSnapshotOperation = async (label: string, operation: () => Promise<RepoSnapshot>) => {
    setLoading(true);
    setError(null);
    try {
      const next = await operation();
      setSnapshotState(next);
      setOperationLog((log) => [`${label} complete`, ...log].slice(0, 8));
    } catch (operationError) {
      const message = operationError instanceof Error ? operationError.message : String(operationError);
      setError(message);
      setOperationLog((log) => [`${label} failed: ${message}`, ...log].slice(0, 8));
    } finally {
      setLoading(false);
    }
  };

  const openRepositoryPath = (path: string, limit = historyLimit) =>
    runSnapshotOperation("Open repository", () => openRepo(path, limit));

  const openCurrentPath = () => openRepositoryPath(repoPath);

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
        <header className="topbar">
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

        <div className="content-grid">
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
            checkout={(name) => {
              const repo = requireRepo();
              if (repo) void runSnapshotOperation("Checkout branch", () => checkoutBranch(repo, name));
            }}
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
          />

          <Panel
            title="History"
            className="history-panel"
            actions={
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
            }
          >
            {snapshot && snapshot.commits.length > 0 ? (
              <CommitGraphTable
                rows={graphRows}
                selectedSha={selectedCommit?.sha}
                onSelect={(commitItem) => {
                  setSelectedCommit(commitItem);
                  setDiffMode("commit");
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

          <aside className="detail-stack">
            <Panel title="Selection" actions={<GitCommitHorizontal size={15} />}>
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

            <Panel title={`Changed Files (${commitFiles.length})`} actions={<FileText size={15} />}>
              <CommitFileList
                files={commitFiles}
                selected={selectedCommitFile}
                loading={commitFilesLoading}
                error={commitFileError}
                onSelect={(file) => {
                  setSelectedCommitFile(file);
                  setDiffMode("commit");
                }}
              />
            </Panel>

            <Panel title="Diff" actions={<Code2 size={15} />}>
              {activeDiffPath ? (
                <SplitDiffViewer path={activeDiffPath} diff={activeDiff} loading={activeDiffLoading} />
              ) : (
                <EmptyState>No file selected</EmptyState>
              )}
            </Panel>
          </aside>

          <section className="bottom-area">
            <Panel title={`Changes (${snapshot?.changes.length ?? 0})`} actions={<ClipboardList size={15} />}>
              {snapshot ? (
                <div className="changes-grid">
                  <ChangeColumn
                    title={`Unstaged (${unstagedChanges.length})`}
                    changes={unstagedChanges}
                    selected={selectedFile}
                    onSelect={(change) => {
                      setSelectedFile(change);
                      setDiffMode("working");
                    }}
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
                    onSelect={(change) => {
                      setSelectedFile(change);
                      setDiffMode("working");
                    }}
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

            <Panel title="Commit" actions={<SquarePen size={15} />}>
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
                <Button variant="primary" disabled={!snapshot || loading || !commitMessage.trim()} onClick={commitChanges}>
                  Commit
                </Button>
              </div>
            </Panel>

            <Panel title="Operations">
              <div className="operation-log">
                {operationLog.map((entry, index) => (
                  <span key={`${entry}-${index}`}>{entry}</span>
                ))}
              </div>
            </Panel>
          </section>
        </div>
      </section>

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
        />
      )}
    </main>
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
  checkout,
  deleteBranch,
  applyStash,
  dropStash
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
  checkout: (name: string) => void;
  deleteBranch: (name: string) => void;
  applyStash: (stash: string) => void;
  dropStash: (stash: string) => void;
}) {
  return (
    <aside className="sidebar">
      <Panel title="Branches" actions={<GitBranch size={15} />}>
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
                <button onClick={() => checkout(branch.name)} disabled={branch.isUnborn || branch.isRemote}>
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

      <Panel title="Remotes" actions={<Boxes size={15} />}>
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

      <Panel title="Stashes" actions={<PackageOpen size={15} />}>
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

      <Panel title="Pull Requests" actions={<GitPullRequest size={15} />}>
        <EmptyState>GitHub adapter pending</EmptyState>
      </Panel>
    </aside>
  );
}

function CommitGraphTable({
  rows,
  selectedSha,
  onSelect
}: {
  rows: GraphRow[];
  selectedSha?: string;
  onSelect: (commit: Commit) => void;
}) {
  const visibleLaneCount = Math.min(maxVisibleGraphLanes, Math.max(4, Math.max(...rows.map((row) => row.maxLane), 1)));
  const graphWidth = visibleLaneCount * graphLaneWidth + 24;
  const style = { "--graph-width": `${graphWidth}px` } as CSSProperties;

  return (
    <div className="graph-history" style={style}>
      <div className="graph-history-header" role="row">
        <span>Branch / Tag</span>
        <span>Graph</span>
        <span>Commit Message</span>
        <span>Author</span>
        <span>Date / Time</span>
        <span>Hash</span>
      </div>
      <div className="graph-history-body">
        {rows.map((row) => (
          <button
            key={row.commit.sha}
            className={clsx("graph-commit-row", selectedSha === row.commit.sha && "selected")}
            style={{ "--row-color": row.color } as CSSProperties}
            onClick={() => onSelect(row.commit)}
          >
            <span className="branch-tag-cell">
              {row.refs.length > 0 ? (
                row.refs.slice(0, 3).map((ref) => (
                  <span key={`${row.commit.sha}-${ref.label}`} className={clsx("ref-chip", ref.kind)} style={{ "--ref-color": ref.color } as CSSProperties}>
                    {ref.label}
                  </span>
                ))
              ) : (
                <span className="ref-placeholder" />
              )}
            </span>
            <CommitGraphSvg row={row} width={graphWidth} laneCount={visibleLaneCount} />
            <span className="graph-message-cell">
              <strong>{row.commit.message || "(no subject)"}</strong>
              {row.commit.parents.length > 1 && <small>{row.commit.parents.length} parents</small>}
            </span>
            <span className="graph-author-cell">{row.commit.author}</span>
            <span className="graph-date-cell">{formatDateTime(row.commit.date)}</span>
            <span className="graph-hash-cell">{shortSha(row.commit.sha)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function CommitGraphSvg({ row, width, laneCount }: { row: GraphRow; width: number; laneCount: number }) {
  const laneX = (lane: number) => 12 + lane * graphLaneWidth;
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
            y2="21"
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
            y1="21"
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
          const midY = graphRowHeight - 10;
          const path =
            from === to
              ? `M ${fromX} 21 L ${toX} ${graphRowHeight}`
              : `M ${fromX} 21 C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${graphRowHeight}`;
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
        <circle cx={laneX(visibleLane(row.lane))} cy="21" r="4.8" fill={row.color} stroke="var(--panel)" strokeWidth="2" />
        <circle cx={laneX(visibleLane(row.lane))} cy="21" r="7.5" fill="none" stroke={row.color} strokeWidth="1" opacity="0.35" />
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
        <Button variant="ghost" onClick={bulkAction} disabled={bulkDisabled}>
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
  runningInTauri
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
}) {
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
                  { label: "GitHub", icon: Github },
                  { label: "GitHub Enterprise Server", icon: Github },
                  { label: "GitLab", icon: GitFork },
                  { label: "Bitbucket", icon: Boxes },
                  { label: "Azure DevOps", icon: Link2 },
                  { label: "Jira Cloud", icon: ClipboardList },
                  { label: "Trello", icon: ClipboardList }
                ].map(({ label, icon: Icon }) => (
                  <button key={label} className={clsx(label === "GitHub" && "active")}>
                    <Icon size={16} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
              <div className="integration-detail">
                <h3>GitHub</h3>
                <p>Provider account support is planned after the local Git workflow stabilizes.</p>
                <Button variant="secondary" disabled>
                  Connect GitHub
                </Button>
                <div className="settings-note">
                  Future scope: OAuth, PR list, PR creation, checks, reviewers, labels, and branch protection awareness.
                </div>
              </div>
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
  if (kind === "head") return "#34d399";
  if (kind === "tag") return "#facc15";
  return colorForId(label);
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

function displayBranches(snapshot: RepoSnapshot) {
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
