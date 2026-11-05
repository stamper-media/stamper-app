import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "../components/Logo";
import { getConfig } from "../lib/config";
import "./globals.css";
import "./capture/capture.css";

const NETWORK: Record<number, string> = {
  31337: "Local chain",
  314159: "Calibration testnet",
  314: "",
};

export const metadata: Metadata = {
  metadataBase: new URL(getConfig().origin),
  title: { default: "Stamper", template: "%s · Stamper" },
  description:
    "Stamp a photo or video: its fingerprints are signed in your browser and registered on Filecoin.",
  icons: { icon: [{ url: "/brand/stamper-mark.svg", type: "image/svg+xml" }] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0a12" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const cfg = getConfig();
  const network = NETWORK[cfg.chainId];
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <nav className="site-nav">
            <Link href="/" className="brand" aria-label="Stamper">
              <Logo height={26} />
            </Link>
            <span className="nav-links">
              {network ? <span className="network">{network}</span> : null}
              <a href={`${cfg.verifyBase}/about`}>What a stamp proves</a>
              <a className="nav-cta" href={cfg.verifyBase}>
                <span className="nav-cta-mark" aria-hidden="true" />
                Check a stamp
              </a>
            </span>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="site-footer" data-testid="footer">
          <div className="site-footer-inner">
            <div>
              <p className="footer-credit">
                Developed by{" "}
                <a href="https://tinfoil.art" rel="noreferrer">
                  Tinfoil
                </a>
              </p>
            </div>
            <span className="footer-links">
              <a href={`${cfg.verifyBase}/status`}>Service status</a>
              <a href="https://filecoin.io" rel="noreferrer">
                Built on Filecoin
              </a>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
