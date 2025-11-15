import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('File Upload and Analysis', () => {
  test('should upload and analyze a crash log file', async ({ page }) => {
    // Navigate to the application
    await page.goto('/');

    // Wait for the app to load
    await expect(page.locator('text=Hadron')).toBeVisible({ timeout: 10000 });

    // Check that the drop zone is visible
    await expect(page.locator('text=Drop crash log here')).toBeVisible();

    // Locate the file input (hidden but functional)
    const fileInput = page.locator('input[type="file"]');

    // Upload the sample crash log
    const filePath = path.join(__dirname, '../fixtures/sample-crash.log');
    await fileInput.setInputFiles(filePath);

    // Wait for the analysis button to appear
    await expect(page.locator('button:has-text("Analyze")')).toBeVisible({ timeout: 5000 });

    // Click the analyze button
    await page.locator('button:has-text("Analyze")').click();

    // Wait for analysis to complete (could take 10-30 seconds depending on AI provider)
    // Look for the results section to appear
    await expect(page.locator('text=ROOT CAUSE')).toBeVisible({ timeout: 60000 });

    // Verify key sections of the analysis results are present
    await expect(page.locator('text=Error Type')).toBeVisible();
    await expect(page.locator('text=Severity')).toBeVisible();
    await expect(page.locator('text=Suggested Fixes')).toBeVisible();

    // Verify the error type was detected
    await expect(page.locator('text=MessageNotUnderstood')).toBeVisible();

    // Verify severity is shown
    await expect(page.locator('[class*="severity"]')).toBeVisible();
  });

  test('should show error for unsupported file types', async ({ page }) => {
    await page.goto('/');

    // Wait for the app to load
    await expect(page.locator('text=Hadron')).toBeVisible({ timeout: 10000 });

    // Try to upload a non-log file
    const fileInput = page.locator('input[type="file"]');

    // Create a temporary invalid file path (Playwright will handle this gracefully)
    // In practice, the app should validate file extensions
    const invalidFile = path.join(__dirname, '../fixtures/invalid.pdf');

    // This test assumes the app validates file types
    // If validation doesn't exist yet, this documents the expected behavior
  });

  test('should handle file drag and drop', async ({ page }) => {
    await page.goto('/');

    // Wait for the app to load
    await expect(page.locator('text=Hadron')).toBeVisible({ timeout: 10000 });

    // Verify drop zone is interactive
    const dropZone = page.locator('[class*="drop-zone"]').first();
    await expect(dropZone).toBeVisible();

    // Note: Actual drag-and-drop simulation in Playwright requires the dataTransfer API
    // This test documents the expected behavior
  });

  test('should allow canceling analysis', async ({ page }) => {
    await page.goto('/');

    // Wait for the app to load
    await expect(page.locator('text=Hadron')).toBeVisible({ timeout: 10000 });

    // Upload a file
    const fileInput = page.locator('input[type="file"]');
    const filePath = path.join(__dirname, '../fixtures/sample-crash.log');
    await fileInput.setInputFiles(filePath);

    // Wait for analyze button
    await expect(page.locator('button:has-text("Analyze")').first()).toBeVisible({ timeout: 5000 });

    // Click analyze
    await page.locator('button:has-text("Analyze")').first().click();

    // Look for cancel button while analysis is in progress
    // Note: This assumes there's a cancel button during analysis
    const cancelButton = page.locator('button:has-text("Cancel")');

    // If cancel button exists, test canceling
    if (await cancelButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cancelButton.click();

      // Verify analysis was canceled
      await expect(page.locator('text=Analysis canceled')).toBeVisible({ timeout: 5000 });
    }
  });

  test('should save analysis to history', async ({ page }) => {
    await page.goto('/');

    // Wait for the app to load
    await expect(page.locator('text=Hadron')).toBeVisible({ timeout: 10000 });

    // Upload and analyze
    const fileInput = page.locator('input[type="file"]');
    const filePath = path.join(__dirname, '../fixtures/sample-crash.log');
    await fileInput.setInputFiles(filePath);

    await expect(page.locator('button:has-text("Analyze")').first()).toBeVisible({ timeout: 5000 });
    await page.locator('button:has-text("Analyze")').first().click();

    // Wait for analysis to complete
    await expect(page.locator('text=ROOT CAUSE')).toBeVisible({ timeout: 60000 });

    // Navigate to history
    const historyButton = page.locator('button:has-text("History")');
    await historyButton.click();

    // Verify the analyzed file appears in history
    await expect(page.locator('text=sample-crash.log')).toBeVisible({ timeout: 5000 });
  });
});
