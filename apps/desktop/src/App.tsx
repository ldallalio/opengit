import { useEffect, useMemo, useState } from "react";
import type { Commit, FileChange, RepoSnapshot } from "@opengit/core";
import { Button, EmptyState, IconButton, Panel } from "@opengit/ui";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  Check,
  ChevronRight,
  CircleDot,
  ClipboardList,
  Code2,
  GitBranch,
  GitCommitHorizontal,
  GitFork,
  GitPullRequest,
  History,
  Moon,
  PackageOpen,
  Plus,
  RefreshCw,
  Search,
  Shuffle,
  SquarePen,
  Sun,
  Trash2,
  UploadCloud,
  X
} from "lucide-react";
import { clsx } from "clsx";
import {
  checkoutBranch,
  commit,
  createBranch,
  deleteBranch,
  discardPaths,
  fetchRepo,
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

const defaultPath = localStorage.getItem("opengit:lastPath") ?? "/Users/logandallalio/Documents/OpenGit";

export default function App() {
  const runningInTauri = isTauriRuntime();
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("opengit:theme") as Theme) || "dark");
  const [repoPath, setRepoPath] = useState(defaultPath);
  const [snapshot, setSnapshot] = useState<RepoSnapshot | null>(() => (runningInTauri ? null : demoSnapshot));
  const [selectedCommit, setSelectedCommit] = useState<Commit | null>(snapshot?.commits[0] ?? null);
  const [selectedFile, setSelectedFile] = useState<FileChange | null>(snapshot?.changes[0] ?? null);
  const [diff, setDiff] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [branchName, setBranchName] = useState("");
  const [stashMessage, setStashMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [loading, setLoading] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operationLog, setOperationLog] = useState<string[]>([
    runningInTauri ? "OpenGit ready" : "Browser preview uses demo data"
  ]);

  const stagedChanges = useMemo(() => snapshot?.changes.filter((change) => change.staged) ?? [], [snapshot]);
  const unstagedChanges = useMemo(() => snapshot?.changes.filter((change) => change.unstaged) ?? [], [snapshot]);

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

  const setSnapshotState = (next: RepoSnapshot) => {
    setSnapshot(next);
    setRepoPath(next.repository.path);
    localStorage.setItem("opengit:lastPath", next.repository.path);
    setSelectedCommit(next.commits[0] ?? null);
    setSelectedFile(next.changes[0] ?? null);
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

  const open = () => runSnapshotOperation("Open repository", () => openRepo(repoPath));

  const refresh = () => {
    if (!snapshot) return open();
    return runSnapshotOperation("Refresh", () => refreshRepo(snapshot.repository.path));
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
        <IconButton label="Push" onClick={() => snapshot && runSnapshotOperation("Push", () => pushRepo(snapshot.repository.path))}>
          <UploadCloud size={18} />
        </IconButton>
        <div className="rail-spacer" />
        <IconButton label="Toggle theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </IconButton>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="repo-open">
            <PackageOpen size={18} />
            <input value={repoPath} onChange={(event) => setRepoPath(event.target.value)} aria-label="Repository path" />
            <Button variant="primary" onClick={open} disabled={loading}>
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
            setStashMessage={setStashMessage}
            createBranch={branchCreate}
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

          <Panel title="History" className="history-panel" actions={<History size={15} />}>
            {snapshot && snapshot.commits.length > 0 ? (
              <div className="commit-list">
                {snapshot.commits.map((item) => (
                  <button
                    key={item.sha}
                    className={clsx("commit-row", selectedCommit?.sha === item.sha && "selected")}
                    onClick={() => setSelectedCommit(item)}
                  >
                    <span className="graph-lane">
                      <CircleDot size={13} />
                    </span>
                    <span className="commit-main">
                      <span className="commit-message">{item.message || "(no subject)"}</span>
                      <span className="commit-meta">
                        {shortSha(item.sha)} · {item.author} · {formatDate(item.date)}
                      </span>
                    </span>
                    <span className="ref-list">
                      {item.refs.slice(0, 2).map((ref) => (
                        <span key={ref} className="ref-badge">
                          {ref}
                        </span>
                      ))}
                    </span>
                  </button>
                ))}
              </div>
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

            <Panel title="Diff" actions={<Code2 size={15} />}>
              {selectedFile ? (
                <div className="diff-shell">
                  <div className="diff-title">{selectedFile.path}</div>
                  <pre>{diff || "No diff available"}</pre>
                </div>
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
                    onSelect={setSelectedFile}
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
                    onSelect={setSelectedFile}
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
            ["Open repository", open],
            ["Refresh", refresh],
            ["Stage all changes", () => batchFileAction("Stage all", unstagedChanges, stagePaths)],
            ["Unstage all changes", () => batchFileAction("Unstage all", stagedChanges, unstagePaths)],
            ["Fetch", () => snapshot && runSnapshotOperation("Fetch", () => fetchRepo(snapshot.repository.path))],
            ["Pull", () => snapshot && runSnapshotOperation("Pull", () => pullRepo(snapshot.repository.path))],
            ["Push", () => snapshot && runSnapshotOperation("Push", () => pushRepo(snapshot.repository.path))],
            ["Toggle theme", () => setTheme(theme === "dark" ? "light" : "dark")]
          ]}
        />
      )}
    </main>
  );
}

function Sidebar({
  snapshot,
  branchName,
  stashMessage,
  setBranchName,
  setStashMessage,
  createBranch,
  stashCurrent,
  checkout,
  deleteBranch,
  applyStash,
  dropStash
}: {
  snapshot: RepoSnapshot | null;
  branchName: string;
  stashMessage: string;
  setBranchName: (value: string) => void;
  setStashMessage: (value: string) => void;
  createBranch: () => void;
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
                <button onClick={() => checkout(branch.name)} disabled={branch.isUnborn}>
                  <ChevronRight size={13} />
                  <span>{branch.name}</span>
                  {branch.isUnborn && <small>unborn</small>}
                </button>
                {!branch.isProtected && !branch.isCurrent && !branch.isUnborn && (
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

function statusLabel(change: FileChange) {
  if (change.status === "untracked") return "U";
  if (change.status === "renamed") return "R";
  if (change.status === "deleted") return "D";
  if (change.status === "added") return "A";
  if (change.status === "conflicted") return "!";
  return "M";
}

function displayBranches(snapshot: RepoSnapshot) {
  if (snapshot.branches.length > 0) {
    return snapshot.branches.map((branch) => ({ ...branch, isUnborn: false }));
  }

  const name = snapshot.currentBranch && snapshot.currentBranch !== "(detached)" ? snapshot.currentBranch : "main";
  return [
    {
      name,
      fullRef: `refs/heads/${name}`,
      isCurrent: true,
      isProtected: name === "main" || name === "master",
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
