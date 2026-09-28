//! Worktree registry and lifecycle. Git remains the authority for filesystem changes.
use super::*;
use std::sync::{Arc, OnceLock};
static WRITES: OnceLock<std::sync::Mutex<BTreeMap<PathBuf, Arc<tokio::sync::Mutex<()>>>>> =
    OnceLock::new();
/// Shared by native mutations in every checkout of the same repository.
pub(super) async fn write_lock(repo_path: &str) -> CommandResult<tokio::sync::OwnedMutexGuard<()>> {
    let repo = resolve_repo_root(repo_path).await?;
    let common = git(
        &repo,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )
    .await?;
    let key = fs::canonicalize(common.strip_suffix('\n').unwrap_or(&common))?;
    let lock = WRITES
        .get_or_init(|| std::sync::Mutex::new(BTreeMap::new()))
        .lock()
        .map_err(|_| invalid("Repository lock is unavailable."))?
        .entry(key)
        .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone();
    Ok(lock.lock_owned().await)
}

fn invalid(message: impl Into<String>) -> AppError {
    AppError::InvalidInput {
        code: "WORKTREE_INVALID",
        message: message.into(),
    }
}
async fn git(repo: &Path, args: &[&str]) -> CommandResult<String> {
    run_git(Some(repo), args.iter().map(|s| s.to_string()).collect()).await
}

pub(super) fn parse(output: &str) -> Vec<Worktree> {
    let mut rows = Vec::new();
    let mut row = Worktree::default();
    for field in output.split('\0').chain(std::iter::once("")) {
        if field.is_empty() {
            if !row.path.is_empty() {
                row.is_main = rows.is_empty();
                rows.push(std::mem::take(&mut row));
            }
        } else if let Some(path) = field.strip_prefix("worktree ") {
            row.path = path.into();
        } else if let Some(head) = field.strip_prefix("HEAD ") {
            row.head = head.into();
        } else if let Some(branch) = field.strip_prefix("branch ") {
            row.branch_ref = Some(branch.into());
            row.branch = Some(normalize_ref_display(branch));
        } else if field == "bare" {
            row.bare = true;
        } else if field == "detached" {
            row.detached = true;
        } else if field == "locked" || field.starts_with("locked ") {
            row.locked = true;
            row.lock_reason = field.strip_prefix("locked ").map(str::to_string);
        } else if field == "prunable" || field.starts_with("prunable ") {
            row.prunable = true;
            row.prune_reason = field.strip_prefix("prunable ").map(str::to_string);
        }
    }
    rows
}

/// Use the same path representation as repo_open, including Windows verbatim paths.
/// A missing registration still needs a stable identity for Locate/Repair: resolve
/// the nearest existing ancestor without requiring the checkout itself to exist.
fn registry_path(path: &Path) -> PathBuf {
    if let Ok(canonical) = fs::canonicalize(path) {
        return canonical;
    }
    let mut ancestor = path;
    let mut missing = Vec::new();
    while let (Some(parent), Some(name)) = (ancestor.parent(), ancestor.file_name()) {
        missing.push(name.to_os_string());
        if let Ok(mut canonical) = fs::canonicalize(parent) {
            for component in missing.iter().rev() {
                canonical.push(component);
            }
            return canonical;
        }
        ancestor = parent;
    }
    path.to_path_buf()
}

