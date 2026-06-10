import type { LocalRepoMatch, LocalRepositoryRef, ProviderRepository } from "@opengit/core";

export type RepoCloneFilter = "all" | "cloned" | "not-cloned" | "missing-path";

export type ProviderRepositoryFilters = {
  search: string;
  provider: string;
  project: string;
  cloneStatus: RepoCloneFilter;
};

export type ProviderRepositoryGroup = {
  key: string;
  accountName: string;
  projectName: string;
  repositories: ProviderRepository[];
};

export type CloneDestinationPreview =
  | {
      ok: true;
      path: string;
      folderName: string;
    }
  | {
      ok: false;
      path?: string;
      folderName?: string;
      message: string;
    };

export function redactRemoteUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.username || url.password) {
      url.username = "***";
      url.password = "";
      return url.toString().replace("%2A%2A%2A", "***");
    }
    return trimmed;
  } catch {
    return trimmed.replace(/(https?:\/\/)([^/\s@]+@)/gi, "$1***@");
  }
}

export function normalizeGitRemoteUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const withoutCredentialNoise = trimmed.replace(/^(https?:\/\/)([^/\s@]+@)/i, "$1");

  try {
    const url = new URL(withoutCredentialNoise);
    const host = url.hostname.toLowerCase();
    const parts = url.pathname
      .split("/")
      .map((part) => decodeURIComponent(part).trim())
      .filter(Boolean);

    if (host === "dev.azure.com" && parts.length >= 4 && parts[2].toLowerCase() === "_git") {
      return azureKey(parts[0], parts[1], stripDotGit(parts[3]));
    }

    if (host.endsWith(".visualstudio.com") && parts.length >= 3 && parts[1].toLowerCase() === "_git") {
      return azureKey(host.slice(0, -".visualstudio.com".length), parts[0], stripDotGit(parts[2]));
    }

    return `${url.protocol.toLowerCase()}//${host}${stripDotGit(url.pathname).toLowerCase()}`;
  } catch {
    const scpLike = trimmed.match(/^([^@]+@)?([^:]+):(.+)$/);
    if (scpLike) {
      return `ssh://${scpLike[2].toLowerCase()}/${stripDotGit(scpLike[3]).toLowerCase()}`;
    }
    return stripDotGit(trimmed).toLowerCase();
  }
}

export function sanitizeRepoFolderName(name: string): string {
  const base = stripDotGit(name).trim();
  const sanitized = base
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+$/, "")
    .replace(/^-+|-+$/g, "")
    .trim();
  return sanitized || "repository";
}

export function deriveCloneDestination(cloneRoot: string, repoName: string): CloneDestinationPreview {
  const root = cloneRoot.trim();
  if (!root) {
    return { ok: false, message: "Choose a clone root before cloning." };
  }

  const folderName = sanitizeRepoFolderName(repoName);
  if (folderName === "." || folderName === ".." || folderName.includes("/") || folderName.includes("\\")) {
    return { ok: false, folderName, message: "Repository name cannot be used as a safe folder name." };
  }

  return {
    ok: true,
    folderName,
    path: joinPath(root, folderName)
  };
}

export function matchProviderRepository(
  repo: ProviderRepository,
  localRefs: LocalRepositoryRef[],
  savedPath: string | undefined,
  activePath: string | undefined
): LocalRepoMatch {
  if (savedPath && !localRefs.some((ref) => ref.path === savedPath && ref.exists)) {
    return { status: "missing-path", path: savedPath };
  }

  const cloneUrl = repo.cloneUrl?.url;
  const normalizedCloneUrl = cloneUrl ? normalizeGitRemoteUrl(cloneUrl) : "";
  const activeNormalized = activePath ? normalizeLocalPath(activePath) : "";

  for (const ref of localRefs) {
    if (!ref.exists || !ref.isRepository) continue;
    const matchedRemote = ref.remotes.find((remote) =>
      [remote.fetchUrl, remote.pushUrl].some((url) => url && normalizeGitRemoteUrl(url) === normalizedCloneUrl)
    );
    if (matchedRemote) {
      const path = ref.path;
      return {
        status: activeNormalized && normalizeLocalPath(path) === activeNormalized ? "current" : "cloned",
        path,
        matchedRemote: matchedRemote.fetchUrl ?? matchedRemote.pushUrl
      };
    }
  }

  return { status: "not-cloned" };
}

export function filterProviderRepositories(repositories: ProviderRepository[], filters: ProviderRepositoryFilters) {
  const search = filters.search.trim().toLowerCase();
  return repositories.filter((repo) => {
    if (filters.provider !== "all" && repo.provider !== filters.provider) return false;
    if (filters.project !== "all" && (repo.projectName ?? "No project") !== filters.project) return false;
    if (filters.cloneStatus !== "all" && repo.localMatch.status !== filters.cloneStatus) return false;
    if (!search) return true;
    return [repo.name, repo.accountName, repo.projectName, repo.defaultBranch, repo.cloneUrl?.safeUrl]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(search));
  });
}

export function groupProviderRepositories(repositories: ProviderRepository[]) {
  const groups = new Map<string, ProviderRepositoryGroup>();
  for (const repo of repositories) {
    const accountName = repo.accountName || "Unknown account";
    const projectName = repo.projectName || "No project";
    const key = `${repo.provider}:${accountName}:${projectName}`;
    const existing = groups.get(key);
    if (existing) {
      existing.repositories.push(repo);
    } else {
      groups.set(key, { key, accountName, projectName, repositories: [repo] });
    }
  }

  return [...groups.values()].map((group) => ({
    ...group,
    repositories: [...group.repositories].sort((left, right) => left.name.localeCompare(right.name))
  }));
}

export function uniqueProjectNames(repositories: ProviderRepository[]) {
  return [...new Set(repositories.map((repo) => repo.projectName ?? "No project"))].sort((left, right) => left.localeCompare(right));
}

export function mergeRepositoryLocalMatches(
  repositories: ProviderRepository[],
  localRefs: LocalRepositoryRef[],
  savedPaths: Record<string, string>,
  activePath?: string
) {
  return repositories.map((repo) => {
    if (localRefs.length > 0) {
      return {
        ...repo,
        localMatch: matchProviderRepository(repo, localRefs, savedPaths[repo.id], activePath)
      };
    }
    const localMatch = promoteCurrentMatch(repo.localMatch, activePath);
    return {
      ...repo,
      localMatch:
        savedPaths[repo.id] && localMatch.status === "not-cloned"
          ? { status: "missing-path" as const, path: savedPaths[repo.id] }
          : localMatch
    };
  });
}

function azureKey(org: string, project: string, repo: string) {
  return `azure-devops:${org.toLowerCase()}/${project.toLowerCase()}/${stripDotGit(repo).toLowerCase()}`;
}

function stripDotGit(value: string) {
  return value.replace(/\.git$/i, "");
}

function joinPath(root: string, folderName: string) {
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}${folderName}`;
}

function normalizeLocalPath(path: string) {
  return path.replace(/[\\/]+$/, "");
}

function promoteCurrentMatch(match: LocalRepoMatch, activePath: string | undefined): LocalRepoMatch {
  if (!activePath || !match.path || match.status !== "cloned") return match;
  return normalizeLocalPath(match.path) === normalizeLocalPath(activePath) ? { ...match, status: "current" } : match;
}
