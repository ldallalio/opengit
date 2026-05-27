import { invoke, isTauri } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { CommitFile, RepoSnapshot } from "@opengit/core";
import { demoCommitFiles, demoDiff, demoSnapshot } from "./demo";

export type OpenAiStatus = {
  configured: boolean;
};

export type AzureDevOpsStatus = {
  configured: boolean;
};

export type OpenAiTestResult = {
  configured: boolean;
  ok: boolean;
  message: string;
};

export type AiCommitSuggestion = {
  summary: string;
  description: string;
};

export type AiBranchNameSuggestion = {
  name: string;
};

export type AiPrDescriptionSuggestion = {
  title: string;
  description: string;
};

export type ConflictVersions = {
  path: string;
  base: string;
  ours: string;
  theirs: string;
  working: string;
};

export type ConflictStrategy = "ours" | "theirs" | "both";

export class OpenGitApiError extends Error {
  code: string;
  detail?: string;

  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = "OpenGitApiError";
    this.code = code;
    this.detail = detail;
  }
}

export const isTauriRuntime = () => {
  const internals = window.__TAURI_INTERNALS__ as { invoke?: unknown } | undefined;
  return isTauri() || typeof internals?.invoke === "function";
};

async function call<T>(command: string, args: Record<string, unknown>, fallback: T): Promise<T> {
  if (!isTauriRuntime()) {
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    return fallback;
  }

  try {
    return await invoke<T>(command, args);
  } catch (error) {
    if (typeof error === "object" && error && "message" in error) {
      const payload = error as { code?: string; message?: string; detail?: string };
      throw new OpenGitApiError(payload.code ?? "UNKNOWN", payload.message ?? "Command failed.", payload.detail);
    }
    throw new OpenGitApiError("UNKNOWN", String(error));
  }
}

export const openRepo = (path: string, historyLimit?: number) =>
  call<RepoSnapshot>("repo_open", { path, historyLimit }, demoSnapshot);

export async function chooseRepositoryFolder(): Promise<string | null> {
  if (!isTauriRuntime()) {
    return window.prompt("Repository path", demoSnapshot.repository.path);
  }

  const selected = await openDialog({
    directory: true,
    multiple: false,
    title: "Open Git Repository"
  });

  if (Array.isArray(selected)) {
    return selected[0] ?? null;
  }

  return selected;
}

export const refreshRepo = (repoPath: string, historyLimit?: number) =>
  call<RepoSnapshot>("repo_status", { repoPath, historyLimit }, demoSnapshot);

export const cloneRepo = (url: string, destination: string, historyLimit?: number) =>
  call<RepoSnapshot>("repo_clone", { url, destination, historyLimit }, demoSnapshot);

export const stagePaths = (repoPath: string, paths: string[]) =>
  call<RepoSnapshot>("git_stage", { repoPath, paths }, demoSnapshot);

export const unstagePaths = (repoPath: string, paths: string[]) =>
  call<RepoSnapshot>("git_unstage", { repoPath, paths }, demoSnapshot);

export const discardPaths = (repoPath: string, paths: string[]) =>
  call<RepoSnapshot>("git_discard", { repoPath, paths }, demoSnapshot);

export const commit = (repoPath: string, message: string, amend: boolean) =>
  call<RepoSnapshot>("git_commit", { repoPath, message, amend }, demoSnapshot);

export const updateCommitMessage = (repoPath: string, commitSha: string, message: string) =>
  call<RepoSnapshot>("git_commit_message_update", { repoPath, commitSha, message }, demoSnapshot);

export const undoLastCommit = (repoPath: string) =>
  call<RepoSnapshot>("git_commit_undo_last", { repoPath }, demoSnapshot);

export const squashLastCommits = (repoPath: string, message: string) =>
  call<RepoSnapshot>("git_commit_squash_last", { repoPath, message }, demoSnapshot);

export const getOpenAiStatus = () => call<OpenAiStatus>("ai_openai_status", {}, { configured: false });

export const saveOpenAiApiKey = (apiKey: string) => call<OpenAiStatus>("ai_openai_save_api_key", { apiKey }, { configured: false });

export const clearOpenAiApiKey = () => call<OpenAiStatus>("ai_openai_clear_api_key", {}, { configured: false });

export const testOpenAiApiKey = () =>
  call<OpenAiTestResult>("ai_openai_test_api_key", {}, { configured: false, ok: false, message: "Desktop mode is required to test secure OpenAI keys." });

export const getAzureDevOpsStatus = () => call<AzureDevOpsStatus>("azure_devops_status", {}, { configured: false });

export const saveAzureDevOpsPat = (pat: string) => call<AzureDevOpsStatus>("azure_devops_save_pat", { pat }, { configured: false });

export const clearAzureDevOpsPat = () => call<AzureDevOpsStatus>("azure_devops_clear_pat", {}, { configured: false });

export const generateAiCommitMessage = (repoPath: string, model?: string) =>
  call<AiCommitSuggestion>(
    "ai_commit_message_generate",
    { repoPath, model },
    {
      summary: "feat: summarize staged OpenGit changes",
      description: "Generated preview based on staged files. Desktop mode sends the staged diff to OpenAI."
    }
  );

