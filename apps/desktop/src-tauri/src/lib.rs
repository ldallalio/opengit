use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::{Component, Path, PathBuf},
};
use tauri::Manager;
use thiserror::Error;
use tokio::process::Command;

type CommandResult<T> = Result<T, AppError>;
const DEFAULT_HISTORY_LIMIT: u32 = 250;
const MIN_HISTORY_LIMIT: u32 = 50;
const MAX_HISTORY_LIMIT: u32 = 2_000;

#[derive(Debug, Error)]
enum AppError {
    #[error("{message}")]
    InvalidInput { code: &'static str, message: String },
    #[error("Git command failed")]
    GitFailed { message: String, detail: String },
    #[error("I/O error: {0}")]
    Io(String),
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
            AppError::Io(message) => ErrorBody {
                code: "IO_ERROR",
                message: message.clone(),
                detail: None,
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

#[derive(Debug, Serialize, Clone, Copy)]
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

#[derive(Debug, Serialize)]
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
struct Branch {
    name: String,
    full_ref: String,
    upstream: Option<String>,
    ahead: Option<i32>,
    behind: Option<i32>,
    is_current: bool,
    is_protected: bool,
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

#[derive(Debug, Serialize, Clone, Copy)]
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
struct RepoSnapshot {
    repository: Repository,
    current_branch: Option<String>,
    upstream: Option<String>,
    ahead: i32,
    behind: i32,
    changes: Vec<FileChange>,
    branches: Vec<Branch>,
    remotes: Vec<Remote>,
    stashes: Vec<Stash>,
    commits: Vec<Commit>,
    conflicts: Vec<Conflict>,
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
struct BranchCreateRequest {
    repo_path: String,
    name: String,
    checkout: bool,
    start_point: Option<String>,
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

#[tauri::command]
async fn git_stage(repo_path: String, paths: Vec<String>) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    let safe_paths = validate_file_paths(&paths)?;
    let mut args = vec!["add".into(), "--".into()];
    args.extend(safe_paths);
    run_git(Some(&repo), args).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_unstage(repo_path: String, paths: Vec<String>) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    let safe_paths = validate_file_paths(&paths)?;
    let mut args = vec!["restore".into(), "--staged".into(), "--".into()];
    args.extend(safe_paths);
    run_git(Some(&repo), args).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_discard(repo_path: String, paths: Vec<String>) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    let safe_paths = validate_file_paths(&paths)?;
    let mut args = vec!["restore".into(), "--".into()];
    args.extend(safe_paths);
    run_git(Some(&repo), args).await?;
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
    run_git(Some(&repo), args).await?;
    build_snapshot(&repo, None).await
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
    run_git(Some(&repo), args).await?;
    if request.checkout {
        run_git(Some(&repo), vec!["checkout".into(), request.name]).await?;
    }
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_branch_checkout(repo_path: String, name: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    validate_ref_arg(&name, "branch name")?;
    run_git(Some(&repo), vec!["checkout".into(), name]).await?;
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
    run_git(Some(&repo), vec!["branch".into(), delete_arg.into(), name]).await?;
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
    run_git(
        Some(&repo),
        vec!["branch".into(), "-m".into(), old_name, new_name],
    )
    .await?;
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
    run_git(Some(&repo), vec!["pull".into()]).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_merge(repo_path: String, branch: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    validate_ref_arg(&branch, "branch name")?;
    run_git(
        Some(&repo),
        vec!["merge".into(), "--no-edit".into(), branch],
    )
    .await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_rebase(repo_path: String, upstream: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    validate_ref_arg(&upstream, "upstream branch")?;
    run_git(Some(&repo), vec!["rebase".into(), upstream]).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_cherry_pick(repo_path: String, commit_sha: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    validate_ref_arg(&commit_sha, "commit")?;
    run_git(Some(&repo), vec!["cherry-pick".into(), commit_sha]).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_revert(repo_path: String, commit_sha: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    validate_ref_arg(&commit_sha, "commit")?;
    run_git(
        Some(&repo),
        vec!["revert".into(), "--no-edit".into(), commit_sha],
    )
    .await?;
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

    run_git(Some(&repo), args).await?;
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
    run_git(Some(&repo), args).await?;
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
    run_git(Some(&repo), vec!["remote".into(), "add".into(), name, url]).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_stash_push(repo_path: String, message: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    let mut args = vec!["stash".into(), "push".into()];
    if !message.trim().is_empty() {
        args.extend(["-m".into(), message]);
    }
    run_git(Some(&repo), args).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_stash_apply(repo_path: String, stash: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    validate_stash_ref(&stash)?;
    run_git(Some(&repo), vec!["stash".into(), "apply".into(), stash]).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_stash_drop(repo_path: String, stash: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    validate_stash_ref(&stash)?;
    run_git(Some(&repo), vec!["stash".into(), "drop".into(), stash]).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_diff(repo_path: String, path: String, staged: bool) -> CommandResult<String> {
    let repo = resolve_repo_root(&repo_path).await?;
    let mut safe_paths = validate_file_paths(&[path])?;
    let mut args = vec!["diff".into(), "--no-ext-diff".into(), "--minimal".into()];
    if staged {
        args.push("--staged".into());
    }
    args.push("--".into());
    args.append(&mut safe_paths);
    run_git(Some(&repo), args).await
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

    let (branch_status, changes, conflicts) = parse_status(&status_output);
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
        &run_git(
            Some(repo),
            vec![
                "log".into(),
                "--all".into(),
                "--topo-order".into(),
                "--date=iso-strict".into(),
                "--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%s%x1f%D%x1e".into(),
                "-n".into(),
                history_limit.to_string(),
            ],
        )
        .await
        .unwrap_or_default(),
    );

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
        branches,
        remotes,
        stashes,
        commits,
        conflicts,
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
    let mut command = Command::new("git");
    command.env("GIT_TERMINAL_PROMPT", "0");
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
        Err(AppError::GitFailed {
            message: git_error_summary(&detail),
            detail,
        })
    }
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
    let git_dir = run_git(Some(repo), vec!["rev-parse".into(), "--git-dir".into()])
        .await
        .ok()
        .map(|value| repo.join(value.trim()));

    if let Some(git_dir) = git_dir {
        if git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists() {
            return WorktreeState::Rebasing;
        }
        if git_dir.join("MERGE_HEAD").exists() {
            return WorktreeState::Merging;
        }
        if git_dir.join("CHERRY_PICK_HEAD").exists() {
            return WorktreeState::CherryPicking;
        }
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
        .find(|line| !line.trim().is_empty())
        .map(|line| redact_secrets(line.trim()))
        .unwrap_or_else(|| "Git command failed.".to_string())
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
            git_stage,
            git_unstage,
            git_discard,
            git_commit,
            git_branch_create,
            git_branch_checkout,
            git_branch_delete,
            git_branch_rename,
            git_fetch,
            git_pull,
            git_merge,
            git_rebase,
            git_cherry_pick,
            git_revert,
            git_tag_create,
            git_push,
            git_remote_add,
            git_stash_push,
            git_stash_apply,
            git_stash_drop,
            git_diff,
            git_commit_files,
            git_commit_file_diff
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
    fn clamps_history_limit() {
        assert_eq!(clamp_history_limit(None), DEFAULT_HISTORY_LIMIT);
        assert_eq!(clamp_history_limit(Some(1)), MIN_HISTORY_LIMIT);
        assert_eq!(clamp_history_limit(Some(750)), 750);
        assert_eq!(clamp_history_limit(Some(10_000)), MAX_HISTORY_LIMIT);
    }

    #[test]
    fn redacts_credentials_from_urls() {
        let redacted = redact_secrets("https://token:secret@github.com/example/private.git");
        assert_eq!(redacted, "https://***@github.com/example/private.git");
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
}
