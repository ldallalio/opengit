import { describe, expect, it } from "vitest";
import type { LocalRepositoryRef, ProviderRepository } from "@opengit/core";
import {
  deriveCloneDestination,
  filterProviderRepositories,
  groupProviderRepositories,
  matchProviderRepository,
  normalizeGitRemoteUrl,
  redactRemoteUrl,
  sanitizeRepoFolderName
} from "./repositoryManagement";

const azureRepo: ProviderRepository = {
  id: "azure-devops:hubley:hubley-spfx:OpenGit",
  provider: "azure-devops",
  accountId: "hubley",
  accountName: "Hubley",
  projectId: "hubley-spfx",
  projectName: "hubley spfx",
  name: "OpenGit",
  defaultBranch: "main",
  cloneUrl: {
    kind: "https",
    url: "https://dev.azure.com/Hubley/hubley%20spfx/_git/OpenGit",
    safeUrl: "https://dev.azure.com/Hubley/hubley%20spfx/_git/OpenGit"
  },
  localMatch: { status: "not-cloned" }
};

describe("repository management helpers", () => {
  it("normalizes Azure DevOps clone URL variants", () => {
    expect(normalizeGitRemoteUrl("https://dev.azure.com/org/project/_git/repo")).toBe("azure-devops:org/project/repo");
    expect(normalizeGitRemoteUrl("https://org@dev.azure.com/org/project/_git/repo.git")).toBe("azure-devops:org/project/repo");
    expect(normalizeGitRemoteUrl("https://org.visualstudio.com/project/_git/repo")).toBe("azure-devops:org/project/repo");
    expect(normalizeGitRemoteUrl("https://DEV.AZURE.com/Org/Project/_git/Repo")).toBe("azure-devops:org/project/repo");
  });

  it("redacts credential-bearing urls before display", () => {
    expect(redactRemoteUrl("https://token:secret@github.com/example/private.git")).toBe("https://***@github.com/example/private.git");
  });

  it("sanitizes clone folder names and derives destinations", () => {
    expect(sanitizeRepoFolderName("../bad:name.git")).toBe("..-bad-name");
    expect(deriveCloneDestination("/Users/logan/Code", "OpenGit.git")).toEqual({
      ok: true,
      folderName: "OpenGit",
      path: "/Users/logan/Code/OpenGit"
    });
    expect(deriveCloneDestination("", "OpenGit").ok).toBe(false);
  });

  it("matches provider repos to local remotes", () => {
    const refs: LocalRepositoryRef[] = [
      {
        path: "/Users/logan/Code/OpenGit",
        exists: true,
        isRepository: true,
        remotes: [
          {
            name: "origin",
            fetchUrl: "https://hubley@dev.azure.com/Hubley/hubley%20spfx/_git/OpenGit.git",
            provider: "azure-devops"
          }
        ]
      }
    ];

    expect(matchProviderRepository(azureRepo, refs, undefined, "/Users/logan/Code/OpenGit")).toMatchObject({
      status: "current",
      path: "/Users/logan/Code/OpenGit"
    });
  });

  it("reports saved located paths that are missing", () => {
    expect(matchProviderRepository(azureRepo, [], "/Users/logan/Missing/OpenGit", undefined)).toEqual({
      status: "missing-path",
      path: "/Users/logan/Missing/OpenGit"
    });
  });

  it("filters and groups provider repositories", () => {
    const repos = [
      azureRepo,
      {
        ...azureRepo,
        id: "azure-devops:hubley:internal:Tools",
        projectName: "internal",
        name: "Tools",
        localMatch: { status: "cloned" as const, path: "/Users/logan/Code/Tools" }
      }
    ];

    const filtered = filterProviderRepositories(repos, {
      search: "tools",
      provider: "azure-devops",
      project: "all",
      cloneStatus: "cloned"
    });

    expect(filtered.map((repo) => repo.name)).toEqual(["Tools"]);
    expect(groupProviderRepositories(repos)).toHaveLength(2);
  });
});