export const generateAiBranchName = (repoPath: string, model?: string) =>
  call<AiBranchNameSuggestion>(
    "ai_branch_name_generate",
    { repoPath, model },
    { name: "feature/generated-branch-name" }
  );

export const generateAiPrDescription = (repoPath: string, model?: string) =>
  call<AiPrDescriptionSuggestion>(
    "ai_pr_description_generate",
    { repoPath, model },
    {
      title: "Improve OpenGit workflow",
      description: "## Summary\n- Generated preview for browser mode\n\n## Testing\n- Not run in browser preview"
    }
  );

export const fetchRepo = (repoPath: string, remote?: string) =>
  call<RepoSnapshot>("git_fetch", { repoPath, remote }, demoSnapshot);

export const pullRepo = (repoPath: string) => call<RepoSnapshot>("git_pull", { repoPath }, demoSnapshot);

export const pullRepoFastForward = (repoPath: string) => call<RepoSnapshot>("git_pull_fast_forward", { repoPath }, demoSnapshot);

export const pullRepoRebase = (repoPath: string) => call<RepoSnapshot>("git_pull_rebase", { repoPath }, demoSnapshot);

export const pushRepo = (repoPath: string, remote?: string, branch?: string, forceWithLease = false, setUpstream = false) =>
  call<RepoSnapshot>("git_push", { repoPath, remote, branch, forceWithLease, setUpstream }, demoSnapshot);

export const addRemote = (repoPath: string, name: string, url: string) =>
  call<RepoSnapshot>("git_remote_add", { repoPath, name, url }, demoSnapshot);

export const createBranch = (repoPath: string, name: string, checkout: boolean, startPoint?: string) =>
  call<RepoSnapshot>("git_branch_create", { request: { repoPath, name, checkout, startPoint } }, demoSnapshot);

export const checkoutBranch = (repoPath: string, name: string) =>
  call<RepoSnapshot>("git_branch_checkout", { repoPath, name }, demoSnapshot);

export const deleteBranch = (repoPath: string, name: string, force: boolean) =>
  call<RepoSnapshot>("git_branch_delete", { repoPath, name, force }, demoSnapshot);

export const renameBranch = (repoPath: string, oldName: string, newName: string) =>
  call<RepoSnapshot>("git_branch_rename", { repoPath, oldName, newName }, demoSnapshot);

export const mergeBranch = (repoPath: string, branch: string) =>
  call<RepoSnapshot>("git_merge", { repoPath, branch }, demoSnapshot);

export const rebaseOnto = (repoPath: string, upstream: string) =>
  call<RepoSnapshot>("git_rebase", { repoPath, upstream }, demoSnapshot);

export const cherryPickCommit = (repoPath: string, commitSha: string) =>
  call<RepoSnapshot>("git_cherry_pick", { repoPath, commitSha }, demoSnapshot);

export const revertCommit = (repoPath: string, commitSha: string) =>
  call<RepoSnapshot>("git_revert", { repoPath, commitSha }, demoSnapshot);

export const createTag = (repoPath: string, name: string, target: string, message?: string) =>
  call<RepoSnapshot>("git_tag_create", { repoPath, name, target, message }, demoSnapshot);

export const stashPush = (repoPath: string, message: string) =>
  call<RepoSnapshot>("git_stash_push", { repoPath, message }, demoSnapshot);

export const stashApply = (repoPath: string, stash: string) =>
  call<RepoSnapshot>("git_stash_apply", { repoPath, stash }, demoSnapshot);

export const stashDrop = (repoPath: string, stash: string) =>
  call<RepoSnapshot>("git_stash_drop", { repoPath, stash }, demoSnapshot);

export const getDiff = (repoPath: string, path: string, staged: boolean) =>
  call<string>("git_diff", { repoPath, path, staged }, demoDiff);

export const getCommitFiles = (repoPath: string, sha: string) =>
  call<CommitFile[]>("git_commit_files", { repoPath, sha }, demoCommitFiles);

export const getCommitFileDiff = (repoPath: string, sha: string, path: string, oldPath?: string) =>
  call<string>("git_commit_file_diff", { repoPath, sha, path, oldPath }, demoDiff);

export const getConflictVersions = (repoPath: string, path: string) =>
  call<ConflictVersions>("git_conflict_versions", { repoPath, path }, { path, base: "", ours: "", theirs: "", working: "" });

export const resolveConflict = (repoPath: string, path: string, strategy: ConflictStrategy) =>
  call<RepoSnapshot>("git_conflict_resolve", { repoPath, path, strategy }, demoSnapshot);

export const markConflictResolved = (repoPath: string, path: string) =>
  call<RepoSnapshot>("git_conflict_mark_resolved", { repoPath, path }, demoSnapshot);

export const continueGitOperation = (repoPath: string) =>
  call<RepoSnapshot>("git_operation_continue", { repoPath }, demoSnapshot);

export const abortGitOperation = (repoPath: string) =>
  call<RepoSnapshot>("git_operation_abort", { repoPath }, demoSnapshot);

export const restoreUndoSnapshot = (repoPath: string, snapshotId: string) =>
  call<RepoSnapshot>("git_undo_restore", { repoPath, snapshotId }, demoSnapshot);