pub(super) async fn list(repo: &Path) -> CommandResult<Vec<Worktree>> {
    let mut rows = parse(&git(repo, &["worktree", "list", "--porcelain", "-z"]).await?);
    let current = fs::canonicalize(repo)?;
    let common = git(
        repo,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )
    .await?;
    let common = fs::canonicalize(common.strip_suffix('\n').unwrap_or(&common))?;
    for row in &mut rows {
        row.path = registry_path(Path::new(&row.path))
            .to_string_lossy()
            .into_owned();
        let checkout = Path::new(&row.path);
        let admin = if row.is_main {
            Some(common.clone())
        } else {
            fs::read_to_string(checkout.join(".git"))
                .ok()
                .and_then(|raw| {
                    raw.strip_prefix("gitdir: ")
                        .map(|value| checkout.join(value.strip_suffix('\n').unwrap_or(value)))
                })
        };
        row.checkout_id = admin
            .and_then(|path| fs::canonicalize(path).ok())
            .map(|path| path.to_string_lossy().into_owned());
        row.common_dir = common.to_string_lossy().into_owned();
        row.is_current = fs::canonicalize(&row.path).ok().as_ref() == Some(&current);
        row.availability = match fs::metadata(&row.path) {
            Ok(m) if m.is_dir() => "available",
            Ok(_) => "inaccessible",
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => "missing",
            Err(_) => "inaccessible",
        }
        .into();
    }
    Ok(rows)
}
async fn member(repo: &Path, path: &str) -> CommandResult<Worktree> {
    list(repo)
        .await?
        .into_iter()
        .find(|r| {
            r.path == path
                || Path::new(&r.path) == registry_path(Path::new(path))
                || fs::canonicalize(path)
                    .ok()
                    .zip(fs::canonicalize(&r.path).ok())
                    .is_some_and(|(a, b)| a == b)
        })
        .ok_or_else(|| invalid("This checkout is no longer registered. Refresh the worktree list."))
}
pub(super) async fn ensure_branch_available(repo: &Path, branch: &str) -> CommandResult<()> {
    if let Some(row) = list(repo).await?.iter().find(|r| {
        !r.is_current
            && (r.branch.as_deref() == Some(branch) || r.branch_ref.as_deref() == Some(branch))
    }) {
        return Err(invalid(format!(
            "Branch is checked out at {}. Open that worktree first.",
            row.path
        )));
    }
    Ok(())
}
#[tauri::command]
pub(super) async fn git_worktree_list(repo_path: String) -> CommandResult<Vec<Worktree>> {
    list(&resolve_repo_root(&repo_path).await?).await
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub(super) struct Status {
    staged: usize,
    unstaged: usize,
    untracked: usize,
    ignored: usize,
    conflicts: usize,
    operation: bool,
    checked_at: String,
}
async fn status(path: &Path) -> CommandResult<Status> {
    let raw = git(
        path,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--ignored=matching",
        ],
    )
    .await?;
    let mut result = Status::default();
    let mut fields = raw.split('\0');
    while let Some(field) = fields.next() {
        if field.len() < 3 {
            continue;
        }
        let x = field.as_bytes()[0];
        let y = field.as_bytes()[1];
        if x == b'!' {
            result.ignored += 1;
            continue;
        }
        if x == b'?' {
            result.untracked += 1;
            continue;
        }
        if x != b' ' {
            result.staged += 1;
        }
        if y != b' ' {
            result.unstaged += 1;
        }
        if x == b'U' || y == b'U' || &field[..2] == "AA" || &field[..2] == "DD" {
            result.conflicts += 1;
        }
        if x == b'R' || x == b'C' {
            fields.next();
        }
    }
    let dir = git(path, &["rev-parse", "--absolute-git-dir"]).await?;
    result.operation = [
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "rebase-merge",
        "rebase-apply",
        "sequencer",
    ]
    .iter()
    .any(|p| {
        Path::new(dir.strip_suffix('\n').unwrap_or(&dir))
            .join(p)
            .exists()
    });
    result.checked_at = now_millis().to_string();
    Ok(result)
}
#[tauri::command]
pub(super) async fn git_worktree_status(repo_path: String, path: String) -> CommandResult<Status> {
    let repo = resolve_repo_root(&repo_path).await?;
    let row = member(&repo, &path).await?;
    if row.bare || row.availability != "available" {
        return Err(invalid("Checkout is unavailable."));
    }
    tokio::time::timeout(std::time::Duration::from_secs(15), status(Path::new(&path)))
        .await
        .map_err(|_| invalid("Worktree status timed out."))?
}
async fn destination(repo: &Path, path: &str) -> CommandResult<PathBuf> {
    let input = Path::new(path);
    if !input.is_absolute() {
        return Err(invalid("Choose an absolute destination path."));
    }
    let leaf = input
        .file_name()
        .ok_or_else(|| invalid("Choose a folder name."))?;
    let dest = fs::canonicalize(
        input
            .parent()
            .ok_or_else(|| invalid("Choose a parent directory."))?,
    )?
    .join(leaf);
    if dest.exists() {
        return Err(invalid(
            "The destination already exists. Choose a new folder.",
        ));
    }
    for row in list(repo).await? {
        let registered = fs::canonicalize(&row.path).unwrap_or_else(|_| PathBuf::from(&row.path));
        if dest.starts_with(&registered)
            || registered.starts_with(&dest)
            || dest.starts_with(&row.common_dir)
        {
            return Err(invalid(
                "The destination overlaps a registered checkout or Git metadata.",
            ));
        }
    }
    Ok(dest)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Create {
    path: String,
    mode: String,
    branch: String,
    start_point: String,
}
async fn validate_create(repo: &Path, request: &Create) -> CommandResult<()> {
    destination(repo, &request.path).await?;
    git(
        repo,
        &[
            "rev-parse",
            "--verify",
            "--end-of-options",
            &format!("{}^{{commit}}", request.start_point),
        ],
    )
    .await?;
    match request.mode.as_str() {
        "new" => {
            git(repo, &["check-ref-format", "--branch", &request.branch]).await?;
            if git(
                repo,
                &[
                    "show-ref",
                    "--verify",
                    &format!("refs/heads/{}", request.branch),
                ],
            )
            .await
            .is_ok()
            {
                return Err(invalid(
                    "This branch already exists. Choose Existing local branch or another name.",
                ));
            }
        }
        "existing" => {
            git(
                repo,
                &[
                    "show-ref",
                    "--verify",
                    &format!("refs/heads/{}", request.branch),
                ],
            )
            .await?;
            if list(repo)
                .await?
                .iter()
                .any(|r| r.branch.as_deref() == Some(&request.branch))
            {
                return Err(invalid(
                    "This branch is checked out. Open its existing worktree.",
                ));
            }
        }
        "detached" => (),
        _ => return Err(invalid("Unknown creation mode.")),
    }
    Ok(())
}
#[tauri::command]
pub(super) async fn git_worktree_validate(repo_path: String, request: Create) -> CommandResult<()> {
    validate_create(&resolve_repo_root(&repo_path).await?, &request).await
}
#[tauri::command]
pub(super) async fn git_worktree_create(
    repo_path: String,
    request: Create,
) -> CommandResult<String> {
    let _guard = write_lock(&repo_path).await?;
    let repo = resolve_repo_root(&repo_path).await?;
    validate_create(&repo, &request).await?;
    let dest = destination(&repo, &request.path).await?;
    let base = git(
        &repo,
        &[
            "rev-parse",
            "--verify",
            "--end-of-options",
            &format!("{}^{{commit}}", request.start_point),
        ],
    )
    .await?;
    let dest = dest.to_string_lossy().into_owned();
    let remote_ref = format!(
        "refs/remotes/{}",
        request
            .start_point
            .strip_prefix("refs/remotes/")
            .unwrap_or(&request.start_point)
    );
    let mut args = vec!["worktree", "add"];
    match request.mode.as_str() {
        "new" => {
            git(&repo, &["check-ref-format", "--branch", &request.branch]).await?;
            args.extend(["-b", &request.branch]);
            if git(&repo, &["show-ref", "--verify", &remote_ref])
                .await
                .is_ok()
            {
                args.push("--track");
            }
        }
        "existing" => {
            git(
                &repo,
                &[
                    "show-ref",
                    "--verify",
                    &format!("refs/heads/{}", request.branch),
                ],
            )
            .await?;
            if list(&repo)
                .await?
                .iter()
                .any(|r| r.branch.as_deref() == Some(&request.branch))
            {
                return Err(invalid(
                    "This branch is already checked out. Open its existing worktree.",
                ));
            }
        }
        "detached" => args.push("--detach"),
        _ => return Err(invalid("Unknown creation mode.")),
    }
    args.extend(["--", &dest]);
    let tracking = request.mode == "new" && args.contains(&"--track");
    args.push(if request.mode == "existing" {
        &request.branch
    } else if tracking {
        &remote_ref
    } else {
        base.trim()
    });
    git(&repo, &args).await?;
    Ok(dest)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Removal {
    path: String,
    ignored: usize,
    blockers: Vec<String>,
    head: String,
    token: String,
}
async fn removal(repo: &Path, path: &str) -> CommandResult<Removal> {
    let row = member(repo, path).await?;
    let mut blockers = Vec::new();
    if row.is_main || row.bare {
        blockers.push("The main checkout cannot be removed.".into());
    }
    if row.locked {
        blockers.push("Unlock this worktree before removal.".into());
    }
    if row.availability != "available" {
        blockers.push("Locate or repair this checkout first.".into());
    }
    let mut ignored = 0;
    if row.availability == "available" && !row.bare {
        let path = Path::new(path);
        let state = status(path).await?;
        ignored = state.ignored;
        if state.staged + state.unstaged + state.untracked + state.conflicts > 0 {
            blockers.push("Commit or preserve all tracked and untracked changes first.".into());
        }
        if state.operation || read_active_operation(path).await?.is_some() {
            blockers.push("Finish the active Git/OpenGit operation first.".into());
        }
        if !read_parallel_lanes(path).await?.is_empty() {
            blockers.push("Preserve and remove saved lanes first.".into());
        }
        if path.join(".gitmodules").exists() {
            blockers.push("Worktrees containing submodules cannot be removed here.".into());
        }
        if row.detached {
            let refs = git(
                path,
                &[
                    "for-each-ref",
                    "--contains",
                    &row.head,
                    "--format=%(refname)",
                    "refs/heads",
                    "refs/tags",
                ],
            )
            .await?;
            if refs.trim().is_empty() {
                blockers
                    .push("Create a branch or tag to preserve this detached commit first.".into());
            }
        }
    }
    let token = if row.availability == "available" && !row.bare {
        // Bind confirmation to identity, branch and the complete ignored/untracked listing.
        let identity = git(Path::new(path), &["rev-parse", "--absolute-git-dir"]).await?;
        let files = git(
            Path::new(path),
            &[
                "ls-files",
                "--others",
                "--ignored",
                "--exclude-standard",
                "-z",
            ],
        )
        .await?;
        let mut evidence = format!("{}{:?}{}{}", identity, row.branch_ref, row.head, files);
        for file in files.split('\0').filter(|f| !f.is_empty()) {
            let metadata = fs::symlink_metadata(Path::new(path).join(file))?;
            evidence.push_str(&format!(
                "{:?}:{:?}:{}",
                metadata.modified().ok(),
                metadata.file_type(),
                metadata.len()
            ));
        }
        use std::hash::{Hash, Hasher};
        let mut hash = std::collections::hash_map::DefaultHasher::new();
        evidence.hash(&mut hash);
        format!("{:x}", hash.finish())
    } else {
        String::new()
    };
    Ok(Removal {
        path: row.path,
        head: row.head,
        ignored,
        blockers,
        token,
    })
}
#[tauri::command]
pub(super) async fn git_worktree_remove_preview(
    repo_path: String,
    path: String,
) -> CommandResult<Removal> {
    removal(&resolve_repo_root(&repo_path).await?, &path).await
}
#[tauri::command]
pub(super) async fn git_worktree_remove(
    repo_path: String,
    path: String,
    head: String,
    token: String,
    acknowledge_ignored: bool,
) -> CommandResult<()> {
    let _guard = write_lock(&repo_path).await?;
    let repo = resolve_repo_root(&repo_path).await?;
    let preview = removal(&repo, &path).await?;
    if !preview.blockers.is_empty() {
        return Err(invalid(preview.blockers.join(" ")));
    }
    if preview.head != head || preview.token != token {
        return Err(invalid(
            "Checkout identity or content changed. Review removal again.",
        ));
    }
    if preview.ignored > 0 && !acknowledge_ignored {
        return Err(invalid("Acknowledge deletion of ignored files first."));
    }
    if fs::canonicalize(&path)? == repo {
        return Err(invalid(
            "Open a surviving checkout before removing this one.",
        ));
    }
    git(&repo, &["worktree", "remove", "--", &path]).await?;
    Ok(())
}
#[tauri::command]
pub(super) async fn git_worktree_manage(
    repo_path: String,
    path: String,
    action: String,
    value: String,
) -> CommandResult<()> {
    let _guard = write_lock(&repo_path).await?;
    let repo = resolve_repo_root(&repo_path).await?;
    let row = member(&repo, &path).await?;
    match action.as_str() {
        "reveal" | "editor" if row.availability == "available" => {
            let target = fs::canonicalize(&path)?.to_string_lossy().into_owned();
            if action == "editor" {
                if spawn_system_open("code", vec![target.clone()])
                    .await
                    .is_err()
                {
                    if cfg!(target_os = "macos") {
                        spawn_system_open(
                            "open",
                            vec!["-a".into(), "Visual Studio Code".into(), target],
                        )
                        .await?;
                    } else {
                        return Err(invalid("Install the VS Code command-line tool."));
                    }
                }
            } else if cfg!(target_os = "macos") {
                spawn_system_open("open", vec![target]).await?;
            } else if cfg!(target_os = "windows") {
                spawn_system_open("explorer", vec![target]).await?;
            } else {
                spawn_system_open("xdg-open", vec![target]).await?;
            }
        }
        "lock" if !row.is_main && !row.bare => {
            git(
                &repo,
                &["worktree", "lock", "--reason", &value, "--", &path],
            )
            .await?;
        }
        "unlock" if !row.is_main && !row.bare => {
            git(&repo, &["worktree", "unlock", "--", &path]).await?;
        }
        "move" if !row.is_main && !row.bare && !row.locked => {
            if Path::new(&path).join(".gitmodules").exists()
                || status(Path::new(&path)).await?.operation
            {
                return Err(invalid(
                    "Finish operations and resolve submodules before moving.",
                ));
            }
            let dest = destination(&repo, &value).await?;
            git(
                &repo,
                &["worktree", "move", "--", &path, &dest.to_string_lossy()],
            )
            .await?;
        }
        "repair" => {
            let moved = fs::canonicalize(&value)?;
            let raw = fs::read_to_string(moved.join(".git"))?;
            let gitdir = raw
                .strip_suffix('\n')
                .unwrap_or(&raw)
                .strip_prefix("gitdir: ")
                .ok_or_else(|| invalid("Select a linked checkout."))?;
            let admin = fs::canonicalize(moved.join(gitdir))?;
            let common = fs::canonicalize(&row.common_dir)?;
            if admin.parent() != Some(common.join("worktrees").as_path()) {
                return Err(invalid("This directory belongs to another repository."));
            }
            let old = fs::read_to_string(admin.join("gitdir"))?;
            if Path::new(old.strip_suffix('\n').unwrap_or(&old))
                .parent()
                .map(registry_path)
                != Some(registry_path(Path::new(&path)))
            {
                return Err(invalid(
                    "This directory does not match the selected registration.",
                ));
            }
            git(
                &repo,
                &["worktree", "repair", "--", &moved.to_string_lossy()],
            )
            .await?;
        }
        _ => return Err(invalid("This action is unavailable for this checkout.")),
    }
    Ok(())
}
#[tauri::command]
pub(super) async fn git_worktree_prune_preview(repo_path: String) -> CommandResult<String> {
    let repo = resolve_repo_root(&repo_path).await?;
    // Git emits dry-run diagnostics on stderr, so use a dedicated invocation.
    let output = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args([
            "worktree",
            "prune",
            "--dry-run",
            "--verbose",
            "--expire=now",
        ])
        .output()
        .await?;
    if !output.status.success() {
        return Err(git_command_failure(
            String::from_utf8_lossy(&output.stderr).into(),
        ));
    }
    Ok(format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    ))
}
#[tauri::command]
pub(super) async fn git_worktree_prune(repo_path: String, preview: String) -> CommandResult<()> {
    let _guard = write_lock(&repo_path).await?;
    if git_worktree_prune_preview(repo_path.clone()).await? != preview {
        return Err(invalid(
            "Stale registrations changed. Preview cleanup again.",
        ));
    }
    git(
        &resolve_repo_root(&repo_path).await?,
        &["worktree", "prune", "--verbose", "--expire=now"],
    )
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nul_parser_preserves_paths_and_reasons() {
        let rows = parse("worktree /repo main\0HEAD abc\0branch refs/heads/main\0future value\0\0worktree /other\n\t雪\0HEAD def\0detached\0locked external agent\0prunable missing path\0\0");
        assert_eq!(rows.len(), 2);
        assert!(rows[0].is_main);
        assert_eq!(rows[1].path, "/other\n\t雪");
        assert!(rows[1].detached);
        assert_eq!(rows[1].lock_reason.as_deref(), Some("external agent"));
    }
    #[test]
    fn bare_and_unborn() {
        let rows = parse("worktree /bare\0bare\0\0worktree /new\0branch refs/heads/new\0\0");
        assert!(rows[0].bare);
        assert_eq!(rows[1].head, "");
    }
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn command(path: &Path, args: &[&str]) -> String {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(path)
            .args(args)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{:?}: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap().trim().into()
    }
    fn fixture(name: &str) -> (Fixture, String) {
        let root = std::env::temp_dir().join(format!(
            "opengit-worktrees-{name}-{}-{}",
            std::process::id(),
            now_millis()
        ));
        fs::create_dir_all(root.join("main")).unwrap();
        let root = fs::canonicalize(root).unwrap();
        let repo = root.join("main");
        command(&repo, &["init", "-b", "main"]);
        command(&repo, &["config", "user.name", "Worktree Test"]);
        command(&repo, &["config", "user.email", "worktree@example.invalid"]);
        fs::write(repo.join("file.txt"), "initial\n").unwrap();
        command(&repo, &["add", "."]);
        command(&repo, &["commit", "-m", "initial"]);
        (Fixture(root), repo.to_string_lossy().into())
    }
    async fn create(repo: &str, path: &Path, branch: &str) -> String {
        git_worktree_create(
            repo.into(),
            Create {
                path: path.to_string_lossy().into(),
                mode: "new".into(),
                branch: branch.into(),
                start_point: "HEAD".into(),
            },
        )
        .await
        .unwrap()
    }
    #[tokio::test]
    async fn lifecycle_and_checkout_isolation() {
        let (fixture, repo) = fixture("lifecycle");
        let other = create(&repo, &fixture.0.join("other 雪"), "feature").await;
        assert_eq!(list(Path::new(&repo)).await.unwrap().len(), 2);
        assert_eq!(list(Path::new(&other)).await.unwrap().len(), 2);
        assert!(list(Path::new(&other)).await.unwrap()[1].is_current);
        fs::write(Path::new(&other).join("file.txt"), "linked change\n").unwrap();
        assert_eq!(status(Path::new(&repo)).await.unwrap().unstaged, 0);
        assert_eq!(status(Path::new(&other)).await.unwrap().unstaged, 1);
        assert!(!removal(Path::new(&repo), &other)
            .await
            .unwrap()
            .blockers
            .is_empty());
        git_stage(other.clone(), vec!["file.txt".into()])
            .await
            .unwrap();
        assert_eq!(status(Path::new(&other)).await.unwrap().staged, 1);
        assert_eq!(status(Path::new(&repo)).await.unwrap().staged, 0);
        assert!(!list_undo_snapshots(Path::new(&other))
            .await
            .unwrap()
            .is_empty());
        assert!(list_undo_snapshots(Path::new(&repo))
            .await
            .unwrap()
            .is_empty());
        git_commit(other.clone(), "linked commit".into(), false)
            .await
            .unwrap();
        assert_eq!(
            fs::read_to_string(Path::new(&repo).join("file.txt")).unwrap(),
            "initial\n"
        );
        git_worktree_manage(repo.clone(), other.clone(), "lock".into(), "agent".into())
            .await
            .unwrap();
        assert!(!removal(Path::new(&repo), &other)
            .await
            .unwrap()
            .blockers
            .is_empty());
        git_worktree_manage(repo.clone(), other.clone(), "unlock".into(), "".into())
            .await
            .unwrap();
        let moved = fixture.0.join("moved").to_string_lossy().into_owned();
        git_worktree_manage(repo.clone(), other.clone(), "move".into(), moved.clone())
            .await
            .unwrap();
        assert!(!Path::new(&other).exists());
        let preview = removal(Path::new(&repo), &moved).await.unwrap();
        assert!(preview.blockers.is_empty());
        git_worktree_remove(
            repo.clone(),
            moved.clone(),
            preview.head,
            preview.token,
            false,
        )
        .await
        .unwrap();
        assert!(!Path::new(&moved).exists());
        command(
            Path::new(&repo),
            &["show-ref", "--verify", "refs/heads/feature"],
        );
        assert!(!removal(Path::new(&repo), &repo)
            .await
            .unwrap()
            .blockers
            .is_empty());
    }
    #[tokio::test]
    async fn removal_requires_fresh_preview_and_preserves_detached_commits() {
        let (fixture, repo) = fixture("removal");
        let other = create(&repo, &fixture.0.join("other"), "feature").await;
        fs::write(Path::new(&other).join(".gitignore"), "build/\n").unwrap();
        command(Path::new(&other), &["add", ".gitignore"]);
        command(Path::new(&other), &["commit", "-m", "ignore"]);
        fs::create_dir(Path::new(&other).join("build")).unwrap();
        fs::write(Path::new(&other).join("build/output"), "important").unwrap();
        let preview = removal(Path::new(&repo), &other).await.unwrap();
        assert!(preview.ignored > 0);
        assert!(git_worktree_remove(
            repo.clone(),
            other.clone(),
            preview.head.clone(),
            preview.token.clone(),
            false
        )
        .await
        .is_err());
        fs::write(Path::new(&other).join("build/extra"), "new").unwrap();
        assert!(git_worktree_remove(
            repo.clone(),
            other.clone(),
            preview.head,
            preview.token,
            true
        )
        .await
        .is_err());
        command(Path::new(&other), &["checkout", "--detach"]);
        command(
            Path::new(&other),
            &["commit", "--allow-empty", "-m", "unique detached"],
        );
        let preview = removal(Path::new(&repo), &other).await.unwrap();
        assert!(preview.blockers.iter().any(|s| s.contains("detached")));
        command(Path::new(&other), &["branch", "preserved"]);
        let preview = removal(Path::new(&repo), &other).await.unwrap();
        assert!(preview.blockers.is_empty());
        git_worktree_remove(
            repo.clone(),
            other.clone(),
            preview.head,
            preview.token,
            true,
        )
        .await
        .unwrap();
    }
    #[tokio::test]
    async fn repairs_external_moves_and_rechecks_prune_candidates() {
        let (fixture, repo) = fixture("repair");
        let other = create(&repo, &fixture.0.join("other"), "feature").await;
        let moved = fixture.0.join("externally moved");
        fs::rename(&other, &moved).unwrap();
        let missing = list(Path::new(&repo))
            .await
            .unwrap()
            .into_iter()
            .find(|row| !row.is_main)
            .unwrap();
        assert_eq!(missing.availability, "missing");
        assert_eq!(Path::new(&missing.path), registry_path(Path::new(&other)));
        git_worktree_manage(
            repo.clone(),
            other.clone(),
            "repair".into(),
            moved.to_string_lossy().into(),
        )
        .await
        .unwrap();
        assert_eq!(
            fs::canonicalize(&list(Path::new(&repo)).await.unwrap()[1].path).unwrap(),
            fs::canonicalize(&moved).unwrap()
        );
        fs::remove_dir_all(&moved).unwrap();
        let preview = git_worktree_prune_preview(repo.clone()).await.unwrap();
        assert!(!preview.is_empty());
        let third = create(&repo, &fixture.0.join("third"), "third").await;
        fs::remove_dir_all(third).unwrap();
        assert!(git_worktree_prune(repo.clone(), preview).await.is_err());
        let preview = git_worktree_prune_preview(repo.clone()).await.unwrap();
        git_worktree_prune(repo.clone(), preview).await.unwrap();
        assert_eq!(list(Path::new(&repo)).await.unwrap().len(), 1);
    }
    #[tokio::test]
    async fn creation_modes_tracking_and_invalid_destinations() {
        let (fixture, repo) = fixture("creation");
        command(Path::new(&repo), &["remote", "add", "origin", &repo]);
        command(Path::new(&repo), &["fetch", "origin"]);
        let other = fixture.0.join("tracking").to_string_lossy().into_owned();
        git_worktree_create(
            repo.clone(),
            Create {
                path: other.clone(),
                mode: "new".into(),
                branch: "tracking".into(),
                start_point: "origin/main".into(),
            },
        )
        .await
        .unwrap();
        assert_eq!(
            command(
                Path::new(&other),
                &["rev-parse", "--abbrev-ref", "@{upstream}"]
            ),
            "origin/main"
        );
        assert!(git_worktree_create(
            repo.clone(),
            Create {
                path: fixture.0.join("occupied").to_string_lossy().into(),
                mode: "existing".into(),
                branch: "tracking".into(),
                start_point: "tracking".into()
            }
        )
        .await
        .is_err());
        assert!(destination(
            Path::new(&repo),
            &Path::new(&repo).join("nested").to_string_lossy()
        )
        .await
        .is_err());
        let common = list(Path::new(&repo)).await.unwrap()[0].common_dir.clone();
        assert!(destination(
            Path::new(&other),
            &Path::new(&common).join("unsafe").to_string_lossy()
        )
        .await
        .is_err());
        command(Path::new(&repo), &["branch", "existing"]);
        let existing = fixture.0.join("existing").to_string_lossy().into_owned();
        git_worktree_create(
            repo.clone(),
            Create {
                path: existing.clone(),
                mode: "existing".into(),
                branch: "existing".into(),
                start_point: "existing".into(),
            },
        )
        .await
        .unwrap();
        let detached = fixture.0.join("detached").to_string_lossy().into_owned();
        git_worktree_create(
            repo.clone(),
            Create {
                path: detached.clone(),
                mode: "detached".into(),
                branch: "".into(),
                start_point: "HEAD".into(),
            },
        )
        .await
        .unwrap();
        assert!(list(Path::new(&repo))
            .await
            .unwrap()
            .iter()
            .any(
                |row| fs::canonicalize(&row.path).ok() == fs::canonicalize(&detached).ok()
                    && row.detached
            ));
    }
    #[tokio::test]
    async fn blocks_lanes_submodules_conflicts_and_cross_checkout_branch_changes() {
        let (fixture, repo) = fixture("guards");
        let other = create(&repo, &fixture.0.join("other"), "feature").await;
        assert!(
            git_branch_rename(repo.clone(), "feature".into(), "renamed".into())
                .await
                .is_err()
        );
        assert!(git_branch_delete(repo.clone(), "feature".into(), true)
            .await
            .is_err());
        let lane = ParallelLane {
            id: "saved".into(),
            name: "Saved".into(),
            target_branch: "feature".into(),
            base_head: command(Path::new(&other), &["rev-parse", "HEAD"]),
            applied: false,
            status: ParallelLaneStatus::Dirty,
            paths: vec![],
            created_at: "0".into(),
            updated_at: "0".into(),
        };
        write_parallel_lanes(Path::new(&other), &[lane])
            .await
            .unwrap();
        assert!(removal(Path::new(&repo), &other)
            .await
            .unwrap()
            .blockers
            .iter()
            .any(|b| b.contains("lanes")));
        write_parallel_lanes(Path::new(&other), &[]).await.unwrap();
        fs::write(Path::new(&other).join(".gitmodules"), "").unwrap();
        assert!(removal(Path::new(&repo), &other)
            .await
            .unwrap()
            .blockers
            .iter()
            .any(|b| b.contains("submodules")));
        fs::remove_file(Path::new(&other).join(".gitmodules")).unwrap();
        fs::write(Path::new(&repo).join("file.txt"), "main change\n").unwrap();
        command(Path::new(&repo), &["commit", "-am", "main change"]);
        fs::write(Path::new(&other).join("file.txt"), "other change\n").unwrap();
        command(Path::new(&other), &["commit", "-am", "other change"]);
        assert!(git(Path::new(&other), &["merge", "main"]).await.is_err());
        assert!(status(Path::new(&other)).await.unwrap().conflicts > 0);
        assert_eq!(status(Path::new(&repo)).await.unwrap().conflicts, 0);
        assert!(removal(Path::new(&repo), &other)
            .await
            .unwrap()
            .blockers
            .iter()
            .any(|b| b.contains("operation")));
    }
    #[tokio::test]
    async fn sibling_writes_share_a_lock_and_special_paths_open() {
        let (fixture, repo) = fixture("identity");
        // Windows forbids control characters in filenames; the NUL parser fixture
        // still covers those characters on every platform.
        let folder = if cfg!(windows) {
            "other 雪"
        } else {
            "other 雪\t\n"
        };
        let other = create(&repo, &fixture.0.join(folder), "feature").await;
        assert_eq!(
            resolve_repo_root(&other).await.unwrap(),
            fs::canonicalize(&other).unwrap()
        );
        let listed = list(Path::new(&other)).await.unwrap();
        let active = listed.iter().find(|row| row.is_current).unwrap();
        assert_eq!(
            Path::new(&active.path),
            resolve_repo_root(&other).await.unwrap()
        );
        let main_guard = write_lock(&repo).await.unwrap();
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(30), write_lock(&other))
                .await
                .is_err()
        );
        drop(main_guard);
        let _linked_guard = write_lock(&other).await.unwrap();
        let rows = list(Path::new(&repo)).await.unwrap();
        assert_ne!(rows[0].checkout_id, rows[1].checkout_id);
        assert_eq!(rows[0].common_dir, rows[1].common_dir);
    }
}
