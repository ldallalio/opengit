use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::BTreeMap,
    fs,
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use thiserror::Error;
use tokio::process::Command;

type CommandResult<T> = Result<T, AppError>;
const DEFAULT_HISTORY_LIMIT: u32 = 250;
const MIN_HISTORY_LIMIT: u32 = 50;
const MAX_HISTORY_LIMIT: u32 = 2_000;
const OPENAI_KEY_SERVICE: &str = "OpenGit";
const OPENAI_KEY_ACCOUNT: &str = "openai-api-key";
const AZURE_DEVOPS_PAT_ACCOUNT: &str = "azure-devops-pat";
const GITHUB_PAT_ACCOUNT: &str = "github-pat";
const CLAUDE_KEY_ACCOUNT: &str = "claude-api-key";
const CLAUDE_MODEL: &str = "claude-opus-4-8";
const ANTHROPIC_MESSAGES_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_COUNT_TOKENS_URL: &str = "https://api.anthropic.com/v1/messages/count_tokens";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const GITHUB_API_BASE: &str = "https://api.github.com";
const GITHUB_USER_AGENT: &str = "OpenGit";
const DEFAULT_OPENAI_MODEL: &str = "gpt-5-mini";
const MAX_STAGED_DIFF_CHARS: usize = 48_000;
/// Upper bound on the number of working-tree change entries returned in a snapshot.
/// A repository with tens of thousands of changes (e.g. a build-output directory that
/// slipped past .gitignore) would otherwise ship a multi-megabyte payload and freeze
/// the UI. Beyond this the list is capped and `changes_truncated` is set.
const MAX_CHANGE_ENTRIES: usize = 5_000;

#[derive(Debug, Error)]
enum AppError {
    #[error("{message}")]
    InvalidInput { code: &'static str, message: String },
    #[error("Git command failed")]
    GitFailed { message: String, detail: String },
    #[error("{message}")]
    GitActionRequired {
        code: &'static str,
        message: String,
        detail: String,
    },
    #[error("I/O error: {0}")]
    Io(String),
    #[error("Secure storage error: {0}")]
    SecureStorage(String),
    #[error("OpenAI request failed")]
    AiFailed { message: String, detail: String },
    #[error("{message}")]
    ProviderFailed {
        code: &'static str,
        message: String,
        detail: String,
    },
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        #[derive(Serialize)]
        struct ErrorBody<'a> {
            code: &'a str,
            message: String,
            detail: Option<String>,
        }

        let body = match self {
            AppError::InvalidInput { code, message } => ErrorBody {
                code,
                message: message.clone(),
                detail: None,
            },
            AppError::GitFailed { message, detail } => ErrorBody {
                code: "GIT_FAILED",
                message: message.clone(),
                detail: Some(redact_secrets(detail)),
            },
            AppError::GitActionRequired {
                code,
                message,
                detail,
            } => ErrorBody {
                code,
                message: message.clone(),
                detail: Some(redact_secrets(detail)),
            },
            AppError::Io(message) => ErrorBody {
                code: "IO_ERROR",
                message: message.clone(),
                detail: None,
            },
            AppError::SecureStorage(message) => ErrorBody {
                code: "SECURE_STORAGE_ERROR",
                message: message.clone(),
                detail: None,
            },
            AppError::AiFailed { message, detail } => ErrorBody {
                code: "OPENAI_FAILED",
                message: message.clone(),
                detail: Some(redact_secrets(detail)),
            },
            AppError::ProviderFailed {
                code,
                message,
                detail,
            } => ErrorBody {
                code,
                message: message.clone(),
                detail: Some(redact_secrets(detail)),
            },
        };

