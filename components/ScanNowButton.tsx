"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { scanNowAction } from "@/app/actions";

export default function ScanNowButton() {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();

  function scan() {
    setStatus(null);
    startTransition(async () => {
      const result = await scanNowAction();
      if ("error" in result) {
        setStatus(`Scan failed: ${result.error}`);
      } else {
        const found = result.snapshotsStored;
        const alerts = result.alertsSent;
        setStatus(
          `Scanned at ${new Date(result.scannedAt).toLocaleTimeString()} — ` +
            `${found} snapshot${found === 1 ? "" : "s"} stored, ` +
            `${result.belowTarget.length} at/below target, ${alerts} alert${alerts === 1 ? "" : "s"} sent.`
        );
        router.refresh();
      }
    });
  }

  return (
    <div>
      <button className="btn" onClick={scan} disabled={pending}>
        {pending ? "Scanning…" : "Scan Now"}
      </button>
      {status && <p className="scan-status">{status}</p>}
    </div>
  );
}
