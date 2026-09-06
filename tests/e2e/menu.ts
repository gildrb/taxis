import type { Page } from "@playwright/test";

export async function chooseOption(page: Page, field: string, option: string): Promise<void> {
  await page.getByRole("combobox", { name: field, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
