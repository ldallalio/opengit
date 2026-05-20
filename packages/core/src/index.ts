export type OperationResult<T> =
  | { ok: true; data: T; operationId?: string }
  | { ok: false; error: GitOperationError; operationId?: string };

export interface GitOperationError {
  code: string;
  message: string;
  detail?: string;
}

export interface Repository {
  id: string;
  path: string;
  name: string;
  provider?: GitProvider;
  remotes: Remote[];
  head?: string;
  worktreeState: WorktreeState;
}

export type GitProvider = "github" | "gitlab" | "bitbucket" | "azure-devops" | "unknown";

export type WorktreeState =
  | "clean"
  | "dirty"
  | "merging"
  | "rebasing"
  | "cherry-picking"
  | "detached"
  | "unknown";

export interface Commit {
  sha: string;
  parents: string[];
  author: string;
  authorEmail: string;
  date: string;
  message: string;
  refs: string[];
}

export interface Branch {
  name: string;
  fullRef: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  isCurrent: boolean;
  isProtected: boolean;
}

export interface Remote {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
  provider: GitProvider;
}

export interface Stash {
  index: string;
  sha: string;
  branch?: string;
  message: string;
  timestamp?: string;
}

export interface PullRequest {
  providerId: string;
  title: string;
  state: "open" | "closed" | "merged" | "draft";
  base: string;
  head: string;
  reviewers: string[];
  labels: string[];
  checks: CheckRun[];
  draft: boolean;
}

export interface CheckRun {
  name: string;
  status: "queued" | "in_progress" | "success" | "failure" | "cancelled" | "unknown";
}

export interface Diff {
  files: DiffFile[];
  mode: "unified" | "side-by-side";
}

export interface DiffFile {
  path: string;
  oldPath?: string;
  hunks: DiffHunk[];
  binary: boolean;
  additions: number;
  deletions: number;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  kind: "context" | "added" | "removed" | "meta";
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface FileChange {
  path: string;
  oldPath?: string;
  status: FileStatus;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  binary: boolean;
  renameScore?: number;
}

export type FileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "conflicted"
  | "ignored"
  | "unknown";

export interface Conflict {
  path: string;
  kind: string;
  stages: string[];
  resolutionState: "unresolved" | "resolved" | "manual";
}

export interface Worktree {
  path: string;
  branch?: string;
  head: string;
  locked: boolean;
  prunable: boolean;
}

export interface CredentialRef {
  provider: GitProvider;
  accountId: string;
  keyringService: string;
  keyringAccount: string;
  scopes: string[];
  expiresAt?: string;
}

export interface RepoSnapshot {
  repository: Repository;
  currentBranch?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  changes: FileChange[];
  branches: Branch[];
  remotes: Remote[];
  stashes: Stash[];
  commits: Commit[];
  conflicts: Conflict[];
}
