import { invoke } from "@tauri-apps/api/core";
import type { RepoSnapshot } from "@opengit/core";
import { demoDiff, demoSnapshot } from "./demo";

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

export const isTauriRuntime = () => Boolean(window.__TAURI_INTERNALS__);

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

export const openRepo = (path: string) => call<RepoSnapshot>("repo_open", { path }, demoSnapshot);

export const refreshRepo = (repoPath: string) => call<RepoSnapshot>("repo_status", { repoPath }, demoSnapshot);

export const cloneRepo = (url: string, destination: string) =>
  call<RepoSnapshot>("repo_clone", { url, destination }, demoSnapshot);

export const stagePaths = (repoPath: string, paths: string[]) =>
  call<RepoSnapshot>("git_stage", { repoPath, paths }, demoSnapshot);

export const unstagePaths = (repoPath: string, paths: string[]) =>
  call<RepoSnapshot>("git_unstage", { repoPath, paths }, demoSnapshot);

export const discardPaths = (repoPath: string, paths: string[]) =>
  call<RepoSnapshot>("git_discard", { repoPath, paths }, demoSnapshot);

export const commit = (repoPath: string, message: string, amend: boolean) =>
  call<RepoSnapshot>("git_commit", { repoPath, message, amend }, demoSnapshot);

export const fetchRepo = (repoPath: string, remote?: string) =>
  call<RepoSnapshot>("git_fetch", { repoPath, remote }, demoSnapshot);

export const pullRepo = (repoPath: string) => call<RepoSnapshot>("git_pull", { repoPath }, demoSnapshot);

export const pushRepo = (repoPath: string, remote?: string, branch?: string, forceWithLease = false) =>
  call<RepoSnapshot>("git_push", { repoPath, remote, branch, forceWithLease }, demoSnapshot);

export const createBranch = (repoPath: string, name: string, checkout: boolean) =>
  call<RepoSnapshot>("git_branch_create", { request: { repoPath, name, checkout } }, demoSnapshot);

export const checkoutBranch = (repoPath: string, name: string) =>
  call<RepoSnapshot>("git_branch_checkout", { repoPath, name }, demoSnapshot);

export const deleteBranch = (repoPath: string, name: string, force: boolean) =>
  call<RepoSnapshot>("git_branch_delete", { repoPath, name, force }, demoSnapshot);

export const stashPush = (repoPath: string, message: string) =>
  call<RepoSnapshot>("git_stash_push", { repoPath, message }, demoSnapshot);

export const stashApply = (repoPath: string, stash: string) =>
  call<RepoSnapshot>("git_stash_apply", { repoPath, stash }, demoSnapshot);

export const stashDrop = (repoPath: string, stash: string) =>
  call<RepoSnapshot>("git_stash_drop", { repoPath, stash }, demoSnapshot);

export const getDiff = (repoPath: string, path: string, staged: boolean) =>
  call<string>("git_diff", { repoPath, path, staged }, demoDiff);
