use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use serde_json::json;
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
const OPENAI_KEY_SERVICE: &str = "OpenGit";
const OPENAI_KEY_ACCOUNT: &str = "openai-api-key";
const AZURE_DEVOPS_PAT_ACCOUNT: &str = "azure-devops-pat";
const DEFAULT_OPENAI_MODEL: &str = "gpt-5-mini";
const MAX_STAGED_DIFF_CHARS: usize = 48_000;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GitOperationState {
    None,
    Merging,
    Rebasing,
    CherryPicking,
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
struct ConflictVersions {
    path: String,
    base: String,
    ours: String,
    theirs: String,
    working: String,
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

    let head = run_git(Some(&repo), vec!["rev-parse".into(), "HEAD".into()]).await?;
    if head.trim() != commit_sha.trim() {
        return invalid(
            "UNSUPPORTED_REWRITE",
            "Only the HEAD commit message can be updated safely right now.",
        );
    }

    let staged = run_git(
        Some(&repo),
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

    run_git(
        Some(&repo),
        vec!["commit".into(), "--amend".into(), "-m".into(), message],
    )
    .await?;
    build_snapshot(&repo, None).await
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
async fn ai_commit_message_generate(
    repo_path: String,
    model: Option<String>,
) -> CommandResult<AiCommitSuggestion> {
    let repo = resolve_repo_root(&repo_path).await?;
    let api_key = read_openai_api_key()?.ok_or_else(|| AppError::InvalidInput {
        code: "OPENAI_KEY_MISSING",
        message:
            "Add an OpenAI API key in Preferences > Integrations before generating commit messages."
                .to_string(),
    })?;
    let model = validate_openai_model(model)?;
    let staged_context = build_staged_commit_context(&repo).await?;

    let response = reqwest::Client::new()
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(api_key)
        .json(&json!({
            "model": model,
            "instructions": "You write concise Git commit messages from staged diffs. Return only JSON with keys summary and description. summary must be one line, preferably Conventional Commits style. description should be a short markdown body with 1-4 bullets when useful. Do not invent files or behavior not shown in the staged diff.",
            "input": staged_context,
            "reasoning": {
                "effort": "minimal"
            },
            "max_output_tokens": 1200
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

    parse_openai_commit_response(&body_text)
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
    run_git_snapshot_operation(
        &repo,
        vec!["pull".into(), "--ff".into(), "--no-edit".into()],
    )
    .await
}

#[tauri::command]
async fn git_pull_fast_forward(repo_path: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    run_git_snapshot_operation(
        &repo,
        vec!["pull".into(), "--ff".into(), "--no-edit".into()],
    )
    .await
}

#[tauri::command]
async fn git_pull_rebase(repo_path: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    run_git_snapshot_operation(&repo, vec!["pull".into(), "--rebase".into()]).await
}

#[tauri::command]
async fn git_merge(repo_path: String, branch: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    validate_ref_arg(&branch, "branch name")?;
    run_git_snapshot_operation(&repo, vec!["merge".into(), "--no-edit".into(), branch]).await
}

#[tauri::command]
async fn git_rebase(repo_path: String, upstream: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    validate_ref_arg(&upstream, "upstream branch")?;
    run_git_snapshot_operation(&repo, vec!["rebase".into(), upstream]).await
}

#[tauri::command]
async fn git_cherry_pick(repo_path: String, commit_sha: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    validate_ref_arg(&commit_sha, "commit")?;
    run_git_snapshot_operation(&repo, vec!["cherry-pick".into(), commit_sha]).await
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
async fn git_conflict_versions(repo_path: String, path: String) -> CommandResult<ConflictVersions> {
    let repo = resolve_repo_root(&repo_path).await?;
    let mut safe_paths = validate_file_paths(&[path])?;
    let path = safe_paths.remove(0);
    let working = std::fs::read_to_string(repo.join(&path)).unwrap_or_default();

    Ok(ConflictVersions {
        base: git_show_stage(&repo, 1, &path).await.unwrap_or_default(),
        ours: git_show_stage(&repo, 2, &path).await.unwrap_or_default(),
        theirs: git_show_stage(&repo, 3, &path).await.unwrap_or_default(),
        working,
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
            run_git(
                Some(&repo),
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
            run_git(
                Some(&repo),
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
            let ours = git_show_stage(&repo, 2, &path).await.unwrap_or_default();
            let theirs = git_show_stage(&repo, 3, &path).await.unwrap_or_default();
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
    run_git(Some(&repo), vec!["add".into(), "--".into(), path]).await?;
    build_snapshot(&repo, None).await
}

#[tauri::command]
async fn git_operation_continue(repo_path: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    match detect_git_operation(&repo).await {
        GitOperationState::Rebasing => {
            run_git_snapshot_operation(&repo, vec!["rebase".into(), "--continue".into()]).await
        }
        GitOperationState::CherryPicking => {
            run_git_snapshot_operation(&repo, vec!["cherry-pick".into(), "--continue".into()]).await
        }
        GitOperationState::Merging => {
            run_git_snapshot_operation(&repo, vec!["commit".into(), "--no-edit".into()]).await
        }
        GitOperationState::None => invalid(
            "NO_GIT_OPERATION",
            "There is no merge, rebase, or cherry-pick to continue.",
        ),
    }
}

#[tauri::command]
async fn git_operation_abort(repo_path: String) -> CommandResult<RepoSnapshot> {
    let repo = resolve_repo_root(&repo_path).await?;
    match detect_git_operation(&repo).await {
        GitOperationState::Rebasing => {
            run_git(Some(&repo), vec!["rebase".into(), "--abort".into()]).await?;
        }
        GitOperationState::CherryPicking => {
            run_git(Some(&repo), vec!["cherry-pick".into(), "--abort".into()]).await?;
        }
        GitOperationState::Merging => {
            run_git(Some(&repo), vec!["merge".into(), "--abort".into()]).await?;
        }
        GitOperationState::None => {
            return invalid(
                "NO_GIT_OPERATION",
                "There is no merge, rebase, or cherry-pick to abort.",
            );
        }
    }

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
        Err(AppError::GitFailed {
            message: git_error_summary(&detail),
            detail,
        })
    }
}

async fn run_git_snapshot_operation(repo: &Path, args: Vec<String>) -> CommandResult<RepoSnapshot> {
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
            let parts: Vec<&str> = record.splitn(12, ' ').collect();
            if let (Some(xy), Some(path)) = (parts.get(1), parts.get(11)) {
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

fn parse_openai_commit_response(body_text: &str) -> CommandResult<AiCommitSuggestion> {
    let body: OpenAiResponseBody =
        serde_json::from_str(body_text).map_err(|error| AppError::AiFailed {
            message: "OpenAI returned an unreadable response.".to_string(),
            detail: error.to_string(),
        })?;
    let output = extract_openai_output_text(&body).ok_or_else(|| AppError::AiFailed {
        message: openai_missing_output_message(&body),
        detail: truncate_display_text(&redact_secrets(body_text), 2_000),
    })?;

    parse_commit_suggestion_text(&output)
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
            git_commit_message_update,
            ai_openai_status,
            ai_openai_test_api_key,
            ai_openai_save_api_key,
            ai_openai_clear_api_key,
            azure_devops_status,
            azure_devops_save_pat,
            azure_devops_clear_pat,
            ai_commit_message_generate,
            git_branch_create,
            git_branch_checkout,
            git_branch_delete,
            git_branch_rename,
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
            "u UU N... 100644 100644 100644 100644 aaa bbb ccc ddd src/conflict.ts\0"
        );

        let (_branch, changes, conflicts) = parse_status(raw);

        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].path, "src/conflict.ts");
        assert_eq!(conflicts[0].kind, "UU");
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
}
