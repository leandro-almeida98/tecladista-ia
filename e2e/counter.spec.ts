import { test, expect } from "@playwright/test"

test("incrementa contador", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Count: 0")).toBeVisible()
  await page.getByRole("button", { name: "+" }).click()
  await expect(page.getByText("Count: 1")).toBeVisible()
})