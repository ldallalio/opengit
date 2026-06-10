import type { BranchInspection, CommitFile, ProviderRepoCatalog, RepoSnapshot } from "@opengit/core";

export const demoSnapshot: RepoSnapshot = {
  repository: {
    id: "demo",
    path: "/Users/logan/Code/opengit",
    name: "opengit",
    provider: "github",
    remotes: [
      {
        name: "origin",
        fetchUrl: "git@github.com:logan/opengit.git",
        pushUrl: "git@github.com:logan/opengit.git",
        provider: "github"
      }
    ],
    head: "f5a84c5",
    worktreeState: "dirty"
  },
  currentBranch: "main",
  upstream: "origin/main",
  ahead: 2,
  behind: 0,
  changes: [
    {
      path: "apps/desktop/src/App.tsx",
      status: "modified",
      indexStatus: "M",
      worktreeStatus: " ",
      staged: true,
      unstaged: false,
      binary: false
    },
    {
      path: "apps/desktop/src-tauri/src/lib.rs",
      status: "modified",
      indexStatus: " ",
      worktreeStatus: "M",
      staged: false,
      unstaged: true,
      binary: false
    },
    {
      path: "docs/threat-model.md",
      status: "untracked",
      indexStatus: "?",
      worktreeStatus: "?",
      staged: false,
      unstaged: true,
      binary: false
    }
  ],
  branches: [
    {
      name: "main",
      fullRef: "refs/heads/main",
      upstream: "origin/main",
      ahead: 2,
      behind: 0,
      isCurrent: true,
      isProtected: true
    },
    {
      name: "feature/conflict-view",
      fullRef: "refs/heads/feature/conflict-view",
      isCurrent: false,
      isProtected: false
    }
  ],
  remotes: [
    {
      name: "origin",
      fetchUrl: "git@github.com:logan/opengit.git",
      pushUrl: "git@github.com:logan/opengit.git",
      provider: "github"
    }
  ],
  stashes: [
    {
      index: "stash@{0}",
      sha: "22ca2aa",
      branch: "main",
      message: "WIP on main: command palette"
    }
  ],
  commits: [
    {
      sha: "f5a84c5a962f9adf6cf3e6de1ef4b3f4ad30ec57",
      parents: ["aa8c8f252648b7efba0cb128e211c65f49ac1411", "8d39b418aadc398936a092859fcbe812ad13f908"],
      author: "Logan Dallalio",
      authorEmail: "logan@example.com",
      date: "2026-05-20T09:15:00-05:00",
      message: "Merge branch 'feature/commit-graph' into main",
      refs: ["HEAD -> main", "origin/main"]
    },
    {
      sha: "aa8c8f252648b7efba0cb128e211c65f49ac1411",
      parents: ["18ad3f008e7246f1b9bd771fef74771fb2bfb89c"],
      author: "Logan Dallalio",
      authorEmail: "logan@example.com",
      date: "2026-05-20T08:42:00-05:00",
      message: "Document product architecture",
      refs: []
    },
    {
      sha: "8d39b418aadc398936a092859fcbe812ad13f908",
      parents: ["76bd0be0c79652c938fc363c4e77d278f3cb49ef"],
      author: "Logan Dallalio",
      authorEmail: "logan@example.com",
      date: "2026-05-20T08:31:00-05:00",
      message: "Render linked commit lanes",
      refs: ["origin/feature/commit-graph"]
    },
    {
      sha: "76bd0be0c79652c938fc363c4e77d278f3cb49ef",
      parents: ["18ad3f008e7246f1b9bd771fef74771fb2bfb89c"],
      author: "Logan Dallalio",
      authorEmail: "logan@example.com",
      date: "2026-05-20T08:12:00-05:00",
      message: "Load all branch history",
      refs: ["feature/commit-graph"]
    },
    {
      sha: "18ad3f008e7246f1b9bd771fef74771fb2bfb89c",
      parents: [],
      author: "Logan Dallalio",
      authorEmail: "logan@example.com",
      date: "2026-05-19T17:45:00-05:00",
      message: "Initial OpenGit foundation",
      refs: ["tag: v0.1.0"]
    }
  ],
  conflicts: [],
  undoSnapshots: [
    {
      id: "demo-before-commit",
      label: "before commit",
      branch: "main",
      headSha: "aa8c8f252648b7efba0cb128e211c65f49ac1411",
      refName: "refs/opengit/snapshots/demo-before-commit",
      createdAt: String(Date.now() - 1000 * 60 * 8),
      hasStagedPatch: true,
      hasWorkingPatch: true
    }
  ],
  branchStacks: [
    {
      id: "stack-demo",
      name: "Commit graph polish",
      trunk: "main",
      status: "clean",
      lastOperation: "Restack complete",
      createdAt: String(Date.now() - 1000 * 60 * 60),
      updatedAt: String(Date.now() - 1000 * 60 * 12),
      items: [
        {
          id: "stack-item-demo",
          branch: "feature/conflict-view",
          baseBranch: "main",
          order: 0,
          headSha: "76bd0be0c79652c938fc363c4e77d278f3cb49ef",
          upstream: "origin/feature/commit-graph",
          status: "ahead"
        }
      ]
    }
  ],
  parallelLanes: [
    {
      id: "lane-demo",
      name: "Backend parser",
      targetBranch: "main",
      baseHead: "f5a84c5a962f9adf6cf3e6de1ef4b3f4ad30ec57",
      applied: false,
      status: "clean",
      createdAt: String(Date.now() - 1000 * 60 * 28),
      updatedAt: String(Date.now() - 1000 * 60 * 28),
      paths: [
        {
          path: "apps/desktop/src-tauri/src/lib.rs",
          status: "modified",
          source: "working"
        }
      ]
    }
  ],
  worktrees: [
    {
      path: "/Users/logan/Code/opengit",
      branch: "main",
      head: "f5a84c5a962f9adf6cf3e6de1ef4b3f4ad30ec57",
      locked: false,
      prunable: false
    }
  ]
};