        body.serialize(serializer)
    }
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        AppError::Io(value.to_string())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Repository {
    id: String,
    path: String,
    name: String,
    provider: GitProvider,
    remotes: Vec<Remote>,
    head: Option<String>,
    worktree_state: WorktreeState,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum GitProvider {
    Github,
    Gitlab,
    Bitbucket,
    AzureDevops,
    Unknown,
}

#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
enum WorktreeState {
    Clean,
    Dirty,
    Merging,
    Rebasing,
    CherryPicking,
    Detached,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GitOperationState {
    None,
    Merging,
    Rebasing,
    CherryPicking,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Commit {
    sha: String,
    parents: Vec<String>,
    author: String,
    author_email: String,
    date: String,
    message: String,
    refs: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommitPage {
    commits: Vec<Commit>,
    has_more: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Branch {
    name: String,
    full_ref: String,
    upstream: Option<String>,
    ahead: Option<i32>,
    behind: Option<i32>,
    is_current: bool,
    is_protected: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BranchInspection {
    branch: Branch,
    kind: BranchInspectionKind,
    upstream: Option<String>,
    default_branch: Option<String>,
    base_ref: Option<String>,
    head_sha: Option<String>,
    last_commit: Option<Commit>,
    ahead_behind_upstream: Option<AheadBehind>,
    ahead_behind_default: Option<AheadBehind>,
    status: BranchInspectionStatus,
    recent_commits: Vec<Commit>,
    diff_summary: Option<BranchDiffSummary>,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum BranchInspectionKind {
    Local,
    Remote,
    Tag,
    Unknown,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AheadBehind {
    ahead: i32,
    behind: i32,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum BranchInspectionStatus {
    Current,
    UpToDate,
    Ahead,
    Behind,
    Diverged,
    NoUpstream,
    Unknown,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BranchDiffSummary {
    base_ref: String,
    file_count: usize,
    additions: Option<i32>,
    deletions: Option<i32>,
    files: Vec<CommitFile>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Remote {
    name: String,
    fetch_url: Option<String>,
    push_url: Option<String>,
    provider: GitProvider,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Stash {
    index: String,
    sha: String,
    branch: Option<String>,
    message: String,
    timestamp: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileChange {
    path: String,
    old_path: Option<String>,
    status: FileStatus,
    index_status: String,
    worktree_status: String,
    staged: bool,
    unstaged: bool,
    binary: bool,
    rename_score: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommitFile {
    path: String,
    old_path: Option<String>,
    status: FileStatus,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UndoSnapshot {
    id: String,
    label: String,
    branch: Option<String>,
    head_sha: Option<String>,
    ref_name: Option<String>,
    created_at: String,
    has_staged_patch: bool,
    has_working_patch: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PullRequestRef {
    provider: GitProvider,
    provider_id: Option<String>,
    url: Option<String>,
    state: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BranchStack {
    id: String,
    name: String,
    trunk: String,
    items: Vec<BranchStackItem>,
    status: BranchStackStatus,
    last_operation: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum BranchStackStatus {
    Clean,
    NeedsRestack,
    Conflicted,
    Unknown,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BranchStackItem {
    id: String,
    branch: String,
    base_branch: String,
    order: usize,
    head_sha: Option<String>,
    upstream: Option<String>,
    pr_ref: Option<PullRequestRef>,
    status: BranchStackItemStatus,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum BranchStackItemStatus {
    Clean,
    Ahead,
    Behind,
    NeedsRestack,
    Conflicted,
    Missing,
    Unknown,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ParallelLane {
    id: String,
    name: String,
    target_branch: String,
    base_head: String,
    applied: bool,
    status: ParallelLaneStatus,
    paths: Vec<ParallelLanePath>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum ParallelLaneStatus {
    Clean,
    Dirty,
    Blocked,
    Conflicted,
    Committed,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ParallelLanePath {
    path: String,
    old_path: Option<String>,
    status: FileStatus,
    source: ParallelLanePathSource,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum ParallelLanePathSource {
    Working,
    Staged,
    Untracked,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GitWorkflowOperation {
    id: String,
    kind: GitWorkflowOperationKind,
    label: String,
    status: GitWorkflowOperationStatus,
    stack_id: Option<String>,
    lane_id: Option<String>,
    branch: Option<String>,
    base_branch: Option<String>,
    created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum GitWorkflowOperationKind {
    StackRestack,
    LaneApply,
    LaneUnapply,
    LaneCommit,
    Worktree,
    Unknown,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum GitWorkflowOperationStatus {
    Running,
    Conflicted,
    Blocked,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum FileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    Untracked,
    Conflicted,
    Ignored,
    Unknown,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Conflict {
    path: String,
    kind: String,
    stages: Vec<String>,
    resolution_state: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConflictVersions {
    path: String,
    base: String,
    ours: String,
    theirs: String,
    working: String,
    diff: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Worktree {
    path: String,
    branch: Option<String>,
    head: String,
    locked: bool,
    prunable: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RepoSnapshot {
    repository: Repository,
    current_branch: Option<String>,
    upstream: Option<String>,
    ahead: i32,
    behind: i32,
    changes: Vec<FileChange>,
    /// Total number of working-tree changes before any display cap was applied.
    total_changes: usize,
    /// True when `changes` was capped at `MAX_CHANGE_ENTRIES` to keep the UI responsive.
    changes_truncated: bool,
    branches: Vec<Branch>,
    remotes: Vec<Remote>,
    stashes: Vec<Stash>,
    commits: Vec<Commit>,
    conflicts: Vec<Conflict>,
    undo_snapshots: Vec<UndoSnapshot>,
    branch_stacks: Vec<BranchStack>,
    parallel_lanes: Vec<ParallelLane>,
    worktrees: Vec<Worktree>,
    active_operation: Option<GitWorkflowOperation>,
}

#[derive(Debug, Default)]
struct BranchStatus {
    current_branch: Option<String>,
    upstream: Option<String>,
    ahead: i32,
    behind: i32,
    head_oid: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BranchCreateRequest {
    repo_path: String,
    name: String,
    checkout: bool,
    start_point: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StackCreateRequest {
    repo_path: String,
    name: String,
    trunk: String,
    branches: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StackCreateChildRequest {
    repo_path: String,
    stack_id: String,
    base_branch: String,
    new_branch_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StackAddBranchRequest {
    repo_path: String,
    stack_id: String,
    branch: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StackReorderRequest {
    repo_path: String,
    stack_id: String,
    ordered_branch_names: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaneCreateRequest {
    repo_path: String,
    name: String,
    target_branch: String,
    paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaneAssignPathsRequest {
    repo_path: String,
    lane_id: String,
    paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaneCommitRequest {
    repo_path: String,
    lane_id: String,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaneMaterializeBranchRequest {
    repo_path: String,
    lane_id: String,
    branch_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenAiStatus {
    configured: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AzureDevOpsStatus {
    configured: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeStatus {
    configured: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeTestResult {
    configured: bool,
    ok: bool,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GithubStatus {
    configured: bool,
    login: Option<String>,
    name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderAccountStatus {
    provider: GitProvider,
    configured: bool,
    status: ProviderConnectionStatus,
    label: String,
    detail: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
enum ProviderConnectionStatus {
    Connected,
    MissingToken,
    AuthFailed,
    Unavailable,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderAccount {
    id: String,
    provider: GitProvider,
    name: String,
    display_name: Option<String>,
    url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderProject {
    id: String,
    provider: GitProvider,
    account_id: String,
    name: String,
    url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderCloneUrl {
    kind: ProviderCloneUrlKind,
    url: String,
    safe_url: String,
}

#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
enum ProviderCloneUrlKind {
    Https,
    Ssh,
    Unknown,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum LocalRepoMatchStatus {
    NotCloned,
    Cloned,
    MissingPath,
    Current,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalRepoMatch {
    status: LocalRepoMatchStatus,
    path: Option<String>,
    matched_remote: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderRepository {
    id: String,
    provider: GitProvider,
    account_id: String,
    account_name: String,
    project_id: Option<String>,
    project_name: Option<String>,
    name: String,
    default_branch: Option<String>,
    web_url: Option<String>,
    clone_url: Option<ProviderCloneUrl>,
    local_match: LocalRepoMatch,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderRepoCatalog {
    provider: GitProvider,
    accounts: Vec<ProviderAccount>,
    projects: Vec<ProviderProject>,
    repositories: Vec<ProviderRepository>,
    refreshed_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalRepositoryRef {
    path: String,
    exists: bool,
    is_repository: bool,
    remotes: Vec<Remote>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderReposListRequest {
    provider: GitProvider,
    local_paths: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenAiTestResult {
    configured: bool,
    ok: bool,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiCommitSuggestion {
    summary: String,
    description: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiBranchNameSuggestion {
    name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiPrDescriptionSuggestion {
    title: String,
    description: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiBranchExplanation {
    branch: String,
    base: String,
    markdown: String,
}

#[derive(Debug, Deserialize)]
struct OpenAiResponseBody {
    status: Option<String>,
    incomplete_details: Option<OpenAiIncompleteDetails>,
    output_text: Option<String>,
    output: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct OpenAiIncompleteDetails {
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AiCommitSuggestionWire {
    summary: String,
    description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AiBranchNameSuggestionWire {
    name: String,
}

#[derive(Debug, Deserialize)]
struct AiPrDescriptionSuggestionWire {
    title: String,
    description: Option<String>,
}

#[tauri::command]
async fn repo_open(path: String, history_limit: Option<u32>) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&path).await?;
    build_snapshot(&repo, history_limit).await
}

#[tauri::command]
async fn repo_clone(
    url: String,
    destination: String,
    history_limit: Option<u32>,
) -> CommandResult<RepoSnapshot> {
    if url.trim().is_empty() {
        return invalid("INVALID_URL", "Clone URL is required.");
    }
    if destination.trim().is_empty() {
        return invalid("INVALID_PATH", "Destination path is required.");
    }

    run_git(None, vec!["clone".into(), url, destination.clone()]).await?;
    repo_open(destination, history_limit).await
}

#[tauri::command]
async fn repo_status(repo_path: String, history_limit: Option<u32>) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    build_snapshot(&repo, history_limit).await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitIdentity {
    name: Option<String>,
    email: Option<String>,
}

async fn read_global_git_config_value(key: &str) -> Option<String> {
    run_git(
        None,
        vec![
            "config".into(),
            "--global".into(),
            "--get".into(),
            key.into(),
        ],
    )
    .await
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
}

#[tauri::command]
async fn git_identity_get() -> CommandResult<GitIdentity> {
    Ok(GitIdentity {
        name: read_global_git_config_value("user.name").await,
        email: read_global_git_config_value("user.email").await,
    })
}

#[tauri::command]
async fn git_identity_set(name: String, email: String) -> CommandResult<GitIdentity> {
    let name = name.trim().to_string();
    let email = email.trim().to_string();
    if name.is_empty() {
        return invalid("INVALID_NAME", "Author name is required.");
    }
    if email.is_empty() {
        return invalid("INVALID_EMAIL", "Author email is required.");
    }

    run_git(
        None,
        vec![
            "config".into(),
            "--global".into(),
            "user.name".into(),
            name.clone(),
        ],
    )
    .await?;
    run_git(
        None,
        vec![
            "config".into(),
            "--global".into(),
            "user.email".into(),
            email.clone(),
        ],
    )
    .await?;

    Ok(GitIdentity {
        name: Some(name),
        email: Some(email),
    })
}

#[tauri::command]
async fn git_commit_search(
    repo_path: String,
    query: String,
    history_limit: Option<u32>,
) -> CommandResult<Vec<Commit>> {
    let repo = resolve_repo_root(&repo_path).await?;
    let terms = history_search_terms(&query);
    let limit = clamp_history_limit(history_limit) as usize;

    if terms.is_empty() {
        return Ok(parse_commits(
            &run_git(Some(&repo), history_log_args(limit as u32))
                .await
                .unwrap_or_default(),
        ));
    }

    Ok(parse_commits(
        &run_git(Some(&repo), history_search_log_args())
            .await
            .unwrap_or_default(),
    )
    .into_iter()
    .filter(|commit| commit_matches_history_search(commit, &terms))
    .take(limit)
    .collect())
}

#[tauri::command]
async fn git_commit_lookup(repo_path: String, sha: String) -> CommandResult<Commit> {
    let repo = resolve_repo_root(&repo_path).await?;
    validate_ref_arg(&sha, "commit")?;
    parse_commits(&run_git(Some(&repo), commit_show_args(&sha)).await?)
        .into_iter()
        .next()
        .ok_or_else(|| AppError::InvalidInput {
            code: "INVALID_REF",
            message: "Commit could not be found.".to_string(),
        })
}

#[tauri::command]
async fn git_commit_page(repo_path: String, skip: u32, limit: Option<u32>) -> CommandResult<CommitPage> {
    let repo = resolve_repo_root(&repo_path).await?;
    let page_limit = limit.unwrap_or(DEFAULT_HISTORY_LIMIT).clamp(MIN_HISTORY_LIMIT, MAX_HISTORY_LIMIT);
    let mut commits = parse_commits(&run_git(Some(&repo), history_page_log_args(skip, page_limit + 1)).await?);
    let has_more = commits.len() > page_limit as usize;
    commits.truncate(page_limit as usize);
    Ok(CommitPage { commits, has_more })
}

#[tauri::command]
async fn git_stage(repo_path: String, paths: Vec<String>) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    let safe_paths = validate_file_paths(&paths)?;
    let mut args = vec!["add".into(), "--".into()];
    args.extend(safe_paths);
    run_git_with_safety_snapshot(&repo, "before stage", args).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_unstage(repo_path: String, paths: Vec<String>) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    let safe_paths = validate_file_paths(&paths)?;
    let mut args = vec!["restore".into(), "--staged".into(), "--".into()];
    args.extend(safe_paths);
    run_git_with_safety_snapshot(&repo, "before unstage", args).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_discard(repo_path: String, paths: Vec<String>) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    let safe_paths = validate_file_paths(&paths)?;
    create_safety_snapshot(&repo, "before discard").await?;

    // `git restore` only understands tracked content and errors with
    // "pathspec ... did not match any file(s) known to git" on untracked files
    // or directories, so partition the request: tracked paths are restored,
    // while every path is also passed through `git clean` to remove untracked
    // files/directories (a no-op where nothing untracked exists, which covers
    // directories holding both tracked-modified and untracked files).
    let mut tracked = Vec::new();
    for path in &safe_paths {
        let listed = run_git(
            Some(&repo),
            vec!["ls-files".into(), "--".into(), path.clone()],
        )
        .await?;
        if !listed.trim().is_empty() {
            tracked.push(path.clone());
        }
    }

    if !tracked.is_empty() {
        let mut restore_args = vec!["restore".into(), "--".into()];
        restore_args.extend(tracked);
        run_git(Some(&repo), restore_args).await?;
    }

    let mut clean_args = vec!["clean".into(), "-fd".into(), "--".into()];
    clean_args.extend(safe_paths);
    run_git(Some(&repo), clean_args).await?;

    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_commit(
    repo_path: String,
    message: String,
    amend: bool,
) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    if message.trim().is_empty() {
        return invalid("INVALID_COMMIT_MESSAGE", "Commit message is required.");
    }

    let mut args = vec!["commit".into()];
    if amend {
        args.push("--amend".into());
    }
    args.extend(["-m".into(), message]);
    run_git_with_safety_snapshot(&repo, "before commit", args).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_commit_message_update(
    repo_path: String,
    commit_sha: String,
    message: String,
) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    validate_ref_arg(&commit_sha, "commit")?;
    if message.trim().is_empty() {
        return invalid("INVALID_COMMIT_MESSAGE", "Commit message is required.");
    }

    reword_commit(&repo, &commit_sha, message.trim()).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_commit_undo_last(repo_path: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    ensure_no_active_operation(&repo).await?;
    ensure_clean_worktree(&repo, "Undo last commit").await?;
    run_git(
        Some(&repo),
        vec!["rev-parse".into(), "--verify".into(), "HEAD~1".into()],
    )
    .await?;
    run_git_with_safety_snapshot(
        &repo,
        "before undo last commit",
        vec!["reset".into(), "--mixed".into(), "HEAD~1".into()],
    )
    .await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_commit_squash_last(repo_path: String, message: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    if message.trim().is_empty() {
        return invalid("INVALID_COMMIT_MESSAGE", "Commit message is required.");
    }
    ensure_no_active_operation(&repo).await?;
    ensure_clean_worktree(&repo, "Squash last commits").await?;
    let branch = ensure_current_local_branch(&repo).await?;
    let old_head = resolve_commit_sha(&repo, "HEAD").await?;
    let previous_commit =
        resolve_commit_sha(&repo, "HEAD~1")
            .await
            .map_err(|_| AppError::InvalidInput {
                code: "UNSUPPORTED_REWRITE",
                message: "At least two linear commits are required before squashing.".to_string(),
            })?;
    if commit_parent_count(&repo, "HEAD").await? > 1
        || commit_parent_count(&repo, "HEAD~1").await? > 1
    {
        return invalid(
            "UNSUPPORTED_REWRITE",
            "Merge commits cannot be squashed in this guarded flow.",
        );
    }

    create_safety_snapshot(&repo, "before squash last commits").await?;
    let tree = commit_tree_id(&repo, "HEAD").await?;
    let author = commit_author_meta(&repo, "HEAD").await?;
    let parent = first_parent(&repo, &previous_commit).await?;
    let new_sha =
        create_commit_with_tree(&repo, &tree, parent.as_deref(), message.trim(), &author).await?;
    update_current_branch_to(&repo, &branch, &new_sha, &old_head).await?;
    build_snapshot(&repo, None).await
}

async fn reword_commit(repo: &Path, commit_sha: &str, message: &str) -> CommandResult<()> {
    ensure_no_active_operation(repo).await?;
    let target = resolve_commit_sha(repo, commit_sha).await?;
    let head = resolve_commit_sha(repo, "HEAD").await?;

    if target == head {
        let staged = run_git(
            Some(repo),
            vec![
                "diff".into(),
                "--cached".into(),
                "--name-only".into(),
                "-z".into(),
            ],
        )
        .await?;
        if !staged.is_empty() {
            return invalid(
                "STAGED_CHANGES_BLOCK_AMEND",
                "Unstage files before updating the HEAD commit message.",
            );
        }

        run_git_with_safety_snapshot(
            repo,
            "before commit message update",
            vec![
                "commit".into(),
                "--amend".into(),
                "-m".into(),
                message.to_string(),
            ],
        )
        .await?;
        return Ok(());
    }

    if !is_ancestor(repo, &target, &head).await {
        return invalid(
            "UNSUPPORTED_REWRITE",
            "Selected commit is not an ancestor of HEAD in the current branch.",
        );
    }

    ensure_clean_worktree(repo, "Update older commit message").await?;
    let branch = ensure_current_local_branch(repo).await?;
    let rewrite_chain = linear_rewrite_chain(repo, &target, &head).await?;
    create_safety_snapshot(repo, "before older commit message update").await?;

    let mut previous_new_parent = first_parent(repo, &target).await?;
    let mut final_new_sha = String::new();
    for sha in rewrite_chain {
        let tree = commit_tree_id(repo, &sha).await?;
        let author = commit_author_meta(repo, &sha).await?;
        let commit_message = if sha == target {
            message.to_string()
        } else {
            read_commit_message(repo, &sha).await?
        };
        let new_sha = create_commit_with_tree(
            repo,
            &tree,
            previous_new_parent.as_deref(),
            &commit_message,
            &author,
        )
        .await?;
        previous_new_parent = Some(new_sha.clone());
        final_new_sha = new_sha;
    }

    update_current_branch_to(repo, &branch, &final_new_sha, &head).await
}

#[derive(Debug)]
struct CommitAuthorMeta {
    name: String,
    email: String,
    date: String,
}

async fn ensure_no_active_operation(repo: &Path) -> CommandResult<()> {
    if matches!(detect_git_operation(repo).await, GitOperationState::None) {
        return Ok(());
    }
    invalid(
        "ACTIVE_GIT_OPERATION",
        "Finish or abort the active merge, rebase, or cherry-pick before editing commits.",
    )
}

async fn ensure_clean_worktree(repo: &Path, action: &str) -> CommandResult<()> {
    let status = run_git(
        Some(repo),
        vec!["status".into(), "--porcelain=v2".into(), "-z".into()],
    )
    .await?;
    if status.is_empty() {
        return Ok(());
    }
    invalid(
        "DIRTY_WORKTREE_BLOCK_REWRITE",
        &format!("{action} requires a clean working tree. Commit, stash, or discard local changes first."),
    )
}

async fn ensure_current_local_branch(repo: &Path) -> CommandResult<String> {
    current_branch_name(repo)
        .await
        .ok_or_else(|| AppError::InvalidInput {
            code: "DETACHED_HEAD_BLOCK_REWRITE",
            message: "Checkout a local branch before rewriting commit history.".to_string(),
        })
}

async fn resolve_commit_sha(repo: &Path, value: &str) -> CommandResult<String> {
    let output = run_git(
        Some(repo),
        vec![
            "rev-parse".into(),
            "--verify".into(),
            format!("{value}^{{commit}}"),
        ],
    )
    .await?;
    Ok(output.trim().to_string())
}

async fn commit_parent_count(repo: &Path, value: &str) -> CommandResult<usize> {
    let output = run_git(
        Some(repo),
        vec![
            "rev-list".into(),
            "--parents".into(),
            "-n".into(),
            "1".into(),
            value.to_string(),
        ],
    )
    .await?;
    Ok(output.split_whitespace().skip(1).count())
}

async fn is_ancestor(repo: &Path, ancestor: &str, descendant: &str) -> bool {
    run_git(
        Some(repo),
        vec![
            "merge-base".into(),
            "--is-ancestor".into(),
            ancestor.to_string(),
            descendant.to_string(),
        ],
    )
    .await
    .is_ok()
}

async fn linear_rewrite_chain(repo: &Path, target: &str, head: &str) -> CommandResult<Vec<String>> {
    let mut chain = vec![target.to_string()];
    let descendants = run_git(
        Some(repo),
        vec![
            "rev-list".into(),
            "--reverse".into(),
            "--first-parent".into(),
            format!("{target}..{head}"),
        ],
    )
    .await?;
    chain.extend(
        descendants
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(ToString::to_string),
    );

    for sha in &chain {
        if commit_parent_count(repo, sha).await? > 1 {
            return invalid(
                "UNSUPPORTED_REWRITE",
                "Merge commits cannot be reworded in this guarded rewrite flow.",
            );
        }
    }

    Ok(chain)
}

async fn first_parent(repo: &Path, sha: &str) -> CommandResult<Option<String>> {
    let output = run_git(
        Some(repo),
        vec![
            "rev-list".into(),
            "--parents".into(),
            "-n".into(),
            "1".into(),
            sha.to_string(),
        ],
    )
    .await?;
    Ok(output.split_whitespace().nth(1).map(ToString::to_string))
}

async fn commit_tree_id(repo: &Path, sha: &str) -> CommandResult<String> {
    let output = run_git(
        Some(repo),
        vec![
            "show".into(),
            "-s".into(),
            "--format=%T".into(),
            sha.to_string(),
        ],
    )
    .await?;
    Ok(output.trim().to_string())
}

async fn read_commit_message(repo: &Path, sha: &str) -> CommandResult<String> {
    run_git(
        Some(repo),
        vec![
            "log".into(),
            "-1".into(),
            "--format=%B".into(),
            sha.to_string(),
        ],
    )
    .await
    .map(|message| message.trim_end().to_string())
}

async fn commit_author_meta(repo: &Path, sha: &str) -> CommandResult<CommitAuthorMeta> {
    let output = run_git(
        Some(repo),
        vec![
            "show".into(),
            "-s".into(),
            "--format=%an%x1f%ae%x1f%aI".into(),
            sha.to_string(),
        ],
    )
    .await?;
    let mut parts = output.trim_end().split('\u{1f}');
    Ok(CommitAuthorMeta {
        name: parts.next().unwrap_or_default().to_string(),
        email: parts.next().unwrap_or_default().to_string(),
        date: parts.next().unwrap_or_default().to_string(),
    })
}

async fn create_commit_with_tree(
    repo: &Path,
    tree: &str,
    parent: Option<&str>,
    message: &str,
    author: &CommitAuthorMeta,
) -> CommandResult<String> {
    let mut args = vec!["commit-tree".into(), tree.to_string()];
    if let Some(parent) = parent {
        args.extend(["-p".into(), parent.to_string()]);
    }
    args.extend(["-m".into(), message.to_string()]);
    let output = run_git_with_env(
        Some(repo),
        args,
        vec![
            ("GIT_AUTHOR_NAME", author.name.clone()),
            ("GIT_AUTHOR_EMAIL", author.email.clone()),
            ("GIT_AUTHOR_DATE", author.date.clone()),
        ],
    )
    .await?;
    Ok(output.trim().to_string())
}

async fn update_current_branch_to(
    repo: &Path,
    branch: &str,
    new_sha: &str,
    old_head: &str,
) -> CommandResult<()> {
    let branch_ref = format!("refs/heads/{branch}");
    run_git(
        Some(repo),
        vec![
            "update-ref".into(),
            branch_ref.clone(),
            new_sha.to_string(),
            old_head.to_string(),
        ],
    )
    .await?;
    run_git(
        Some(repo),
        vec!["reset".into(), "--hard".into(), branch_ref],
    )
    .await?;
    Ok(())
}

#[tauri::command]
async fn ai_openai_status() -> CommandResult<OpenAiStatus> {
    Ok(OpenAiStatus {
        configured: read_openai_api_key()?.is_some(),
    })
}

#[tauri::command]
async fn ai_openai_test_api_key() -> CommandResult<OpenAiTestResult> {
    let Some(api_key) = read_openai_api_key()? else {
        return Ok(OpenAiTestResult {
            configured: false,
            ok: false,
            message: "No OpenAI API key is saved.".to_string(),
        });
    };

    let response = reqwest::Client::new()
        .get("https://api.openai.com/v1/models")
        .bearer_auth(api_key)
        .send()
        .await;

    match response {
        Ok(response) => {
            let status = response.status();
            let body_text = response.text().await.unwrap_or_default();
            if status.is_success() {
                Ok(OpenAiTestResult {
                    configured: true,
                    ok: true,
                    message: "OpenAI API key is saved and reachable.".to_string(),
                })
            } else {
                Ok(OpenAiTestResult {
                    configured: true,
                    ok: false,
                    message: format!(
                        "OpenAI returned HTTP {status}: {}",
                        openai_error_message(&body_text)
                    ),
                })
            }
        }
        Err(error) => Ok(OpenAiTestResult {
            configured: true,
            ok: false,
            message: format!("Could not reach OpenAI: {error}"),
        }),
    }
}

#[tauri::command]
async fn ai_openai_save_api_key(api_key: String) -> CommandResult<OpenAiStatus> {
    let value = api_key.trim();
    if value.is_empty() {
        return invalid("INVALID_OPENAI_KEY", "OpenAI API key is required.");
    }
    if value.chars().any(|ch| ch.is_control()) {
        return invalid(
            "INVALID_OPENAI_KEY",
            "OpenAI API key contains unsafe characters.",
        );
    }

    let entry = openai_key_entry()?;
    entry.set_password(value).map_err(map_keyring_error)?;
    let saved = entry.get_password().map_err(map_keyring_error)?;
    if saved != value {
        return invalid(
            "OPENAI_KEY_VERIFY_FAILED",
            "OpenAI API key could not be verified after saving.",
        );
    }
    if read_openai_api_key()?.as_deref() != Some(value) {
        return invalid(
            "OPENAI_KEY_VERIFY_FAILED",
            "OpenAI API key was saved but could not be read through the normal status path.",
        );
    }
    Ok(OpenAiStatus { configured: true })
}

#[tauri::command]
async fn ai_openai_clear_api_key() -> CommandResult<OpenAiStatus> {
    let entry = openai_key_entry()?;
    match entry.delete_credential() {
        Ok(_) | Err(KeyringError::NoEntry) => Ok(OpenAiStatus { configured: false }),
        Err(error) => Err(map_keyring_error(error)),
    }
}

#[tauri::command]
async fn ai_claude_status() -> CommandResult<ClaudeStatus> {
    Ok(ClaudeStatus {
        configured: read_claude_api_key()?.is_some(),
    })
}

#[tauri::command]
async fn ai_claude_test_api_key() -> CommandResult<ClaudeTestResult> {
    let Some(api_key) = read_claude_api_key()? else {
        return Ok(ClaudeTestResult {
            configured: false,
            ok: false,
            message: "No Claude API key is saved.".to_string(),
        });
    };

    // count_tokens is free and fast; 401 means the key is bad.
    let response = reqwest::Client::new()
        .post(ANTHROPIC_COUNT_TOKENS_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .json(&json!({
            "model": CLAUDE_MODEL,
            "messages": [{"role": "user", "content": "hi"}]
        }))
        .send()
        .await;

    match response {
        Ok(response) => {
            let status = response.status();
            let body_text = response.text().await.unwrap_or_default();
            if status.is_success() {
                Ok(ClaudeTestResult {
                    configured: true,
                    ok: true,
                    message: "Claude API key is saved and reachable.".to_string(),
                })
            } else {
                Ok(ClaudeTestResult {
                    configured: true,
                    ok: false,
                    message: format!(
                        "Anthropic returned HTTP {status}: {}",
                        claude_error_message(&body_text)
                    ),
                })
            }
        }
        Err(error) => Ok(ClaudeTestResult {
            configured: true,
            ok: false,
            message: format!("Could not reach Anthropic: {error}"),
        }),
    }
}

#[tauri::command]
async fn ai_claude_save_api_key(api_key: String) -> CommandResult<ClaudeStatus> {
    let value = api_key.trim();
    if value.is_empty() {
        return invalid("INVALID_CLAUDE_KEY", "Claude API key is required.");
    }
    if value.chars().any(|ch| ch.is_control()) {
        return invalid(
            "INVALID_CLAUDE_KEY",
            "Claude API key contains unsafe characters.",
        );
    }

    let entry = claude_key_entry()?;
    entry.set_password(value).map_err(map_keyring_error)?;
    if read_claude_api_key()?.as_deref() != Some(value) {
        return invalid(
            "CLAUDE_KEY_VERIFY_FAILED",
            "Claude API key was saved but could not be read through the normal status path.",
        );
    }
    Ok(ClaudeStatus { configured: true })
}

#[tauri::command]
async fn ai_claude_clear_api_key() -> CommandResult<ClaudeStatus> {
    let entry = claude_key_entry()?;
    match entry.delete_credential() {
        Ok(_) | Err(KeyringError::NoEntry) => Ok(ClaudeStatus { configured: false }),
        Err(error) => Err(map_keyring_error(error)),
    }
}

#[tauri::command]
async fn azure_devops_status() -> CommandResult<AzureDevOpsStatus> {
    Ok(AzureDevOpsStatus {
        configured: read_azure_devops_pat()?.is_some(),
    })
}

#[tauri::command]
async fn azure_devops_save_pat(pat: String) -> CommandResult<AzureDevOpsStatus> {
    let value = pat.trim();
    if value.is_empty() {
        return invalid("INVALID_AZURE_DEVOPS_PAT", "Azure DevOps PAT is required.");
    }
    if value.chars().any(|ch| ch.is_control()) {
        return invalid(
            "INVALID_AZURE_DEVOPS_PAT",
            "Azure DevOps PAT contains unsafe characters.",
        );
    }

    let entry = azure_devops_pat_entry()?;
    entry.set_password(value).map_err(map_keyring_error)?;
    if read_azure_devops_pat()?.as_deref() != Some(value) {
        return invalid(
            "AZURE_DEVOPS_PAT_VERIFY_FAILED",
            "Azure DevOps PAT was saved but could not be read through the normal status path.",
        );
    }
    Ok(AzureDevOpsStatus { configured: true })
}

#[tauri::command]
async fn azure_devops_clear_pat() -> CommandResult<AzureDevOpsStatus> {
    let entry = azure_devops_pat_entry()?;
    match entry.delete_credential() {
        Ok(_) | Err(KeyringError::NoEntry) => Ok(AzureDevOpsStatus { configured: false }),
        Err(error) => Err(map_keyring_error(error)),
    }
}

#[tauri::command]
async fn github_status() -> CommandResult<GithubStatus> {
    Ok(GithubStatus {
        configured: read_github_pat()?.is_some(),
        login: None,
        name: None,
    })
}

#[tauri::command]
async fn github_save_pat(pat: String) -> CommandResult<GithubStatus> {
    let value = pat.trim();
    if value.is_empty() {
        return invalid("INVALID_GITHUB_PAT", "GitHub PAT is required.");
    }
    if value.chars().any(|ch| ch.is_control()) {
        return invalid("INVALID_GITHUB_PAT", "GitHub PAT contains unsafe characters.");
    }

    // Validate before storing so a mistyped token never lands in the keychain.
    let user: GithubUserWire =
        github_get_json(&reqwest::Client::new(), &format!("{GITHUB_API_BASE}/user"), value).await?;

    let entry = github_pat_entry()?;
    entry.set_password(value).map_err(map_keyring_error)?;
    if read_github_pat()?.as_deref() != Some(value) {
        return invalid(
            "GITHUB_PAT_VERIFY_FAILED",
            "GitHub PAT was saved but could not be read through the normal status path.",
        );
    }
    Ok(GithubStatus {
        configured: true,
        login: Some(user.login),
        name: user.name,
    })
}

#[tauri::command]
async fn github_clear_pat() -> CommandResult<GithubStatus> {
    let entry = github_pat_entry()?;
    match entry.delete_credential() {
        Ok(_) | Err(KeyringError::NoEntry) => Ok(GithubStatus {
            configured: false,
            login: None,
            name: None,
        }),
        Err(error) => Err(map_keyring_error(error)),
    }
}

#[tauri::command]
async fn provider_accounts_status() -> CommandResult<Vec<ProviderAccountStatus>> {
    Ok(vec![
        ProviderAccountStatus {
            provider: GitProvider::AzureDevops,
            configured: false,
            status: ProviderConnectionStatus::Unavailable,
            label: "Azure DevOps".to_string(),
            detail: Some(
                "OpenGit checks the keychain only when you save a PAT or use Azure DevOps."
                    .to_string(),
            ),
        },
        ProviderAccountStatus {
            provider: GitProvider::Github,
            configured: false,
            status: ProviderConnectionStatus::Unavailable,
            label: "GitHub".to_string(),
            detail: Some(
                "OpenGit checks the keychain only when you save a PAT or use GitHub.".to_string(),
            ),
        },
    ])
}

#[tauri::command]
async fn provider_repos_list(request: ProviderReposListRequest) -> CommandResult<ProviderRepoCatalog> {
    match request.provider {
        GitProvider::AzureDevops => list_azure_devops_repositories(request.local_paths).await,
        GitProvider::Github => list_github_repositories(request.local_paths).await,
        _ => Err(AppError::ProviderFailed {
            code: "PROVIDER_UNAVAILABLE",
            message: "This provider is not supported yet.".to_string(),
            detail: "Only Azure DevOps and GitHub repository management are implemented.".to_string(),
        }),
    }
}

#[tauri::command]
async fn ai_commit_message_generate(
    repo_path: String,
    model: Option<String>,
    provider: Option<String>,
) -> CommandResult<AiCommitSuggestion> {
    let repo = resolve_repo_root(&repo_path).await?;
    let backend = resolve_ai_backend(provider, model)?;
    let staged_context = build_staged_commit_context(&repo).await?;
    let output = request_ai_output_text(
        &backend,
        "You write concise Git commit messages from staged diffs. Return only JSON with keys summary and description. summary must be one line, preferably Conventional Commits style. description should be a short markdown body with 1-4 bullets when useful. Do not invent files or behavior not shown in the staged diff.",
        staged_context,
        1200,
    )
    .await?;

    parse_commit_suggestion_text(&output)
}

#[tauri::command]
async fn ai_branch_name_generate(
    repo_path: String,
    model: Option<String>,
) -> CommandResult<AiBranchNameSuggestion> {
    let repo = resolve_repo_root(&repo_path).await?;
    let api_key = read_openai_api_key()?.ok_or_else(|| AppError::InvalidInput {
        code: "OPENAI_KEY_MISSING",
        message:
            "Add an OpenAI API key in Preferences > Integrations before generating branch names."
                .to_string(),
    })?;
    let model = validate_openai_model(model)?;
    let context = build_change_context(&repo, "branch name").await?;
    let body_text = request_openai_response_body(
        &api_key,
        &model,
        "You create concise Git branch names from repository changes. Return only JSON with key name. The name must be lowercase kebab-case, may include one slash prefix like feature/, fix/, chore/, docs/, refactor/, or wip/, must not contain spaces, and must be no more than 48 characters. Do not invent work not shown in the Git context.",
        context,
        400,
    )
    .await?;

    parse_openai_branch_response(&body_text)
}

#[tauri::command]
async fn ai_pr_description_generate(
    repo_path: String,
    model: Option<String>,
    provider: Option<String>,
) -> CommandResult<AiPrDescriptionSuggestion> {
    let repo = resolve_repo_root(&repo_path).await?;
    let backend = resolve_ai_backend(provider, model)?;
    let context = build_pr_context(&repo).await?;
    let output = request_ai_output_text(
        &backend,
        "You draft practical pull request copy from Git history and diffs. Return only JSON with keys title and description. title must be concise. description must use markdown with a short Summary section and a Testing section. Do not invent product behavior, tickets, reviewers, or test results not shown in the context.",
        context,
        1400,
    )
    .await?;

    parse_pr_suggestion_text(&output)
}

#[tauri::command]
async fn ai_branch_explain(
    repo_path: String,
    branch: String,
    model: Option<String>,
    provider: Option<String>,
) -> CommandResult<AiBranchExplanation> {
    let repo = resolve_repo_root(&repo_path).await?;
    validate_ref_arg(&branch, "branch name")?;
    let backend = resolve_ai_backend(provider, model)?;
    let (base, context) = build_branch_explain_context(&repo, &branch).await?;
    let output = request_ai_output_text(
        &backend,
        "You explain Git branch changes to a developer reviewing the branch. Return only markdown, no JSON and no code fences around the whole answer. Start with a one-paragraph summary of what the branch does, then a short bulleted list of the notable changes grouped by area. Keep it concise. Do not invent behavior, files, or intent not shown in the Git context.",
        context,
        1400,
    )
    .await?;
    let markdown = output.trim().to_string();
    if markdown.is_empty() {
        return Err(AppError::AiFailed {
            message: "OpenAI did not return an explanation.".to_string(),
            detail: String::new(),
        });
    }

    Ok(AiBranchExplanation {
        branch,
        base,
        markdown,
    })
}

#[tauri::command]
async fn git_branch_create(request: BranchCreateRequest) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&request.repo_path).await?;
    validate_ref_arg(&request.name, "branch name")?;
    let mut args = vec!["branch".into(), request.name.clone()];
    if let Some(start_point) = request.start_point.filter(|value| !value.trim().is_empty()) {
        validate_ref_arg(&start_point, "branch start point")?;
        args.push(start_point);
    }
    run_git_with_safety_snapshot(&repo, "before branch create", args).await?;
    if request.checkout {
        run_git_with_safety_snapshot(
            &repo,
            "before checkout",
            vec!["checkout".into(), request.name],
        )
        .await?;
    }
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_branch_checkout(repo_path: String, name: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    validate_ref_arg(&name, "branch name")?;
    run_git_with_safety_snapshot(&repo, "before checkout", vec!["checkout".into(), name]).await?;
    build_snapshot(&repo, None).await
}

/// Split a remote-tracking ref's short name (e.g. `origin/feature/foo`) into its
/// remote (`origin`) and local branch name (`feature/foo`) by matching against the
/// repository's configured remotes. Returns None if no known remote is a prefix.
async fn split_remote_ref(repo: &Path, remote_ref: &str) -> Option<(String, String)> {
    let remotes = run_git(Some(repo), vec!["remote".into()]).await.ok()?;
    remotes
        .lines()
        .map(str::trim)
        .filter(|remote| !remote.is_empty())
        .find_map(|remote| {
            remote_ref
                .strip_prefix(remote)
                .and_then(|rest| rest.strip_prefix('/'))
                .filter(|local| !local.is_empty())
                .map(|local| (remote.to_string(), local.to_string()))
        })
}

/// Check out a remote branch the way a Git desktop client should: create a local
/// tracking branch when none exists, or switch to the existing local branch and
/// fast-forward it up to the remote-tracking ref when it is a clean fast-forward.
/// Never force-updates a diverged local branch.
#[tauri::command]
async fn git_branch_checkout_remote(
    repo_path: String,
    remote_ref: String,
) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    validate_ref_arg(&remote_ref, "remote branch")?;

    let (_remote, local) = split_remote_ref(&repo, &remote_ref).await.ok_or_else(|| {
        AppError::InvalidInput {
            code: "UNKNOWN_REMOTE_BRANCH",
            message: format!("'{remote_ref}' is not a known remote branch."),
        }
    })?;

    let tracking_ref = format!("refs/remotes/{remote_ref}");
    if !git_ref_exists(&repo, &tracking_ref).await {
        return Err(AppError::InvalidInput {
            code: "UNKNOWN_REMOTE_BRANCH",
            message: format!("Remote branch '{remote_ref}' no longer exists. Fetch and try again."),
        });
    }

    let local_ref = format!("refs/heads/{local}");
    if git_ref_exists(&repo, &local_ref).await {
        // Switch to the existing local branch, then fast-forward only if it is
        // strictly behind the remote (local is an ancestor of the tracking ref).
        run_git_with_safety_snapshot(
            &repo,
            "before checkout",
            vec!["checkout".into(), local.clone()],
        )
        .await?;

        let can_fast_forward = run_git(
            Some(&repo),
            vec![
                "merge-base".into(),
                "--is-ancestor".into(),
                local_ref,
                tracking_ref.clone(),
            ],
        )
        .await
        .is_ok();

        if can_fast_forward {
            run_git(
                Some(&repo),
                vec!["merge".into(), "--ff-only".into(), tracking_ref],
            )
            .await?;
        }
    } else {
        // No local branch yet: create one at the remote tip with tracking set.
        run_git_with_safety_snapshot(
            &repo,
            "before checkout",
            vec![
                "switch".into(),
                "--create".into(),
                local,
                "--track".into(),
                remote_ref,
            ],
        )
        .await?;
    }

    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_branch_delete(
    repo_path: String,
    name: String,
    force: bool,
) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    validate_ref_arg(&name, "branch name")?;
    let delete_arg = if force { "-D" } else { "-d" };
    run_git_with_safety_snapshot(
        &repo,
        "before branch delete",
        vec!["branch".into(), delete_arg.into(), name],
    )
    .await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_branch_rename(
    repo_path: String,
    old_name: String,
    new_name: String,
) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    validate_ref_arg(&old_name, "branch name")?;
    validate_ref_arg(&new_name, "new branch name")?;
    run_git_with_safety_snapshot(
        &repo,
        "before branch rename",
        vec!["branch".into(), "-m".into(), old_name.clone(), new_name.clone()],
    )
    .await?;
    let mut stacks = read_branch_stacks(&repo).await?;
    for stack in &mut stacks {
        if stack.trunk == old_name {
            stack.trunk = new_name.clone();
        }
        for item in &mut stack.items {
            if item.branch == old_name {
                item.branch = new_name.clone();
            }
            if item.base_branch == old_name {
                item.base_branch = new_name.clone();
            }
        }
        stack.updated_at = now_millis().to_string();
    }
    write_branch_stacks(&repo, &stacks).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_branch_inspect(
    repo_path: String,
    branch_ref: String,
) -> CommandResult<BranchInspection> {
    let repo = resolve_repo_root(&repo_path).await?;
    inspect_branch(&repo, &branch_ref).await
}

#[tauri::command]
async fn git_stack_list(repo_path: String) -> CommandResult<Vec<BranchStack>> {
    let repo = resolve_repo_root(&repo_path).await?;
    let branches = parse_branches(
        &run_git(
            Some(&repo),
            vec![
                "branch".into(),
                "--all".into(),
                "--format=%(refname:short)%1f%(refname)%1f%(upstream:short)%1f%(HEAD)".into(),
            ],
        )
        .await?,
        0,
        0,
    );
    Ok(enriched_branch_stacks(&repo, &branches).await)
}

#[tauri::command]
async fn git_stack_create(request: StackCreateRequest) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&request.repo_path).await?;
    validate_ref_arg(&request.trunk, "stack trunk")?;
    if !git_ref_exists(&repo, &request.trunk).await {
        return invalid("INVALID_REF", "Stack trunk branch does not exist.");
    }
    let mut branches = Vec::new();
    for branch in request.branches {
        validate_ref_arg(&branch, "stack branch")?;
        if branch != request.trunk && git_ref_exists(&repo, &branch).await {
            branches.push(branch);
        }
    }
    branches.dedup();
    let now = now_millis().to_string();
    let mut stack = BranchStack {
        id: metadata_id("stack", &request.name),
        name: truncate_display_text(request.name.trim(), 80),
        trunk: request.trunk,
        items: branches
            .into_iter()
            .enumerate()
            .map(|(index, branch)| BranchStackItem {
                id: metadata_id("stack-item", &branch),
                branch,
                base_branch: String::new(),
                order: index,
                head_sha: None,
                upstream: None,
                pr_ref: None,
                status: BranchStackItemStatus::Unknown,
            })
            .collect(),
        status: BranchStackStatus::Unknown,
        last_operation: Some("Stack created".to_string()),
        created_at: now.clone(),
        updated_at: now,
    };
    stack_resequence_items(&mut stack);
    let mut stacks = read_branch_stacks(&repo).await?;
    stacks.push(stack);
    write_branch_stacks(&repo, &stacks).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_stack_create_child(request: StackCreateChildRequest) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&request.repo_path).await?;
    let stack_id = validate_metadata_id(&request.stack_id, "stack id")?;
    validate_ref_arg(&request.base_branch, "base branch")?;
    validate_ref_arg(&request.new_branch_name, "new branch name")?;
    create_safety_snapshot(&repo, "before stack child branch").await?;
    run_git(
        Some(&repo),
        vec![
            "branch".into(),
            request.new_branch_name.clone(),
            request.base_branch.clone(),
        ],
    )
    .await?;

    let mut stacks = read_branch_stacks(&repo).await?;
    let stack = find_stack_mut(&mut stacks, &stack_id)?;
    let insert_at = stack
        .items
        .iter()
        .position(|item| item.branch == request.base_branch)
        .map(|index| index + 1)
        .unwrap_or(0);
    stack.items.insert(
        insert_at,
        BranchStackItem {
            id: metadata_id("stack-item", &request.new_branch_name),
            branch: request.new_branch_name,
            base_branch: request.base_branch,
            order: insert_at,
            head_sha: None,
            upstream: None,
            pr_ref: None,
            status: BranchStackItemStatus::Unknown,
        },
    );
    stack.last_operation = Some("Child branch created".to_string());
    stack_resequence_items(stack);
    write_branch_stacks(&repo, &stacks).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_stack_add_branch(request: StackAddBranchRequest) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&request.repo_path).await?;
    let stack_id = validate_metadata_id(&request.stack_id, "stack id")?;
    validate_ref_arg(&request.branch, "stack branch")?;
    if !git_ref_exists(&repo, &request.branch).await {
        return invalid("INVALID_REF", "Branch does not exist.");
    }
    let mut stacks = read_branch_stacks(&repo).await?;
    let stack = find_stack_mut(&mut stacks, &stack_id)?;
    if stack.trunk == request.branch || stack.items.iter().any(|item| item.branch == request.branch) {
        return invalid("STACK_DUPLICATE_BRANCH", "That branch is already in this stack.");
    }
    let order = stack.items.len();
    let base_branch = stack
        .items
        .last()
        .map(|item| item.branch.clone())
        .unwrap_or_else(|| stack.trunk.clone());
    stack.items.push(BranchStackItem {
        id: metadata_id("stack-item", &request.branch),
        branch: request.branch.clone(),
        base_branch,
        order,
        head_sha: None,
        upstream: None,
        pr_ref: None,
        status: BranchStackItemStatus::Unknown,
    });
    stack.last_operation = Some(format!("Added {} to stack", request.branch));
    stack_resequence_items(stack);
    write_branch_stacks(&repo, &stacks).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_stack_reorder(request: StackReorderRequest) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&request.repo_path).await?;
    let stack_id = validate_metadata_id(&request.stack_id, "stack id")?;
    let mut stacks = read_branch_stacks(&repo).await?;
    let stack = find_stack_mut(&mut stacks, &stack_id)?;
    let mut reordered = Vec::new();
    for branch in request.ordered_branch_names {
        validate_ref_arg(&branch, "stack branch")?;
        if let Some(index) = stack.items.iter().position(|item| item.branch == branch) {
            reordered.push(stack.items.remove(index));
        }
    }
    reordered.extend(stack.items.drain(..));
    stack.items = reordered;
    stack.last_operation = Some("Stack order updated".to_string());
    stack_resequence_items(stack);
    write_branch_stacks(&repo, &stacks).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_stack_remove_branch(
    repo_path: String,
    stack_id: String,
    branch: String,
) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    let stack_id = validate_metadata_id(&stack_id, "stack id")?;
    validate_ref_arg(&branch, "stack branch")?;
    let mut stacks = read_branch_stacks(&repo).await?;
    let stack = find_stack_mut(&mut stacks, &stack_id)?;
    stack.items.retain(|item| item.branch != branch);
    stack.last_operation = Some(format!("Removed {branch} from stack"));
    stack_resequence_items(stack);
    write_branch_stacks(&repo, &stacks).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_stack_restack(repo_path: String, stack_id: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    let stack_id = validate_metadata_id(&stack_id, "stack id")?;
    ensure_clean_worktree(&repo, "Restack").await?;
    let mut stacks = read_branch_stacks(&repo).await?;
    let stack = find_stack_mut(&mut stacks, &stack_id)?.clone();
    let original_branch = current_branch_name(&repo).await;
    create_safety_snapshot(&repo, "before stack restack").await?;

    for item in &stack.items {
        let operation = GitWorkflowOperation {
            id: metadata_id("operation", "stack-restack"),
            kind: GitWorkflowOperationKind::StackRestack,
            label: format!("Restacking {} onto {}", item.branch, item.base_branch),
            status: GitWorkflowOperationStatus::Running,
            stack_id: Some(stack.id.clone()),
            lane_id: None,
            branch: Some(item.branch.clone()),
            base_branch: Some(item.base_branch.clone()),
            created_at: now_millis().to_string(),
        };
        write_active_operation(&repo, &operation).await?;
        run_git(Some(&repo), vec!["checkout".into(), item.branch.clone()]).await?;
        if let Err(error) = run_git(Some(&repo), vec!["rebase".into(), item.base_branch.clone()]).await {
            let mut conflicted = operation;
            conflicted.status = GitWorkflowOperationStatus::Conflicted;
            write_active_operation(&repo, &conflicted).await?;
            if let Some(snapshot) = snapshot_for_interrupted_operation(&repo).await? {
                return Ok(snapshot);
            }
            return Err(error);
        }
    }

    clear_active_operation(&repo).await?;
    if let Some(branch) = original_branch {
        if branch != "(detached)" && branch != "HEAD" {
            run_git(Some(&repo), vec!["checkout".into(), branch]).await?;
        }
    }
    let stack = find_stack_mut(&mut stacks, &stack_id)?;
    stack.last_operation = Some("Restack complete".to_string());
    stack.updated_at = now_millis().to_string();
    write_branch_stacks(&repo, &stacks).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_stack_sync_trunk(repo_path: String, stack_id: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    let stack_id = validate_metadata_id(&stack_id, "stack id")?;
    ensure_clean_worktree(&repo, "Sync trunk").await?;
    let mut stacks = read_branch_stacks(&repo).await?;
    let stack = find_stack_mut(&mut stacks, &stack_id)?.clone();
    create_safety_snapshot(&repo, "before stack trunk sync").await?;
    let original_branch = current_branch_name(&repo).await;
    run_git(Some(&repo), vec!["checkout".into(), stack.trunk.clone()]).await?;
    run_git(Some(&repo), vec!["pull".into(), "--ff-only".into()]).await?;
    if let Some(branch) = original_branch {
        if branch != stack.trunk && branch != "(detached)" && branch != "HEAD" {
            run_git(Some(&repo), vec!["checkout".into(), branch]).await?;
        }
    }
    let stack = find_stack_mut(&mut stacks, &stack_id)?;
    stack.last_operation = Some("Trunk synced".to_string());
    stack.updated_at = now_millis().to_string();
    write_branch_stacks(&repo, &stacks).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_stack_push(repo_path: String, stack_id: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    let stack_id = validate_metadata_id(&stack_id, "stack id")?;
    let mut stacks = read_branch_stacks(&repo).await?;
    let stack = find_stack_mut(&mut stacks, &stack_id)?.clone();
    let remotes = parse_remotes(&run_git(Some(&repo), vec!["remote".into(), "-v".into()]).await?);
    let remote = remotes
        .first()
        .ok_or_else(|| AppError::InvalidInput {
            code: "REMOTE_MISSING",
            message: "Add a remote before pushing a stack.".to_string(),
        })?
        .name
        .clone();
    create_safety_snapshot(&repo, "before stack push").await?;
    for item in &stack.items {
        run_git(
            Some(&repo),
            vec![
                "push".into(),
                "-u".into(),
                remote.clone(),
                item.branch.clone(),
            ],
        )
        .await?;
    }
    let stack = find_stack_mut(&mut stacks, &stack_id)?;
    stack.last_operation = Some("Stack pushed".to_string());
    stack.updated_at = now_millis().to_string();
    write_branch_stacks(&repo, &stacks).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_lane_list(repo_path: String) -> CommandResult<Vec<ParallelLane>> {
    let repo = resolve_repo_root(&repo_path).await?;
    read_parallel_lanes(&repo).await
}

#[tauri::command]
async fn git_lane_create(request: LaneCreateRequest) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&request.repo_path).await?;
    validate_ref_arg(&request.target_branch, "target branch")?;
    if !git_ref_exists(&repo, &request.target_branch).await {
        return invalid("INVALID_REF", "Lane target branch does not exist.");
    }
    let base_head = branch_head_sha(&repo, &request.target_branch)
        .await
        .unwrap_or_default();
    create_safety_snapshot(&repo, "before parallel lane create").await?;
    let now = now_millis().to_string();
    let mut lane = ParallelLane {
        id: metadata_id("lane", &request.name),
        name: truncate_display_text(request.name.trim(), 72),
        target_branch: request.target_branch,
        base_head,
        applied: false,
        status: ParallelLaneStatus::Clean,
        paths: Vec::new(),
        created_at: now.clone(),
        updated_at: now,
    };
    capture_paths_into_lane(&repo, &mut lane, &request.paths).await?;
    let mut lanes = read_parallel_lanes(&repo).await?;
    lanes.push(lane);
    write_parallel_lanes(&repo, &lanes).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_lane_assign_paths(request: LaneAssignPathsRequest) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&request.repo_path).await?;
    let lane_id = validate_metadata_id(&request.lane_id, "lane id")?;
    create_safety_snapshot(&repo, "before assign to parallel lane").await?;
    let mut lanes = read_parallel_lanes(&repo).await?;
    let lane = find_lane_mut(&mut lanes, &lane_id)?;
    if lane.applied {
        return invalid("LANE_APPLIED", "Unapply this lane before assigning more files to it.");
    }
    capture_paths_into_lane(&repo, lane, &request.paths).await?;
    write_parallel_lanes(&repo, &lanes).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_lane_apply(repo_path: String, lane_id: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    let lane_id = validate_metadata_id(&lane_id, "lane id")?;
    create_safety_snapshot(&repo, "before parallel lane apply").await?;
    let mut lanes = read_parallel_lanes(&repo).await?;
    let lane = find_lane_mut(&mut lanes, &lane_id)?;
    let operation = GitWorkflowOperation {
        id: metadata_id("operation", "lane-apply"),
        kind: GitWorkflowOperationKind::LaneApply,
        label: format!("Applying lane {}", lane.name),
        status: GitWorkflowOperationStatus::Running,
        stack_id: None,
        lane_id: Some(lane.id.clone()),
        branch: Some(lane.target_branch.clone()),
        base_branch: None,
        created_at: now_millis().to_string(),
    };
    write_active_operation(&repo, &operation).await?;
    if let Err(error) = apply_lane_internal(&repo, lane).await {
        lane.status = ParallelLaneStatus::Blocked;
        let mut blocked = operation;
        blocked.status = GitWorkflowOperationStatus::Blocked;
        write_active_operation(&repo, &blocked).await?;
        write_parallel_lanes(&repo, &lanes).await?;
        return Err(error);
    }
    clear_active_operation(&repo).await?;
    write_parallel_lanes(&repo, &lanes).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_lane_unapply(repo_path: String, lane_id: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    let lane_id = validate_metadata_id(&lane_id, "lane id")?;
    create_safety_snapshot(&repo, "before parallel lane unapply").await?;
    let mut lanes = read_parallel_lanes(&repo).await?;
    let lane = find_lane_mut(&mut lanes, &lane_id)?;
    let operation = GitWorkflowOperation {
        id: metadata_id("operation", "lane-unapply"),
        kind: GitWorkflowOperationKind::LaneUnapply,
        label: format!("Unapplying lane {}", lane.name),
        status: GitWorkflowOperationStatus::Running,
        stack_id: None,
        lane_id: Some(lane.id.clone()),
        branch: Some(lane.target_branch.clone()),
        base_branch: None,
        created_at: now_millis().to_string(),
    };
    write_active_operation(&repo, &operation).await?;
    if let Err(error) = unapply_lane_internal(&repo, lane).await {
        lane.status = ParallelLaneStatus::Blocked;
        let mut blocked = operation;
        blocked.status = GitWorkflowOperationStatus::Blocked;
        write_active_operation(&repo, &blocked).await?;
        write_parallel_lanes(&repo, &lanes).await?;
        return Err(error);
    }
    clear_active_operation(&repo).await?;
    write_parallel_lanes(&repo, &lanes).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_lane_commit(request: LaneCommitRequest) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&request.repo_path).await?;
    if request.message.trim().is_empty() {
        return invalid("EMPTY_COMMIT_MESSAGE", "Commit message is required.");
    }
    let lane_id = validate_metadata_id(&request.lane_id, "lane id")?;
    create_safety_snapshot(&repo, "before parallel lane commit").await?;
    let mut lanes = read_parallel_lanes(&repo).await?;
    let lane = find_lane_mut(&mut lanes, &lane_id)?;
    let current = current_branch_name(&repo).await.unwrap_or_default();
    if current != lane.target_branch {
        return invalid("LANE_TARGET_BRANCH", "Checkout the lane target branch before committing this lane.");
    }
    if !lane.applied {
        apply_lane_internal(&repo, lane).await?;
    }
    let paths = lane.paths.iter().map(|path| path.path.clone()).collect::<Vec<_>>();
    run_git(Some(&repo), git_args_with_paths(&["add"], &paths)).await?;
    run_git(
        Some(&repo),
        vec!["commit".into(), "-m".into(), request.message.trim().to_string()],
    )
    .await?;
    lane.applied = false;
    lane.status = ParallelLaneStatus::Committed;
    lane.updated_at = now_millis().to_string();
    write_parallel_lanes(&repo, &lanes).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_lane_discard(repo_path: String, lane_id: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    let lane_id = validate_metadata_id(&lane_id, "lane id")?;
    create_safety_snapshot(&repo, "before parallel lane discard").await?;
    let mut lanes = read_parallel_lanes(&repo).await?;
    if let Some(index) = lanes.iter().position(|lane| lane.id == lane_id) {
        let mut lane = lanes[index].clone();
        if lane.applied {
            unapply_lane_internal(&repo, &mut lane).await?;
        }
        let dir = lane_dir(&repo, &lane_id).await?;
        if dir.exists() {
            fs::remove_dir_all(dir)?;
        }
        lanes.remove(index);
    }
    write_parallel_lanes(&repo, &lanes).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_lane_materialize_branch(request: LaneMaterializeBranchRequest) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&request.repo_path).await?;
    validate_ref_arg(&request.branch_name, "branch name")?;
    let lane_id = validate_metadata_id(&request.lane_id, "lane id")?;
    if git_ref_exists(&repo, &format!("refs/heads/{}", request.branch_name)).await {
        return invalid("BRANCH_EXISTS", "A branch with that name already exists.");
    }
    ensure_clean_worktree(&repo, "Materialize lane").await?;
    create_safety_snapshot(&repo, "before materialize parallel lane").await?;
    let mut lanes = read_parallel_lanes(&repo).await?;
    let lane = find_lane_mut(&mut lanes, &lane_id)?;
    run_git(
        Some(&repo),
        vec![
            "checkout".into(),
            "-b".into(),
            request.branch_name.clone(),
            lane.target_branch.clone(),
        ],
    )
    .await?;
    lane.target_branch = request.branch_name;
    apply_lane_internal(&repo, lane).await?;
    write_parallel_lanes(&repo, &lanes).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_fetch(repo_path: String, remote: Option<String>) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    let mut args = vec!["fetch".into()];
    if let Some(remote_name) = remote.filter(|value| !value.trim().is_empty()) {
        validate_ref_arg(&remote_name, "remote name")?;
        args.push(remote_name);
    }
    run_git(Some(&repo), args).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_pull(repo_path: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    run_git_snapshot_operation(
        &repo,
        "before pull",
        vec!["pull".into(), "--ff".into(), "--no-edit".into()],
    )
    .await
}

#[tauri::command]
async fn git_pull_fast_forward(repo_path: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    run_git_snapshot_operation(
        &repo,
        "before fast-forward pull",
        vec!["pull".into(), "--ff".into(), "--no-edit".into()],
    )
    .await
}

#[tauri::command]
async fn git_pull_rebase(repo_path: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    run_git_snapshot_operation(
        &repo,
        "before pull rebase",
        vec!["pull".into(), "--rebase".into()],
    )
    .await
}

#[tauri::command]
async fn git_merge(repo_path: String, branch: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    validate_ref_arg(&branch, "branch name")?;
    run_git_snapshot_operation(
        &repo,
        "before merge",
        vec!["merge".into(), "--no-edit".into(), branch],
    )
    .await
}

#[tauri::command]
async fn git_rebase(repo_path: String, upstream: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    validate_ref_arg(&upstream, "upstream branch")?;
    run_git_snapshot_operation(&repo, "before rebase", vec!["rebase".into(), upstream]).await
}

#[tauri::command]
async fn git_cherry_pick(repo_path: String, commit_sha: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    validate_ref_arg(&commit_sha, "commit")?;
    run_git_snapshot_operation(
        &repo,
        "before cherry-pick",
        vec!["cherry-pick".into(), commit_sha],
    )
    .await
}

#[tauri::command]
async fn git_revert(repo_path: String, commit_sha: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    validate_ref_arg(&commit_sha, "commit")?;
    run_git_snapshot_operation(
        &repo,
        "before revert",
        vec!["revert".into(), "--no-edit".into(), commit_sha],
    )
    .await
}

#[tauri::command]
async fn git_conflict_versions(repo_path: String, path: String) -> CommandResult<ConflictVersions> {
    let repo = resolve_repo_root(&repo_path).await?;
    let mut safe_paths = validate_file_paths(&[path])?;
    let path = safe_paths.remove(0);
    // A missing file is a valid delete-side conflict; any other read failure must
    // surface instead of rendering the pane as silently empty.
    let working = match std::fs::read_to_string(repo.join(&path)) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(error.into()),
    };
    let diff = run_git(
        Some(&repo),
        vec![
            "diff".into(),
            "--no-ext-diff".into(),
            "--minimal".into(),
            "--".into(),
            path.clone(),
        ],
    )
    .await
    .unwrap_or_default();

    Ok(ConflictVersions {
        base: git_show_stage(&repo, 1, &path).await.unwrap_or_default(),
        ours: git_show_stage(&repo, 2, &path).await.unwrap_or_default(),
        theirs: git_show_stage(&repo, 3, &path).await.unwrap_or_default(),
        working,
        diff,
        path,
    })
}

#[tauri::command]
async fn git_conflict_resolve(
    repo_path: String,
    path: String,
    strategy: String,
) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    let mut safe_paths = validate_file_paths(&[path])?;
    let path = safe_paths.remove(0);
    match strategy.as_str() {
        "ours" => {
            run_git_with_safety_snapshot(
                &repo,
                "before conflict resolve",
                vec![
                    "checkout".into(),
                    "--ours".into(),
                    "--".into(),
                    path.clone(),
                ],
            )
            .await?;
        }
        "theirs" => {
            run_git_with_safety_snapshot(
                &repo,
                "before conflict resolve",
                vec![
                    "checkout".into(),
                    "--theirs".into(),
                    "--".into(),
                    path.clone(),
                ],
            )
            .await?;
        }
        "both" => {
            create_safety_snapshot(&repo, "before conflict resolve").await?;
            let ours = git_show_stage(&repo, 2, &path).await.unwrap_or_default();
            let theirs = git_show_stage(&repo, 3, &path).await.unwrap_or_default();
            // Both stages empty means the content could not be read at all; writing
            // an empty resolution would silently discard both sides.
            if ours.is_empty() && theirs.is_empty() {
                return invalid(
                    "CONFLICT_CONTENT_UNAVAILABLE",
                    "Could not read either side of the conflict; resolve it manually instead.",
                );
            }
            let combined = combine_conflict_sides(&ours, &theirs);
            std::fs::write(repo.join(&path), combined)?;
        }
        _ => {
            return invalid(
                "INVALID_CONFLICT_STRATEGY",
                "Conflict strategy must be ours, theirs, or both.",
            );
        }
    }

    run_git(Some(&repo), vec!["add".into(), "--".into(), path]).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_conflict_mark_resolved(
    repo_path: String,
    path: String,
) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    let mut safe_paths = validate_file_paths(&[path])?;
    let path = safe_paths.remove(0);
    run_git_with_safety_snapshot(
        &repo,
        "before mark resolved",
        vec!["add".into(), "--".into(), path],
    )
    .await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_operation_continue(repo_path: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    let result = match detect_git_operation(&repo).await {
        GitOperationState::Rebasing => {
            run_git_snapshot_operation(
                &repo,
                "before rebase continue",
                vec!["rebase".into(), "--continue".into()],
            )
            .await
        }
        GitOperationState::CherryPicking => {
            run_git_snapshot_operation(
                &repo,
                "before cherry-pick continue",
                vec!["cherry-pick".into(), "--continue".into()],
            )
            .await
        }
        GitOperationState::Merging => {
            run_git_snapshot_operation(
                &repo,
                "before merge continue",
                vec!["commit".into(), "--no-edit".into()],
            )
            .await
        }
        GitOperationState::None => invalid(
            "NO_GIT_OPERATION",
            "There is no merge, rebase, or cherry-pick to continue.",
        ),
    };
    if result.is_ok() {
        let _ = clear_active_operation(&repo).await;
    }
    result
}

#[tauri::command]
async fn git_operation_abort(repo_path: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    match detect_git_operation(&repo).await {
        GitOperationState::Rebasing => {
            run_git_with_safety_snapshot(
                &repo,
                "before rebase abort",
                vec!["rebase".into(), "--abort".into()],
            )
            .await?;
        }
        GitOperationState::CherryPicking => {
            run_git_with_safety_snapshot(
                &repo,
                "before cherry-pick abort",
                vec!["cherry-pick".into(), "--abort".into()],
            )
            .await?;
        }
        GitOperationState::Merging => {
            run_git_with_safety_snapshot(
                &repo,
                "before merge abort",
                vec!["merge".into(), "--abort".into()],
            )
            .await?;
        }
        GitOperationState::None => {
            return invalid(
                "NO_GIT_OPERATION",
                "There is no merge, rebase, or cherry-pick to abort.",
            );
        }
    }

    clear_active_operation(&repo).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_tag_create(
    repo_path: String,
    name: String,
    target: String,
    message: Option<String>,
) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    validate_ref_arg(&name, "tag name")?;
    validate_ref_arg(&target, "tag target")?;

    let mut args = vec!["tag".into()];
    if let Some(message_value) = message.filter(|value| !value.trim().is_empty()) {
        args.extend(["-a".into(), name, target, "-m".into(), message_value]);
    } else {
        args.extend([name, target]);
    }

    run_git_with_safety_snapshot(&repo, "before tag create", args).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_push(
    repo_path: String,
    remote: Option<String>,
    branch: Option<String>,
    force_with_lease: bool,
    set_upstream: bool,
) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    let context = push_context(&repo, remote.as_deref(), branch.as_deref()).await;
    let mut args = vec!["push".into()];
    if force_with_lease {
        args.push("--force-with-lease".into());
    }
    if set_upstream {
        args.push("-u".into());
    }
    if let Some(remote_name) = remote.filter(|value| !value.trim().is_empty()) {
        validate_ref_arg(&remote_name, "remote name")?;
        args.push(remote_name);
    }
    if let Some(branch_name) = branch.filter(|value| !value.trim().is_empty()) {
        validate_ref_arg(&branch_name, "branch name")?;
        args.push(branch_name);
    }
    create_safety_snapshot(&repo, "before push").await?;
    if let Err(error) = run_git(Some(&repo), args).await {
        if !force_with_lease && is_push_non_fast_forward_error(&error) {
            return Err(push_non_fast_forward_error(error, &context));
        }
        return Err(error);
    }
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_remote_add(
    repo_path: String,
    name: String,
    url: String,
) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    validate_ref_arg(&name, "remote name")?;
    validate_remote_url(&url)?;
    run_git_with_safety_snapshot(
        &repo,
        "before remote add",
        vec!["remote".into(), "add".into(), name, url],
    )
    .await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_stash_push(repo_path: String, message: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    let mut args = vec!["stash".into(), "push".into()];
    if !message.trim().is_empty() {
        args.extend(["-m".into(), message]);
    }
    run_git_with_safety_snapshot(&repo, "before stash", args).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_stash_push_paths(
    repo_path: String,
    paths: Vec<String>,
    message: String,
) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    let safe_paths = validate_file_paths(&paths)?;
    let mut args = vec!["stash".into(), "push".into(), "--include-untracked".into()];
    if !message.trim().is_empty() {
        args.extend(["-m".into(), message]);
    }
    args.push("--".into());
    args.extend(safe_paths);
    run_git_with_safety_snapshot(&repo, "before stash file", args).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_ignore_add(repo_path: String, pattern: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    let pattern = pattern.trim().to_string();
    if pattern.is_empty() {
        return invalid("INVALID_PATTERN", "Ignore pattern is required.");
    }
    if pattern.contains('\n') || pattern.contains('\r') {
        return invalid("INVALID_PATTERN", "Ignore pattern must be a single line.");
    }

    let gitignore = repo.join(".gitignore");
    let existing = fs::read_to_string(&gitignore).unwrap_or_default();
    if !existing.lines().any(|line| line.trim() == pattern) {
        let mut next = existing;
        if !next.is_empty() && !next.ends_with('\n') {
            next.push('\n');
        }
        next.push_str(&pattern);
        next.push('\n');
        fs::write(&gitignore, next)?;
    }
    build_snapshot(&repo, None).await
}

async fn spawn_system_open(command: &str, args: Vec<String>) -> CommandResult<()> {
    let status = Command::new(command).args(args).status().await?;
    if status.success() {
        Ok(())
    } else {
        invalid("OPEN_FAILED", "The system open command failed.")
    }
}

fn resolve_working_file(repo: &Path, path: &str) -> CommandResult<PathBuf> {
    let safe = validate_file_paths(&[path.to_string()])?;
    Ok(repo.join(&safe[0]))
}

#[tauri::command]
async fn file_show_in_folder(repo_path: String, path: String) -> CommandResult<()> {
    let repo = resolve_repo_root(&repo_path).await?;
    let target = resolve_working_file(&repo, &path)?;
    if cfg!(target_os = "macos") {
        spawn_system_open("open", vec!["-R".into(), target.display().to_string()]).await
    } else if cfg!(target_os = "windows") {
        spawn_system_open("explorer", vec![format!("/select,{}", target.display())]).await
    } else {
        let parent = target
            .parent()
            .map(|value| value.display().to_string())
            .unwrap_or_else(|| repo.display().to_string());
        spawn_system_open("xdg-open", vec![parent]).await
    }
}

#[tauri::command]
async fn file_open_default(repo_path: String, path: String) -> CommandResult<()> {
    let repo = resolve_repo_root(&repo_path).await?;
    let target = resolve_working_file(&repo, &path)?;
    let target_str = target.display().to_string();
    if cfg!(target_os = "macos") {
        spawn_system_open("open", vec![target_str]).await
    } else if cfg!(target_os = "windows") {
        spawn_system_open("cmd", vec!["/C".into(), "start".into(), String::new(), target_str]).await
    } else {
        spawn_system_open("xdg-open", vec![target_str]).await
    }
}

#[tauri::command]
async fn file_open_in_editor(repo_path: String, path: String) -> CommandResult<()> {
    let repo = resolve_repo_root(&repo_path).await?;
    let target = resolve_working_file(&repo, &path)?;
    let target_str = target.display().to_string();
    if spawn_system_open("code", vec![target_str.clone()]).await.is_ok() {
        return Ok(());
    }
    if cfg!(target_os = "macos") {
        return spawn_system_open(
            "open",
            vec!["-a".into(), "Visual Studio Code".into(), target_str],
        )
        .await;
    }
    invalid(
        "EDITOR_NOT_FOUND",
        "Could not launch VS Code. Install the `code` command-line tool.",
    )
}

#[tauri::command]
async fn file_delete(repo_path: String, path: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    let target = resolve_working_file(&repo, &path)?;
    if !target.exists() {
        return invalid("FILE_NOT_FOUND", "The file no longer exists on disk.");
    }
    fs::remove_file(&target)?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_export_patch(
    repo_path: String,
    path: String,
    staged: bool,
    destination: String,
) -> CommandResult<()> {
    let repo = resolve_repo_root(&repo_path).await?;
    let safe = validate_file_paths(&[path])?;
    let mut args = vec!["diff".into()];
    if staged {
        args.push("--cached".into());
    }
    args.extend(["--".into(), safe[0].clone()]);
    let diff = run_git(Some(&repo), args).await?;
    if diff.trim().is_empty() {
        return invalid(
            "EMPTY_PATCH",
            "No diff to export for this file. Untracked files have no patch until staged.",
        );
    }
    fs::write(Path::new(&destination), diff)?;
    Ok(())
}

#[tauri::command]
async fn git_stash_apply(repo_path: String, stash: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    validate_stash_ref(&stash)?;
    run_git_with_safety_snapshot(
        &repo,
        "before stash apply",
        vec!["stash".into(), "apply".into(), stash],
    )
    .await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_stash_drop(repo_path: String, stash: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    validate_stash_ref(&stash)?;
    run_git_with_safety_snapshot(
        &repo,
        "before stash drop",
        vec!["stash".into(), "drop".into(), stash],
    )
    .await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_diff(
    repo_path: String,
    path: String,
    staged: bool,
    untracked: bool,
) -> CommandResult<String> {
    let repo = resolve_repo_root(&repo_path).await?;
    let mut safe_paths = validate_file_paths(&[path])?;

    if untracked {
        // Untracked files are absent from the index and HEAD, so a plain `git diff`
        // shows nothing. Diff against /dev/null with --no-index to render the whole
        // file as additions. --no-index exits 1 when the inputs differ (always true
        // for a new file), so that exit code is expected rather than an error.
        let mut args = vec![
            "diff".into(),
            "--no-ext-diff".into(),
            "--minimal".into(),
            "--no-index".into(),
            "/dev/null".into(),
        ];
        args.append(&mut safe_paths);
        return run_git_no_index_diff(&repo, args).await;
    }

    let mut args = vec!["diff".into(), "--no-ext-diff".into(), "--minimal".into()];
    if staged {
        args.push("--staged".into());
    }
    args.push("--".into());
    args.append(&mut safe_paths);
    run_git(Some(&repo), args).await
}

/// Run `git diff --no-index`, which uses a non-standard exit-code convention:
/// 0 = inputs identical, 1 = inputs differ (the normal case here), >1 = real error.
async fn run_git_no_index_diff(repo: &Path, args: Vec<String>) -> CommandResult<String> {
    let mut command = Command::new("git");
    command.env("GIT_TERMINAL_PROMPT", "0");
    command.arg("-C").arg(repo);
    command.args(args);

    let output = command.output().await?;
    match output.status.code() {
        Some(0) | Some(1) => Ok(String::from_utf8_lossy(&output.stdout).to_string()),
        _ => {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            Err(git_command_failure(if stderr.trim().is_empty() {
                stdout
            } else {
                stderr
            }))
        }
    }
}

/// List the individual untracked files inside an untracked directory so the UI can
/// expand a collapsed folder row (e.g. `docs/`) and show its contents. Capped like a
/// normal snapshot so a huge untracked directory can't flood the payload.
#[tauri::command]
async fn git_list_directory_files(
    repo_path: String,
    dir: String,
) -> CommandResult<Vec<FileChange>> {
    let repo = resolve_repo_root(&repo_path).await?;
    let normalized = dir.trim_end_matches('/').to_string();
    let mut safe_dir = validate_file_paths(&[normalized])?;

    let mut args = vec![
        "status".into(),
        "--porcelain=v2".into(),
        "--branch".into(),
        "-z".into(),
        "-uall".into(),
        "--".into(),
    ];
    args.append(&mut safe_dir);

    let output = run_git(Some(&repo), args).await?;
    let (_branch, mut changes, _conflicts) = parse_status(&output);
    changes.truncate(MAX_CHANGE_ENTRIES);
    Ok(changes)
}

#[tauri::command]
async fn git_commit_files(repo_path: String, sha: String) -> CommandResult<Vec<CommitFile>> {
    let repo = resolve_repo_root(&repo_path).await?;
    validate_ref_arg(&sha, "commit")?;
    let base = commit_base_ref(&repo, &sha).await?;
    let output = run_git(
        Some(&repo),
        vec![
            "diff".into(),
            "--name-status".into(),
            "-z".into(),
            "-M".into(),
            base,
            sha,
        ],
    )
    .await?;

    Ok(parse_commit_files(&output))
}

#[tauri::command]
async fn git_commit_file_diff(
    repo_path: String,
    sha: String,
    path: String,
    old_path: Option<String>,
) -> CommandResult<String> {
    let repo = resolve_repo_root(&repo_path).await?;
    validate_ref_arg(&sha, "commit")?;
    let base = commit_base_ref(&repo, &sha).await?;
    let mut safe_paths = validate_file_paths(&[path])?;
    if let Some(old_path_value) = old_path {
        let mut old_safe_paths = validate_file_paths(&[old_path_value])?;
        safe_paths.splice(0..0, old_safe_paths.drain(..));
    }

    let mut args = vec![
        "diff".into(),
        "--no-ext-diff".into(),
        "--minimal".into(),
        base,
        sha,
        "--".into(),
    ];
    args.append(&mut safe_paths);
    run_git(Some(&repo), args).await
}

async fn build_snapshot(repo: &Path, history_limit: Option<u32>) -> CommandResult<RepoSnapshot> {
    let history_limit = clamp_history_limit(history_limit);
    let status_output = run_git(
        Some(repo),
        vec![
            "status".into(),
            "--porcelain=v2".into(),
            "-z".into(),
            "--branch".into(),
        ],
    )
    .await?;

    let (branch_status, mut changes, conflicts) = parse_status(&status_output);
    let total_changes = changes.len();
    let changes_truncated = total_changes > MAX_CHANGE_ENTRIES;
    if changes_truncated {
        changes.truncate(MAX_CHANGE_ENTRIES);
    }
    let remotes = parse_remotes(&run_git(Some(repo), vec!["remote".into(), "-v".into()]).await?);
    let branches = parse_branches(
        &run_git(
            Some(repo),
            vec![
                "branch".into(),
                "--all".into(),
                "--format=%(refname:short)%1f%(refname)%1f%(upstream:short)%1f%(HEAD)".into(),
            ],
        )
        .await?,
        branch_status.ahead,
        branch_status.behind,
    );
    let stashes = parse_stashes(
        &run_git(
            Some(repo),
            vec![
                "stash".into(),
                "list".into(),
                "--format=%gd%x1f%H%x1f%gs".into(),
            ],
        )
        .await?,
    );
    let commits = parse_commits(
        &run_git(Some(repo), history_log_args(history_limit))
            .await
            .unwrap_or_default(),
    );
    let undo_snapshots = list_undo_snapshots(repo).await.unwrap_or_default();
    let branch_stacks = enriched_branch_stacks(repo, &branches).await;
    let parallel_lanes = read_parallel_lanes(repo).await.unwrap_or_default();
    let worktrees = list_worktrees(repo).await.unwrap_or_default();
    let active_operation = read_active_operation(repo).await.unwrap_or_default();

    let worktree_state = detect_worktree_state(repo, &branch_status, &changes).await;
    let name = repo
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Repository")
        .to_string();

    let repository = Repository {
        id: repo.to_string_lossy().to_string(),
        path: repo.to_string_lossy().to_string(),
        name,
        provider: remotes
            .first()
            .map(|remote| remote.provider)
            .unwrap_or(GitProvider::Unknown),
        remotes: remotes.clone(),
        head: branch_status.head_oid.clone(),
        worktree_state,
    };

    Ok(RepoSnapshot {
        repository,
        current_branch: branch_status.current_branch,
        upstream: branch_status.upstream,
        ahead: branch_status.ahead,
        behind: branch_status.behind,
        changes,
        total_changes,
        changes_truncated,
        branches,
        remotes,
        stashes,
        commits,
        conflicts,
        undo_snapshots,
        branch_stacks,
        parallel_lanes,
        worktrees,
        active_operation,
    })
}

async fn resolve_repo_root(path: &str) -> CommandResult<PathBuf> {
    if path.trim().is_empty() {
        return invalid("INVALID_PATH", "Repository path is required.");
    }

    let input = PathBuf::from(path);
    let canonical = std::fs::canonicalize(&input).map_err(|error| AppError::InvalidInput {
        code: "INVALID_PATH",
        message: format!("Cannot open '{}': {error}", input.display()),
    })?;

    let root = run_git(
        None,
        vec![
            "-C".into(),
            canonical.to_string_lossy().to_string(),
            "rev-parse".into(),
            "--show-toplevel".into(),
        ],
    )
    .await?;

    let repo = PathBuf::from(root.trim());
    let repo = std::fs::canonicalize(&repo).map_err(|error| AppError::InvalidInput {
        code: "INVALID_REPOSITORY",
        message: format!("Git returned an invalid repository root: {error}"),
    })?;

    Ok(repo)
}

async fn run_git(repo: Option<&Path>, args: Vec<String>) -> CommandResult<String> {
    let extra_headers = git_http_extra_headers(repo, &args).await?;
    let mut command = Command::new("git");
    command.env("GIT_TERMINAL_PROMPT", "0");
    if !extra_headers.is_empty() {
        command.env("GIT_CONFIG_COUNT", extra_headers.len().to_string());
        for (index, header) in extra_headers.iter().enumerate() {
            command.env(
                format!("GIT_CONFIG_KEY_{index}"),
                format!("http.{}.extraheader", header.scope),
            );
            command.env(format!("GIT_CONFIG_VALUE_{index}"), &header.header);
        }
    }
    if let Some(repo_path) = repo {
        command.arg("-C").arg(repo_path);
    }
    command.args(args);

    let output = command.output().await?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(stdout)
    } else {
        let detail = if stderr.trim().is_empty() {
            stdout
        } else {
            stderr
        };
        Err(git_command_failure(detail))
    }
}

async fn run_git_with_env(
    repo: Option<&Path>,
    args: Vec<String>,
    envs: Vec<(&str, String)>,
) -> CommandResult<String> {
    let extra_headers = git_http_extra_headers(repo, &args).await?;
    let mut command = Command::new("git");
    command.env("GIT_TERMINAL_PROMPT", "0");
    for (key, value) in envs {
        command.env(key, value);
    }
    if !extra_headers.is_empty() {
        command.env("GIT_CONFIG_COUNT", extra_headers.len().to_string());
        for (index, header) in extra_headers.iter().enumerate() {
            command.env(
                format!("GIT_CONFIG_KEY_{index}"),
                format!("http.{}.extraheader", header.scope),
            );
            command.env(format!("GIT_CONFIG_VALUE_{index}"), &header.header);
        }
    }
    if let Some(repo_path) = repo {
        command.arg("-C").arg(repo_path);
    }
    command.args(args);

    let output = command.output().await?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(stdout)
    } else {
        let detail = if stderr.trim().is_empty() {
            stdout
        } else {
            stderr
        };
        Err(git_command_failure(detail))
    }
}

async fn run_git_with_safety_snapshot(
    repo: &Path,
    label: &str,
    args: Vec<String>,
) -> CommandResult<String> {
    create_safety_snapshot(repo, label).await?;
    run_git(Some(repo), args).await
}

async fn run_git_snapshot_operation(
    repo: &Path,
    label: &str,
    args: Vec<String>,
) -> CommandResult<RepoSnapshot> {
    create_safety_snapshot(repo, label).await?;
    match run_git(Some(repo), args).await {
        Ok(_) => build_snapshot(repo, None).await,
        Err(error) => {
            if let Some(snapshot) = snapshot_for_interrupted_operation(repo).await? {
                Ok(snapshot)
            } else {
                Err(error)
            }
        }
    }
}

#[tauri::command]
async fn git_undo_restore(repo_path: String, snapshot_id: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    let snapshot_id = validate_snapshot_id(&snapshot_id)?;
    if !matches!(detect_git_operation(&repo).await, GitOperationState::None) {
        return invalid(
            "ACTIVE_GIT_OPERATION",
            "Finish or abort the active merge, rebase, or cherry-pick before restoring a snapshot.",
        );
    }

    let snapshot = read_undo_snapshot(&repo, &snapshot_id).await?;
    create_safety_snapshot(&repo, "before undo restore").await?;
    let target = snapshot
        .ref_name
        .as_ref()
        .or(snapshot.head_sha.as_ref())
        .ok_or_else(|| AppError::InvalidInput {
            code: "INVALID_UNDO_SNAPSHOT",
            message: "Undo snapshot does not contain a restorable commit.".to_string(),
        })?
        .clone();

    run_git(Some(&repo), vec!["reset".into(), "--hard".into(), target]).await?;
    let snapshot_dir = undo_snapshot_dir(&repo).await?;
    let staged_patch = snapshot_dir.join(format!("{snapshot_id}.staged.patch"));
    let working_patch = snapshot_dir.join(format!("{snapshot_id}.working.patch"));

    if snapshot.has_staged_patch && staged_patch.exists() {
        run_git(
            Some(&repo),
            vec![
                "apply".into(),
                "--index".into(),
                "--whitespace=nowarn".into(),
                staged_patch.to_string_lossy().to_string(),
            ],
        )
        .await?;
    }
    if snapshot.has_working_patch && working_patch.exists() {
        run_git(
            Some(&repo),
            vec![
                "apply".into(),
                "--whitespace=nowarn".into(),
                working_patch.to_string_lossy().to_string(),
            ],
        )
        .await?;
    }

    build_snapshot(&repo, None).await
}

async fn create_safety_snapshot(repo: &Path, label: &str) -> CommandResult<Option<UndoSnapshot>> {
    let Some(git_dir) = git_dir_path(repo).await else {
        return Ok(None);
    };
    let snapshot_dir = git_dir.join("opengit").join("snapshots");
    fs::create_dir_all(&snapshot_dir)?;

    let head_sha = run_git(
        Some(repo),
        vec!["rev-parse".into(), "--verify".into(), "HEAD".into()],
    )
    .await
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty());
    let branch = current_branch_name(repo).await;
    let id = safety_snapshot_id(label);
    let created_at = now_millis().to_string();
    let ref_name = head_sha
        .as_ref()
        .map(|_| format!("refs/opengit/snapshots/{id}"));

    if let (Some(head_sha), Some(ref_name)) = (&head_sha, &ref_name) {
        run_git(
            Some(repo),
            vec!["update-ref".into(), ref_name.clone(), head_sha.clone()],
        )
        .await?;
    }

    let staged_patch = run_git(
        Some(repo),
        vec!["diff".into(), "--cached".into(), "--binary".into()],
    )
    .await
    .unwrap_or_default();
    let working_patch = run_git(Some(repo), vec!["diff".into(), "--binary".into()])
        .await
        .unwrap_or_default();
    let has_staged_patch = !staged_patch.trim().is_empty();
    let has_working_patch = !working_patch.trim().is_empty();

    if has_staged_patch {
        fs::write(
            snapshot_dir.join(format!("{id}.staged.patch")),
            staged_patch,
        )?;
    }
    if has_working_patch {
        fs::write(
            snapshot_dir.join(format!("{id}.working.patch")),
            working_patch,
        )?;
    }

    let snapshot = UndoSnapshot {
        id: id.clone(),
        label: truncate_display_text(label.trim(), 90),
        branch,
        head_sha,
        ref_name,
        created_at,
        has_staged_patch,
        has_working_patch,
    };
    let body =
        serde_json::to_vec_pretty(&snapshot).map_err(|error| AppError::Io(error.to_string()))?;
    fs::write(snapshot_dir.join(format!("{id}.json")), body)?;
    prune_undo_snapshots(&snapshot_dir, 40);

    Ok(Some(snapshot))
}

async fn list_undo_snapshots(repo: &Path) -> CommandResult<Vec<UndoSnapshot>> {
    let snapshot_dir = undo_snapshot_dir(repo).await?;
    if !snapshot_dir.exists() {
        return Ok(Vec::new());
    }

    let mut snapshots = Vec::new();
    for entry in fs::read_dir(snapshot_dir)? {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(body) = fs::read_to_string(&path) else {
            continue;
        };
        if let Ok(snapshot) = serde_json::from_str::<UndoSnapshot>(&body) {
            snapshots.push(snapshot);
        }
    }

    snapshots.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    snapshots.truncate(20);
    Ok(snapshots)
}

async fn read_undo_snapshot(repo: &Path, snapshot_id: &str) -> CommandResult<UndoSnapshot> {
    let snapshot_dir = undo_snapshot_dir(repo).await?;
    let path = snapshot_dir.join(format!("{snapshot_id}.json"));
    let body = fs::read_to_string(path).map_err(|_| AppError::InvalidInput {
        code: "INVALID_UNDO_SNAPSHOT",
        message: "Undo snapshot could not be found.".to_string(),
    })?;
    serde_json::from_str(&body).map_err(|error| AppError::InvalidInput {
        code: "INVALID_UNDO_SNAPSHOT",
        message: format!("Undo snapshot is unreadable: {error}"),
    })
}

async fn undo_snapshot_dir(repo: &Path) -> CommandResult<PathBuf> {
    let Some(git_dir) = git_dir_path(repo).await else {
        return invalid(
            "INVALID_REPOSITORY",
            "Repository Git directory could not be resolved.",
        );
    };
    Ok(git_dir.join("opengit").join("snapshots"))
}

async fn opengit_dir(repo: &Path) -> CommandResult<PathBuf> {
    let Some(git_dir) = git_dir_path(repo).await else {
        return invalid(
            "INVALID_REPOSITORY",
            "Repository Git directory could not be resolved.",
        );
    };
    Ok(git_dir.join("opengit"))
}

async fn stacks_file(repo: &Path) -> CommandResult<PathBuf> {
    Ok(opengit_dir(repo).await?.join("stacks").join("stacks.json"))
}

async fn lanes_file(repo: &Path) -> CommandResult<PathBuf> {
    Ok(opengit_dir(repo).await?.join("lanes").join("lanes.json"))
}

async fn lane_dir(repo: &Path, lane_id: &str) -> CommandResult<PathBuf> {
    let lane_id = validate_metadata_id(lane_id, "lane id")?;
    Ok(opengit_dir(repo).await?.join("lanes").join(lane_id))
}

async fn active_operation_file(repo: &Path) -> CommandResult<PathBuf> {
    Ok(opengit_dir(repo)
        .await?
        .join("operations")
        .join("active.json"))
}

async fn read_branch_stacks(repo: &Path) -> CommandResult<Vec<BranchStack>> {
    let path = stacks_file(repo).await?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let body = fs::read_to_string(path)?;
    serde_json::from_str(&body).map_err(|error| AppError::InvalidInput {
        code: "INVALID_STACK_METADATA",
        message: format!("Stack metadata is unreadable: {error}"),
    })
}

async fn write_branch_stacks(repo: &Path, stacks: &[BranchStack]) -> CommandResult<()> {
    let path = stacks_file(repo).await?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let body = serde_json::to_vec_pretty(stacks).map_err(|error| AppError::Io(error.to_string()))?;
    fs::write(path, body)?;
    Ok(())
}

async fn read_parallel_lanes(repo: &Path) -> CommandResult<Vec<ParallelLane>> {
    let path = lanes_file(repo).await?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let body = fs::read_to_string(path)?;
    serde_json::from_str(&body).map_err(|error| AppError::InvalidInput {
        code: "INVALID_LANE_METADATA",
        message: format!("Parallel lane metadata is unreadable: {error}"),
    })
}

async fn write_parallel_lanes(repo: &Path, lanes: &[ParallelLane]) -> CommandResult<()> {
    let path = lanes_file(repo).await?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let body = serde_json::to_vec_pretty(lanes).map_err(|error| AppError::Io(error.to_string()))?;
    fs::write(path, body)?;
    Ok(())
}

async fn read_active_operation(repo: &Path) -> CommandResult<Option<GitWorkflowOperation>> {
    let path = active_operation_file(repo).await?;
    if !path.exists() {
        return Ok(None);
    }
    let body = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&body).ok())
}

async fn write_active_operation(repo: &Path, operation: &GitWorkflowOperation) -> CommandResult<()> {
    let path = active_operation_file(repo).await?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let body = serde_json::to_vec_pretty(operation).map_err(|error| AppError::Io(error.to_string()))?;
    fs::write(path, body)?;
    Ok(())
}

async fn clear_active_operation(repo: &Path) -> CommandResult<()> {
    let path = active_operation_file(repo).await?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

async fn list_worktrees(repo: &Path) -> CommandResult<Vec<Worktree>> {
    let output = run_git(
        Some(repo),
        vec!["worktree".into(), "list".into(), "--porcelain".into()],
    )
    .await
    .unwrap_or_default();
    let mut worktrees = Vec::new();
    let mut path: Option<String> = None;
    let mut head = String::new();
    let mut branch: Option<String> = None;
    let mut locked = false;
    let mut prunable = false;

    for line in output.lines().chain(std::iter::once("")) {
        if line.is_empty() {
            if let Some(path_value) = path.take() {
                worktrees.push(Worktree {
                    path: path_value,
                    branch: branch.take().map(|value| normalize_ref_display(&value)),
                    head: head.clone(),
                    locked,
                    prunable,
                });
            }
            head.clear();
            locked = false;
            prunable = false;
            continue;
        }
        if let Some(value) = line.strip_prefix("worktree ") {
            path = Some(value.to_string());
        } else if let Some(value) = line.strip_prefix("HEAD ") {
            head = value.to_string();
        } else if let Some(value) = line.strip_prefix("branch ") {
            branch = Some(value.to_string());
        } else if line.starts_with("locked") {
            locked = true;
        } else if line.starts_with("prunable") {
            prunable = true;
        }
    }

    Ok(worktrees)
}

async fn enriched_branch_stacks(repo: &Path, branches: &[Branch]) -> Vec<BranchStack> {
    let Ok(stacks) = read_branch_stacks(repo).await else {
        return Vec::new();
    };
    let branch_map: BTreeMap<String, &Branch> = branches
        .iter()
        .map(|branch| (branch.name.clone(), branch))
        .collect();
    let mut enriched = Vec::new();

    for mut stack in stacks {
        let mut stack_status = BranchStackStatus::Clean;
        for item in &mut stack.items {
            if let Some(branch) = branch_map.get(&item.branch) {
                item.head_sha = branch_head_sha(repo, &item.branch).await;
                item.upstream = branch.upstream.clone();
                item.status = if branch.behind.unwrap_or(0) > 0 {
                    BranchStackItemStatus::Behind
                } else if branch.ahead.unwrap_or(0) > 0 {
                    BranchStackItemStatus::Ahead
                } else if branch_ancestor_contains(repo, &item.base_branch, &item.branch).await {
                    BranchStackItemStatus::Clean
                } else {
                    BranchStackItemStatus::NeedsRestack
                };
            } else {
                item.status = BranchStackItemStatus::Missing;
            }
            if matches!(
                item.status,
                BranchStackItemStatus::NeedsRestack
                    | BranchStackItemStatus::Behind
                    | BranchStackItemStatus::Conflicted
                    | BranchStackItemStatus::Missing
            ) {
                stack_status = if matches!(item.status, BranchStackItemStatus::Conflicted) {
                    BranchStackStatus::Conflicted
                } else {
                    BranchStackStatus::NeedsRestack
                };
            }
        }
        stack.status = stack_status;
        enriched.push(stack);
    }

    enriched
}

async fn branch_head_sha(repo: &Path, branch: &str) -> Option<String> {
    run_git(
        Some(repo),
        vec!["rev-parse".into(), "--verify".into(), branch.to_string()],
    )
    .await
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
}

async fn branch_ancestor_contains(repo: &Path, base: &str, branch: &str) -> bool {
    run_git(
        Some(repo),
        vec!["merge-base".into(), "--is-ancestor".into(), base.into(), branch.into()],
    )
    .await
    .is_ok()
}

async fn git_ref_exists(repo: &Path, reference: &str) -> bool {
    run_git(
        Some(repo),
        vec![
            "rev-parse".into(),
            "--verify".into(),
            "--quiet".into(),
            reference.to_string(),
        ],
    )
    .await
    .is_ok()
}

async fn inspect_branch(repo: &Path, branch_ref: &str) -> CommandResult<BranchInspection> {
    let normalized_ref = normalize_branch_inspection_ref(branch_ref)?;
    validate_ref_arg(&normalized_ref, "branch reference")?;

    let status_output = run_git(
        Some(repo),
        vec![
            "status".into(),
            "--porcelain=v2".into(),
            "-z".into(),
            "--branch".into(),
        ],
    )
    .await
    .unwrap_or_default();
    let (branch_status, _changes, _conflicts) = parse_status(&status_output);
    let branches = parse_branches(
        &run_git(
            Some(repo),
            vec![
                "branch".into(),
                "--all".into(),
                "--format=%(refname:short)%1f%(refname)%1f%(upstream:short)%1f%(HEAD)".into(),
            ],
        )
        .await
        .unwrap_or_default(),
        branch_status.ahead,
        branch_status.behind,
    );

    let branch = branches
        .iter()
        .find(|branch| branch_matches_ref(branch, &normalized_ref))
        .cloned()
        .or(fallback_branch_for_ref(repo, &normalized_ref).await);
    let Some(branch) = branch else {
        return invalid("INVALID_REF", "Branch or ref could not be found.");
    };

    let kind = branch_inspection_kind(&branch, &normalized_ref);
    let target_ref = preferred_branch_ref(&branch, &normalized_ref);
    let upstream = branch.upstream.clone();
    let default_branch = default_branch_ref(repo).await;
    let head_sha = branch_head_sha(repo, &target_ref).await;
    let recent_commits = branch_recent_commits(repo, &target_ref).await.unwrap_or_default();
    let last_commit = recent_commits.first().cloned();
    let ahead_behind_upstream = if let Some(upstream_ref) = upstream.as_deref() {
        ahead_behind(repo, upstream_ref, &target_ref).await
    } else {
        None
    };
    let ahead_behind_default = if let Some(default_ref) = default_branch
        .as_deref()
        .filter(|default_ref| !same_ref_name(default_ref, &target_ref))
    {
        ahead_behind(repo, default_ref, &target_ref).await
    } else {
        None
    };
    let status = branch_inspection_status(ahead_behind_upstream.as_ref(), upstream.as_deref());
    let base_ref = upstream
        .clone()
        .or(default_branch.clone())
        .filter(|base| !same_ref_name(base, &target_ref));
    let diff_summary = if let Some(base) = base_ref.as_deref() {
        branch_diff_summary(repo, base, &target_ref).await
    } else {
        None
    };

    Ok(BranchInspection {
        branch,
        kind,
        upstream,
        default_branch,
        base_ref,
        head_sha,
        last_commit,
        ahead_behind_upstream,
        ahead_behind_default,
        status,
        recent_commits,
        diff_summary,
    })
}

fn normalize_branch_inspection_ref(value: &str) -> CommandResult<String> {
    let trimmed = value.trim();
    let normalized = trimmed
        .strip_prefix("HEAD -> ")
        .or_else(|| trimmed.strip_prefix("tag: "))
        .unwrap_or(trimmed)
        .trim()
        .to_string();
    if normalized.is_empty() {
        return invalid("INVALID_REF", "Branch reference is required.");
    }
    Ok(normalized)
}

fn branch_matches_ref(branch: &Branch, value: &str) -> bool {
    branch.name == value
        || branch.full_ref == value
        || normalize_ref_display(&branch.full_ref) == value
        || branch
            .full_ref
            .strip_prefix("refs/remotes/")
            .is_some_and(|remote_ref| remote_ref == value)
}

async fn fallback_branch_for_ref(repo: &Path, value: &str) -> Option<Branch> {
    let full_ref = if value.starts_with("refs/") {
        if !git_ref_exists(repo, value).await {
            return None;
        }
        value.to_string()
    } else if git_ref_exists(repo, &format!("refs/tags/{value}")).await {
        format!("refs/tags/{value}")
    } else if git_ref_exists(repo, &format!("refs/heads/{value}")).await {
        format!("refs/heads/{value}")
    } else if git_ref_exists(repo, &format!("refs/remotes/{value}")).await {
        format!("refs/remotes/{value}")
    } else if git_ref_exists(repo, value).await {
        value.to_string()
    } else {
        return None;
    };

    Some(Branch {
        name: normalize_ref_display(&full_ref).replace("refs/tags/", ""),
        full_ref,
        upstream: None,
        ahead: None,
        behind: None,
        is_current: false,
        is_protected: false,
    })
}

fn branch_inspection_kind(branch: &Branch, requested_ref: &str) -> BranchInspectionKind {
    if branch.full_ref.starts_with("refs/heads/") {
        BranchInspectionKind::Local
    } else if branch.full_ref.starts_with("refs/remotes/") {
        BranchInspectionKind::Remote
    } else if branch.full_ref.starts_with("refs/tags/") || requested_ref.starts_with("refs/tags/") {
        BranchInspectionKind::Tag
    } else {
        BranchInspectionKind::Unknown
    }
}

fn preferred_branch_ref(branch: &Branch, requested_ref: &str) -> String {
    if branch.full_ref.is_empty() {
        requested_ref.to_string()
    } else {
        branch.full_ref.clone()
    }
}

fn same_ref_name(left: &str, right: &str) -> bool {
    left == right || normalize_ref_display(left) == normalize_ref_display(right)
}

async fn ahead_behind(repo: &Path, base: &str, target: &str) -> Option<AheadBehind> {
    let output = run_git(
        Some(repo),
        vec![
            "rev-list".into(),
            "--left-right".into(),
            "--count".into(),
            format!("{base}...{target}"),
        ],
    )
    .await
    .ok()?;
    let mut parts = output.split_whitespace();
    let behind = parts.next()?.parse().ok()?;
    let ahead = parts.next()?.parse().ok()?;
    Some(AheadBehind { ahead, behind })
}

fn branch_inspection_status(
    upstream_counts: Option<&AheadBehind>,
    upstream: Option<&str>,
) -> BranchInspectionStatus {
    if upstream.is_none() {
        return BranchInspectionStatus::NoUpstream;
    }
    match upstream_counts {
        Some(counts) if counts.ahead > 0 && counts.behind > 0 => BranchInspectionStatus::Diverged,
        Some(counts) if counts.ahead > 0 => BranchInspectionStatus::Ahead,
        Some(counts) if counts.behind > 0 => BranchInspectionStatus::Behind,
        Some(_) => BranchInspectionStatus::UpToDate,
        None => BranchInspectionStatus::Unknown,
    }
}

async fn branch_recent_commits(repo: &Path, branch_ref: &str) -> CommandResult<Vec<Commit>> {
    let output = run_git(
        Some(repo),
        vec![
            "log".into(),
            "-n".into(),
            "200".into(),
            "--date=iso-strict".into(),
            "--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%s%x1f%D%x1e".into(),
            branch_ref.to_string(),
        ],
    )
    .await?;
    Ok(parse_commits(&output))
}

async fn default_branch_ref(repo: &Path) -> Option<String> {
    if let Ok(output) = run_git(
        Some(repo),
        vec![
            "symbolic-ref".into(),
            "--quiet".into(),
            "--short".into(),
            "refs/remotes/origin/HEAD".into(),
        ],
    )
    .await
    {
        let value = output.trim();
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }

    for candidate in ["origin/main", "origin/master", "main", "master", "trunk", "develop"] {
        if git_ref_exists(repo, candidate).await {
            return Some(candidate.to_string());
        }
    }
    None
}

async fn branch_diff_summary(repo: &Path, base: &str, target: &str) -> Option<BranchDiffSummary> {
    let range = format!("{base}...{target}");
    let files = parse_commit_files(
        &run_git(
            Some(repo),
            vec![
                "diff".into(),
                "--name-status".into(),
                "-z".into(),
                "--find-renames".into(),
                range.clone(),
            ],
        )
        .await
        .ok()?,
    );
    let (additions, deletions) = parse_shortstat(
        &run_git(Some(repo), vec!["diff".into(), "--shortstat".into(), range])
            .await
            .unwrap_or_default(),
    );
    let file_count = files.len();
    Some(BranchDiffSummary {
        base_ref: base.to_string(),
        file_count,
        additions,
        deletions,
        files: files.into_iter().take(50).collect(),
    })
}

fn parse_shortstat(raw: &str) -> (Option<i32>, Option<i32>) {
    let mut additions = None;
    let mut deletions = None;
    let mut previous_number = None;

    for token in raw.split(|ch: char| ch.is_whitespace() || ch == ',') {
        if token.is_empty() {
            continue;
        }
        if let Ok(value) = token.parse::<i32>() {
            previous_number = Some(value);
            continue;
        }
        if token.starts_with("insertion") {
            additions = previous_number;
        } else if token.starts_with("deletion") {
            deletions = previous_number;
        }
    }

    (additions, deletions)
}

fn normalize_ref_display(value: &str) -> String {
    value
        .replace("refs/heads/", "")
        .replace("refs/remotes/", "")
}

fn metadata_id(prefix: &str, label: &str) -> String {
    let slug = label
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .split('-')
        .filter(|part| !part.is_empty())
        .take(8)
        .collect::<Vec<_>>()
        .join("-");
    format!("{prefix}-{}-{}", now_millis(), if slug.is_empty() { "item" } else { &slug })
}

fn validate_metadata_id(value: &str, label: &str) -> CommandResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.starts_with('-')
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
        || trimmed.chars().any(|ch| ch.is_control())
    {
        return invalid("INVALID_ID", &format!("{label} is invalid."));
    }
    Ok(trimmed.to_string())
}

fn stack_resequence_items(stack: &mut BranchStack) {
    stack.items.sort_by_key(|item| item.order);
    let mut base = stack.trunk.clone();
    for (index, item) in stack.items.iter_mut().enumerate() {
        item.order = index;
        item.base_branch = base.clone();
        base = item.branch.clone();
    }
    stack.updated_at = now_millis().to_string();
}

fn lane_patch_path(dir: &Path, source: ParallelLanePathSource) -> PathBuf {
    match source {
        ParallelLanePathSource::Staged => dir.join("staged.patch"),
        ParallelLanePathSource::Working => dir.join("working.patch"),
        ParallelLanePathSource::Untracked => dir.join("untracked.patch"),
    }
}

fn lane_untracked_root(dir: &Path) -> PathBuf {
    dir.join("untracked")
}

fn lane_owns_path(lane: &ParallelLane, path: &str) -> bool {
    lane.paths.iter().any(|lane_path| lane_path.path == path)
}

fn find_lane_mut<'a>(lanes: &'a mut [ParallelLane], lane_id: &str) -> CommandResult<&'a mut ParallelLane> {
    lanes.iter_mut().find(|lane| lane.id == lane_id).ok_or_else(|| AppError::InvalidInput {
        code: "LANE_NOT_FOUND",
        message: "Parallel lane could not be found.".to_string(),
    })
}

fn find_stack_mut<'a>(stacks: &'a mut [BranchStack], stack_id: &str) -> CommandResult<&'a mut BranchStack> {
    stacks.iter_mut().find(|stack| stack.id == stack_id).ok_or_else(|| AppError::InvalidInput {
        code: "STACK_NOT_FOUND",
        message: "Branch stack could not be found.".to_string(),
    })
}

fn git_args_with_paths(prefix: &[&str], paths: &[String]) -> Vec<String> {
    let mut args = prefix.iter().map(|value| value.to_string()).collect::<Vec<_>>();
    args.push("--".to_string());
    args.extend(paths.iter().cloned());
    args
}

async fn capture_paths_into_lane(repo: &Path, lane: &mut ParallelLane, paths: &[String]) -> CommandResult<()> {
    let safe_paths = validate_file_paths(paths)?;
    let snapshot = build_snapshot(repo, None).await?;
    let mut staged_paths = Vec::new();
    let mut working_paths = Vec::new();
    let mut untracked_paths = Vec::new();
    let mut lane_paths = Vec::new();

    for path in safe_paths {
        if lane_owns_path(lane, &path) {
            continue;
        }
        let Some(change) = snapshot.changes.iter().find(|change| change.path == path) else {
            return invalid("LANE_PATH_UNCHANGED", "Only changed files can be assigned to a lane.");
        };
        if change.staged && change.unstaged {
            return invalid(
                "LANE_MIXED_FILE",
                "Files with both staged and unstaged edits must be split manually before assigning to a lane.",
            );
        }
        let source = if change.status == FileStatus::Untracked {
            untracked_paths.push(path.clone());
            ParallelLanePathSource::Untracked
        } else if change.staged {
            staged_paths.push(path.clone());
            ParallelLanePathSource::Staged
        } else {
            working_paths.push(path.clone());
            ParallelLanePathSource::Working
        };
        lane_paths.push(ParallelLanePath {
            path,
            old_path: change.old_path.clone(),
            status: change.status,
            source,
        });
    }

    if lane_paths.is_empty() {
        return invalid("LANE_EMPTY", "Select at least one changed file for the lane.");
    }

    let dir = lane_dir(repo, &lane.id).await?;
    fs::create_dir_all(&dir)?;

    if !staged_paths.is_empty() {
        let patch = run_git(Some(repo), git_args_with_paths(&["diff", "--cached", "--binary"], &staged_paths)).await?;
        let patch_path = lane_patch_path(&dir, ParallelLanePathSource::Staged);
        fs::write(&patch_path, patch)?;
        run_git(
            Some(repo),
            vec![
                "apply".into(),
                "--check".into(),
                "-R".into(),
                "--index".into(),
                patch_path.to_string_lossy().to_string(),
            ],
        )
        .await?;
    }

    if !working_paths.is_empty() {
        let patch = run_git(Some(repo), git_args_with_paths(&["diff", "--binary"], &working_paths)).await?;
        let patch_path = lane_patch_path(&dir, ParallelLanePathSource::Working);
        fs::write(&patch_path, patch)?;
        run_git(
            Some(repo),
            vec![
                "apply".into(),
                "--check".into(),
                "-R".into(),
                patch_path.to_string_lossy().to_string(),
            ],
        )
        .await?;
    }

    let untracked_root = lane_untracked_root(&dir);
    for path in &untracked_paths {
        let source = repo.join(path);
        if !source.is_file() {
            return invalid("LANE_UNTRACKED_UNSUPPORTED", "Only untracked files can be assigned in v1; directories are not supported yet.");
        }
        let destination = untracked_root.join(path);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(&source, destination)?;
    }

    if !staged_paths.is_empty() {
        let patch_path = lane_patch_path(&dir, ParallelLanePathSource::Staged);
        run_git(
            Some(repo),
            vec![
                "apply".into(),
                "-R".into(),
                "--index".into(),
                patch_path.to_string_lossy().to_string(),
            ],
        )
        .await?;
    }
    if !working_paths.is_empty() {
        let patch_path = lane_patch_path(&dir, ParallelLanePathSource::Working);
        run_git(
            Some(repo),
            vec![
                "apply".into(),
                "-R".into(),
                patch_path.to_string_lossy().to_string(),
            ],
        )
        .await?;
    }
    for path in &untracked_paths {
        fs::remove_file(repo.join(path))?;
    }

    lane.paths.extend(lane_paths);
    lane.applied = false;
    lane.status = ParallelLaneStatus::Clean;
    lane.updated_at = now_millis().to_string();
    Ok(())
}

async fn apply_lane_internal(repo: &Path, lane: &mut ParallelLane) -> CommandResult<()> {
    if lane.applied {
        return Ok(());
    }
    let dir = lane_dir(repo, &lane.id).await?;
    let staged_patch = lane_patch_path(&dir, ParallelLanePathSource::Staged);
    let working_patch = lane_patch_path(&dir, ParallelLanePathSource::Working);

    if staged_patch.exists() {
        run_git(
            Some(repo),
            vec![
                "apply".into(),
                "--check".into(),
                "--index".into(),
                staged_patch.to_string_lossy().to_string(),
            ],
        )
        .await?;
    }
    if working_patch.exists() {
        run_git(
            Some(repo),
            vec![
                "apply".into(),
                "--check".into(),
                working_patch.to_string_lossy().to_string(),
            ],
        )
        .await?;
    }
    for path in lane.paths.iter().filter(|path| path.source == ParallelLanePathSource::Untracked) {
        if repo.join(&path.path).exists() {
            return invalid("LANE_UNTRACKED_COLLISION", "Applying this lane would overwrite an untracked file.");
        }
    }

    if staged_patch.exists() {
        run_git(
            Some(repo),
            vec![
                "apply".into(),
                "--index".into(),
                staged_patch.to_string_lossy().to_string(),
            ],
        )
        .await?;
    }
    if working_patch.exists() {
        run_git(
            Some(repo),
            vec!["apply".into(), working_patch.to_string_lossy().to_string()],
        )
        .await?;
    }
    for path in lane.paths.iter().filter(|path| path.source == ParallelLanePathSource::Untracked) {
        let source = lane_untracked_root(&dir).join(&path.path);
        let destination = repo.join(&path.path);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(source, destination)?;
    }

    lane.applied = true;
    lane.status = ParallelLaneStatus::Dirty;
    lane.updated_at = now_millis().to_string();
    Ok(())
}

async fn unapply_lane_internal(repo: &Path, lane: &mut ParallelLane) -> CommandResult<()> {
    if !lane.applied {
        return Ok(());
    }
    let dir = lane_dir(repo, &lane.id).await?;
    let staged_patch = lane_patch_path(&dir, ParallelLanePathSource::Staged);
    let working_patch = lane_patch_path(&dir, ParallelLanePathSource::Working);

    if staged_patch.exists() {
        run_git(
            Some(repo),
            vec![
                "apply".into(),
                "--check".into(),
                "-R".into(),
                "--index".into(),
                staged_patch.to_string_lossy().to_string(),
            ],
        )
        .await?;
    }
    if working_patch.exists() {
        run_git(
            Some(repo),
            vec![
                "apply".into(),
                "--check".into(),
                "-R".into(),
                working_patch.to_string_lossy().to_string(),
            ],
        )
        .await?;
    }
    for path in lane.paths.iter().filter(|path| path.source == ParallelLanePathSource::Untracked) {
        let source = lane_untracked_root(&dir).join(&path.path);
        let destination = repo.join(&path.path);
        if destination.exists() {
            let expected = fs::read(&source).unwrap_or_default();
            let actual = fs::read(&destination).unwrap_or_default();
            if expected != actual {
                return invalid("LANE_UNTRACKED_MODIFIED", "Untracked lane file changed after apply; commit it or restore manually before unapplying.");
            }
        }
    }

    if staged_patch.exists() {
        run_git(
            Some(repo),
            vec![
                "apply".into(),
                "-R".into(),
                "--index".into(),
                staged_patch.to_string_lossy().to_string(),
            ],
        )
        .await?;
    }
    if working_patch.exists() {
        run_git(
            Some(repo),
            vec![
                "apply".into(),
                "-R".into(),
                working_patch.to_string_lossy().to_string(),
            ],
        )
        .await?;
    }
    for path in lane.paths.iter().filter(|path| path.source == ParallelLanePathSource::Untracked) {
        let destination = repo.join(&path.path);
        if destination.exists() {
            fs::remove_file(destination)?;
        }
    }

    lane.applied = false;
    lane.status = ParallelLaneStatus::Clean;
    lane.updated_at = now_millis().to_string();
    Ok(())
}

fn prune_undo_snapshots(snapshot_dir: &Path, keep: usize) {
    let Ok(entries) = fs::read_dir(snapshot_dir) else {
        return;
    };
    let mut snapshots: Vec<_> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("json"))
        .filter_map(|path| {
            let body = fs::read_to_string(&path).ok()?;
            let snapshot = serde_json::from_str::<UndoSnapshot>(&body).ok()?;
            Some((snapshot.created_at, snapshot.id, path))
        })
        .collect();
    snapshots.sort_by(|left, right| right.0.cmp(&left.0));

    for (_, id, metadata_path) in snapshots.into_iter().skip(keep) {
        let _ = fs::remove_file(metadata_path);
        let _ = fs::remove_file(snapshot_dir.join(format!("{id}.staged.patch")));
        let _ = fs::remove_file(snapshot_dir.join(format!("{id}.working.patch")));
    }
}

async fn current_branch_name(repo: &Path) -> Option<String> {
    run_git(
        Some(repo),
        vec!["rev-parse".into(), "--abbrev-ref".into(), "HEAD".into()],
    )
    .await
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty() && value != "HEAD")
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn safety_snapshot_id(label: &str) -> String {
    let slug = label
        .chars()
        .filter_map(|ch| {
            if ch.is_ascii_alphanumeric() {
                Some(ch.to_ascii_lowercase())
            } else if ch == '-' || ch == '_' || ch.is_ascii_whitespace() {
                Some('-')
            } else {
                None
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .take(6)
        .collect::<Vec<_>>()
        .join("-");
    let slug = if slug.is_empty() { "operation" } else { &slug };
    format!("{}-{slug}", now_millis())
}

fn validate_snapshot_id(value: &str) -> CommandResult<String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 140 {
        return invalid("INVALID_UNDO_SNAPSHOT", "Undo snapshot id is invalid.");
    }
    if !value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return invalid("INVALID_UNDO_SNAPSHOT", "Undo snapshot id is invalid.");
    }
    Ok(value.to_string())
}

async fn snapshot_for_interrupted_operation(repo: &Path) -> CommandResult<Option<RepoSnapshot>> {
    let snapshot = build_snapshot(repo, None).await?;
    if !snapshot.conflicts.is_empty()
        || matches!(
            snapshot.repository.worktree_state,
            WorktreeState::Merging | WorktreeState::Rebasing | WorktreeState::CherryPicking
        )
    {
        Ok(Some(snapshot))
    } else {
        Ok(None)
    }
}

async fn git_show_stage(repo: &Path, stage: u8, path: &str) -> CommandResult<String> {
    run_git(Some(repo), vec!["show".into(), format!(":{stage}:{path}")]).await
}

fn combine_conflict_sides(ours: &str, theirs: &str) -> String {
    let mut combined = String::new();
    combined.push_str(ours.trim_end_matches(['\n', '\r']));
    if !combined.is_empty() {
        combined.push('\n');
    }
    combined.push_str(theirs.trim_start_matches(['\n', '\r']));
    if !combined.ends_with('\n') {
        combined.push('\n');
    }
    combined
}

#[derive(Debug, Clone)]
struct GitHttpExtraHeader {
    scope: String,
    header: String,
}

#[derive(Debug, Default)]
struct PushContext {
    branch: Option<String>,
    upstream: Option<String>,
}

async fn push_context(repo: &Path, remote: Option<&str>, branch: Option<&str>) -> PushContext {
    let branch_name = if let Some(branch_name) = branch
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
    {
        Some(branch_name)
    } else {
        run_git(
            Some(repo),
            vec!["rev-parse".into(), "--abbrev-ref".into(), "HEAD".into()],
        )
        .await
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value != "HEAD")
    };

    let explicit_remote = remote
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let upstream = run_git(
        Some(repo),
        vec![
            "rev-parse".into(),
            "--abbrev-ref".into(),
            "--symbolic-full-name".into(),
            "@{u}".into(),
        ],
    )
    .await
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty() && value != "@{u}")
    .or_else(|| match (explicit_remote, branch_name.as_deref()) {
        (Some(remote_name), Some(branch_name)) => Some(format!("{remote_name}/{branch_name}")),
        _ => None,
    });

    PushContext {
        branch: branch_name,
        upstream,
    }
}

fn is_push_non_fast_forward_error(error: &AppError) -> bool {
    let detail = match error {
        AppError::GitFailed { detail, .. } => detail,
        _ => return false,
    };
    let lower = detail.to_ascii_lowercase();
    lower.contains("non-fast-forward")
        || lower.contains("(fetch first)")
        || (lower.contains("[rejected]") && lower.contains("fetch first"))
}

fn push_non_fast_forward_error(error: AppError, context: &PushContext) -> AppError {
    let detail = match error {
        AppError::GitFailed { detail, .. } => detail,
        other => return other,
    };
    let message = match (&context.branch, &context.upstream) {
        (Some(branch), Some(upstream)) => format!(
            "'refs/heads/{branch}' is behind 'refs/remotes/{upstream}'. Update your branch by doing a Pull."
        ),
        _ => git_error_summary(&detail),
    };

    AppError::GitActionRequired {
        code: "PUSH_NON_FAST_FORWARD",
        message,
        detail,
    }
}

async fn git_http_extra_headers(
    repo: Option<&Path>,
    args: &[String],
) -> CommandResult<Vec<GitHttpExtraHeader>> {
    if !is_git_network_command(args) {
        return Ok(Vec::new());
    }

    let urls = git_network_urls(repo, args).await;
    let azure_urls: Vec<_> = urls
        .iter()
        .filter_map(|url| azure_devops_auth_target(url))
        .collect();
    if azure_urls.is_empty() {
        return Ok(Vec::new());
    }

    let Some(pat) = read_azure_devops_pat()? else {
        return invalid(
            "AZURE_DEVOPS_TOKEN_MISSING",
            "Add an Azure DevOps Personal Access Token in Preferences > Integrations before running Git network operations against Azure DevOps HTTPS remotes.",
        );
    };

    let mut headers: Vec<GitHttpExtraHeader> = Vec::new();
    for target in azure_urls {
        if headers.iter().any(|header| header.scope == target.scope) {
            continue;
        }
        let auth = BASE64_STANDARD.encode(format!("{}:{pat}", target.username));
        headers.push(GitHttpExtraHeader {
            scope: target.scope,
            header: format!("Authorization: Basic {auth}"),
        });
    }
    Ok(headers)
}

fn is_git_network_command(args: &[String]) -> bool {
    matches!(
        args.first().map(String::as_str),
        Some("clone" | "fetch" | "pull" | "push" | "ls-remote")
    )
}

async fn git_network_urls(repo: Option<&Path>, args: &[String]) -> Vec<String> {
    match args.first().map(String::as_str) {
        Some("clone" | "ls-remote") => args
            .iter()
            .skip(1)
            .find(|value| !value.starts_with('-'))
            .cloned()
            .into_iter()
            .collect(),
        Some("fetch" | "pull" | "push") => {
            let Some(repo) = repo else {
                return Vec::new();
            };
            let remote_name = remote_name_from_network_args(args)
                .or_else(|| current_upstream_remote(repo).ok().flatten());
            git_remote_urls(repo, remote_name.as_deref()).unwrap_or_default()
        }
        _ => Vec::new(),
    }
}

fn remote_name_from_network_args(args: &[String]) -> Option<String> {
    match args.first().map(String::as_str) {
        Some("fetch" | "pull") => args
            .iter()
            .skip(1)
            .find(|value| !value.starts_with('-'))
            .cloned(),
        Some("push") => args
            .iter()
            .skip(1)
            .find(|value| !value.starts_with('-'))
            .cloned(),
        _ => None,
    }
}

fn current_upstream_remote(repo: &Path) -> CommandResult<Option<String>> {
    let output = std::process::Command::new("git")
        .env("GIT_TERMINAL_PROMPT", "0")
        .arg("-C")
        .arg(repo)
        .args(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
        .output()?;
    if !output.status.success() {
        return Ok(None);
    }
    let upstream = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(upstream
        .split_once('/')
        .map(|(remote, _)| remote.to_string())
        .filter(|remote| !remote.trim().is_empty()))
}

fn git_remote_urls(repo: &Path, remote_name: Option<&str>) -> CommandResult<Vec<String>> {
    let mut urls = Vec::new();
    if let Some(remote_name) = remote_name {
        for key in [
            format!("remote.{remote_name}.url"),
            format!("remote.{remote_name}.pushurl"),
        ] {
            urls.extend(git_config_values(repo, &["--get-all", &key])?);
        }
        return Ok(urls);
    }

    let mut lines = git_config_values(repo, &["--get-regexp", r"^remote\..*\.url$"])?;
    lines.extend(git_config_values(
        repo,
        &["--get-regexp", r"^remote\..*\.pushurl$"],
    )?);
    for line in lines {
        if let Some((_, value)) = line.split_once(' ') {
            urls.push(value.to_string());
        }
    }
    Ok(urls)
}

fn git_config_values(repo: &Path, args: &[&str]) -> CommandResult<Vec<String>> {
    let output = std::process::Command::new("git")
        .env("GIT_TERMINAL_PROMPT", "0")
        .arg("-C")
        .arg(repo)
        .arg("config")
        .args(args)
        .output()?;
    if !output.status.success() {
        return Ok(Vec::new());
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToString::to_string)
        .collect())
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AzureDevOpsAuthTarget {
    scope: String,
    username: String,
}

fn azure_devops_auth_target(url: &str) -> Option<AzureDevOpsAuthTarget> {
    let lower = url.to_ascii_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return None;
    }

    let protocol_end = url.find("://")?;
    let scheme = url[..protocol_end].to_ascii_lowercase();
    let rest = &url[protocol_end + 3..];
    let authority = rest.split('/').next().unwrap_or_default();
    let host_start = authority.rfind('@').map_or(0, |index| index + 1);
    let host = &authority[host_start..];
    let host_lower = host.to_ascii_lowercase();
    let host_without_port = host_lower.split(':').next().unwrap_or_default();
    if host_without_port != "dev.azure.com" && !host_without_port.ends_with(".visualstudio.com") {
        return None;
    }

    let username = authority
        .get(..host_start.saturating_sub(1))
        .and_then(|value| value.rsplit('@').next())
        .and_then(|value| value.split(':').next())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("opengit")
        .to_string();

    Some(AzureDevOpsAuthTarget {
        scope: format!("{scheme}://{host}/"),
        username,
    })
}

fn parse_status(raw: &str) -> (BranchStatus, Vec<FileChange>, Vec<Conflict>) {
    let mut branch = BranchStatus::default();
    let mut changes = Vec::new();
    let mut conflicts = Vec::new();

    for record in raw.split('\0').filter(|record| !record.is_empty()) {
        if let Some(value) = record.strip_prefix("# branch.oid ") {
            branch.head_oid = Some(value.to_string());
            continue;
        }
        if let Some(value) = record.strip_prefix("# branch.head ") {
            branch.current_branch = Some(value.to_string());
            continue;
        }
        if let Some(value) = record.strip_prefix("# branch.upstream ") {
            branch.upstream = Some(value.to_string());
            continue;
        }
        if let Some(value) = record.strip_prefix("# branch.ab ") {
            let mut parts = value.split_whitespace();
            branch.ahead = parts
                .next()
                .and_then(|part| part.trim_start_matches('+').parse::<i32>().ok())
                .unwrap_or(0);
            branch.behind = parts
                .next()
                .and_then(|part| part.trim_start_matches('-').parse::<i32>().ok())
                .unwrap_or(0);
            continue;
        }
        if let Some(path) = record.strip_prefix("? ") {
            changes.push(file_change(
                path,
                None,
                "?",
                "?",
                FileStatus::Untracked,
                false,
            ));
            continue;
        }
        if let Some(path) = record.strip_prefix("! ") {
            changes.push(file_change(
                path,
                None,
                "!",
                "!",
                FileStatus::Ignored,
                false,
            ));
            continue;
        }
        if record.starts_with("1 ") {
            let parts: Vec<&str> = record.splitn(9, ' ').collect();
            if let (Some(xy), Some(path)) = (parts.get(1), parts.get(8)) {
                changes.push(change_from_xy(path, None, xy, None));
            }
            continue;
        }
        if record.starts_with("2 ") {
            let parts: Vec<&str> = record.splitn(10, ' ').collect();
            if let (Some(xy), Some(score), Some(path)) = (parts.get(1), parts.get(8), parts.get(9))
            {
                let rename_score = score.trim_start_matches(['R', 'C']).parse::<i32>().ok();
                changes.push(change_from_xy(path, None, xy, rename_score));
            }
            continue;
        }
        if record.starts_with("u ") {
            let parts: Vec<&str> = record.splitn(11, ' ').collect();
            if let (Some(xy), Some(path)) = (parts.get(1), parts.get(10)) {
                let change = change_from_xy(path, None, xy, None);
                conflicts.push(Conflict {
                    path: (*path).to_string(),
                    kind: (*xy).to_string(),
                    stages: vec!["base".into(), "ours".into(), "theirs".into()],
                    resolution_state: "unresolved".into(),
                });
                changes.push(FileChange {
                    status: FileStatus::Conflicted,
                    ..change
                });
            }
        }
    }

    (branch, changes, conflicts)
}

fn change_from_xy(
    path: &str,
    old_path: Option<String>,
    xy: &str,
    rename_score: Option<i32>,
) -> FileChange {
    let mut chars = xy.chars();
    let index = normalize_status_char(chars.next().unwrap_or(' '));
    let worktree = normalize_status_char(chars.next().unwrap_or(' '));
    let status = if xy.contains('U') || xy == "AA" || xy == "DD" {
        FileStatus::Conflicted
    } else if index == 'R' || worktree == 'R' {
        FileStatus::Renamed
    } else if index == 'C' || worktree == 'C' {
        FileStatus::Copied
    } else if index == 'A' || worktree == 'A' {
        FileStatus::Added
    } else if index == 'D' || worktree == 'D' {
        FileStatus::Deleted
    } else if index == 'M' || worktree == 'M' {
        FileStatus::Modified
    } else {
        FileStatus::Unknown
    };

    file_change(
        path,
        old_path,
        &index.to_string(),
        &worktree.to_string(),
        status,
        true,
    )
    .with_rename_score(rename_score)
}

fn normalize_status_char(value: char) -> char {
    if value == '.' {
        ' '
    } else {
        value
    }
}

trait FileChangeExt {
    fn with_rename_score(self, rename_score: Option<i32>) -> Self;
}

impl FileChangeExt for FileChange {
    fn with_rename_score(mut self, rename_score: Option<i32>) -> Self {
        self.rename_score = rename_score;
        self
    }
}

fn file_change(
    path: &str,
    old_path: Option<String>,
    index_status: &str,
    worktree_status: &str,
    status: FileStatus,
    tracked: bool,
) -> FileChange {
    FileChange {
        path: path.to_string(),
        old_path,
        status,
        index_status: index_status.to_string(),
        worktree_status: worktree_status.to_string(),
        staged: tracked && index_status != " " && index_status != "?",
        unstaged: worktree_status != " " || index_status == "?",
        binary: false,
        rename_score: None,
    }
}

fn parse_branches(raw: &str, ahead: i32, behind: i32) -> Vec<Branch> {
    raw.lines()
        .filter_map(|line| {
            let mut parts = line.split('\u{1f}');
            let name = parts.next()?.to_string();
            let full_ref = parts.next().unwrap_or_default().to_string();
            let upstream = optional_string(parts.next().unwrap_or_default());
            let is_current = parts.next().unwrap_or_default() == "*";

            // Skip the remote's symbolic HEAD pointer (e.g. `origin/HEAD`) — it is an
            // alias, not a checkoutable branch.
            if full_ref.starts_with("refs/remotes/") && name.ends_with("/HEAD") {
                return None;
            }

            Some(Branch {
                name: name.clone(),
                full_ref,
                upstream,
                ahead: is_current.then_some(ahead),
                behind: is_current.then_some(behind),
                is_current,
                is_protected: matches!(name.as_str(), "main" | "master" | "develop" | "trunk"),
            })
        })
        .collect()
}

fn parse_remotes(raw: &str) -> Vec<Remote> {
    let mut remotes: BTreeMap<String, Remote> = BTreeMap::new();

    for line in raw.lines() {
        let mut parts = line.split_whitespace();
        let Some(name) = parts.next() else { continue };
        let Some(url) = parts.next() else { continue };
        let kind = parts.next().unwrap_or_default();
        let entry = remotes.entry(name.to_string()).or_insert_with(|| Remote {
            name: name.to_string(),
            fetch_url: None,
            push_url: None,
            provider: provider_from_url(url),
        });

        let redacted = redact_secrets(url);
        if kind == "(fetch)" {
            entry.fetch_url = Some(redacted);
        } else if kind == "(push)" {
            entry.push_url = Some(redacted);
        }
    }

    remotes.into_values().collect()
}

fn parse_stashes(raw: &str) -> Vec<Stash> {
    raw.lines()
        .filter_map(|line| {
            let mut parts = line.split('\u{1f}');
            let index = parts.next()?.to_string();
            let sha = parts.next().unwrap_or_default().to_string();
            let message = parts.next().unwrap_or_default().to_string();
            let branch = message
                .strip_prefix("WIP on ")
                .and_then(|rest| rest.split_once(':'))
                .map(|(branch, _)| branch.to_string());

            Some(Stash {
                index,
                sha,
                branch,
                message,
                timestamp: None,
            })
        })
        .collect()
}

fn parse_commits(raw: &str) -> Vec<Commit> {
    raw.split('\u{1e}')
        .filter(|entry| !entry.trim().is_empty())
        .filter_map(|entry| {
            let entry = entry.trim_matches(['\n', '\r']);
            let mut parts = entry.split('\u{1f}');
            let sha = parts.next()?.trim().to_string();
            let parents = parts
                .next()
                .unwrap_or_default()
                .split_whitespace()
                .map(ToString::to_string)
                .collect();
            let author = parts.next().unwrap_or_default().to_string();
            let author_email = parts.next().unwrap_or_default().to_string();
            let date = parts.next().unwrap_or_default().to_string();
            let message = parts.next().unwrap_or_default().to_string();
            let refs = parts
                .next()
                .unwrap_or_default()
                .split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .collect();

            Some(Commit {
                sha,
                parents,
                author,
                author_email,
                date,
                message,
                refs,
            })
        })
        .collect()
}

fn history_log_args(history_limit: u32) -> Vec<String> {
    vec![
        "log".into(),
        "--all".into(),
        "--author-date-order".into(),
        "--date=iso-strict".into(),
        "--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%s%x1f%D%x1e".into(),
        "-n".into(),
        history_limit.to_string(),
    ]
}

fn history_page_log_args(skip: u32, limit: u32) -> Vec<String> {
    vec![
        "log".into(),
        "--all".into(),
        "--author-date-order".into(),
        "--date=iso-strict".into(),
        "--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%s%x1f%D%x1e".into(),
        "--skip".into(),
        skip.to_string(),
        "-n".into(),
        limit.to_string(),
    ]
}

fn history_search_log_args() -> Vec<String> {
    vec![
        "log".into(),
        "--all".into(),
        "--author-date-order".into(),
        "--date=iso-strict".into(),
        "--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%s%x1f%D%x1e".into(),
    ]
}

fn commit_show_args(sha: &str) -> Vec<String> {
    vec![
        "show".into(),
        "--no-patch".into(),
        "--date=iso-strict".into(),
        "--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%s%x1f%D%x1e".into(),
        sha.to_string(),
    ]
}

fn history_search_terms(query: &str) -> Vec<String> {
    query
        .to_lowercase()
        .split_whitespace()
        .map(str::trim)
        .filter(|term| !term.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn commit_matches_history_search(commit: &Commit, terms: &[String]) -> bool {
    let fields = vec![
        commit.sha.clone(),
        short_commit_sha(&commit.sha),
        commit.author.clone(),
        commit.author_email.clone(),
        commit.message.clone(),
        commit.refs.join(" "),
        commit.date.clone(),
    ];

    let searchable_text = fields.join(" ").to_lowercase();

    terms.iter().all(|term| searchable_text.contains(term))
}

fn short_commit_sha(sha: &str) -> String {
    sha.chars().take(7).collect()
}

async fn commit_base_ref(repo: &Path, sha: &str) -> CommandResult<String> {
    const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
    let output = run_git(
        Some(repo),
        vec![
            "rev-list".into(),
            "--parents".into(),
            "-n".into(),
            "1".into(),
            sha.to_string(),
        ],
    )
    .await?;
    let mut parts = output.split_whitespace();
    let Some(_commit) = parts.next() else {
        return invalid("INVALID_REF", "Commit could not be resolved.");
    };

    Ok(parts.next().unwrap_or(EMPTY_TREE).to_string())
}

fn parse_commit_files(raw: &str) -> Vec<CommitFile> {
    let mut parts = raw.split('\0').filter(|part| !part.is_empty());
    let mut files = Vec::new();

    while let Some(status_token) = parts.next() {
        let status = status_from_name_status(status_token);
        if matches!(status, FileStatus::Renamed | FileStatus::Copied) {
            let Some(old_path) = parts.next() else { break };
            let Some(path) = parts.next() else { break };
            files.push(CommitFile {
                path: path.to_string(),
                old_path: Some(old_path.to_string()),
                status,
            });
        } else if let Some(path) = parts.next() {
            files.push(CommitFile {
                path: path.to_string(),
                old_path: None,
                status,
            });
        }
    }

    files
}

fn status_from_name_status(status: &str) -> FileStatus {
    match status.chars().next().unwrap_or(' ') {
        'A' => FileStatus::Added,
        'M' => FileStatus::Modified,
        'D' => FileStatus::Deleted,
        'R' => FileStatus::Renamed,
        'C' => FileStatus::Copied,
        'U' => FileStatus::Conflicted,
        _ => FileStatus::Unknown,
    }
}

async fn detect_worktree_state(
    repo: &Path,
    branch: &BranchStatus,
    changes: &[FileChange],
) -> WorktreeState {
    match detect_git_operation(repo).await {
        GitOperationState::Rebasing => return WorktreeState::Rebasing,
        GitOperationState::Merging => return WorktreeState::Merging,
        GitOperationState::CherryPicking => return WorktreeState::CherryPicking,
        GitOperationState::None => {}
    }

    if branch.current_branch.as_deref() == Some("(detached)")
        || branch.current_branch.as_deref() == Some("HEAD")
    {
        return WorktreeState::Detached;
    }

    if changes.is_empty() {
        WorktreeState::Clean
    } else {
        WorktreeState::Dirty
    }
}

async fn detect_git_operation(repo: &Path) -> GitOperationState {
    let Some(git_dir) = git_dir_path(repo).await else {
        return GitOperationState::None;
    };

    if git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists() {
        return GitOperationState::Rebasing;
    }
    if git_dir.join("MERGE_HEAD").exists() {
        return GitOperationState::Merging;
    }
    if git_dir.join("CHERRY_PICK_HEAD").exists() {
        return GitOperationState::CherryPicking;
    }

    GitOperationState::None
}

async fn git_dir_path(repo: &Path) -> Option<PathBuf> {
    run_git(Some(repo), vec!["rev-parse".into(), "--git-dir".into()])
        .await
        .ok()
        .map(|value| {
            let git_dir = PathBuf::from(value.trim());
            if git_dir.is_absolute() {
                git_dir
            } else {
                repo.join(git_dir)
            }
        })
}

/// Remove a stale Git lock file (e.g. `.git/index.lock`) left behind by a crashed or
/// interrupted process, then return a fresh snapshot. Guarded so it can only ever
/// delete a `*.lock` file that lives inside this repository's own Git directory.
#[tauri::command]
async fn git_clear_lock(repo_path: String, lock_path: String) -> CommandResult<RepoSnapshot> {
    let repo = Path::new(&repo_path);
    let lock = PathBuf::from(&lock_path);

    if lock.extension().and_then(|ext| ext.to_str()) != Some("lock") {
        return invalid(
            "INVALID_LOCK_PATH",
            "Refusing to remove a file that is not a Git lock.",
        );
    }

    let git_dir = git_dir_path(repo).await.ok_or_else(|| AppError::InvalidInput {
        code: "NOT_A_REPOSITORY",
        message: "This folder is not a Git repository.".to_string(),
    })?;
    let git_dir = git_dir.canonicalize().unwrap_or(git_dir);
    let lock_parent = lock
        .parent()
        .map(|parent| parent.canonicalize().unwrap_or_else(|_| parent.to_path_buf()))
        .unwrap_or_default();
    if !lock_parent.starts_with(&git_dir) {
        return invalid(
            "INVALID_LOCK_PATH",
            "Refusing to remove a lock file outside this repository's Git directory.",
        );
    }

    match std::fs::remove_file(&lock) {
        Ok(()) => {}
        // Already gone — treat as success and just refresh.
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => return Err(AppError::Io(err.to_string())),
    }

    build_snapshot(repo, None).await
}

fn validate_file_paths(paths: &[String]) -> CommandResult<Vec<String>> {
    if paths.is_empty() {
        return invalid("INVALID_PATH", "At least one file path is required.");
    }

    let mut safe_paths = Vec::with_capacity(paths.len());
    for path in paths {
        if path.trim().is_empty() {
            return invalid("INVALID_PATH", "File paths cannot be empty.");
        }

        let candidate = Path::new(path);
        if candidate.is_absolute() {
            return invalid("INVALID_PATH", "File paths must be repository-relative.");
        }

        for component in candidate.components() {
            if matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            ) {
                return invalid("INVALID_PATH", "File paths cannot leave the repository.");
            }
        }

        safe_paths.push(path.clone());
    }

    Ok(safe_paths)
}

fn validate_ref_arg(value: &str, label: &str) -> CommandResult<()> {
    if value.trim().is_empty() {
        return invalid("INVALID_REF", &format!("{label} is required."));
    }
    if value.starts_with('-') || value.chars().any(|ch| ch.is_control()) {
        return invalid(
            "INVALID_REF",
            &format!("{label} contains unsafe characters."),
        );
    }
    Ok(())
}

fn validate_stash_ref(value: &str) -> CommandResult<()> {
    validate_ref_arg(value, "stash reference")?;
    if !value.starts_with("stash@{") {
        return invalid("INVALID_REF", "Stash reference must use stash@{n} format.");
    }
    Ok(())
}

fn validate_remote_url(value: &str) -> CommandResult<()> {
    if value.trim().is_empty() {
        return invalid("INVALID_REMOTE_URL", "Remote URL is required.");
    }
    if value.starts_with('-') || value.chars().any(|ch| ch.is_control()) {
        return invalid(
            "INVALID_REMOTE_URL",
            "Remote URL contains unsafe characters.",
        );
    }
    Ok(())
}

fn openai_key_entry() -> CommandResult<Entry> {
    Entry::new(OPENAI_KEY_SERVICE, OPENAI_KEY_ACCOUNT).map_err(map_keyring_error)
}

fn azure_devops_pat_entry() -> CommandResult<Entry> {
    Entry::new(OPENAI_KEY_SERVICE, AZURE_DEVOPS_PAT_ACCOUNT).map_err(map_keyring_error)
}

fn read_openai_api_key() -> CommandResult<Option<String>> {
    match openai_key_entry()?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(map_keyring_error(error)),
    }
}

fn read_azure_devops_pat() -> CommandResult<Option<String>> {
    match azure_devops_pat_entry()?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(map_keyring_error(error)),
    }
}

fn claude_key_entry() -> CommandResult<Entry> {
    Entry::new(OPENAI_KEY_SERVICE, CLAUDE_KEY_ACCOUNT).map_err(map_keyring_error)
}

fn read_claude_api_key() -> CommandResult<Option<String>> {
    match claude_key_entry()?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(map_keyring_error(error)),
    }
}

fn github_pat_entry() -> CommandResult<Entry> {
    Entry::new(OPENAI_KEY_SERVICE, GITHUB_PAT_ACCOUNT).map_err(map_keyring_error)
}

fn read_github_pat() -> CommandResult<Option<String>> {
    match github_pat_entry()?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(map_keyring_error(error)),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AzureProfileResponse {
    id: String,
    display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AzureListResponse<T> {
    value: Vec<T>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AzureAccountWire {
    account_id: Option<String>,
    account_name: String,
    account_uri: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AzureProjectWire {
    id: String,
    name: String,
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AzureRepositoryWire {
    id: String,
    name: String,
    remote_url: Option<String>,
    web_url: Option<String>,
    default_branch: Option<String>,
    project: Option<AzureRepositoryProjectWire>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AzureRepositoryProjectWire {
    id: String,
    name: String,
    url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AzureRemoteParts {
    org: String,
    project: Option<String>,
    repo: String,
}

async fn list_azure_devops_repositories(local_paths: Vec<String>) -> CommandResult<ProviderRepoCatalog> {
    let pat = read_azure_devops_pat()?.ok_or_else(|| AppError::InvalidInput {
        code: "AZURE_DEVOPS_TOKEN_MISSING",
        message:
            "Add an Azure DevOps Personal Access Token in Preferences > Integrations before listing Azure DevOps repositories."
                .to_string(),
    })?;
    let client = reqwest::Client::new();
    let local_refs = local_repository_refs(local_paths).await;

    let mut accounts = Vec::new();
    let mut projects = Vec::new();
    let mut repositories = Vec::new();

    let account_discovery = discover_azure_devops_accounts(&client, &pat).await;
    if let Ok(azure_accounts) = account_discovery {
        let mut fallback_error = None;
        for account in azure_accounts {
            let account_name = account.account_name.clone();
            if let Err(error) = append_azure_account_repositories(
                &client,
                &pat,
                account,
                &local_refs,
                &mut accounts,
                &mut projects,
                &mut repositories,
            )
            .await
            {
                fallback_error = Some(error);
                if let Err(error) = append_azure_org_repositories(
                    &client,
                    &pat,
                    &account_name,
                    &local_refs,
                    &mut accounts,
                    &mut projects,
                    &mut repositories,
                )
                .await
                {
                    fallback_error = Some(error);
                }
            }
        }
        if repositories.is_empty() {
            if let Some(error) = fallback_error {
                return Err(error);
            }
        }
    } else {
        let org_hints = azure_org_hints_from_local_refs(&local_refs);
        if org_hints.is_empty() {
            return Err(azure_discovery_unavailable(account_discovery.err()));
        }
        let mut fallback_error = None;
        for org in org_hints {
            if let Err(error) = append_azure_org_repositories(
                &client,
                &pat,
                &org,
                &local_refs,
                &mut accounts,
                &mut projects,
                &mut repositories,
            )
            .await
            {
                fallback_error = Some(error);
            }
        }
        if repositories.is_empty() {
            return Err(fallback_error.unwrap_or_else(|| azure_discovery_unavailable(None)));
        }
    }

    repositories.sort_by(|left, right| {
        left.account_name
            .cmp(&right.account_name)
            .then_with(|| left.project_name.cmp(&right.project_name))
            .then_with(|| left.name.cmp(&right.name))
    });

    Ok(ProviderRepoCatalog {
        provider: GitProvider::AzureDevops,
        accounts,
        projects,
        repositories,
        refreshed_at: now_millis().to_string(),
    })
}

async fn discover_azure_devops_accounts(
    client: &reqwest::Client,
    pat: &str,
) -> CommandResult<Vec<AzureAccountWire>> {
    let profile: AzureProfileResponse = azure_get_json(
        &client,
        "https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1",
        &pat,
    )
    .await?;
    let _profile_name = profile.display_name.as_deref().unwrap_or("Azure DevOps");
    let accounts_url = format!(
        "https://app.vssps.visualstudio.com/_apis/accounts?memberId={}&api-version=7.1",
        url_query_value(&profile.id)
    );
    azure_get_paged_values(client, &accounts_url, pat).await
}

async fn append_azure_account_repositories(
    client: &reqwest::Client,
    pat: &str,
    account: AzureAccountWire,
    local_refs: &[LocalRepositoryRef],
    accounts: &mut Vec<ProviderAccount>,
    projects: &mut Vec<ProviderProject>,
    repositories: &mut Vec<ProviderRepository>,
) -> CommandResult<()> {
    let account_name = account.account_name.trim().to_string();
    if account_name.is_empty() {
        return Ok(());
    }
    let account_id = account
        .account_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| account_name.clone());
    push_provider_account(accounts, &account_id, &account_name, account.account_uri.clone());

    let projects_url = format!(
        "https://dev.azure.com/{}/_apis/projects?api-version=7.1&$top=1000",
        url_path_segment(&account_name)
    );
    let azure_projects: Vec<AzureProjectWire> =
        azure_get_paged_values(client, &projects_url, pat).await?;

    for project in azure_projects {
        let project_name = project.name.trim().to_string();
        if project_name.is_empty() {
            continue;
        }
        push_provider_project(projects, &account_id, &project.id, &project_name, project.url.clone());
        let repos_url = format!(
            "https://dev.azure.com/{}/{}/_apis/git/repositories?api-version=7.1",
            url_path_segment(&account_name),
            url_path_segment(&project_name)
        );
        let azure_repos: Vec<AzureRepositoryWire> =
            azure_get_paged_values(client, &repos_url, pat).await?;
        for repo in azure_repos {
            push_azure_provider_repository(
                repositories,
                &account_id,
                &account_name,
                Some(&project.id),
                Some(&project_name),
                repo,
                local_refs,
            );
        }
    }
    Ok(())
}

async fn append_azure_org_repositories(
    client: &reqwest::Client,
    pat: &str,
    org: &str,
    local_refs: &[LocalRepositoryRef],
    accounts: &mut Vec<ProviderAccount>,
    projects: &mut Vec<ProviderProject>,
    repositories: &mut Vec<ProviderRepository>,
) -> CommandResult<()> {
    let account_id = org.to_string();
    push_provider_account(
        accounts,
        &account_id,
        org,
        Some(format!("https://dev.azure.com/{}", url_path_segment(org))),
    );
    let repos_url = format!(
        "https://dev.azure.com/{}/_apis/git/repositories?api-version=7.1&$top=1000",
        url_path_segment(org)
    );
    let azure_repos: Vec<AzureRepositoryWire> =
        azure_get_paged_values(client, &repos_url, pat).await?;
    for repo in azure_repos {
        let project_id = repo.project.as_ref().map(|project| project.id.clone());
        let project_name = repo.project.as_ref().map(|project| project.name.clone());
        if let Some(project) = &repo.project {
            push_provider_project(
                projects,
                &account_id,
                &project.id,
                &project.name,
                project.url.clone(),
            );
        }
        push_azure_provider_repository(
            repositories,
            &account_id,
            org,
            project_id.as_deref(),
            project_name.as_deref(),
            repo,
            local_refs,
        );
    }
    Ok(())
}

fn push_provider_account(
    accounts: &mut Vec<ProviderAccount>,
    account_id: &str,
    account_name: &str,
    url: Option<String>,
) {
    if accounts
        .iter()
        .any(|account| account.id == account_id || account.name.eq_ignore_ascii_case(account_name))
    {
        return;
    }
    accounts.push(ProviderAccount {
        id: account_id.to_string(),
        provider: GitProvider::AzureDevops,
        name: account_name.to_string(),
        display_name: Some(account_name.to_string()),
        url,
    });
}

fn push_provider_project(
    projects: &mut Vec<ProviderProject>,
    account_id: &str,
    project_id: &str,
    project_name: &str,
    url: Option<String>,
) {
    if projects
        .iter()
        .any(|project| project.account_id == account_id && project.id == project_id)
    {
        return;
    }
    projects.push(ProviderProject {
        id: project_id.to_string(),
        provider: GitProvider::AzureDevops,
        account_id: account_id.to_string(),
        name: project_name.to_string(),
        url,
    });
}

fn push_azure_provider_repository(
    repositories: &mut Vec<ProviderRepository>,
    account_id: &str,
    account_name: &str,
    project_id: Option<&str>,
    project_name: Option<&str>,
    repo: AzureRepositoryWire,
    local_refs: &[LocalRepositoryRef],
) {
    let project_name_value = project_name.map(ToString::to_string);
    let repo_id = repo_provider_id(
        GitProvider::AzureDevops,
        account_name,
        project_name.unwrap_or_default(),
        &repo.name,
        &repo.id,
    );
    if repositories.iter().any(|existing| existing.id == repo_id) {
        return;
    }
    let clone_url = repo.remote_url.as_ref().map(|url| ProviderCloneUrl {
        kind: provider_clone_url_kind(url),
        url: url.clone(),
        safe_url: redact_secrets(url),
    });
    let local_match = repo
        .remote_url
        .as_deref()
        .map(|url| local_match_for_remote(url, local_refs))
        .unwrap_or_else(|| LocalRepoMatch {
            status: LocalRepoMatchStatus::NotCloned,
            path: None,
            matched_remote: None,
        });
    repositories.push(ProviderRepository {
        id: repo_id,
        provider: GitProvider::AzureDevops,
        account_id: account_id.to_string(),
        account_name: account_name.to_string(),
        project_id: project_id.map(ToString::to_string),
        project_name: project_name_value,
        name: repo.name,
        default_branch: repo.default_branch.as_deref().map(normalize_default_branch),
        web_url: repo.web_url,
        clone_url,
        local_match,
    });
}

fn azure_org_hints_from_local_refs(local_refs: &[LocalRepositoryRef]) -> Vec<String> {
    let mut orgs = BTreeMap::new();
    for local_ref in local_refs {
        for remote in &local_ref.remotes {
            for url in [remote.fetch_url.as_deref(), remote.push_url.as_deref()] {
                let Some(url) = url else {
                    continue;
                };
                if let Some(parts) = azure_remote_parts(url) {
                    orgs.entry(parts.org.to_ascii_lowercase()).or_insert(parts.org);
                }
            }
        }
    }
    orgs.into_values().collect()
}

fn azure_discovery_unavailable(error: Option<AppError>) -> AppError {
    let detail = error
        .map(|error| format!("{error:?}"))
        .unwrap_or_else(|| "No Azure DevOps organization hints were available.".to_string());
    AppError::ProviderFailed {
        code: "AZURE_DEVOPS_DISCOVERY_UNAVAILABLE",
        message: "Azure DevOps account discovery was unavailable for this PAT. OpenGit can still list repos when it can infer an organization from an open, recent, or located Azure DevOps repository.".to_string(),
        detail,
    }
}

async fn azure_get_paged_values<T>(
    client: &reqwest::Client,
    base_url: &str,
    pat: &str,
) -> CommandResult<Vec<T>>
where
    T: for<'de> Deserialize<'de>,
{
    let mut values = Vec::new();
    let mut continuation: Option<String> = None;
    loop {
        let url = match continuation.as_deref() {
            Some(token) => append_query_param(base_url, "continuationToken", token),
            None => base_url.to_string(),
        };
        let (page, next): (AzureListResponse<T>, Option<String>) =
            azure_get_json_with_continuation(client, &url, pat).await?;
        values.extend(page.value);
        if next.as_deref().is_none_or(str::is_empty) {
            break;
        }
        continuation = next;
    }
    Ok(values)
}

async fn azure_get_json<T>(client: &reqwest::Client, url: &str, pat: &str) -> CommandResult<T>
where
    T: for<'de> Deserialize<'de>,
{
    let (value, _continuation) = azure_get_json_with_continuation(client, url, pat).await?;
    Ok(value)
}

async fn azure_get_json_with_continuation<T>(
    client: &reqwest::Client,
    url: &str,
    pat: &str,
) -> CommandResult<(T, Option<String>)>
where
    T: for<'de> Deserialize<'de>,
{
    let response = client
        .get(url)
        .basic_auth("", Some(pat))
        .send()
        .await
        .map_err(|error| AppError::ProviderFailed {
            code: "PROVIDER_REQUEST_FAILED",
            message: "Azure DevOps request failed.".to_string(),
            detail: error.to_string(),
        })?;
    let status = response.status();
    let continuation = response
        .headers()
        .get("x-ms-continuationtoken")
        .and_then(|value| value.to_str().ok())
        .map(ToString::to_string);
    let body = response.text().await.map_err(|error| AppError::ProviderFailed {
        code: "PROVIDER_REQUEST_FAILED",
        message: "Azure DevOps response could not be read.".to_string(),
        detail: error.to_string(),
    })?;

    if !status.is_success() {
        return Err(azure_provider_error(status, url, &body));
    }

    let parsed = serde_json::from_str::<T>(&body).map_err(|error| AppError::ProviderFailed {
        code: "PROVIDER_RESPONSE_INVALID",
        message: "Azure DevOps returned a response OpenGit could not parse.".to_string(),
        detail: format!("{error}: {body}"),
    })?;
    Ok((parsed, continuation))
}

fn azure_provider_error(status: reqwest::StatusCode, url: &str, body: &str) -> AppError {
    let code = if status == reqwest::StatusCode::UNAUTHORIZED
        || status == reqwest::StatusCode::FORBIDDEN
    {
        "AZURE_DEVOPS_AUTH_FAILED"
    } else {
        "PROVIDER_REQUEST_FAILED"
    };
    let message = if code == "AZURE_DEVOPS_AUTH_FAILED" {
        if url.contains("app.vssps.visualstudio.com") {
            "Azure DevOps account discovery is unavailable for this PAT. OpenGit will try Azure organizations from local remotes when possible.".to_string()
        } else {
            "Azure DevOps denied this request. The saved PAT may still be valid, but this organization or API needs matching Code read access.".to_string()
        }
    } else {
        format!("Azure DevOps returned HTTP {status}.")
    };
    AppError::ProviderFailed {
        code,
        message,
        detail: format!("{url}\n{body}"),
    }
}

#[derive(Debug, Deserialize)]
struct GithubUserWire {
    login: String,
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubRepositoryWire {
    id: u64,
    name: String,
    owner: Option<GithubOwnerWire>,
    clone_url: Option<String>,
    html_url: Option<String>,
    default_branch: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubOwnerWire {
    login: String,
    html_url: Option<String>,
}

const GITHUB_REPOS_PER_PAGE: usize = 100;
const GITHUB_REPOS_MAX: usize = 300;

async fn list_github_repositories(local_paths: Vec<String>) -> CommandResult<ProviderRepoCatalog> {
    let pat = read_github_pat()?.ok_or_else(|| AppError::InvalidInput {
        code: "GITHUB_TOKEN_MISSING",
        message:
            "Add a GitHub Personal Access Token in Preferences > Integrations before listing GitHub repositories."
                .to_string(),
    })?;
    let client = reqwest::Client::new();
    let local_refs = local_repository_refs(local_paths).await;

    let mut accounts = Vec::new();
    let mut repositories = Vec::new();

    let mut page = 1;
    loop {
        let url = format!(
            "{GITHUB_API_BASE}/user/repos?per_page={GITHUB_REPOS_PER_PAGE}&sort=pushed&page={page}"
        );
        let github_repos: Vec<GithubRepositoryWire> = github_get_json(&client, &url, &pat).await?;
        let page_len = github_repos.len();
        for repo in github_repos {
            push_github_provider_repository(&mut accounts, &mut repositories, repo, &local_refs);
        }
        if page_len < GITHUB_REPOS_PER_PAGE || repositories.len() >= GITHUB_REPOS_MAX {
            break;
        }
        page += 1;
    }

    repositories.sort_by(|left, right| {
        left.account_name
            .cmp(&right.account_name)
            .then_with(|| left.name.cmp(&right.name))
    });

    Ok(ProviderRepoCatalog {
        provider: GitProvider::Github,
        accounts,
        projects: Vec::new(),
        repositories,
        refreshed_at: now_millis().to_string(),
    })
}

fn push_github_provider_repository(
    accounts: &mut Vec<ProviderAccount>,
    repositories: &mut Vec<ProviderRepository>,
    repo: GithubRepositoryWire,
    local_refs: &[LocalRepositoryRef],
) {
    let owner_login = repo
        .owner
        .as_ref()
        .map(|owner| owner.login.trim().to_string())
        .filter(|login| !login.is_empty())
        .unwrap_or_else(|| "GitHub".to_string());
    if !accounts.iter().any(|account: &ProviderAccount| account.id == owner_login) {
        accounts.push(ProviderAccount {
            id: owner_login.clone(),
            provider: GitProvider::Github,
            name: owner_login.clone(),
            display_name: Some(owner_login.clone()),
            url: repo.owner.as_ref().and_then(|owner| owner.html_url.clone()),
        });
    }

    let repo_id = repo_provider_id(
        GitProvider::Github,
        &owner_login,
        "",
        &repo.name,
        &repo.id.to_string(),
    );
    if repositories.iter().any(|existing| existing.id == repo_id) {
        return;
    }
    let clone_url = repo.clone_url.as_ref().map(|url| ProviderCloneUrl {
        kind: provider_clone_url_kind(url),
        url: url.clone(),
        safe_url: redact_secrets(url),
    });
    let local_match = repo
        .clone_url
        .as_deref()
        .map(|url| local_match_for_remote(url, local_refs))
        .unwrap_or_else(|| LocalRepoMatch {
            status: LocalRepoMatchStatus::NotCloned,
            path: None,
            matched_remote: None,
        });
    repositories.push(ProviderRepository {
        id: repo_id,
        provider: GitProvider::Github,
        account_id: owner_login.clone(),
        account_name: owner_login,
        project_id: None,
        project_name: None,
        name: repo.name,
        default_branch: repo.default_branch.as_deref().map(normalize_default_branch),
        web_url: repo.html_url,
        clone_url,
        local_match,
    });
}

async fn github_get_json<T>(client: &reqwest::Client, url: &str, pat: &str) -> CommandResult<T>
where
    T: for<'de> Deserialize<'de>,
{
    let response = client
        .get(url)
        .bearer_auth(pat)
        .header("User-Agent", GITHUB_USER_AGENT)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|error| AppError::ProviderFailed {
            code: "PROVIDER_REQUEST_FAILED",
            message: "GitHub request failed.".to_string(),
            detail: error.to_string(),
        })?;
    let status = response.status();
    let body = response.text().await.map_err(|error| AppError::ProviderFailed {
        code: "PROVIDER_REQUEST_FAILED",
        message: "GitHub response could not be read.".to_string(),
        detail: error.to_string(),
    })?;

    if !status.is_success() {
        let code = if status == reqwest::StatusCode::UNAUTHORIZED
            || status == reqwest::StatusCode::FORBIDDEN
        {
            "GITHUB_AUTH_FAILED"
        } else {
            "PROVIDER_REQUEST_FAILED"
        };
        let message = if code == "GITHUB_AUTH_FAILED" {
            "GitHub rejected this token. Use a fine-grained or classic PAT with repo read access."
                .to_string()
        } else {
            format!("GitHub returned HTTP {status}.")
        };
        return Err(AppError::ProviderFailed {
            code,
            message,
            detail: format!("{url}\n{}", redact_secrets(&body)),
        });
    }

    serde_json::from_str::<T>(&body).map_err(|error| AppError::ProviderFailed {
        code: "PROVIDER_RESPONSE_INVALID",
        message: "GitHub returned a response OpenGit could not parse.".to_string(),
        detail: format!("{error}: {body}"),
    })
}

async fn local_repository_refs(local_paths: Vec<String>) -> Vec<LocalRepositoryRef> {
    let mut refs = Vec::new();
    let mut seen = Vec::new();
    for path in local_paths {
        let trimmed = path.trim();
        if trimmed.is_empty() || seen.iter().any(|item: &String| item == trimmed) {
            continue;
        }
        seen.push(trimmed.to_string());
        refs.push(local_repository_ref(trimmed).await);
    }
    refs
}

async fn local_repository_ref(path: &str) -> LocalRepositoryRef {
    let input = PathBuf::from(path);
    if !input.exists() {
        return LocalRepositoryRef {
            path: path.to_string(),
            exists: false,
            is_repository: false,
            remotes: Vec::new(),
        };
    }

    let Ok(canonical) = fs::canonicalize(&input) else {
        return LocalRepositoryRef {
            path: path.to_string(),
            exists: true,
            is_repository: false,
            remotes: Vec::new(),
        };
    };

    let root = match run_git(
        None,
        vec![
            "-C".into(),
            canonical.to_string_lossy().to_string(),
            "rev-parse".into(),
            "--show-toplevel".into(),
        ],
    )
    .await
    {
        Ok(value) => PathBuf::from(value.trim()),
        Err(_) => {
            return LocalRepositoryRef {
                path: canonical.to_string_lossy().to_string(),
                exists: true,
                is_repository: false,
                remotes: Vec::new(),
            };
        }
    };
    let remotes = parse_remotes(
        &run_git(Some(&root), vec!["remote".into(), "-v".into()])
            .await
            .unwrap_or_default(),
    );
    LocalRepositoryRef {
        path: root.to_string_lossy().to_string(),
        exists: true,
        is_repository: true,
        remotes,
    }
}

fn local_match_for_remote(remote_url: &str, refs: &[LocalRepositoryRef]) -> LocalRepoMatch {
    let normalized_remote = normalize_git_remote_url(remote_url);
    for local_ref in refs {
        if !local_ref.exists || !local_ref.is_repository {
            continue;
        }
        for remote in &local_ref.remotes {
            for candidate in [remote.fetch_url.as_deref(), remote.push_url.as_deref()] {
                let Some(candidate) = candidate else {
                    continue;
                };
                if normalize_git_remote_url(candidate) == normalized_remote {
                    return LocalRepoMatch {
                        status: LocalRepoMatchStatus::Cloned,
                        path: Some(local_ref.path.clone()),
                        matched_remote: Some(redact_secrets(candidate)),
                    };
                }
            }
        }
    }
    LocalRepoMatch {
        status: LocalRepoMatchStatus::NotCloned,
        path: None,
        matched_remote: None,
    }
}

fn provider_clone_url_kind(url: &str) -> ProviderCloneUrlKind {
    let lower = url.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        ProviderCloneUrlKind::Https
    } else if lower.starts_with("ssh://") || lower.starts_with("git@") {
        ProviderCloneUrlKind::Ssh
    } else {
        ProviderCloneUrlKind::Unknown
    }
}

fn repo_provider_id(
    provider: GitProvider,
    account_name: &str,
    project_name: &str,
    repo_name: &str,
    fallback_id: &str,
) -> String {
    let key = format!(
        "{}:{}:{}",
        account_name.trim().to_ascii_lowercase(),
        project_name.trim().to_ascii_lowercase(),
        repo_name.trim().to_ascii_lowercase()
    );
    let prefix = match provider {
        GitProvider::AzureDevops => "azure-devops",
        GitProvider::Github => "github",
        GitProvider::Gitlab => "gitlab",
        GitProvider::Bitbucket => "bitbucket",
        GitProvider::Unknown => "unknown",
    };
    if key.replace(':', "").trim().is_empty() {
        format!("{prefix}:{fallback_id}")
    } else {
        format!("{prefix}:{key}")
    }
}

fn normalize_default_branch(value: &str) -> String {
    value
        .strip_prefix("refs/heads/")
        .unwrap_or(value)
        .trim()
        .to_string()
}

fn normalize_git_remote_url(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if let Some(parts) = azure_remote_parts(trimmed) {
        if let Some(project) = parts.project {
            return azure_repo_key(&parts.org, &project, &parts.repo);
        }
    }
    let without_credentials = strip_url_credentials(trimmed);
    if let Some((scheme, rest)) = without_credentials.split_once("://") {
        let mut authority_and_path = rest.splitn(2, '/');
        let authority = authority_and_path.next().unwrap_or_default();
        let path = authority_and_path.next().unwrap_or_default();
        let host = authority
            .split('@')
            .last()
            .unwrap_or(authority)
            .split(':')
            .next()
            .unwrap_or(authority)
            .to_ascii_lowercase();
        let parts: Vec<String> = path
            .split('/')
            .map(percent_decode)
            .filter(|part| !part.trim().is_empty())
            .collect();
        if host == "dev.azure.com" && parts.len() >= 4 && parts[2].eq_ignore_ascii_case("_git")
        {
            return azure_repo_key(&parts[0], &parts[1], &parts[3]);
        }
        if host.ends_with(".visualstudio.com")
            && parts.len() >= 3
            && parts[1].eq_ignore_ascii_case("_git")
        {
            let org = host.trim_end_matches(".visualstudio.com");
            return azure_repo_key(org, &parts[0], &parts[2]);
        }
        return format!(
            "{}://{}{}",
            scheme.to_ascii_lowercase(),
            host,
            strip_dot_git(&format!("/{path}")).to_ascii_lowercase()
        );
    }

    if let Some((left, right)) = trimmed.split_once(':') {
        if left.contains('@') && !right.trim().is_empty() {
            let host = left.split('@').last().unwrap_or(left).to_ascii_lowercase();
            return format!("ssh://{}/{}", host, strip_dot_git(right).to_ascii_lowercase());
        }
    }

    strip_dot_git(trimmed).to_ascii_lowercase()
}

fn azure_remote_parts(input: &str) -> Option<AzureRemoteParts> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }

    let without_credentials = strip_url_credentials(trimmed);
    if let Some((_scheme, rest)) = without_credentials.split_once("://") {
        let mut authority_and_path = rest.splitn(2, '/');
        let authority = authority_and_path.next().unwrap_or_default();
        let path = authority_and_path.next().unwrap_or_default();
        let host = authority
            .split('@')
            .last()
            .unwrap_or(authority)
            .split(':')
            .next()
            .unwrap_or(authority)
            .to_ascii_lowercase();
        let parts: Vec<String> = path
            .split('/')
            .map(percent_decode)
            .filter(|part| !part.trim().is_empty())
            .collect();
        if host == "dev.azure.com" && parts.len() >= 4 && parts[2].eq_ignore_ascii_case("_git")
        {
            return Some(AzureRemoteParts {
                org: parts[0].clone(),
                project: Some(parts[1].clone()),
                repo: strip_dot_git(&parts[3]),
            });
        }
        if host.ends_with(".visualstudio.com")
            && parts.len() >= 3
            && parts[1].eq_ignore_ascii_case("_git")
        {
            return Some(AzureRemoteParts {
                org: host.trim_end_matches(".visualstudio.com").to_string(),
                project: Some(parts[0].clone()),
                repo: strip_dot_git(&parts[2]),
            });
        }
        if host == "ssh.dev.azure.com" && parts.len() >= 4 && parts[0].eq_ignore_ascii_case("v3")
        {
            return Some(AzureRemoteParts {
                org: parts[1].clone(),
                project: Some(parts[2].clone()),
                repo: strip_dot_git(&parts[3]),
            });
        }
    }

    if let Some((left, right)) = trimmed.split_once(':') {
        if left.to_ascii_lowercase().contains("ssh.dev.azure.com") {
            let parts: Vec<String> = right
                .split('/')
                .map(percent_decode)
                .filter(|part| !part.trim().is_empty())
                .collect();
            if parts.len() >= 4 && parts[0].eq_ignore_ascii_case("v3") {
                return Some(AzureRemoteParts {
                    org: parts[1].clone(),
                    project: Some(parts[2].clone()),
                    repo: strip_dot_git(&parts[3]),
                });
            }
        }
    }

    None
}

fn azure_repo_key(org: &str, project: &str, repo: &str) -> String {
    format!(
        "azure-devops:{}/{}/{}",
        org.trim().to_ascii_lowercase(),
        project.trim().to_ascii_lowercase(),
        strip_dot_git(repo).trim().to_ascii_lowercase()
    )
}

fn strip_dot_git(value: &str) -> String {
    value
        .strip_suffix(".git")
        .or_else(|| value.strip_suffix(".GIT"))
        .unwrap_or(value)
        .to_string()
}

fn strip_url_credentials(value: &str) -> String {
    let Some((scheme, rest)) = value.split_once("://") else {
        return value.to_string();
    };
    let Some((authority, path)) = rest.split_once('/') else {
        return value.to_string();
    };
    if let Some(at_index) = authority.rfind('@') {
        return format!("{scheme}://{}{}", &authority[at_index + 1..], format!("/{path}"));
    }
    value.to_string()
}

fn percent_decode(value: &str) -> String {
    let mut output = String::new();
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(hex) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
                output.push(hex as char);
                index += 3;
                continue;
            }
        }
        output.push(bytes[index] as char);
        index += 1;
    }
    output
}

fn url_path_segment(value: &str) -> String {
    percent_encode(value, "-._~")
}

fn url_query_value(value: &str) -> String {
    percent_encode(value, "-._~")
}

fn percent_encode(value: &str, safe: &str) -> String {
    let mut output = String::new();
    for byte in value.bytes() {
        let ch = byte as char;
        if ch.is_ascii_alphanumeric() || safe.contains(ch) {
            output.push(ch);
        } else {
            output.push_str(&format!("%{byte:02X}"));
        }
    }
    output
}

fn append_query_param(url: &str, key: &str, value: &str) -> String {
    let separator = if url.contains('?') { '&' } else { '?' };
    format!("{url}{separator}{key}={}", url_query_value(value))
}

fn map_keyring_error(error: KeyringError) -> AppError {
    AppError::SecureStorage(error.to_string())
}

fn validate_openai_model(model: Option<String>) -> CommandResult<String> {
    let value = model
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .unwrap_or_else(|| DEFAULT_OPENAI_MODEL.to_string());
    if value.len() > 80 || value.starts_with('-') || value.chars().any(|ch| ch.is_control()) {
        return invalid(
            "INVALID_OPENAI_MODEL",
            "OpenAI model contains unsafe characters.",
        );
    }
    Ok(value)
}

fn openai_error_message(body_text: &str) -> String {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(body_text) {
        if let Some(message) = value
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(|message| message.as_str())
            .filter(|message| !message.trim().is_empty())
        {
            return truncate_display_text(&redact_secrets(message), 300);
        }
    }

    let fallback = body_text.trim();
    if fallback.is_empty() {
        "Request failed.".to_string()
    } else {
        truncate_display_text(&redact_secrets(fallback), 300)
    }
}

enum AiBackend {
    OpenAi { api_key: String, model: String },
    Claude { api_key: String },
}

/// Pick the AI provider for a generation request: an explicit preference must
/// have its key saved; "auto" uses whichever key exists, Claude winning ties.
fn resolve_ai_backend(provider: Option<String>, model: Option<String>) -> CommandResult<AiBackend> {
    let preference = provider
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "auto".to_string());
    let openai_key = read_openai_api_key()?;
    let claude_key = read_claude_api_key()?;

    match preference.as_str() {
        "openai" => match openai_key {
            Some(api_key) => Ok(AiBackend::OpenAi {
                api_key,
                model: validate_openai_model(model)?,
            }),
            None => Err(AppError::InvalidInput {
                code: "OPENAI_KEY_MISSING",
                message: "Add an OpenAI API key in Preferences > Integrations or switch the AI provider.".to_string(),
            }),
        },
        "claude" => match claude_key {
            Some(api_key) => Ok(AiBackend::Claude { api_key }),
            None => Err(AppError::InvalidInput {
                code: "CLAUDE_KEY_MISSING",
                message: "Add a Claude API key in Preferences > Integrations or switch the AI provider.".to_string(),
            }),
        },
        "auto" => {
            if let Some(api_key) = claude_key {
                Ok(AiBackend::Claude { api_key })
            } else if let Some(api_key) = openai_key {
                Ok(AiBackend::OpenAi {
                    api_key,
                    model: validate_openai_model(model)?,
                })
            } else {
                Err(AppError::InvalidInput {
                    code: "AI_KEY_MISSING",
                    message: "Add an OpenAI or Claude API key in Preferences > Integrations before using AI features.".to_string(),
                })
            }
        }
        _ => invalid("INVALID_AI_PROVIDER", "AI provider must be auto, openai, or claude."),
    }
}

/// Run one instructions+input generation on the selected provider and return
/// the model's raw text output. Prompt content is identical across providers.
async fn request_ai_output_text(
    backend: &AiBackend,
    instructions: &str,
    input: String,
    max_output_tokens: u32,
) -> CommandResult<String> {
    match backend {
        AiBackend::OpenAi { api_key, model } => {
            let body_text =
                request_openai_response_body(api_key, model, instructions, input, max_output_tokens)
                    .await?;
            openai_output_text(&body_text)
        }
        AiBackend::Claude { api_key } => {
            request_claude_output_text(api_key, instructions, input).await
        }
    }
}

fn openai_output_text(body_text: &str) -> CommandResult<String> {
    let body: OpenAiResponseBody =
        serde_json::from_str(body_text).map_err(|error| AppError::AiFailed {
            message: "OpenAI returned an unreadable response.".to_string(),
            detail: error.to_string(),
        })?;
    extract_openai_output_text(&body).ok_or_else(|| AppError::AiFailed {
        message: openai_missing_output_message(&body),
        detail: truncate_display_text(&redact_secrets(body_text), 2_000),
    })
}

#[derive(Debug, Deserialize)]
struct ClaudeMessageResponse {
    content: Vec<serde_json::Value>,
}

async fn request_claude_output_text(
    api_key: &str,
    instructions: &str,
    input: String,
) -> CommandResult<String> {
    let response = reqwest::Client::new()
        .post(ANTHROPIC_MESSAGES_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .json(&json!({
            "model": CLAUDE_MODEL,
            "max_tokens": 16000,
            "system": instructions,
            "messages": [{"role": "user", "content": input}]
        }))
        .send()
        .await
        .map_err(|error| AppError::AiFailed {
            message: "Could not reach Anthropic.".to_string(),
            detail: error.to_string(),
        })?;

    let status = response.status();
    let body_text = response.text().await.map_err(|error| AppError::AiFailed {
        message: "Could not read Anthropic response.".to_string(),
        detail: error.to_string(),
    })?;

    if !status.is_success() {
        return Err(AppError::AiFailed {
            message: format!(
                "Anthropic returned HTTP {status}: {}",
                claude_error_message(&body_text)
            ),
            detail: truncate_display_text(&redact_secrets(&body_text), 2_000),
        });
    }

    let body: ClaudeMessageResponse =
        serde_json::from_str(&body_text).map_err(|error| AppError::AiFailed {
            message: "Anthropic returned an unreadable response.".to_string(),
            detail: error.to_string(),
        })?;

    // Content is a list of typed blocks; collect every text block rather than
    // assuming the first block is text.
    let output: String = body
        .content
        .iter()
        .filter(|block| block.get("type").and_then(|value| value.as_str()) == Some("text"))
        .filter_map(|block| block.get("text").and_then(|value| value.as_str()))
        .collect::<Vec<_>>()
        .join("");
    if output.trim().is_empty() {
        return Err(AppError::AiFailed {
            message: "Claude did not return any text output.".to_string(),
            detail: truncate_display_text(&redact_secrets(&body_text), 2_000),
        });
    }
    Ok(output)
}

fn claude_error_message(body_text: &str) -> String {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(body_text) {
        if let Some(message) = value
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(|message| message.as_str())
            .filter(|message| !message.trim().is_empty())
        {
            return truncate_display_text(&redact_secrets(message), 300);
        }
    }

    let fallback = body_text.trim();
    if fallback.is_empty() {
        "Request failed.".to_string()
    } else {
        truncate_display_text(&redact_secrets(fallback), 300)
    }
}

async fn request_openai_response_body(
    api_key: &str,
    model: &str,
    instructions: &str,
    input: String,
    max_output_tokens: u32,
) -> CommandResult<String> {
    let response = reqwest::Client::new()
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(api_key)
        .json(&json!({
            "model": model,
            "instructions": instructions,
            "input": input,
            "reasoning": {
                "effort": "minimal"
            },
            "max_output_tokens": max_output_tokens
        }))
        .send()
        .await
        .map_err(|error| AppError::AiFailed {
            message: "Could not reach OpenAI.".to_string(),
            detail: error.to_string(),
        })?;

    let status = response.status();
    let body_text = response.text().await.map_err(|error| AppError::AiFailed {
        message: "Could not read OpenAI response.".to_string(),
        detail: error.to_string(),
    })?;

    if !status.is_success() {
        return Err(AppError::AiFailed {
            message: format!("OpenAI returned HTTP {status}."),
            detail: body_text,
        });
    }

    Ok(body_text)
}

async fn build_staged_commit_context(repo: &Path) -> CommandResult<String> {
    let staged_names = run_git(
        Some(repo),
        vec![
            "diff".into(),
            "--cached".into(),
            "--name-only".into(),
            "-z".into(),
        ],
    )
    .await?;
    if staged_names.is_empty() {
        return invalid(
            "NO_STAGED_FILES",
            "Stage files before generating a commit message.",
        );
    }

    let branch = run_git(
        Some(repo),
        vec!["rev-parse".into(), "--abbrev-ref".into(), "HEAD".into()],
    )
    .await
    .unwrap_or_else(|_| "unknown".to_string());
    let name_status = run_git(
        Some(repo),
        vec![
            "diff".into(),
            "--cached".into(),
            "--name-status".into(),
            "--find-renames".into(),
        ],
    )
    .await?;
    let stat = run_git(
        Some(repo),
        vec!["diff".into(), "--cached".into(), "--stat".into()],
    )
    .await?;
    let diff = run_git(
        Some(repo),
        vec![
            "diff".into(),
            "--cached".into(),
            "--no-ext-diff".into(),
            "--find-renames".into(),
            "--unified=80".into(),
        ],
    )
    .await?;

    let repo_name = repo
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("repository");
    let diff = truncate_for_prompt(&diff, MAX_STAGED_DIFF_CHARS);

    Ok(format!(
        "Repository: {repo_name}\nBranch: {}\n\nStaged files:\n{}\nDiff stat:\n{}\nStaged diff{}:\n```diff\n{}\n```",
        branch.trim(),
        name_status.trim(),
        stat.trim(),
        if diff.truncated { " (truncated)" } else { "" },
        diff.text
    ))
}

async fn build_change_context(repo: &Path, purpose: &str) -> CommandResult<String> {
    let status = run_git(Some(repo), vec!["status".into(), "--short".into()]).await?;
    let staged_diff = run_git(
        Some(repo),
        vec![
            "diff".into(),
            "--cached".into(),
            "--no-ext-diff".into(),
            "--find-renames".into(),
            "--unified=60".into(),
        ],
    )
    .await
    .unwrap_or_default();
    let working_diff = run_git(
        Some(repo),
        vec![
            "diff".into(),
            "--no-ext-diff".into(),
            "--find-renames".into(),
            "--unified=60".into(),
        ],
    )
    .await
    .unwrap_or_default();

    if status.trim().is_empty() && staged_diff.trim().is_empty() && working_diff.trim().is_empty() {
        return invalid(
            "NO_CHANGES",
            &format!("Make or stage changes before generating a {purpose}."),
        );
    }

    let branch = run_git(
        Some(repo),
        vec!["rev-parse".into(), "--abbrev-ref".into(), "HEAD".into()],
    )
    .await
    .unwrap_or_else(|_| "unknown".to_string());
    let staged_name_status = run_git(
        Some(repo),
        vec![
            "diff".into(),
            "--cached".into(),
            "--name-status".into(),
            "--find-renames".into(),
        ],
    )
    .await
    .unwrap_or_default();
    let working_name_status = run_git(
        Some(repo),
        vec![
            "diff".into(),
            "--name-status".into(),
            "--find-renames".into(),
        ],
    )
    .await
    .unwrap_or_default();
    let staged_stat = run_git(
        Some(repo),
        vec!["diff".into(), "--cached".into(), "--stat".into()],
    )
    .await
    .unwrap_or_default();
    let working_stat = run_git(Some(repo), vec!["diff".into(), "--stat".into()])
        .await
        .unwrap_or_default();
    let combined_diff = format!(
        "Staged diff:\n{}\n\nWorking diff:\n{}",
        staged_diff.trim(),
        working_diff.trim()
    );
    let diff = truncate_for_prompt(&combined_diff, MAX_STAGED_DIFF_CHARS);
    let repo_name = repo
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("repository");

    Ok(format!(
        "Repository: {repo_name}\nBranch: {}\n\nGit status:\n{}\n\nStaged files:\n{}\nWorking files:\n{}\n\nStaged stat:\n{}\nWorking stat:\n{}\n\nDiff{}:\n```diff\n{}\n```",
        branch.trim(),
        status.trim(),
        staged_name_status.trim(),
        working_name_status.trim(),
        staged_stat.trim(),
        working_stat.trim(),
        if diff.truncated { " (truncated)" } else { "" },
        diff.text
    ))
}

async fn build_pr_context(repo: &Path) -> CommandResult<String> {
    let base = pr_base_ref(repo).await?;
    let branch = run_git(
        Some(repo),
        vec!["rev-parse".into(), "--abbrev-ref".into(), "HEAD".into()],
    )
    .await
    .unwrap_or_else(|_| "unknown".to_string());
    let log = run_git(
        Some(repo),
        vec![
            "log".into(),
            "--oneline".into(),
            "--decorate".into(),
            "--no-merges".into(),
            format!("{base}..HEAD"),
        ],
    )
    .await?;
    if log.trim().is_empty() {
        return invalid(
            "NO_PR_COMMITS",
            "Current branch does not have commits ahead of the detected base branch.",
        );
    }
    let name_status = run_git(
        Some(repo),
        vec![
            "diff".into(),
            "--name-status".into(),
            "--find-renames".into(),
            base.clone(),
            "HEAD".into(),
        ],
    )
    .await
    .unwrap_or_default();
    let stat = run_git(
        Some(repo),
        vec!["diff".into(), "--stat".into(), base.clone(), "HEAD".into()],
    )
    .await
    .unwrap_or_default();
    let diff = run_git(
        Some(repo),
        vec![
            "diff".into(),
            "--no-ext-diff".into(),
            "--find-renames".into(),
            "--unified=60".into(),
            base.clone(),
            "HEAD".into(),
        ],
    )
    .await
    .unwrap_or_default();
    let diff = truncate_for_prompt(&diff, MAX_STAGED_DIFF_CHARS);
    let repo_name = repo
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("repository");

    Ok(format!(
        "Repository: {repo_name}\nBranch: {}\nBase: {base}\n\nCommits ahead of base:\n{}\n\nChanged files:\n{}\n\nDiff stat:\n{}\n\nDiff{}:\n```diff\n{}\n```",
        branch.trim(),
        log.trim(),
        name_status.trim(),
        stat.trim(),
        if diff.truncated { " (truncated)" } else { "" },
        diff.text
    ))
}

/// Gather the Git context for explaining `branch`: commits and diff stat against
/// the merge-base with the branch's upstream, or with the default branch when no
/// upstream exists. Returns the base ref used plus the prompt context.
async fn build_branch_explain_context(repo: &Path, branch: &str) -> CommandResult<(String, String)> {
    let upstream = run_git(
        Some(repo),
        vec![
            "rev-parse".into(),
            "--abbrev-ref".into(),
            "--symbolic-full-name".into(),
            format!("{branch}@{{upstream}}"),
        ],
    )
    .await
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty() && value != branch);

    let candidates = upstream
        .into_iter()
        .chain(["origin/main", "origin/master", "main", "master"].map(ToString::to_string))
        .filter(|candidate| candidate != branch);

    let mut base = None;
    for candidate in candidates {
        if resolve_commit_sha(repo, &candidate).await.is_ok() {
            base = Some(candidate);
            break;
        }
    }
    let base = base.ok_or(AppError::InvalidInput {
        code: "NO_EXPLAIN_BASE",
        message: "Could not find an upstream, origin/main, origin/master, main, or master base to compare this branch against.".to_string(),
    })?;

    let merge_base = run_git(
        Some(repo),
        vec!["merge-base".into(), base.clone(), branch.to_string()],
    )
    .await
    .map(|value| value.trim().to_string())
    .map_err(|_| AppError::InvalidInput {
        code: "NO_EXPLAIN_BASE",
        message: format!("'{branch}' has no merge base with '{base}'."),
    })?;

    let log = run_git(
        Some(repo),
        vec![
            "log".into(),
            "--no-merges".into(),
            "-n".into(),
            "50".into(),
            "--date=short".into(),
            "--format=%h %ad %an: %s".into(),
            format!("{merge_base}..{branch}"),
        ],
    )
    .await?;
    if log.trim().is_empty() {
        return invalid(
            "NO_BRANCH_COMMITS",
            &format!("'{branch}' has no commits ahead of '{base}'."),
        );
    }
    let stat = run_git(
        Some(repo),
        vec![
            "diff".into(),
            "--stat".into(),
            merge_base.clone(),
            branch.to_string(),
        ],
    )
    .await
    .unwrap_or_default();
    let name_status = run_git(
        Some(repo),
        vec![
            "diff".into(),
            "--name-status".into(),
            "--find-renames".into(),
            merge_base,
            branch.to_string(),
        ],
    )
    .await
    .unwrap_or_default();

    let repo_name = repo
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("repository");
    let stat = truncate_for_prompt(&stat, MAX_STAGED_DIFF_CHARS / 2);

    let context = format!(
        "Repository: {repo_name}\nBranch: {branch}\nBase: {base}\n\nCommits on the branch (newest first, up to 50):\n{}\n\nChanged files:\n{}\n\nDiff stat{}:\n{}",
        log.trim(),
        name_status.trim(),
        if stat.truncated { " (truncated)" } else { "" },
        stat.text.trim()
    );
    Ok((base, context))
}

async fn pr_base_ref(repo: &Path) -> CommandResult<String> {
    let upstream = run_git(
        Some(repo),
        vec![
            "rev-parse".into(),
            "--abbrev-ref".into(),
            "--symbolic-full-name".into(),
            "@{u}".into(),
        ],
    )
    .await
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty() && value != "@{u}");

    let candidates = upstream
        .into_iter()
        .chain(["origin/main", "origin/master", "main", "master"].map(ToString::to_string));

    for candidate in candidates {
        if resolve_commit_sha(repo, &candidate).await.is_ok() {
            return Ok(candidate);
        }
    }

    invalid(
        "NO_PR_BASE",
        "Could not find an upstream, origin/main, origin/master, main, or master base for PR text.",
    )
}

struct TruncatedText {
    text: String,
    truncated: bool,
}

fn truncate_for_prompt(value: &str, max_chars: usize) -> TruncatedText {
    let mut text = String::with_capacity(value.len().min(max_chars));
    let mut truncated = false;
    for (index, ch) in value.chars().enumerate() {
        if index >= max_chars {
            truncated = true;
            break;
        }
        text.push(ch);
    }
    if truncated {
        text.push_str("\n\n[diff truncated by OpenGit]");
    }
    TruncatedText { text, truncated }
}

fn truncate_display_text(value: &str, max_chars: usize) -> String {
    let mut text = String::with_capacity(value.len().min(max_chars));
    let mut truncated = false;
    for (index, ch) in value.chars().enumerate() {
        if index >= max_chars {
            truncated = true;
            break;
        }
        text.push(ch);
    }
    if truncated {
        text.push_str("...");
    }
    text
}

#[cfg(test)]
fn parse_openai_commit_response(body_text: &str) -> CommandResult<AiCommitSuggestion> {
    parse_commit_suggestion_text(&openai_output_text(body_text)?)
}

fn parse_openai_branch_response(body_text: &str) -> CommandResult<AiBranchNameSuggestion> {
    parse_branch_suggestion_text(&openai_output_text(body_text)?)
}

#[cfg(test)]
fn parse_openai_pr_response(body_text: &str) -> CommandResult<AiPrDescriptionSuggestion> {
    parse_pr_suggestion_text(&openai_output_text(body_text)?)
}

fn extract_openai_output_text(body: &OpenAiResponseBody) -> Option<String> {
    if let Some(output_text) = body
        .output_text
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        return Some(output_text.clone());
    }

    body.output
        .as_ref()
        .and_then(extract_text_from_response_value)
}

fn extract_text_from_response_value(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(_) => None,
        serde_json::Value::Array(items) => items.iter().find_map(extract_text_from_response_value),
        serde_json::Value::Object(map) => {
            let item_type = map.get("type").and_then(|item| item.as_str());
            if matches!(item_type, Some("reasoning")) {
                return None;
            }

            if matches!(item_type, Some("output_text" | "text")) {
                if let Some(text) = map
                    .get("text")
                    .and_then(|item| item.as_str())
                    .filter(|text| !text.trim().is_empty())
                {
                    return Some(text.to_string());
                }
            }

            map.get("content")
                .and_then(extract_text_from_response_value)
                .or_else(|| {
                    map.get("message")
                        .and_then(extract_text_from_response_value)
                })
                .or_else(|| map.get("output").and_then(extract_text_from_response_value))
        }
        _ => None,
    }
}

fn openai_missing_output_message(body: &OpenAiResponseBody) -> String {
    let status = body.status.as_deref().unwrap_or("unknown");
    if status == "incomplete" {
        let reason = body
            .incomplete_details
            .as_ref()
            .and_then(|details| details.reason.as_deref())
            .unwrap_or("unknown reason");
        return format!("OpenAI stopped before returning commit text ({reason}). Try again with fewer staged changes or a smaller diff.");
    }

    format!("OpenAI returned status '{status}' without commit text. Try again, or use a different model in Preferences > Integrations.")
}

fn parse_commit_suggestion_text(text: &str) -> CommandResult<AiCommitSuggestion> {
    let cleaned = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    let json_candidate = if cleaned.starts_with('{') {
        cleaned
    } else if let (Some(start), Some(end)) = (cleaned.find('{'), cleaned.rfind('}')) {
        &cleaned[start..=end]
    } else {
        ""
    };

    if !json_candidate.is_empty() {
        let wire: AiCommitSuggestionWire =
            serde_json::from_str(json_candidate).map_err(|error| AppError::AiFailed {
                message: "OpenAI returned malformed commit JSON.".to_string(),
                detail: error.to_string(),
            })?;
        return normalize_commit_suggestion(wire.summary, wire.description.unwrap_or_default());
    }

    let mut lines = cleaned.lines();
    let summary = lines.next().unwrap_or_default().trim().to_string();
    let description = lines.collect::<Vec<_>>().join("\n").trim().to_string();
    normalize_commit_suggestion(summary, description)
}

fn parse_branch_suggestion_text(text: &str) -> CommandResult<AiBranchNameSuggestion> {
    let cleaned = cleanup_openai_text(text);
    let json_candidate = json_object_candidate(cleaned);
    if let Some(json_candidate) = json_candidate {
        let wire: AiBranchNameSuggestionWire =
            serde_json::from_str(json_candidate).map_err(|error| AppError::AiFailed {
                message: "OpenAI returned malformed branch JSON.".to_string(),
                detail: error.to_string(),
            })?;
        return normalize_branch_suggestion(wire.name);
    }

    normalize_branch_suggestion(cleaned.lines().next().unwrap_or_default().to_string())
}

fn parse_pr_suggestion_text(text: &str) -> CommandResult<AiPrDescriptionSuggestion> {
    let cleaned = cleanup_openai_text(text);
    let json_candidate = json_object_candidate(cleaned);
    if let Some(json_candidate) = json_candidate {
        let wire: AiPrDescriptionSuggestionWire =
            serde_json::from_str(json_candidate).map_err(|error| AppError::AiFailed {
                message: "OpenAI returned malformed PR JSON.".to_string(),
                detail: error.to_string(),
            })?;
        return normalize_pr_suggestion(wire.title, wire.description.unwrap_or_default());
    }

    let mut lines = cleaned.lines();
    let title = lines.next().unwrap_or_default().trim().to_string();
    let description = lines.collect::<Vec<_>>().join("\n").trim().to_string();
    normalize_pr_suggestion(title, description)
}

fn cleanup_openai_text(text: &str) -> &str {
    text.trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
}

fn json_object_candidate(cleaned: &str) -> Option<&str> {
    if cleaned.starts_with('{') {
        return Some(cleaned);
    }
    if let (Some(start), Some(end)) = (cleaned.find('{'), cleaned.rfind('}')) {
        return Some(&cleaned[start..=end]);
    }
    None
}

fn normalize_commit_suggestion(
    summary: String,
    description: String,
) -> CommandResult<AiCommitSuggestion> {
    let summary = summary.trim().trim_matches('"').to_string();
    let description = description.trim().to_string();
    if summary.is_empty() {
        return invalid(
            "OPENAI_EMPTY_SUMMARY",
            "OpenAI did not return a commit summary.",
        );
    }
    Ok(AiCommitSuggestion {
        summary,
        description,
    })
}

fn normalize_branch_suggestion(name: String) -> CommandResult<AiBranchNameSuggestion> {
    let name = name
        .trim()
        .trim_matches('"')
        .trim_start_matches("branch:")
        .trim()
        .to_string();
    if name.is_empty() {
        return invalid(
            "OPENAI_EMPTY_BRANCH_NAME",
            "OpenAI did not return a branch name.",
        );
    }
    if name.len() > 80
        || name.starts_with('-')
        || name.starts_with('/')
        || name.ends_with('/')
        || name.contains(' ')
        || name.contains("..")
        || name.contains("@{")
        || name.contains("//")
        || name.contains('\\')
        || name.chars().any(|ch| ch.is_control())
    {
        return invalid(
            "OPENAI_UNSAFE_BRANCH_NAME",
            "OpenAI returned a branch name that is not safe to use.",
        );
    }
    Ok(AiBranchNameSuggestion { name })
}

fn normalize_pr_suggestion(
    title: String,
    description: String,
) -> CommandResult<AiPrDescriptionSuggestion> {
    let title = title.trim().trim_matches('"').to_string();
    let description = description.trim().to_string();
    if title.is_empty() {
        return invalid("OPENAI_EMPTY_PR_TITLE", "OpenAI did not return a PR title.");
    }
    Ok(AiPrDescriptionSuggestion { title, description })
}

fn clamp_history_limit(value: Option<u32>) -> u32 {
    value
        .unwrap_or(DEFAULT_HISTORY_LIMIT)
        .clamp(MIN_HISTORY_LIMIT, MAX_HISTORY_LIMIT)
}

fn optional_string(value: &str) -> Option<String> {
    (!value.trim().is_empty()).then(|| value.to_string())
}

fn provider_from_url(url: &str) -> GitProvider {
    let lowered = url.to_ascii_lowercase();
    if lowered.contains("github.com") {
        GitProvider::Github
    } else if lowered.contains("gitlab") {
        GitProvider::Gitlab
    } else if lowered.contains("bitbucket") {
        GitProvider::Bitbucket
    } else if lowered.contains("dev.azure.com") || lowered.contains("visualstudio.com") {
        GitProvider::AzureDevops
    } else {
        GitProvider::Unknown
    }
}

fn redact_secrets(input: &str) -> String {
    let mut output = String::new();
    for token in input.split_whitespace() {
        if let Some(protocol_index) = token.find("://") {
            let auth_start = protocol_index + 3;
            let host_end = token[auth_start..]
                .find('/')
                .map(|index| auth_start + index)
                .unwrap_or(token.len());
            let authority = &token[auth_start..host_end];
            if let Some(at_index) = authority.rfind('@') {
                let host = &authority[at_index + 1..];
                output.push_str(&token[..auth_start]);
                output.push_str("***@");
                output.push_str(host);
                output.push_str(&token[host_end..]);
                output.push(' ');
                continue;
            }
        }
        output.push_str(token);
        output.push(' ');
    }
    output.trim_end().to_string()
}

fn git_error_summary(detail: &str) -> String {
    detail
        .lines()
        .find(|line| is_actionable_git_error_line(line.trim()))
        .map(|line| redact_secrets(line.trim()))
        .unwrap_or_else(|| "Git command failed.".to_string())
}

/// Git prints `Unable to create '<path>.lock': File exists` when a prior process
/// left a lock behind (or one is genuinely still running). Pull the lock path out
/// so the app can offer to clear it instead of dead-ending the user in a terminal.
fn locked_path_from_detail(detail: &str) -> Option<String> {
    let marker = "Unable to create '";
    let start = detail.find(marker)? + marker.len();
    let rest = &detail[start..];
    let end = rest.find('\'')?;
    let path = &rest[..end];
    if path.ends_with(".lock") && detail.contains("File exists") {
        Some(path.to_string())
    } else {
        None
    }
}

/// Build the error for a failed git invocation, upgrading the stale-lock case to an
/// actionable error the UI can recover from with a single click.
fn git_command_failure(detail: String) -> AppError {
    if let Some(lock_path) = locked_path_from_detail(&detail) {
        let label = Path::new(&lock_path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("index.lock");
        return AppError::GitActionRequired {
            code: "GIT_LOCK_EXISTS",
            message: format!(
                "A Git lock file ({label}) is blocking this repository. Another Git process may be running — if you're sure none is, clear the lock and try again."
            ),
            detail,
        };
    }
    AppError::GitFailed {
        message: git_error_summary(&detail),
        detail,
    }
}

fn is_actionable_git_error_line(line: &str) -> bool {
    if line.is_empty() {
        return false;
    }

    let lower = line.to_ascii_lowercase();
    !lower.starts_with("to ")
        && !lower.starts_with("from ")
        && !lower.starts_with("enumerating objects:")
        && !lower.starts_with("counting objects:")
        && !lower.starts_with("compressing objects:")
        && !lower.starts_with("writing objects:")
        && !lower.starts_with("total ")
}

fn invalid<T>(code: &'static str, message: &str) -> CommandResult<T> {
    Err(AppError::InvalidInput {
        code,
        message: message.to_string(),
    })
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("OpenGit");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            repo_open,
            repo_clone,
            repo_status,
            git_identity_get,
            git_identity_set,
            git_stash_push_paths,
            git_ignore_add,
            git_export_patch,
            file_show_in_folder,
            file_open_default,
            file_open_in_editor,
            file_delete,
            git_commit_search,
            git_commit_lookup,
            git_commit_page,
            git_stage,
            git_unstage,
            git_discard,
            git_commit,
            git_commit_message_update,
            git_commit_undo_last,
            git_commit_squash_last,
            ai_openai_status,
            ai_openai_test_api_key,
            ai_openai_save_api_key,
            ai_openai_clear_api_key,
            ai_claude_status,
            ai_claude_test_api_key,
            ai_claude_save_api_key,
            ai_claude_clear_api_key,
            azure_devops_status,
            azure_devops_save_pat,
            azure_devops_clear_pat,
            github_status,
            github_save_pat,
            github_clear_pat,
            provider_accounts_status,
            provider_repos_list,
            ai_commit_message_generate,
            ai_branch_name_generate,
            ai_pr_description_generate,
            ai_branch_explain,
            git_undo_restore,
            git_branch_create,
            git_branch_checkout,
            git_branch_checkout_remote,
            git_branch_delete,
            git_branch_rename,
            git_branch_inspect,
            git_stack_list,
            git_stack_create,
            git_stack_create_child,
            git_stack_add_branch,
            git_stack_reorder,
            git_stack_remove_branch,
            git_stack_restack,
            git_stack_sync_trunk,
            git_stack_push,
            git_lane_list,
            git_lane_create,
            git_lane_assign_paths,
            git_lane_apply,
            git_lane_unapply,
            git_lane_commit,
            git_lane_discard,
            git_lane_materialize_branch,
            git_fetch,
            git_pull,
            git_pull_fast_forward,
            git_pull_rebase,
            git_merge,
            git_rebase,
            git_cherry_pick,
            git_revert,
            git_conflict_versions,
            git_conflict_resolve,
            git_conflict_mark_resolved,
            git_operation_continue,
            git_operation_abort,
            git_tag_create,
            git_push,
            git_remote_add,
            git_stash_push,
            git_stash_apply,
            git_stash_drop,
            git_diff,
            git_list_directory_files,
            git_commit_files,
            git_commit_file_diff,
            git_clear_lock
        ])
        .run(tauri::generate_context!())
        .expect("error while running OpenGit");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_repository_relative_paths() {
        assert!(validate_file_paths(&["src/main.rs".into()]).is_ok());
        assert!(validate_file_paths(&["../secret".into()]).is_err());
        assert!(validate_file_paths(&["/tmp/secret".into()]).is_err());
    }

    #[test]
    fn validates_remote_urls() {
        assert!(validate_remote_url("git@github.com:owner/repo.git").is_ok());
        assert!(validate_remote_url("https://github.com/owner/repo.git").is_ok());
        assert!(validate_remote_url("").is_err());
        assert!(validate_remote_url("--upload-pack=bad").is_err());
    }

    #[test]
    fn detects_azure_devops_https_auth_targets() {
        let target = azure_devops_auth_target("https://logan@dev.azure.com/org/project/_git/repo")
            .expect("azure target");

        assert_eq!(target.scope, "https://dev.azure.com/");
        assert_eq!(target.username, "logan");
    }

    #[test]
    fn detects_visualstudio_https_auth_targets() {
        let target = azure_devops_auth_target("https://org.visualstudio.com/project/_git/repo")
            .expect("azure target");

        assert_eq!(target.scope, "https://org.visualstudio.com/");
        assert_eq!(target.username, "opengit");
    }

    #[test]
    fn normalizes_azure_devops_remote_url_variants() {
        assert_eq!(
            normalize_git_remote_url("https://dev.azure.com/org/project/_git/repo"),
            "azure-devops:org/project/repo"
        );
        assert_eq!(
            normalize_git_remote_url("https://org@dev.azure.com/org/project/_git/repo.git"),
            "azure-devops:org/project/repo"
        );
        assert_eq!(
            normalize_git_remote_url("https://org.visualstudio.com/project/_git/repo"),
            "azure-devops:org/project/repo"
        );
        assert_eq!(
            normalize_git_remote_url("https://DEV.AZURE.com/Org/Project/_git/Repo"),
            "azure-devops:org/project/repo"
        );
        assert_eq!(
            normalize_git_remote_url("git@ssh.dev.azure.com:v3/Org/Project/Repo.git"),
            "azure-devops:org/project/repo"
        );
    }

    #[test]
    fn derives_azure_org_hints_from_local_remotes() {
        let refs = vec![LocalRepositoryRef {
            path: "/tmp/repo".to_string(),
            exists: true,
            is_repository: true,
            remotes: vec![
                Remote {
                    name: "origin".to_string(),
                    fetch_url: Some("https://dev.azure.com/Hubley/hubley%20spfx/_git/OpenGit".to_string()),
                    push_url: None,
                    provider: GitProvider::AzureDevops,
                },
                Remote {
                    name: "other".to_string(),
                    fetch_url: Some("git@ssh.dev.azure.com:v3/SecondOrg/project/repo".to_string()),
                    push_url: None,
                    provider: GitProvider::AzureDevops,
                },
            ],
        }];

        assert_eq!(
            azure_org_hints_from_local_refs(&refs),
            vec!["Hubley".to_string(), "SecondOrg".to_string()]
        );
    }

    #[test]
    fn encodes_azure_path_segments() {
        assert_eq!(url_path_segment("hubley spfx"), "hubley%20spfx");
        assert_eq!(append_query_param("https://example.test?a=1", "continuationToken", "a b"), "https://example.test?a=1&continuationToken=a%20b");
    }

    #[test]
    fn ignores_non_azure_auth_targets() {
        assert!(azure_devops_auth_target("https://github.com/owner/repo.git").is_none());
        assert!(azure_devops_auth_target("git@ssh.dev.azure.com:v3/org/project/repo").is_none());
    }

    #[test]
    fn clamps_history_limit() {
        assert_eq!(clamp_history_limit(None), DEFAULT_HISTORY_LIMIT);
        assert_eq!(clamp_history_limit(Some(1)), MIN_HISTORY_LIMIT);
        assert_eq!(clamp_history_limit(Some(750)), 750);
        assert_eq!(clamp_history_limit(Some(10_000)), MAX_HISTORY_LIMIT);
    }

    #[test]
    fn history_log_uses_author_date_order_for_timeline_view() {
        let args = history_log_args(250);

        assert!(args.contains(&"--author-date-order".to_string()));
        assert!(!args.contains(&"--topo-order".to_string()));
        assert_eq!(args.last().map(String::as_str), Some("250"));
    }

    #[test]
    fn redacts_credentials_from_urls() {
        let redacted = redact_secrets("https://token:secret@github.com/example/private.git");
        assert_eq!(redacted, "https://***@github.com/example/private.git");
    }

    #[test]
    fn summarizes_push_rejection_from_actionable_line() {
        let detail = concat!(
            "To https://dev.azure.com/org/project/_git/repo\n",
            " ! [rejected]        main -> main (non-fast-forward)\n",
            "error: failed to push some refs to 'https://dev.azure.com/org/project/_git/repo'\n"
        );

        assert_eq!(
            git_error_summary(detail),
            "! [rejected] main -> main (non-fast-forward)"
        );
    }

    #[test]
    fn classifies_non_fast_forward_push_as_recoverable() {
        let error = AppError::GitFailed {
            message: "! [rejected] dev-unifiedapp -> dev-unifiedapp (non-fast-forward)".to_string(),
            detail: concat!(
                "To https://dev.azure.com/org/project/_git/repo\n",
                " ! [rejected] dev-unifiedapp -> dev-unifiedapp (non-fast-forward)\n"
            )
            .to_string(),
        };
        let context = PushContext {
            branch: Some("dev-unifiedapp".to_string()),
            upstream: Some("origin/dev-unifiedapp".to_string()),
        };

        assert!(is_push_non_fast_forward_error(&error));
        let recovery = push_non_fast_forward_error(error, &context);
        let serialized = serde_json::to_value(recovery).expect("error should serialize");

        assert_eq!(serialized["code"], "PUSH_NON_FAST_FORWARD");
        assert_eq!(
            serialized["message"],
            "'refs/heads/dev-unifiedapp' is behind 'refs/remotes/origin/dev-unifiedapp'. Update your branch by doing a Pull."
        );
    }

    #[test]
    fn keeps_fatal_auth_errors_as_summary() {
        let detail = "fatal: could not read Password for 'https://user@dev.azure.com': terminal prompts disabled\n";

        assert_eq!(
            git_error_summary(detail),
            "fatal: could not read Password for 'https://***@dev.azure.com': terminal prompts disabled"
        );
    }

    #[test]
    fn parses_porcelain_v2_branch_and_changes() {
        let raw = concat!(
            "# branch.oid abc123\0",
            "# branch.head main\0",
            "# branch.upstream origin/main\0",
            "# branch.ab +2 -1\0",
            "1 .M N... 100644 100644 100644 aaa bbb src/app.rs\0",
            "1 M. N... 100644 100644 100644 aaa bbb src/lib.rs\0",
            "? docs/new.md\0"
        );

        let (branch, changes, conflicts) = parse_status(raw);

        assert_eq!(branch.current_branch.as_deref(), Some("main"));
        assert_eq!(branch.upstream.as_deref(), Some("origin/main"));
        assert_eq!(branch.ahead, 2);
        assert_eq!(branch.behind, 1);
        assert!(conflicts.is_empty());
        assert_eq!(changes.len(), 3);
        assert!(!changes[0].staged);
        assert!(changes[0].unstaged);
        assert!(changes[1].staged);
        assert!(!changes[1].unstaged);
        assert_eq!(changes[2].path, "docs/new.md");
    }

    #[test]
    fn parses_porcelain_v2_conflicts() {
        let raw = concat!(
            "# branch.oid abc123\0",
            "# branch.head main\0",
            "u UU N... 100644 100644 100644 100644 aaa bbb ccc src/conflict.ts\0"
        );

        let (_branch, changes, conflicts) = parse_status(raw);

        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].path, "src/conflict.ts");
        assert_eq!(conflicts[0].kind, "UU");
        assert!(matches!(changes[0].status, FileStatus::Conflicted));
    }

    #[test]
    fn parses_porcelain_v2_conflict_paths_with_spaces() {
        let raw = concat!(
            "# branch.oid abc123\0",
            "# branch.head main\0",
            "u UU N... 100644 100644 100644 100644 aaa bbb ccc src/conflicted folder/file name.tsx\0"
        );

        let (_branch, changes, conflicts) = parse_status(raw);

        assert_eq!(conflicts.len(), 1);
        assert_eq!(
            conflicts[0].path,
            "src/conflicted folder/file name.tsx"
        );
        assert!(matches!(changes[0].status, FileStatus::Conflicted));
    }

    #[test]
    fn combines_conflict_sides_with_single_separator() {
        assert_eq!(
            combine_conflict_sides("current\n", "\nincoming"),
            "current\nincoming\n"
        );
    }

    #[test]
    fn parses_commit_records_without_control_chars_in_sha() {
        let raw = concat!(
            "abc123%x1fparent1%x1fLogan%x1flogan@example.com%x1f2026-05-20T10:00:00-05:00%x1fFirst%x1fHEAD -> main%x1e",
            "\n",
            "def456%x1fabc123%x1fLogan%x1flogan@example.com%x1f2026-05-20T09:00:00-05:00%x1fSecond%x1forigin/main%x1e"
        )
        .replace("%x1f", "\u{1f}")
        .replace("%x1e", "\u{1e}");

        let commits = parse_commits(&raw);

        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].sha, "abc123");
        assert_eq!(commits[1].sha, "def456");
        assert!(validate_ref_arg(&commits[1].sha, "commit").is_ok());
    }

    #[test]
    fn parses_commit_name_status_records() {
        let files = parse_commit_files("M\0src/app.rs\0A\0docs/new.md\0R100\0old.ts\0new.ts\0");

        assert_eq!(files.len(), 3);
        assert_eq!(files[0].path, "src/app.rs");
        assert!(matches!(files[0].status, FileStatus::Modified));
        assert_eq!(files[1].path, "docs/new.md");
        assert!(matches!(files[1].status, FileStatus::Added));
        assert_eq!(files[2].path, "new.ts");
        assert_eq!(files[2].old_path.as_deref(), Some("old.ts"));
        assert!(matches!(files[2].status, FileStatus::Renamed));
    }

    #[test]
    fn parses_nested_openai_response_text() {
        let body = r#"{
            "status": "completed",
            "output": [
                {
                    "type": "message",
                    "content": [
                        {
                            "type": "output_text",
                            "text": "{\"summary\":\"fix: save OpenAI key\",\"description\":\"- Enable macOS keychain backend\"}"
                        }
                    ]
                }
            ]
        }"#;

        let suggestion = parse_openai_commit_response(body).expect("response should parse");

        assert_eq!(suggestion.summary, "fix: save OpenAI key");
        assert_eq!(suggestion.description, "- Enable macOS keychain backend");
    }

    #[test]
    fn parses_openai_branch_name_response() {
        let body = r#"{
            "status": "completed",
            "output_text": "{\"name\":\"fix/auth-token-refresh\"}"
        }"#;

        let suggestion = parse_openai_branch_response(body).expect("branch name should parse");

        assert_eq!(suggestion.name, "fix/auth-token-refresh");
    }

    #[test]
    fn rejects_unsafe_openai_branch_names() {
        let error =
            normalize_branch_suggestion("../danger".to_string()).expect_err("branch should fail");
        let serialized = serde_json::to_value(error).expect("error should serialize");

        assert_eq!(serialized["code"], "OPENAI_UNSAFE_BRANCH_NAME");
    }

    #[test]
    fn parses_openai_pr_response() {
        let body = r###"{
            "status": "completed",
            "output_text": "{\"title\":\"Improve history controls\",\"description\":\"## Summary\\n- Add filters\\n\\n## Testing\\n- npm run build\"}"
        }"###;

        let suggestion = parse_openai_pr_response(body).expect("PR text should parse");

        assert_eq!(suggestion.title, "Improve history controls");
        assert!(suggestion.description.contains("Add filters"));
    }

    #[test]
    fn validates_undo_snapshot_ids() {
        assert!(validate_snapshot_id("1710000000000-before-commit").is_ok());
        assert!(validate_snapshot_id("../bad").is_err());
        assert!(validate_snapshot_id("bad/path").is_err());
    }

    #[test]
    fn resequences_stack_items_against_trunk() {
        let mut stack = BranchStack {
            id: "stack-test".to_string(),
            name: "Test stack".to_string(),
            trunk: "main".to_string(),
            items: vec![
                BranchStackItem {
                    id: "two".to_string(),
                    branch: "feature/two".to_string(),
                    base_branch: "old".to_string(),
                    order: 1,
                    head_sha: None,
                    upstream: None,
                    pr_ref: None,
                    status: BranchStackItemStatus::Unknown,
                },
                BranchStackItem {
                    id: "one".to_string(),
                    branch: "feature/one".to_string(),
                    base_branch: "old".to_string(),
                    order: 0,
                    head_sha: None,
                    upstream: None,
                    pr_ref: None,
                    status: BranchStackItemStatus::Unknown,
                },
            ],
            status: BranchStackStatus::Unknown,
            last_operation: None,
            created_at: "1".to_string(),
            updated_at: "1".to_string(),
        };

        stack_resequence_items(&mut stack);

        assert_eq!(stack.items[0].branch, "feature/one");
        assert_eq!(stack.items[0].base_branch, "main");
        assert_eq!(stack.items[1].base_branch, "feature/one");
    }

    #[test]
    fn validates_metadata_ids() {
        assert!(validate_metadata_id("lane-123-good", "lane id").is_ok());
        assert!(validate_metadata_id("../bad", "lane id").is_err());
        assert!(validate_metadata_id("bad/path", "lane id").is_err());
    }

    #[test]
    fn parses_branch_diff_shortstat() {
        let (additions, deletions) =
            parse_shortstat(" 4 files changed, 120 insertions(+), 17 deletions(-)");

        assert_eq!(additions, Some(120));
        assert_eq!(deletions, Some(17));
    }

    #[tokio::test]
    async fn stores_stack_metadata_inside_git_dir() {
        let repo = init_test_repo("stack-metadata");
        commit_test_file(&repo, "file.txt", "one\n", "first commit");
        run_git_test(&repo, &["branch", "feature/one"]);
        let trunk = run_git_test(&repo, &["rev-parse", "--abbrev-ref", "HEAD"])
            .trim()
            .to_string();

        git_stack_create(StackCreateRequest {
            repo_path: repo.to_string_lossy().to_string(),
            name: "Feature stack".to_string(),
            trunk: trunk.clone(),
            branches: vec!["feature/one".to_string()],
        })
        .await
        .expect("stack should create");

        let stacks = read_branch_stacks(&repo).await.expect("stacks");
        assert_eq!(stacks.len(), 1);
        assert_eq!(stacks[0].items[0].base_branch, trunk);

        let _ = fs::remove_dir_all(repo);
    }

    #[tokio::test]
    async fn diffs_untracked_file_against_dev_null() {
        let repo = init_test_repo("untracked-diff");
        commit_test_file(&repo, "seed.txt", "seed\n", "seed commit");
        fs::write(repo.join("new.txt"), "hello\nworld\n").expect("write new file");

        let diff = git_diff(
            repo.to_string_lossy().to_string(),
            "new.txt".to_string(),
            false,
            true,
        )
        .await
        .expect("untracked diff should render");

        assert!(diff.contains("+hello"), "diff should show added content:\n{diff}");
        assert!(diff.contains("+world"), "diff should show added content:\n{diff}");
        let _ = fs::remove_dir_all(repo);
    }

    #[tokio::test]
    async fn lists_files_in_untracked_directory() {
        let repo = init_test_repo("untracked-dir");
        commit_test_file(&repo, "seed.txt", "seed\n", "seed commit");
        fs::create_dir_all(repo.join("docs")).expect("mkdir docs");
        fs::write(repo.join("docs/a.md"), "a\n").expect("write a");
        fs::write(repo.join("docs/b.md"), "b\n").expect("write b");

        let files = git_list_directory_files(
            repo.to_string_lossy().to_string(),
            "docs/".to_string(),
        )
        .await
        .expect("directory listing should succeed");

        let mut paths: Vec<String> = files.iter().map(|change| change.path.clone()).collect();
        paths.sort();
        assert_eq!(paths, vec!["docs/a.md".to_string(), "docs/b.md".to_string()]);
        assert!(files.iter().all(|change| change.status == FileStatus::Untracked));
        let _ = fs::remove_dir_all(repo);
    }

    #[tokio::test]
    async fn snapshot_reports_change_totals_without_truncation() {
        let repo = init_test_repo("change-totals");
        commit_test_file(&repo, "seed.txt", "seed\n", "seed commit");
        for index in 0..12 {
            fs::write(repo.join(format!("file-{index}.txt")), "x\n").expect("write file");
        }

        let snapshot = build_snapshot(&repo, None).await.expect("snapshot");

        assert_eq!(snapshot.total_changes, 12);
        assert_eq!(snapshot.changes.len(), 12);
        assert!(!snapshot.changes_truncated);
        let _ = fs::remove_dir_all(repo);
    }

    #[tokio::test]
    async fn rewords_older_linear_commit_in_temp_repo() {
        let repo = init_test_repo("reword-older");
        let first = commit_test_file(&repo, "file.txt", "one\n", "first commit");
        let _second = commit_test_file(&repo, "file.txt", "two\n", "second commit");

        reword_commit(&repo, &first, "first commit reworded")
            .await
            .expect("commit should reword");

        let subjects = run_git_test(&repo, &["log", "--reverse", "--format=%s"]);
        let subjects = subjects.lines().collect::<Vec<_>>();
        let status = run_git_test(&repo, &["status", "--porcelain"]);

        assert_eq!(subjects, vec!["first commit reworded", "second commit"]);
        assert!(status.trim().is_empty());
        assert!(!list_undo_snapshots(&repo)
            .await
            .expect("snapshots")
            .is_empty());

        let _ = fs::remove_dir_all(repo);
    }

    #[tokio::test]
    async fn commit_search_scans_beyond_visible_history_limit() {
        let repo = init_test_repo("commit-search");
        let target = commit_test_file(&repo, "file.txt", "target\n", "target commit");
        for index in 0..55 {
            let contents = format!("newer {index}\n");
            let message = format!("newer commit {index}");
            commit_test_file(&repo, "file.txt", &contents, &message);
        }

        let limited_snapshot = build_snapshot(&repo, Some(MIN_HISTORY_LIMIT))
            .await
            .expect("snapshot should build");
        assert!(!limited_snapshot
            .commits
            .iter()
            .any(|commit| commit.sha == target));

        let results = git_commit_search(
            repo.to_string_lossy().to_string(),
            target[..11].to_string(),
            Some(MIN_HISTORY_LIMIT),
        )
        .await
        .expect("commit search should run");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].sha, target);

        let _ = fs::remove_dir_all(repo);
    }

    #[tokio::test]
    async fn commit_lookup_finds_commit_outside_visible_history_limit() {
        let repo = init_test_repo("commit-lookup");
        let target = commit_test_file(&repo, "file.txt", "target\n", "target commit");
        for index in 0..55 {
            let contents = format!("newer {index}\n");
            let message = format!("newer commit {index}");
            commit_test_file(&repo, "file.txt", &contents, &message);
        }

        let limited_snapshot = build_snapshot(&repo, Some(MIN_HISTORY_LIMIT))
            .await
            .expect("snapshot should build");
        assert!(!limited_snapshot
            .commits
            .iter()
            .any(|commit| commit.sha == target));

        let commit = git_commit_lookup(repo.to_string_lossy().to_string(), target.clone())
            .await
            .expect("commit lookup should run");

        assert_eq!(commit.sha, target);
        assert_eq!(commit.message, "target commit");

        let _ = fs::remove_dir_all(repo);
    }

    #[tokio::test]
    async fn commit_page_loads_history_after_skip() {
        let repo = init_test_repo("commit-page");
        let oldest = commit_test_file(&repo, "file.txt", "oldest\n", "oldest commit");
        for index in 0..55 {
            let contents = format!("newer {index}\n");
            let message = format!("newer commit {index}");
            commit_test_file(&repo, "file.txt", &contents, &message);
        }

        let page = git_commit_page(
            repo.to_string_lossy().to_string(),
            MIN_HISTORY_LIMIT,
            Some(MIN_HISTORY_LIMIT),
        )
        .await
        .expect("commit page should run");

        assert_eq!(page.commits.len(), 6);
        assert!(!page.has_more);
        assert_eq!(page.commits.last().map(|commit| commit.sha.as_str()), Some(oldest.as_str()));

        let _ = fs::remove_dir_all(repo);
    }

    #[test]
    fn ignores_openai_reasoning_ids_when_extracting_text() {
        let body = r#"{
            "status": "completed",
            "output": [
                {
                    "id": "rs_0bc5e10ff8c90d11006a0f1592300c8193bda9bce888d5d36b",
                    "type": "reasoning",
                    "summary": []
                },
                {
                    "id": "msg_123",
                    "type": "message",
                    "content": [
                        {
                            "type": "output_text",
                            "text": "{\"summary\":\"fix: parse OpenAI text\",\"description\":\"- Ignore reasoning item ids\"}"
                        }
                    ]
                }
            ]
        }"#;

        let suggestion = parse_openai_commit_response(body).expect("response should parse");

        assert_eq!(suggestion.summary, "fix: parse OpenAI text");
        assert_eq!(suggestion.description, "- Ignore reasoning item ids");
    }

    #[test]
    fn explains_incomplete_openai_response_without_text() {
        let body = r#"{
            "status": "incomplete",
            "incomplete_details": {
                "reason": "max_output_tokens"
            },
            "output": []
        }"#;

        let error = parse_openai_commit_response(body).expect_err("response should fail");
        let serialized = serde_json::to_value(error).expect("error should serialize");

        assert!(serialized["message"]
            .as_str()
            .expect("message")
            .contains("max_output_tokens"));
    }

    /// Build a bare "remote" and a working clone wired to it, returning the clone path.
    fn init_clone_with_remote(name: &str) -> (PathBuf, PathBuf) {
        let origin = std::env::temp_dir().join(format!("opengit-{name}-origin-{}", now_millis()));
        fs::create_dir_all(&origin).expect("origin dir");
        run_git_test(&origin, &["init", "--bare"]);

        let seed = std::env::temp_dir().join(format!("opengit-{name}-seed-{}", now_millis()));
        fs::create_dir_all(&seed).expect("seed dir");
        run_git_test(&seed, &["init"]);
        run_git_test(&seed, &["config", "user.name", "OpenGit Test"]);
        run_git_test(&seed, &["config", "user.email", "opengit@example.com"]);
        run_git_test(&seed, &["checkout", "-b", "main"]);
        commit_test_file(&seed, "file.txt", "one\n", "first commit");
        run_git_test(&seed, &["checkout", "-b", "feature/foo"]);
        commit_test_file(&seed, "feature.txt", "feature\n", "feature commit");
        run_git_test(&seed, &["remote", "add", "origin", &origin.to_string_lossy()]);
        run_git_test(&seed, &["push", "origin", "main", "feature/foo"]);

        let clone = std::env::temp_dir().join(format!("opengit-{name}-clone-{}", now_millis()));
        run_git_test(
            Path::new("."),
            &[
                "clone",
                &origin.to_string_lossy(),
                &clone.to_string_lossy(),
            ],
        );
        run_git_test(&clone, &["config", "user.name", "OpenGit Test"]);
        run_git_test(&clone, &["config", "user.email", "opengit@example.com"]);
        let _ = fs::remove_dir_all(&seed);
        (origin, clone)
    }

    #[tokio::test]
    async fn checks_out_remote_branch_as_local_tracking() {
        let (origin, clone) = init_clone_with_remote("remote-checkout-new");
        // Only `main` is checked out locally; `feature/foo` exists only on the remote.
        assert!(!git_ref_exists(&clone, "refs/heads/feature/foo").await);

        let snapshot = git_branch_checkout_remote(
            clone.to_string_lossy().to_string(),
            "origin/feature/foo".to_string(),
        )
        .await
        .expect("remote checkout should succeed");

        assert_eq!(snapshot.current_branch.as_deref(), Some("feature/foo"));
        assert!(git_ref_exists(&clone, "refs/heads/feature/foo").await);
        let upstream = run_git_test(&clone, &["rev-parse", "--abbrev-ref", "feature/foo@{upstream}"]);
        assert_eq!(upstream.trim(), "origin/feature/foo");

        let _ = fs::remove_dir_all(clone);
        let _ = fs::remove_dir_all(origin);
    }

    #[tokio::test]
    async fn fast_forwards_stale_local_branch_to_remote() {
        let (origin, clone) = init_clone_with_remote("remote-checkout-ff");
        // Create a local tracking branch, then advance the remote past it.
        run_git_test(&clone, &["switch", "--create", "feature/foo", "--track", "origin/feature/foo"]);
        let stale = run_git_test(&clone, &["rev-parse", "HEAD"]).trim().to_string();
        run_git_test(&clone, &["checkout", "main"]);

        // Push a new commit to the remote feature branch from a second clone.
        let worker = std::env::temp_dir().join(format!("opengit-ff-worker-{}", now_millis()));
        run_git_test(Path::new("."), &["clone", &origin.to_string_lossy(), &worker.to_string_lossy()]);
        run_git_test(&worker, &["config", "user.name", "OpenGit Test"]);
        run_git_test(&worker, &["config", "user.email", "opengit@example.com"]);
        run_git_test(&worker, &["checkout", "feature/foo"]);
        commit_test_file(&worker, "feature.txt", "feature\nupdated\n", "advance feature");
        run_git_test(&worker, &["push", "origin", "feature/foo"]);
        run_git_test(&clone, &["fetch", "origin"]);

        let snapshot = git_branch_checkout_remote(
            clone.to_string_lossy().to_string(),
            "origin/feature/foo".to_string(),
        )
        .await
        .expect("remote checkout should succeed");

        assert_eq!(snapshot.current_branch.as_deref(), Some("feature/foo"));
        let head = run_git_test(&clone, &["rev-parse", "HEAD"]).trim().to_string();
        let remote_tip = run_git_test(&clone, &["rev-parse", "refs/remotes/origin/feature/foo"])
            .trim()
            .to_string();
        assert_eq!(head, remote_tip, "local branch should be fast-forwarded to remote tip");
        assert_ne!(head, stale, "local branch should have advanced");

        let _ = fs::remove_dir_all(worker);
        let _ = fs::remove_dir_all(clone);
        let _ = fs::remove_dir_all(origin);
    }

    #[tokio::test]
    async fn diverged_local_branch_is_checked_out_but_not_moved() {
        let (origin, clone) = init_clone_with_remote("remote-checkout-diverged");
        run_git_test(&clone, &["switch", "--create", "feature/foo", "--track", "origin/feature/foo"]);
        // Give the local branch a commit the remote does not have.
        let local_tip = commit_test_file(&clone, "local.txt", "local only\n", "local divergent work");
        run_git_test(&clone, &["checkout", "main"]);

        let snapshot = git_branch_checkout_remote(
            clone.to_string_lossy().to_string(),
            "origin/feature/foo".to_string(),
        )
        .await
        .expect("remote checkout should succeed");

        assert_eq!(snapshot.current_branch.as_deref(), Some("feature/foo"));
        let head = run_git_test(&clone, &["rev-parse", "HEAD"]).trim().to_string();
        assert_eq!(head, local_tip, "diverged local branch must not be force-updated");

        let _ = fs::remove_dir_all(clone);
        let _ = fs::remove_dir_all(origin);
    }

    #[test]
    fn extracts_lock_path_from_git_error() {
        let detail = "fatal: Unable to create '/Users/dev/repo/.git/index.lock': File exists.\n\nAnother git process seems to be running in this repository.\n";
        assert_eq!(
            locked_path_from_detail(detail).as_deref(),
            Some("/Users/dev/repo/.git/index.lock")
        );
    }

    #[test]
    fn ignores_unrelated_git_errors_for_lock_detection() {
        let detail = "fatal: not a git repository\n";
        assert!(locked_path_from_detail(detail).is_none());
    }

    #[test]
    fn lock_failure_becomes_actionable_error() {
        let detail = "fatal: Unable to create '/repo/.git/index.lock': File exists.\n".to_string();
        match git_command_failure(detail) {
            AppError::GitActionRequired { code, message, .. } => {
                assert_eq!(code, "GIT_LOCK_EXISTS");
                assert!(message.contains("index.lock"));
            }
            other => panic!("expected GitActionRequired, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn clears_stale_index_lock() {
        let repo = init_test_repo("clear-lock");
        commit_test_file(&repo, "file.txt", "one\n", "first commit");
        let lock = repo.join(".git").join("index.lock");
        fs::write(&lock, b"").expect("write lock");
        assert!(lock.exists());

        git_clear_lock(
            repo.to_string_lossy().to_string(),
            lock.to_string_lossy().to_string(),
        )
        .await
        .expect("lock should clear");

        assert!(!lock.exists());
        let _ = fs::remove_dir_all(repo);
    }

    #[tokio::test]
    async fn refuses_to_clear_non_lock_file() {
        let repo = init_test_repo("clear-lock-guard");
        commit_test_file(&repo, "file.txt", "one\n", "first commit");
        let target = repo.join(".git").join("HEAD");
        assert!(target.exists());

        let result = git_clear_lock(
            repo.to_string_lossy().to_string(),
            target.to_string_lossy().to_string(),
        )
        .await;

        assert!(result.is_err());
        assert!(target.exists(), "guard must not delete a non-lock file");
        let _ = fs::remove_dir_all(repo);
    }

    fn init_test_repo(name: &str) -> PathBuf {
        let repo = std::env::temp_dir().join(format!("opengit-{name}-{}", now_millis()));
        fs::create_dir_all(&repo).expect("repo dir");
        run_git_test(&repo, &["init"]);
        run_git_test(&repo, &["config", "user.name", "OpenGit Test"]);
        run_git_test(&repo, &["config", "user.email", "opengit@example.com"]);
        repo
    }

    fn commit_test_file(repo: &Path, path: &str, contents: &str, message: &str) -> String {
        fs::write(repo.join(path), contents).expect("write file");
        run_git_test(repo, &["add", path]);
        run_git_test(repo, &["commit", "-m", message]);
        run_git_test(repo, &["rev-parse", "HEAD"])
            .trim()
            .to_string()
    }

    fn run_git_test(repo: &Path, args: &[&str]) -> String {
        let output = std::process::Command::new("git")
            .env("GIT_TERMINAL_PROMPT", "0")
            .arg("-C")
            .arg(repo)
            .args(args)
            .output()
            .expect("git command should run");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).to_string()
    }
}
