import { RequestGeneration } from "./worktreeState";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RepoSnapshot, Worktree } from "@opengit/core";
import {
  chooseRepositoryFolder,
  createWorktree,
  validateWorktree,
  listWorktrees,
  manageWorktree,
  previewWorktreePrune,
  previewWorktreeRemoval,
  pruneWorktrees,
  removeWorktree,
  worktreeStatus,
  type WorktreeRemoval,
  type WorktreeStatus,
} from "./api";

const label = (row: Worktree) =>
  row.branch ||
  (row.head
    ? `Detached ${row.head.slice(0, 8)}`
    : row.bare
      ? "Bare repository"
      : "Unborn branch");
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export function Worktrees({
  snapshot,
  open,
  reconcile,
}: {
  snapshot: RepoSnapshot;
  open: (path: string) => Promise<boolean>;
  reconcile: (oldPath: string, newPath?: string) => void;
}) {
  const repo = snapshot.repository.path;
  const [rows, setRows] = useState(snapshot.worktrees);
  const [states, setStates] = useState<Record<string, WorktreeStatus | string>>(
    {},
  );
  const [expanded, setExpanded] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(new RequestGeneration());
  const [form, setForm] = useState<
    "create" | "move" | "lock" | "remove" | "prune" | null
  >(null);
  const [target, setTarget] = useState<Worktree | null>(null);
  const [mode, setMode] = useState("new");
  const [branch, setBranch] = useState("");
  const [base, setBase] = useState("HEAD");
  const [parent, setParent] = useState(repo.replace(/[\\/][^\\/]+$/, ""));
  const [folder, setFolder] = useState("");
  const [folderEdited, setFolderEdited] = useState(false);
  const [reason, setReason] = useState("");
  const [openCreated, setOpenCreated] = useState(true);
  const [removal, setRemoval] = useState<WorktreeRemoval | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [prunePreview, setPrunePreview] = useState("");
  const separator = parent.includes("\\") ? "\\" : "/";
  const destination = `${parent.replace(/[\\/]$/, "")}${separator}${folder}`;
  const [validatedKey, setValidatedKey] = useState("");
  const [validationError, setValidationError] = useState("");
  const creationRequest = {
    path: destination,
    mode,
    branch,
    startPoint: mode === "existing" ? branch : base,
  };
  const validationKey = JSON.stringify([repo, creationRequest]);
  const localCreationValid =
    !!folder.trim() &&
    !/[\\/]/.test(folder) &&
    folder !== "." &&
    folder !== ".." &&
    !!parent.trim() &&
    !!base.trim() &&
    (mode === "detached" || !!branch.trim()) &&
    (mode !== "existing" || !rows.some((row) => row.branch === branch));
  useEffect(() => {
    if (form !== "create" || !localCreationValid) return;
    let disposed = false;
    setValidationError("");
    const timer = window.setTimeout(() => {
      void validateWorktree(repo, creationRequest)
        .then(() => {
          if (!disposed) setValidatedKey(validationKey);
        })
        .catch((e) => {
          if (!disposed) setValidationError(message(e));
        });
    }, 300);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [form, validationKey, localCreationValid]);
  const refresh = useCallback(async () => {
    const ticket = generation.current.begin();
    try {
      const next = await listWorktrees(repo);
      if (!generation.current.isCurrent(ticket)) return;
      setRows(next);
      setError("");
      if (!expanded && !dialog.current?.open) return;
      let index = 0;
      const worker = async () => {
        while (index < next.length) {
          const row = next[index++];
          if (
            row.bare ||
            (row.availability && row.availability !== "available")
          )
            continue;
          let state: WorktreeStatus | string;
          try {
            state = await worktreeStatus(repo, row.path);
          } catch (e) {
            state = message(e);
          }
          if (!generation.current.isCurrent(ticket)) return;
          setStates((current) => ({ ...current, [row.path]: state }));
        }
      };
      await Promise.all([worker(), worker()]);
    } catch (e) {
      if (generation.current.isCurrent(ticket))
        setError(`Worktree list may be stale: ${message(e)}`);
    }
  }, [repo, expanded]);
  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void refresh();
    }, 15000);
    const focus = () => {
      void refresh();
    };
    window.addEventListener("focus", focus);
    return () => {
      generation.current.invalidate();
      window.clearInterval(interval);
      window.removeEventListener("focus", focus);
    };
  }, [refresh]);
  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent<{ base?: string }>).detail;
      dialog.current?.showModal();
      if (detail?.base) {
        setBase(detail.base);
        setMode("new");
        setBranch("");
        setFolder("");
        setFolderEdited(false);
        setTarget(null);
        setNotice("");
        setError("");
        setForm("create");
      }
      void refresh();
    };
    window.addEventListener("opengit:worktrees", show);
    return () => window.removeEventListener("opengit:worktrees", show);
  }, [refresh]);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
      setForm(null);
      setNotice("Worktree action completed.");
      window.dispatchEvent(new Event("focus"));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const chooseParent = async () => {
    try {
      const path = await chooseRepositoryFolder();
      if (path) setParent(path);
    } catch (e) {
      setError(message(e));
    }
  };
  const prepare = (kind: "create" | "move" | "lock", row?: Worktree) => {
    setTarget(row ?? null);
    setForm(kind);
    setError("");
    setNotice("");
    setFolder("");
    setFolderEdited(false);
    setReason("");
    setBase("HEAD");
    setParent((row?.path ?? repo).replace(/[\\/][^\\/]+$/, ""));
  };
  const statusLabel = (row: Worktree) => {
    const state = states[row.path];
    if (row.bare) return "Bare";
    if (row.availability && row.availability !== "available")
      return row.availability;
    if (!state) return "Checking…";
    if (typeof state === "string") return `Status unavailable: ${state}`;
    return `${state.staged} staged · ${state.unstaged} unstaged · ${state.untracked} untracked${state.conflicts ? ` · ${state.conflicts} conflicts` : ""}${state.operation ? " · operation in progress" : ""}`;
  };
  const displayed = rows.filter((row) => {
    if (
      !`${row.path} ${row.branch ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase())
    )
      return false;
    const status = states[row.path];
    return (
      filter === "all" ||
      (filter === "locked" && row.locked) ||
      (filter === "unavailable" && row.availability !== "available") ||
      (filter === "changed" &&
        status &&
        typeof status !== "string" &&
        status.staged + status.unstaged + status.untracked > 0)
    );
  });
  const occupied = rows.find((row) => row.branch === branch);
  return (
    <section className="worktree-section" aria-label="Worktrees">
      <div className="worktree-heading">
        <button onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
          {expanded ? "▾" : "▸"} Worktrees ({rows.length})
        </button>
        <button
          onClick={() => {
            dialog.current?.showModal();
            void refresh();
          }}
        >
          Manage
        </button>
      </div>
      {expanded && (
        <div className="worktree-sidebar-list">
          {rows.map((row) => (
            <button
              key={row.path}
              disabled={
                row.bare ||
                (!!row.availability && row.availability !== "available")
              }
              title={`${row.path}\n${statusLabel(row)}`}
              className={row.path === repo ? "active" : ""}
              onClick={() => void open(row.path)}
            >
              <strong>{label(row)}</strong>
              <small>
                {row.isMain ? "Main · " : ""}
                {row.path === repo ? "Current · " : ""}
                {row.locked ? "Locked · " : ""}
                {row.path.split(/[\\/]/).pop()}
              </small>
            </button>
          ))}
        </div>
      )}
      {error && !dialog.current?.open && (
        <p role="alert">
          {error} <button onClick={() => void refresh()}>Retry</button>
        </p>
      )}
      <dialog
        ref={dialog}
        className="worktree-dialog"
        aria-labelledby="worktree-manager-title"
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <header>
          <div>
            <h2 id="worktree-manager-title">Worktrees</h2>
            <p>All checkouts registered with this local repository.</p>
          </div>
          <button
            disabled={busy}
            onClick={() => dialog.current?.close()}
            aria-label="Close worktree manager"
          >
            Close
          </button>
        </header>
        {error && (
          <div role="alert" className="worktree-error">
            {error}{" "}
            <button onClick={() => void refresh()}>Retry refresh</button>
          </div>
        )}
        {notice && <p role="status">{notice}</p>}
        {!form && (
          <>
            <div className="worktree-toolbar">
              <input
                aria-label="Search worktrees"
                placeholder="Search branch or path"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                aria-label="Filter worktrees"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">All worktrees</option>
                <option value="changed">Changed</option>
                <option value="locked">Locked</option>
                <option value="unavailable">Unavailable</option>
              </select>
              <button disabled={busy} onClick={() => prepare("create")}>
                Create worktree
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setError("");
                  void previewWorktreePrune(repo)
                    .then((value) => {
                      setPrunePreview(value);
                      setForm("prune");
                    })
                    .catch((e) => setError(message(e)))
                    .finally(() => setBusy(false));
                }}
              >
                Clean stale registrations
              </button>
              <button disabled={busy} onClick={() => void refresh()}>
                Refresh
              </button>
            </div>
            <div className="worktree-cards">
              {displayed.length === 0 && (
                <p>No worktrees match these filters.</p>
              )}
              {displayed.map((row) => (
                <article key={row.path}>
                  <div>
                    <h3>
                      {label(row)} {row.isMain && <small>Main</small>}{" "}
                      {row.path === repo && <small>Current</small>}
                    </h3>
                    <code>{row.path}</code>
                    <p>{statusLabel(row)}</p>
                    {row.locked && (
                      <p>Locked: {row.lockReason || "No reason provided"}</p>
                    )}
                    {row.prunable && (
                      <p>Stale registration: {row.pruneReason}</p>
                    )}
                  </div>
                  <div className="worktree-actions">
                    <button
                      disabled={
                        busy ||
                        row.bare ||
                        (!!row.availability && row.availability !== "available")
                      }
                      onClick={() => {
                        dialog.current?.close();
                        void open(row.path);
                      }}
                    >
                      Open
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(row.path)
                          .catch((e) => setError(message(e)))
                      }
                    >
                      Copy path
                    </button>
                    <button
                      disabled={busy || row.availability === "missing"}
                      onClick={() =>
                        void run(() => manageWorktree(repo, row.path, "reveal"))
                      }
                    >
                      Reveal
                    </button>
                    <button
                      disabled={
                        busy || row.bare || row.availability === "missing"
                      }
                      onClick={() =>
                        void run(() => manageWorktree(repo, row.path, "editor"))
                      }
                    >
                      Open in editor
                    </button>
                    {!row.isMain && !row.bare && (
                      <>
                        <button
                          disabled={busy}
                          onClick={() =>
                            row.locked
                              ? void run(() =>
                                  manageWorktree(repo, row.path, "unlock"),
                                )
                              : prepare("lock", row)
                          }
                        >
                          {row.locked ? "Unlock" : "Lock"}
                        </button>
                        <button
                          disabled={
                            busy ||
                            row.locked ||
                            row.availability !== "available"
                          }
                          onClick={() => prepare("move", row)}
                        >
                          Move
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const path = await chooseRepositoryFolder();
                              if (!path) return;
                              await manageWorktree(
                                repo,
                                row.path,
                                "repair",
                                path,
                              );
                              reconcile(row.path, path);
                            })
                          }
                        >
                          Locate / repair
                        </button>
                        <button
                          disabled={busy || row.locked}
                          onClick={() => {
                            setBusy(true);
                            setError("");
                            setTarget(row);
                            setAcknowledged(false);
                            void previewWorktreeRemoval(repo, row.path)
                              .then((value) => {
                                setRemoval(value);
                                setForm("remove");
                              })
                              .catch((e) => setError(message(e)))
                              .finally(() => setBusy(false));
                          }}
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
        {form && (
          <div className="worktree-form">
            <h3>
              {form === "create"
                ? "Create worktree"
                : form === "move"
                  ? "Move worktree folder"
                  : form === "lock"
                    ? "Lock worktree"
                    : form === "remove"
                      ? "Remove worktree"
                      : "Clean stale registrations"}
            </h3>
            {target && <code>{target.path}</code>}
            {(form === "create" || form === "move") && (
              <>
                <p>
                  Choose a new folder outside existing checkouts. Other editors
                  or agents may still be using a checkout even when it is clean.
                </p>
                {form === "create" && (
                  <>
                    <label>
                      Mode
                      <select
                        value={mode}
                        onChange={(e) => setMode(e.target.value)}
                      >
                        <option value="new">New branch</option>
                        <option value="existing">Existing local branch</option>
                        <option value="detached">Detached commit</option>
                      </select>
                    </label>
                    {mode !== "detached" && (
                      <label>
                        Branch
                        <input
                          value={branch}
                          list="worktree-branches"
                          onChange={(e) => {
                            setBranch(e.target.value);
                            if (!folderEdited)
                              setFolder(
                                `${snapshot.repository.name}-${e.target.value.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
                              );
                          }}
                        />
                        <datalist id="worktree-branches">
                          {snapshot.branches
                            .filter(
                              (b) => !b.fullRef.startsWith("refs/remotes/"),
                            )
                            .map((b) => (
                              <option key={b.name} value={b.name} />
                            ))}
                        </datalist>
                      </label>
                    )}
                    {mode !== "existing" && (
                      <label>
                        Start point
                        <input
                          value={base}
                          onChange={(e) => setBase(e.target.value)}
                          placeholder="Branch, remote branch, or commit"
                        />
                        <small>
                          Current HEAD: {snapshot.currentBranch || "detached"} ·{" "}
                          {snapshot.repository.head?.slice(0, 8)}
                        </small>
                      </label>
                    )}
                    {mode === "existing" && occupied && (
                      <p>
                        This branch is checked out at {occupied.path}.{" "}
                        <button
                          onClick={() => {
                            dialog.current?.close();
                            void open(occupied.path);
                          }}
                        >
                          Open existing worktree
                        </button>
                      </p>
                    )}
                  </>
                )}
                <label>
                  Parent directory
                  <div className="worktree-toolbar">
                    <input
                      value={parent}
                      onChange={(e) => setParent(e.target.value)}
                    />
                    <button onClick={() => void chooseParent()}>
                      Choose folder
                    </button>
                  </div>
                </label>
                <label>
                  Folder name
                  <input
                    value={folder}
                    onChange={(e) => {
                      setFolder(e.target.value);
                      setFolderEdited(true);
                    }}
                  />
                </label>
                <code>{destination}</code>
                {form === "create" && (
                  <label>
                    <input
                      type="checkbox"
                      checked={openCreated}
                      onChange={(e) => setOpenCreated(e.target.checked)}
                    />{" "}
                    Open when created
                  </label>
                )}
                {form === "create" && (
                  <p role="status">
                    {!localCreationValid
                      ? "Complete the fields and choose an available branch."
                      : validationError ||
                        (validatedKey !== validationKey
                          ? "Checking branch, start point and destination…"
                          : "Ready to create")}
                  </p>
                )}
                <button
                  disabled={
                    (form === "create" && validatedKey !== validationKey) ||
                    busy ||
                    !folder.trim() ||
                    /[\\/]/.test(folder) ||
                    folder === "." ||
                    folder === ".." ||
                    (form === "create" &&
                      ((mode !== "detached" && !branch.trim()) ||
                        (mode === "existing" && !!occupied) ||
                        !base.trim()))
                  }
                  onClick={() =>
                    void run(async () => {
                      if (form === "create") {
                        const path = await createWorktree(repo, {
                          path: destination,
                          mode,
                          branch,
                          startPoint: mode === "existing" ? branch : base,
                        });
                        setNotice(`Created ${path}`);
                        if (openCreated) {
                          dialog.current?.close();
                          await open(path);
                        }
                      } else if (target) {
                        const current = target.path === repo;
                        const survivor = rows.find(
                          (r) =>
                            r.path !== target.path &&
                            !r.bare &&
                            r.availability === "available",
                        );
                        if (
                          current &&
                          (!survivor || !(await open(survivor.path)))
                        )
                          throw new Error(
                            "Open another available checkout before moving this one.",
                          );
                        await manageWorktree(
                          current ? survivor!.path : repo,
                          target.path,
                          "move",
                          destination,
                        );
                        reconcile(target.path, destination);
                        if (current) await open(destination);
                      }
                    })
                  }
                >
                  {busy
                    ? "Working…"
                    : form === "create"
                      ? "Create"
                      : "Move folder"}
                </button>
              </>
            )}
            {form === "lock" && (
              <>
                <p>
                  A lock protects against moving, removal and stale-registration
                  cleanup. File editing remains available.
                </p>
                <label>
                  Reason
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <button
                  disabled={busy}
                  onClick={() =>
                    target &&
                    void run(() =>
                      manageWorktree(repo, target.path, "lock", reason),
                    )
                  }
                >
                  Lock worktree
                </button>
              </>
            )}
            {form === "remove" && removal && (
              <>
                <p>
                  This deletes the exact directory above and its checkout-local
                  undo history. The branch is preserved.
                </p>
                {removal.blockers.map((item) => (
                  <p key={item} role="alert">
                    {item}
                  </p>
                ))}
                {removal.ignored > 0 && (
                  <label>
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      onChange={(e) => setAcknowledged(e.target.checked)}
                    />{" "}
                    Delete ignored content too ({removal.ignored} entries,
                    including possible build files).
                  </label>
                )}
                <button
                  disabled={
                    busy ||
                    removal.blockers.length > 0 ||
                    (removal.ignored > 0 && !acknowledged)
                  }
                  onClick={() =>
                    void run(async () => {
                      let control = repo;
                      if (removal.path === repo) {
                        const survivor = rows.find(
                          (r) =>
                            r.path !== repo &&
                            !r.bare &&
                            r.availability === "available",
                        );
                        if (!survivor || !(await open(survivor.path)))
                          throw new Error(
                            "Open another available checkout first.",
                          );
                        control = survivor.path;
                      }
                      await removeWorktree(
                        control,
                        removal.path,
                        removal.head,
                        removal.token,
                        acknowledged,
                      );
                      reconcile(removal.path);
                    })
                  }
                >
                  Remove checkout
                </button>
              </>
            )}
            {form === "prune" && (
              <>
                <p>
                  Remove repository-wide stale registration metadata listed
                  below. A missing directory may be an unmounted drive; cancel
                  and lock its registration if it needs to be preserved.
                </p>
                <pre>{prunePreview || "No stale registrations."}</pre>
                <button
                  disabled={busy || !prunePreview}
                  onClick={() =>
                    void run(() => pruneWorktrees(repo, prunePreview))
                  }
                >
                  Clean listed registrations
                </button>
              </>
            )}
            <button disabled={busy} onClick={() => setForm(null)}>
              Back
            </button>
          </div>
        )}
      </dialog>
    </section>
  );
}
