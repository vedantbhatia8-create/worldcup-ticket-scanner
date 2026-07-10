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

export async function updateSettingsAction(formData: FormData): Promise<void> {
  const price = Number(formData.get("target_price"));
  if (Number.isFinite(price) && price > 0) await setTargetPrice(price);
  revalidatePath("/");
}
