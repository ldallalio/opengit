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

export type ProviderConnectionStatus = "connected" | "missing-token" | "auth-failed" | "unavailable";

export interface ProviderAccountStatus {
  provider: GitProvider;
  configured: boolean;
  status: ProviderConnectionStatus;
  label: string;
  detail?: string;
}

export interface ProviderAccount {
  id: string;
  provider: GitProvider;
  name: string;
  displayName?: string;
  url?: string;
}

export interface ProviderProject {
  id: string;
  provider: GitProvider;
  accountId: string;
  name: string;
  url?: string;
}

export interface ProviderCloneUrl {
  kind: "https" | "ssh" | "unknown";
  url: string;
  safeUrl: string;
}

export type LocalRepoMatchStatus = "not-cloned" | "cloned" | "missing-path" | "current";

export interface LocalRepoMatch {
  status: LocalRepoMatchStatus;
  path?: string;
  matchedRemote?: string;
}

export interface LocalRepositoryRef {
  path: string;
  exists: boolean;
  isRepository: boolean;
  remotes: Remote[];
}

export interface ProviderRepository {
  id: string;
  provider: GitProvider;
  accountId: string;
  accountName: string;
  projectId?: string;
  projectName?: string;
  name: string;
  defaultBranch?: string;
  webUrl?: string;
  cloneUrl?: ProviderCloneUrl;
  localMatch: LocalRepoMatch;
}

export interface ProviderRepoCatalog {
  provider: GitProvider;
  accounts: ProviderAccount[];
  projects: ProviderProject[];
  repositories: ProviderRepository[];
  refreshedAt: string;
}

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

export interface BranchInspection {
  branch: Branch;
  kind: "local" | "remote" | "tag" | "unknown";
  upstream?: string;
  defaultBranch?: string;
  baseRef?: string;
  headSha?: string;
  lastCommit?: Commit;
  aheadBehindUpstream?: AheadBehind;
  aheadBehindDefault?: AheadBehind;
  status: "current" | "up-to-date" | "ahead" | "behind" | "diverged" | "no-upstream" | "unknown";
  recentCommits: Commit[];
  diffSummary?: BranchDiffSummary;
}

export interface AheadBehind {
  ahead: number;
  behind: number;
}

export interface BranchDiffSummary {
  baseRef: string;
  fileCount: number;
  additions?: number;
  deletions?: number;
  files: Array<{
    path: string;
    oldPath?: string;
    status: FileStatus;
  }>;
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

export interface PullRequestRef {
  provider: GitProvider;
  providerId?: string;
  url?: string;
  state?: PullRequest["state"];
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

export interface CommitFile {
  path: string;
  oldPath?: string;
  status: FileStatus;
}

export interface UndoSnapshot {
  id: string;
  label: string;
  branch?: string;
  headSha?: string;
  refName?: string;
  createdAt: string;
  hasStagedPatch: boolean;
  hasWorkingPatch: boolean;
}

export interface BranchStack {
  id: string;
  name: string;
  trunk: string;
  items: BranchStackItem[];
  status: BranchStackStatus;
  lastOperation?: string;
  createdAt: string;
  updatedAt: string;
}

export type BranchStackStatus = "clean" | "needs-restack" | "conflicted" | "unknown";

export interface BranchStackItem {
  id: string;
  branch: string;
  baseBranch: string;
  order: number;
  headSha?: string;
  upstream?: string;
  prRef?: PullRequestRef;
  status: BranchStackItemStatus;
}

export type BranchStackItemStatus = "clean" | "ahead" | "behind" | "needs-restack" | "conflicted" | "missing" | "unknown";

export interface ParallelLane {
  id: string;
  name: string;
  targetBranch: string;
  baseHead: string;
  applied: boolean;
  status: ParallelLaneStatus;
  paths: ParallelLanePath[];
  createdAt: string;
  updatedAt: string;
}

export type ParallelLaneStatus = "clean" | "dirty" | "blocked" | "conflicted" | "committed";

export interface ParallelLanePath {
  path: string;
  oldPath?: string;
  status: FileStatus;
  source: "working" | "staged" | "untracked";
}

export interface GitWorkflowOperation {
  id: string;
  kind: "stack-restack" | "lane-apply" | "lane-unapply" | "lane-commit" | "worktree" | "unknown";
  label: string;
  status: "running" | "conflicted" | "blocked";
  stackId?: string;
  laneId?: string;
  branch?: string;
  baseBranch?: string;
  createdAt: string;
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
  /** Total working-tree changes before any display cap; may exceed `changes.length`. */
  totalChanges?: number;
  /** True when `changes` was capped by the backend to keep the UI responsive. */
  changesTruncated?: boolean;
  branches: Branch[];
  remotes: Remote[];
  stashes: Stash[];
  commits: Commit[];
  conflicts: Conflict[];
  undoSnapshots: UndoSnapshot[];
  branchStacks: BranchStack[];
  parallelLanes: ParallelLane[];
  worktrees: Worktree[];
  activeOperation?: GitWorkflowOperation;
}
