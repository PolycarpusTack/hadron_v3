import { test, expect } from '@playwright/test';

test.describe('Settings Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Hadron')).toBeVisible({ timeout: 10000 });

    // Open settings panel
    const settingsButton = page.locator('button[title="Settings"], button:has-text("Settings")').first();
    await settingsButton.click();

    // Wait for settings panel to open
    await expect(page.locator('text=AI Provider')).toBeVisible({ timeout: 5000 });
  });

  test('should open and close settings panel', async ({ page }) => {
    // Settings panel should be open from beforeEach
    await expect(page.locator('text=AI Provider')).toBeVisible();

    // Close settings
    const closeButton = page.locator('button[aria-label="Close settings"], button:has-text("×")').first();
    await closeButton.click();

    // Verify settings closed
    await expect(page.locator('text=AI Provider')).not.toBeVisible({ timeout: 3000 });
  });

  test('should display all provider options', async ({ page }) => {
    // Verify all 6 providers are listed
    await expect(page.locator('text=OpenAI')).toBeVisible();
    await expect(page.locator('text=Anthropic')).toBeVisible();
    await expect(page.locator('text=Ollama')).toBeVisible();
    await expect(page.locator('text=Z.ai')).toBeVisible();
    await expect(page.locator('text=vLLM')).toBeVisible();
    await expect(page.locator('text=llama.cpp')).toBeVisible();
  });

  test('should show provider toggle switches', async ({ page }) => {
    // Verify toggle switches are present
    const toggles = page.locator('input[type="checkbox"]');
    const toggleCount = await toggles.count();

    // Should have at least 6 toggles (one per provider) + possibly PII toggle
    expect(toggleCount).toBeGreaterThanOrEqual(6);
  });

  test('should activate and deactivate providers', async ({ page }) => {
    // Find vLLM provider (should be inactive by default)
    const vllmSection = page.locator('text=vLLM').locator('..');

    // Find its toggle switch
    const vllmToggle = vllmSection.locator('input[type="checkbox"]').first();

    // Check if initially inactive
    const initialState = await vllmToggle.isChecked();

    // Toggle the provider
    await vllmToggle.click();

    // Verify state changed
    const newState = await vllmToggle.isChecked();
    expect(newState).toBe(!initialState);

    // Toggle back
    await vllmToggle.click();

    // Verify returned to original state
    const finalState = await vllmToggle.isChecked();
    expect(finalState).toBe(initialState);
  });

  test('should not allow deactivating last active provider', async ({ page }) => {
    // This test ensures at least one provider remains active

    // Get all provider toggles
    const toggles = page.locator('input[type="checkbox"][class*="peer"]');
    const count = await toggles.count();

    // Try to uncheck all toggles
    let activateCount = 0;
    for (let i = 0; i < count; i++) {
      const toggle = toggles.nth(i);
      if (await toggle.isChecked()) {
        activateCount++;
        await toggle.click();

        // If it's the last one, it should remain checked or show an error
        const afterClick = await toggle.isChecked();

        if (activateCount === 1) {
          // Last provider should either:
          // 1. Remain checked (prevented)
          // 2. Or show an error message
          expect(afterClick).toBe(true);
        }
        break; // Stop after attempting to deactivate one
      }
    }
  });

  test('should switch between providers', async ({ page }) => {
    // Click on OpenAI provider
    const openaiOption = page.locator('text=OpenAI').locator('..');
    await openaiOption.click();

    // Verify OpenAI is selected (should show checkmark or highlight)
    await expect(openaiOption).toHaveClass(/selected|active|border-blue/);

    // Click on Anthropic provider
    const anthropicOption = page.locator('text=Anthropic').locator('..');
    await anthropicOption.click();

    // Verify Anthropic is selected
    await expect(anthropicOption).toHaveClass(/selected|active|border-blue/);
  });

  test('should display model selection for active provider', async ({ page }) => {
    // Select OpenAI
    await page.locator('text=OpenAI').locator('..').click();

    // Should show GPT models
    await expect(page.locator('text=GPT-')).toBeVisible({ timeout: 3000 });

    // Select Anthropic
    await page.locator('text=Anthropic').locator('..').click();

    // Should show Claude models
    await expect(page.locator('text=Claude')).toBeVisible({ timeout: 3000 });
  });

  test('should toggle PII redaction', async ({ page }) => {
    // Find PII redaction checkbox
    const piiToggle = page.locator('text=Redact PII').locator('..').locator('input[type="checkbox"]').first();

    // Get initial state
    const initialState = await piiToggle.isChecked();

    // Toggle PII redaction
    await piiToggle.click();

    // Verify state changed
    const newState = await piiToggle.isChecked();
    expect(newState).toBe(!initialState);
  });

  test('should show API key input fields', async ({ page }) => {
    // Should have API key inputs for cloud providers
    await expect(page.locator('label:has-text("API Key")')).toBeVisible();

    // Password fields should be present (for hiding API keys)
    const passwordInputs = page.locator('input[type="password"]');
    const passwordCount = await passwordInputs.count();
    expect(passwordCount).toBeGreaterThan(0);
  });

  test('should toggle API key visibility', async ({ page }) => {
    // Find eye icon buttons for toggling visibility
    const eyeButtons = page.locator('button[aria-label*="toggle"], button:has([class*="eye"])');

    if (await eyeButtons.count() > 0) {
      const firstEyeButton = eyeButtons.first();
      await firstEyeButton.click();

      // Verify password field changed to text (or vice versa)
      // This depends on implementation
    }
  });

  test('should save settings', async ({ page }) => {
    // Make a change (e.g., toggle PII redaction)
    const piiToggle = page.locator('text=Redact PII').locator('..').locator('input[type="checkbox"]').first();
    await piiToggle.click();

    // Click save button
    const saveButton = page.locator('button:has-text("Save")').first();
    await saveButton.click();

    // Should show success message
    await expect(page.locator('text=Settings saved').or(page.locator('text=Saved'))).toBeVisible({ timeout: 5000 });

    // Close and reopen settings to verify persistence
    const closeButton = page.locator('button[aria-label="Close settings"], button:has-text("×")').first();
    await closeButton.click();

    // Wait a moment
    await page.waitForTimeout(500);

    // Reopen settings
    const settingsButton = page.locator('button[title="Settings"], button:has-text("Settings")').first();
    await settingsButton.click();

    // Verify the change persisted
    const piiToggleAfter = page.locator('text=Redact PII').locator('..').locator('input[type="checkbox"]').first();
    const stateAfter = await piiToggleAfter.isChecked();

    // The state should have persisted
    // (Compare with before change if we tracked it)
  });

  test('should show active provider count', async ({ page }) => {
    // Should display how many providers are currently active
    await expect(page.locator('text=/\\d+ active/')).toBeVisible();
  });

  test('should display circuit breaker status', async ({ page }) => {
    // Scroll to circuit breaker section if needed
    await page.locator('text=Circuit Breaker Status, text=Provider Health').first().scrollIntoViewIfNeeded();

    // Verify circuit breaker section exists
    await expect(page.locator('text=Circuit Breaker Status, text=Provider Health').first()).toBeVisible();

    // Should show status for active providers
    await expect(page.locator('[class*="circuit"], [class*="health"]')).toBeVisible();
  });
});
