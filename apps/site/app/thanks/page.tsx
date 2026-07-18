"use client";

import { useEffect, useState } from "react";

const REPO_URL = "https://github.com/ldallalio/opengit";
const RELEASES_API = "https://api.github.com/repos/ldallalio/opengit/releases/latest";
const RELEASES_URL = "https://github.com/ldallalio/opengit/releases/latest";

type ReleaseAsset = { name: string; browser_download_url: string };
type Release = { tag_name: string; assets: ReleaseAsset[] };

type Platform = "mac" | "windows" | "linux" | "unknown";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (/Mac/i.test(ua)) return "mac";
  if (/Win/i.test(ua)) return "windows";
  if (/Linux/i.test(ua)) return "linux";
  return "unknown";
}

function findAsset(assets: ReleaseAsset[], test: (name: string) => boolean) {
  return assets.find((a) => !a.name.endsWith(".sig") && test(a.name));
}

function downloadsFor(assets: ReleaseAsset[]) {
  return {
    macArm: findAsset(assets, (n) => /aarch64\.dmg$/i.test(n)),
    macIntel: findAsset(assets, (n) => /_x64\.dmg$/i.test(n)),
    windows: findAsset(assets, (n) => n.toLowerCase().endsWith(".exe")),
    linuxAppImage: findAsset(assets, (n) => n.toLowerCase().endsWith(".appimage")),
    linuxDeb: findAsset(assets, (n) => n.toLowerCase().endsWith(".deb")),
    linuxRpm: findAsset(assets, (n) => n.toLowerCase().endsWith(".rpm")),
  };
}

export default function ThanksPage() {
  const [platform, setPlatform] = useState<Platform>("unknown");
  const [release, setRelease] = useState<Release | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    setPlatform(detectPlatform());
    fetch(RELEASES_API)
      .then((res) => {
        if (!res.ok) throw new Error("release fetch failed");
        return res.json();
      })
      .then((data: Release) => {
        setRelease(data);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, []);

  const d = release ? downloadsFor(release.assets) : null;

  const primary =
    d &&
    (platform === "mac"
      ? d.macArm ?? d.macIntel
      : platform === "windows"
        ? d.windows
        : platform === "linux"
          ? d.linuxAppImage ?? d.linuxDeb ?? d.linuxRpm
          : undefined);

  const primaryLabel =
    platform === "mac"
      ? "Download for macOS (Apple Silicon)"
      : platform === "windows"
        ? "Download for Windows"
        : platform === "linux"
          ? "Download for Linux (AppImage)"
          : "Download OpenGit";

  return (
    <>
      <header className="nav">
        <div className="container nav-inner">
          <a className="brand" href="/">
            <svg width="22" height="22" viewBox="0 0 16 16" fill="var(--accent)" aria-hidden="true">
              <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0v5.256a2.251 2.251 0 1 0 1.5 0V5.372Zm6.5.372a2.25 2.25 0 1 0-1.5 0v.94a2 2 0 0 1-1.155 1.813l-2.03.954a3.5 3.5 0 0 0-.315.176v2.891a2.25 2.25 0 1 0 1.5 0v-.363a2 2 0 0 1 1.155-1.813l2.03-.954A3.5 3.5 0 0 0 13.25 6.7v-.956Z" />
            </svg>
            OpenGit
          </a>
          <nav className="nav-links">
            <a href={REPO_URL}>GitHub</a>
          </nav>
        </div>
      </header>

      <main>
        <section className="hero" style={{ borderTop: "none" }}>
          <div className="container">
            <div className="hero-badge">
              <span className="dot" />
              Payment received
            </div>
            <h1>
              Thanks for buying <em>OpenGit</em>.
            </h1>
            <p className="hero-sub">
              Pay once, use it forever. Your download is ready below, and every
              future version is included automatically.
            </p>

            <div className="thanks-download">
              {status === "loading" && <p className="hero-note">Finding your download…</p>}

              {status === "error" && (
                <a className="btn btn-primary" href={RELEASES_URL}>
                  Go to the latest release
                </a>
              )}

              {status === "ready" && primary && (
                <a className="btn btn-primary" href={primary.browser_download_url}>
                  {primaryLabel}
                </a>
              )}

              {status === "ready" && !primary && (
                <a className="btn btn-primary" href={RELEASES_URL}>
                  Go to the latest release
                </a>
              )}
            </div>

            {status === "ready" && d && (
              <div className="thanks-all">
                <p className="hero-note">Other platforms:</p>
                <div className="thanks-links">
                  {d.macArm && <a href={d.macArm.browser_download_url}>macOS (Apple Silicon)</a>}
                  {d.macIntel && <a href={d.macIntel.browser_download_url}>macOS (Intel)</a>}
                  {d.windows && <a href={d.windows.browser_download_url}>Windows</a>}
                  {d.linuxAppImage && <a href={d.linuxAppImage.browser_download_url}>Linux (AppImage)</a>}
                  {d.linuxDeb && <a href={d.linuxDeb.browser_download_url}>Linux (.deb)</a>}
                  {d.linuxRpm && <a href={d.linuxRpm.browser_download_url}>Linux (.rpm)</a>}
                </div>
              </div>
            )}

            <div className="thanks-notes">
              <p>
                <strong>macOS:</strong> the app is signed and notarized, so it
                opens normally — no right-click-to-open needed.
              </p>
              <p>
                <strong>Windows:</strong> installers aren&apos;t code-signed yet,
                so SmartScreen may show a one-time warning. Choose &quot;More
                info&quot; → &quot;Run anyway&quot;.
              </p>
              <p>
                <strong>Updates:</strong> OpenGit checks for new versions on
                launch and can install them in place. No extra purchase, ever.
              </p>
            </div>

            <p className="hero-note">
              Trouble with your download?{" "}
              <a href={`${REPO_URL}/issues/new`}>Open an issue</a> and I&apos;ll
              help directly.
            </p>
          </div>
        </section>
      </main>

      <footer>
        <div className="container footer-inner">
          <span>OpenGit. MIT licensed, local-first.</span>
          <nav className="footer-links">
            <a href={REPO_URL}>GitHub</a>
            <a href={`${REPO_URL}/blob/main/LICENSE`}>License</a>
            <a href={`${REPO_URL}/issues`}>Issues</a>
          </nav>
        </div>
      </footer>
    </>
  );
}