export const demoDiff = `diff --git a/apps/desktop/src/App.tsx b/apps/desktop/src/App.tsx
index 7a8a0f1..b52c6c1 100644
--- a/apps/desktop/src/App.tsx
+++ b/apps/desktop/src/App.tsx
@@ -1,4 +1,5 @@
 import React from "react";
+import { GitBranch } from "lucide-react";
 
 export default function App() {
-  return <main>OpenGit</main>;
+  return <main className="app-shell">OpenGit</main>;
 }`;

export const demoCommitFiles: CommitFile[] = [
  {
    path: "apps/desktop/src/App.tsx",
    status: "modified"
  },
  {
    path: "apps/desktop/src-tauri/src/lib.rs",
    status: "modified"
  },
  {
    path: "docs/product-brief.md",
    status: "added"
  }
];

export const demoBranchInspection: BranchInspection = {
  branch: demoSnapshot.branches[0],
  kind: "local",
  upstream: "origin/main",
  defaultBranch: "origin/main",
  baseRef: "origin/main",
  headSha: demoSnapshot.commits[0]?.sha,
  lastCommit: demoSnapshot.commits[0],
  aheadBehindUpstream: { ahead: 2, behind: 0 },
  aheadBehindDefault: { ahead: 2, behind: 0 },
  status: "ahead",
  recentCommits: demoSnapshot.commits.slice(0, 5),
  diffSummary: {
    baseRef: "origin/main",
    fileCount: 3,
    additions: 84,
    deletions: 21,
    files: demoCommitFiles
  }
};

export const demoProviderCatalog: ProviderRepoCatalog = {
  provider: "azure-devops",
  refreshedAt: String(Date.now()),
  accounts: [
    {
      id: "hubley-dallalio",
      provider: "azure-devops",
      name: "Hubley Dallalio Workspace",
      displayName: "Hubley Dallalio Workspace",
      url: "https://dev.azure.com/hubley"
    }
  ],
  projects: [
    {
      id: "hubley-spfx",
      provider: "azure-devops",
      accountId: "hubley-dallalio",
      name: "hubley spfx",
      url: "https://dev.azure.com/hubley/hubley%20spfx"
    },
    {
      id: "mobile",
      provider: "azure-devops",
      accountId: "hubley-dallalio",
      name: "mobile",
      url: "https://dev.azure.com/hubley/mobile"
    }
  ],
  repositories: [
    {
      id: "azure-devops:hubley:hubley spfx:hubley spfx",
      provider: "azure-devops",
      accountId: "hubley-dallalio",
      accountName: "Hubley Dallalio Workspace",
      projectId: "hubley-spfx",
      projectName: "hubley spfx",
      name: "hubley spfx",
      defaultBranch: "main",
      webUrl: "https://dev.azure.com/hubley/hubley%20spfx/_git/hubley%20spfx",
      cloneUrl: {
        kind: "https",
        url: "https://dev.azure.com/hubley/hubley%20spfx/_git/hubley%20spfx",
        safeUrl: "https://dev.azure.com/hubley/hubley%20spfx/_git/hubley%20spfx"
      },
      localMatch: {
        status: "cloned",
        path: "/Users/logandallalio/Documents/Hubley/hubley spfx",
        matchedRemote: "https://dev.azure.com/hubley/hubley%20spfx/_git/hubley%20spfx"
      }
    },
    {
      id: "azure-devops:hubley:mobile:hubleyRNMobile",
      provider: "azure-devops",
      accountId: "hubley-dallalio",
      accountName: "Hubley Dallalio Workspace",
      projectId: "mobile",
      projectName: "mobile",
      name: "hubleyRNMobile",
      defaultBranch: "main",
      webUrl: "https://dev.azure.com/hubley/mobile/_git/hubleyRNMobile",
      cloneUrl: {
        kind: "https",
        url: "https://dev.azure.com/hubley/mobile/_git/hubleyRNMobile",
        safeUrl: "https://dev.azure.com/hubley/mobile/_git/hubleyRNMobile"
      },
      localMatch: { status: "not-cloned" }
    },
    {
      id: "azure-devops:hubley:hubley spfx:credential-manager",
      provider: "azure-devops",
      accountId: "hubley-dallalio",
      accountName: "Hubley Dallalio Workspace",
      projectId: "hubley-spfx",
      projectName: "hubley spfx",
      name: "credential-manager",
      defaultBranch: "master",
      webUrl: "https://dev.azure.com/hubley/hubley%20spfx/_git/credential-manager",
      cloneUrl: {
        kind: "https",
        url: "https://dev.azure.com/hubley/hubley%20spfx/_git/credential-manager",
        safeUrl: "https://dev.azure.com/hubley/hubley%20spfx/_git/credential-manager"
      },
      localMatch: { status: "not-cloned" }
    }
  ]
};
