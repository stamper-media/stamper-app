import type { Metadata } from "next";
import { getConfig } from "../lib/config";
import { CaptureClient } from "./capture/CaptureClient";
import { CAPTURE, WEB_TIER } from "./capture/copy";

export const metadata: Metadata = { title: CAPTURE.title };

/** The capture screen: camera or file → minimised, hashed and signed in this browser → onchain. */
export default function CapturePage() {
  const cfg = getConfig();
  return (
    <div className="home">
      <section className="hero cap-hero">
        <div className="hero-copy">
          <span className="label">{CAPTURE.eyebrow}</span>
          <h1>
            {CAPTURE.heroTitle} <em>{CAPTURE.heroAccent}</em>
          </h1>
          <p className="lede">{CAPTURE.heroLede}</p>
          <ul className="trust">
            {CAPTURE.trust.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
        <section className="cap-tier" data-testid="capture-tier">
          <span className="label">{CAPTURE.tierLabel}</span>
          <strong>{WEB_TIER.headline}</strong>
          <p>{WEB_TIER.means}</p>
          <p className="muted">{WEB_TIER.doesNotMean}</p>
        </section>
        {cfg.apiUrl ? (
          <CaptureClient
            apiUrl={cfg.apiUrl}
            chainId={cfg.chainId}
            registry={cfg.registry}
            verifyBase={cfg.verifyBase}
          />
        ) : (
          <div className="check-card">
            <p>{CAPTURE.disabled}</p>
          </div>
        )}
      </section>
    </div>
  );
}
