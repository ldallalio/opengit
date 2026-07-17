import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenGit — A Git client you own",
  description:
    "OpenGit is an open source, local-first Git desktop client. One-time price for official builds, works offline, no telemetry, no account.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
