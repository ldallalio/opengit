import type { RepoSnapshot } from "@opengit/core";

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
      parents: ["aa8c8f2"],
      author: "Logan Dallalio",
      authorEmail: "logan@example.com",
      date: "2026-05-20T09:15:00-05:00",
      message: "Build first OpenGit vertical slice",
      refs: ["HEAD -> main"]
    },
    {
      sha: "aa8c8f252648b7efba0cb128e211c65f49ac1411",
      parents: ["18ad3f0"],
      author: "Logan Dallalio",
      authorEmail: "logan@example.com",
      date: "2026-05-20T08:42:00-05:00",
      message: "Document product architecture",
      refs: []
    }
  ],
  conflicts: []
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
