"use server";

import { revalidatePath } from "next/cache";
import { runScan, setTargetPrice, type ScanSummary } from "@/lib/scan";

export async function scanNowAction(): Promise<ScanSummary | { error: string }> {
  try {
    const summary = await runScan();
    revalidatePath("/");
    return summary;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function updateTargetPriceAction(formData: FormData): Promise<void> {
  const raw = formData.get("target_price");
  const price = Number(raw);
  if (!Number.isFinite(price) || price <= 0) return;
  await setTargetPrice(price);
  revalidatePath("/");
}
