import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  // Stub the Web MIDI API with a Casio CT-S300 input before the app loads.
  await page.addInitScript(() => {
    const input = { name: 'CT-S300', onmidimessage: null }
    const access = {
      inputs: { values: () => [input][Symbol.iterator]() },
      onstatechange: null,
    }
    ;(navigator as unknown as { requestMIDIAccess: () => Promise<unknown> }).requestMIDIAccess =
      async () => access
  })
})

test('importa .mid, renderiza teclado e desenha notas no canvas', async ({ page }) => {
  await page.goto('/')

  // Keyboard and canvas render.
  await expect(page.getByTestId('piano-keyboard')).toBeVisible()
  await expect(page.getByTestId('falling-notes-canvas')).toBeVisible()

  // MIDI connected to the stubbed CT-S300.
  await expect(page.getByText(/CT-S300/)).toBeVisible()

  // Import the generated .mid.
  await page.setInputFiles('[data-testid="midi-file-input"]', 'e2e/fixtures/test.mid')
  await expect(page.getByTestId('midi-file-info')).toContainText('test.mid')
  await expect(page.getByTestId('midi-file-info')).toContainText('4 notas')

  // Play.
  await page.getByRole('button', { name: 'Tocar' }).click()

  // The canvas draws non-transparent pixels (hit line + falling notes).
  await page.waitForTimeout(400)
  const hasPixels = await page.evaluate(() => {
    const c = document.querySelector(
      '[data-testid="falling-notes-canvas"]',
    ) as HTMLCanvasElement
    const ctx = c.getContext('2d')
    if (!ctx) return false
    const data = ctx.getImageData(0, 0, c.width, c.height).data
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) return true
    }
    return false
  })
  expect(hasPixels).toBe(true)
})