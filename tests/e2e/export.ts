import { expect, type Download, type Page } from "@playwright/test";
import type { ExportFormat } from "../../src/export/encode";

/** Use the visible native dialog, then restore the footer trigger before editing the scene. */
export async function downloadExport(page: Page, format: ExportFormat | "json"): Promise<Download> {
  const trigger = page.getByRole("button", { name: "Export", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("radio", { name: { svg: "SVG", png: "PNG", jpeg: "JPEG", webp: "WebP", mp4: "MP4", webm: "WebM", json: "Project JSON" }[format], exact: true }).check();
  const pending = page.waitForEvent("download");
  await dialog.locator('button[type="submit"]').click();
  const download = await pending;
  await expect(dialog.locator('button[type="submit"]')).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  return download;
}
