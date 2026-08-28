import type { SafetyDetail } from "@/lib/bot-universe";

/**
 * The RugCheck facts the safety gate already fetches, shown as chips. This is
 * the same data a bot's buy is screened against, published so a spectator can
 * see WHY a token is or isn't safe to hold — trust through the actual signal,
 * not a logo.
 */
export function SafetyBadges({ safety }: { safety: SafetyDetail }) {
  const chips: { label: string; tone: "good" | "bad" | "warn" | "neutral" }[] = [];

  if (safety.riskScore !== null) {
    chips.push({
      label: `risk ${safety.riskScore}/100`,
      tone: safety.riskScore <= 30 ? "good" : safety.riskScore <= 60 ? "warn" : "bad",
    });
  }
  chips.push({
    label: safety.mintRevoked ? "mint revoked" : "mint LIVE",
    tone: safety.mintRevoked ? "good" : "bad",
  });
  chips.push({
    label: safety.freezeRevoked ? "freeze revoked" : "freeze LIVE",
    tone: safety.freezeRevoked ? "good" : "bad",
  });
  if (safety.lpLockedPct !== null) {
    chips.push({
      label: `LP ${safety.lpLockedPct.toFixed(0)}% locked`,
      tone: safety.lpLockedPct >= 80 ? "good" : safety.lpLockedPct >= 1 ? "warn" : "bad",
    });
  }
  if (safety.devHoldsPct !== null) {
    chips.push({
      label: `dev holds ${safety.devHoldsPct.toFixed(1)}%`,
      tone: safety.devHoldsPct < 5 ? "good" : safety.devHoldsPct < 15 ? "warn" : "bad",
    });
  }
  if (safety.topHolderPct !== null) {
    chips.push({
      label: `top wallet ${safety.topHolderPct.toFixed(1)}%`,
      tone: safety.topHolderPct < 20 ? "good" : safety.topHolderPct < 40 ? "warn" : "bad",
    });
  }
  if (safety.insiders !== null && safety.insiders > 0) {
    chips.push({ label: `${safety.insiders} insiders detected`, tone: "warn" });
  }

  const cls = (tone: string) =>
    tone === "good"
      ? "badge badge-success"
      : tone === "bad"
        ? "badge badge-danger"
        : tone === "warn"
          ? "badge badge-warning"
          : "badge";

  return (
    <div className="mt-4">
      <div className="section-label mb-2">
        <span>Safety</span>
        <span className="text-ink3 normal-case tracking-normal">
          the same RugCheck screen every buy passes
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c, i) => (
          <span key={i} className={cls(c.tone)}>
            {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}
