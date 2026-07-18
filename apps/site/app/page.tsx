const REPO_URL = "https://github.com/ldallalio/opengit";
// TODO: replace with the real Lemon Squeezy product checkout URL before launch.
const CHECKOUT_URL = "https://opengit.lemonsqueezy.com/checkout";

function Icon({ path }: { path: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

const check = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
  </svg>
);

const features = [
  {
    title: "Commit graph",
    body: "A fast, readable graph of your history. Branches, merges, and tags laid out the way you picture them.",
    icon: "M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0v5.256a2.251 2.251 0 1 0 1.5 0V5.372Zm6.5.372a2.25 2.25 0 1 0-1.5 0v.94a2 2 0 0 1-1.155 1.813l-2.03.954a3.5 3.5 0 0 0-.315.176v2.891a2.25 2.25 0 1 0 1.5 0v-.363a2 2 0 0 1 1.155-1.813l2.03-.954A3.5 3.5 0 0 0 13.25 6.7v-.956Z",
  },
  {
    title: "Staging that makes sense",
    body: "Stage files, hunks, or single lines. See exactly what goes into every commit before it happens.",
    icon: "M2.75 1h10.5a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75H2.75a.75.75 0 0 1-.75-.75V1.75A.75.75 0 0 1 2.75 1ZM3.5 2.5v11h9v-11h-9Zm2 2h5a.75.75 0 0 1 0 1.5h-5a.75.75 0 0 1 0-1.5Zm0 3h5a.75.75 0 0 1 0 1.5h-5a.75.75 0 0 1 0-1.5Zm0 3h3a.75.75 0 0 1 0 1.5h-3a.75.75 0 0 1 0-1.5Z",
  },
  {
    title: "Side-by-side diffs",
    body: "Clean split diffs with syntax awareness, so reviews and comparisons stay easy on the eyes.",
    icon: "M1 1.75A.75.75 0 0 1 1.75 1h5.5a.75.75 0 0 1 0 1.5H2.5v11h4.75a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1-.75-.75V1.75Zm9.75-.75h3.5a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-3.5a.75.75 0 0 1 0-1.5h2.75v-11h-2.75a.75.75 0 0 1 0-1.5Z",
  },
  {
    title: "Merge conflict resolver",
    body: "Resolve conflicts inside the app with a clear three-way view. No hunting through conflict markers.",
    icon: "M8 1a.75.75 0 0 1 .53.22l3.25 3.25a.75.75 0 0 1-1.06 1.06L8.75 3.56v4.69a2.25 2.25 0 1 1-1.5 0V3.56L5.28 5.53a.75.75 0 0 1-1.06-1.06L7.47 1.22A.75.75 0 0 1 8 1Zm0 8.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM3 12.75a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1-.75-.75Z",
  },
  {
    title: "Safety snapshots",
    body: "Before any destructive operation, OpenGit takes a snapshot. Rebase, reset, force push, all reversible.",
    icon: "M8 1a7 7 0 1 1-4.95 11.95.75.75 0 1 1 1.06-1.06A5.5 5.5 0 1 0 2.5 8h1.44a.25.25 0 0 1 .18.43L2.06 10.5a.25.25 0 0 1-.36 0L-.36 8.43A.25.25 0 0 1-.18 8H1a7 7 0 0 1 7-7Zm-.75 3.75a.75.75 0 0 1 1.5 0v3.06l2.03 2.03a.75.75 0 1 1-1.06 1.06L7.47 8.66a.75.75 0 0 1-.22-.53V4.75Z",
  },
  {
    title: "Branches, remotes, stashes",
    body: "Full branch, remote, and stash management from one panel. Create, rename, push, pop, drop.",
    icon: "M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z",
  },
  {
    title: "Azure DevOps, first class",
    body: "Pull requests, branch policies, and auth for Azure DevOps built in. Rare in Git clients, standard here. GitHub and GitLab work over plain git too.",
    icon: "M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.879-2.773 4.264 2.559a.25.25 0 0 1 0 .428l-4.264 2.559A.25.25 0 0 1 6 10.559V5.442a.25.25 0 0 1 .379-.215Z",
  },
  {
    title: "AI commit messages",
    body: "Generate commit messages from your staged diff with your own OpenAI key. Optional, off by default.",
    icon: "M7.53 1.282a.5.5 0 0 1 .94 0l.478 1.306a7.5 7.5 0 0 0 4.464 4.464l1.305.478a.5.5 0 0 1 0 .94l-1.305.478a7.5 7.5 0 0 0-4.464 4.464l-.478 1.305a.5.5 0 0 1-.94 0l-.478-1.305a7.5 7.5 0 0 0-4.464-4.464L1.282 8.47a.5.5 0 0 1 0-.94l1.306-.478a7.5 7.5 0 0 0 4.464-4.464Z",
  },
  {
    title: "Local-first, private",
    body: "Everything runs on your machine. No telemetry, no account, no network calls you did not ask for.",
    icon: "M8 0c1.573 0 3.022.289 4.096.777.535.243 1.01.55 1.36.929.35.38.544.822.544 1.294v10c0 .472-.193.914-.544 1.294-.35.38-.825.686-1.36.929C11.022 15.71 9.573 16 8 16s-3.022-.289-4.096-.777c-.535-.243-1.01-.55-1.36-.929C2.194 13.914 2 13.472 2 13V3c0-.472.193-.914.544-1.294.35-.38.825-.686 1.36-.929C4.978.289 6.427 0 8 0Z",
  },
];

const faqs = [
  {
    q: "Why sell builds if the code is open source?",
    a: "Signing certificates, notarization, and update infrastructure cost real money, and building a good Git client takes time. The $15 covers the official, signed, auto-updating installers. The code itself is MIT licensed and always free to build yourself.",
  },
  {
    q: "What platforms are supported?",
    a: "macOS (signed and notarized), Windows, and Linux. Linux builds are free. You can build from source on any platform.",
  },
  {
    q: "Do updates cost extra?",
    a: "No. The $15 is one time. Official builds auto-update, and every future version is included.",
  },
  {
    q: "Is there telemetry?",
    a: "No. OpenGit sends nothing anywhere. No analytics, no crash reporting, no account, no phone-home. The only network traffic is the git operations you run, plus the optional AI feature if you add your own OpenAI key.",
  },
];

export default function Page() {
  return (
    <>
      <header className="nav">
        <div className="container nav-inner">
          <a className="brand" href="#">
            <svg width="22" height="22" viewBox="0 0 16 16" fill="var(--accent)" aria-hidden="true">
              <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0v5.256a2.251 2.251 0 1 0 1.5 0V5.372Zm6.5.372a2.25 2.25 0 1 0-1.5 0v.94a2 2 0 0 1-1.155 1.813l-2.03.954a3.5 3.5 0 0 0-.315.176v2.891a2.25 2.25 0 1 0 1.5 0v-.363a2 2 0 0 1 1.155-1.813l2.03-.954A3.5 3.5 0 0 0 13.25 6.7v-.956Z" />
            </svg>
            OpenGit
          </a>
          <nav className="nav-links">
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
            <a href={REPO_URL}>GitHub</a>
            <a className="nav-cta" href={CHECKOUT_URL}>
              Get OpenGit
            </a>
          </nav>
        </div>
      </header>

      <main>
        <section className="hero" style={{ borderTop: "none" }}>
          <div className="container">
            <div className="hero-badge">
              <span className="dot" />
              MIT licensed. Open source forever.
            </div>
            <h1>
              A Git client <em>you own</em>.
            </h1>
            <p className="hero-sub">
              Pay once, use it forever. Open source, works offline, no
              telemetry, no account. Your repos never leave your machine.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href={CHECKOUT_URL}>
                Buy for $15, once
              </a>
              <a className="btn btn-secondary" href={REPO_URL}>
                View source on GitHub
              </a>
            </div>
            <p className="hero-note">
              macOS, Windows, and Linux. Linux builds are free.
            </p>

            <div className="shot">
              <div className="shot-titlebar">
                <span />
                <span />
                <span />
              </div>
              <div className="shot-body">
                <img
                  src="/opengit-screenshot.png"
                  alt="OpenGit showing the git/git repository: commit graph with merge lanes, branch sidebar, and commit detail"
                  width={2555}
                  height={1435}
                />
              </div>
            </div>
          </div>
        </section>

        <section id="features">
          <div className="container">
            <div className="section-head">
              <h2>Everything a daily driver needs</h2>
              <p>
                Built in Rust and React on Tauri. Small, fast, and local. The
                whole client is designed around doing real Git work without
                getting in your way.
              </p>
            </div>
            <div className="features">
              {features.map((f) => (
                <div className="feature" key={f.title}>
                  <span className="feature-icon">
                    <Icon path={f.icon} />
                  </span>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing">
          <div className="container">
            <div className="section-head">
              <h2>One price. No subscription.</h2>
              <p>
                The code is free forever. The official signed builds cost $15,
                once, and fund the project.
              </p>
            </div>
            <div className="pricing-grid">
              <div className="price-card">
                <div className="price-tag">Build from source</div>
                <div className="price-amount">
                  Free <small>forever</small>
                </div>
                <p>
                  Clone the repo and build it yourself. Same app, same
                  features, MIT licensed.
                </p>
                <ul className="price-list">
                  <li>{check} Full source code, MIT license</li>
                  <li>{check} Every feature included</li>
                  <li>{check} All platforms</li>
                  <li>{check} Free Linux builds</li>
                </ul>
                <a className="btn btn-secondary" href={REPO_URL}>
                  Get the source
                </a>
              </div>
              <div className="price-card featured">
                <div className="price-tag">Official builds</div>
                <div className="price-amount">
                  $15 <small>one time</small>
                </div>
                <p>
                  Signed, notarized installers with automatic updates. Pay
                  once, keep it for life.
                </p>
                <ul className="price-list">
                  <li>{check} macOS signed and notarized</li>
                  <li>{check} Windows and Linux installers</li>
                  <li>{check} Automatic updates, free forever</li>
                  <li>{check} Funds continued development</li>
                </ul>
                <a className="btn btn-primary" href={CHECKOUT_URL}>
                  Buy OpenGit
                </a>
              </div>
            </div>
          </div>
        </section>

        <section id="faq">
          <div className="container">
            <div className="section-head">
              <h2>Questions, answered</h2>
            </div>
            <div className="faq">
              {faqs.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
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
