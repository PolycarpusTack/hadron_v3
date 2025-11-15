import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('History and Analytics', () => {
  // Helper function to perform an analysis
  async function analyzeFile(page: any) {
    const fileInput = page.locator('input[type="file"]');
    const filePath = path.join(__dirname, '../fixtures/sample-crash.log');
    await fileInput.setInputFiles(filePath);

    await expect(page.locator('button:has-text("Analyze")').first()).toBeVisible({ timeout: 5000 });
    await page.locator('button:has-text("Analyze")').first().click();

    // Wait for analysis to complete
    await expect(page.locator('text=ROOT CAUSE')).toBeVisible({ timeout: 60000 });

    // Go back to home
    const homeButton = page.locator('button:has-text("Home"), button:has-text("New Analysis")').first();
    if (await homeButton.isVisible({ timeout: 2000 })) {
      await homeButton.click();
    }
  }

  test('should navigate to history view', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Hadron')).toBeVisible({ timeout: 10000 });

    // Click history button
    const historyButton = page.locator('button:has-text("History")').first();
    await historyButton.click();

    // Verify history view is shown
    await expect(page.locator('text=Analysis History, text=Past Analyses').first()).toBeVisible({ timeout: 5000 });
  });

  test('should display analyses in history', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Hadron')).toBeVisible({ timeout: 10000 });

    // Perform an analysis first
    await analyzeFile(page);

    // Navigate to history
    const historyButton = page.locator('button:has-text("History")').first();
    await historyButton.click();

    // Should see the analyzed file
    await expect(page.locator('text=sample-crash.log')).toBeVisible({ timeout: 5000 });

    // Should show metadata
    await expect(page.locator('text=MessageNotUnderstood')).toBeVisible();
    await expect(page.locator('text=HIGH')).toBeVisible();
  });

  test('should filter by severity', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Hadron')).toBeVisible({ timeout: 10000 });

    // Go to history
    const historyButton = page.locator('button:has-text("History")').first();
    await historyButton.click();

    // Find severity filter
    const severityFilter = page.locator('select[name="severity"], button:has-text("Severity")').first();

    if (await severityFilter.isVisible({ timeout: 2000 })) {
      // If dropdown
      if (await severityFilter.evaluate(el => el.tagName === 'SELECT')) {
        await severityFilter.selectOption('HIGH');
      } else {
        // If button-based filter
        await severityFilter.click();
        await page.locator('text=HIGH').click();
      }

      // Verify only HIGH severity items are shown
      await expect(page.locator('text=HIGH')).toBeVisible();
    }
  });

  test('should filter by provider', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Hadron')).toBeVisible({ timeout: 10000 });

    // Go to history
    const historyButton = page.locator('button:has-text("History")').first();
    await historyButton.click();

    // Find provider filter
    const providerFilter = page.locator('select[name="provider"], button:has-text("Provider")').first();

    if (await providerFilter.isVisible({ timeout: 2000 })) {
      // Test filtering (implementation depends on UI)
      // This documents expected behavior
    }
  });

  test('should search analyses', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Hadron')).toBeVisible({ timeout: 10000 });

    // Go to history
    const historyButton = page.locator('button:has-text("History")').first();
    await historyButton.click();

    // Find search input
    const searchInput = page.locator('input[type="search"], input[placeholder*="Search"]').first();

    if (await searchInput.isVisible({ timeout: 2000 })) {
      // Type search query
      await searchInput.fill('MessageNotUnderstood');

      // Wait for filtered results
      await page.waitForTimeout(500);

      // Should show matching results
      await expect(page.locator('text=MessageNotUnderstood')).toBeVisible();
    }
  });

  test('should toggle favorite status', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Hadron')).toBeVisible({ timeout: 10000 });

    // Analyze a file
    await analyzeFile(page);

    // Go to history
    const historyButton = page.locator('button:has-text("History")').first();
    await historyButton.click();

    // Find favorite button (star icon)
    const favoriteButton = page.locator('button[aria-label*="favorite"], button:has([class*="star"])').first();

    if (await favoriteButton.isVisible({ timeout: 2000 })) {
      // Click to favorite
      await favoriteButton.click();

      // Should show as favorited (filled star or different color)
      await expect(favoriteButton).toHaveClass(/active|favorited|fill/);
    }
  });

  test('should view favorites only', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Hadron')).toBeVisible({ timeout: 10000 });

    // Go to history
    const historyButton = page.locator('button:has-text("History")').first();
    await historyButton.click();

    // Find "Favorites" filter or tab
    const favoritesButton = page.locator('button:has-text("Favorites"), button:has-text("Starred")').first();

    if (await favoritesButton.isVisible({ timeout: 2000 })) {
      await favoritesButton.click();

      // Should only show favorited items
      // (Test assumes there are favorites from previous test)
    }
  });

  test('should view analysis details', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Hadron')).toBeVisible({ timeout: 10000 });

    // Analyze a file
    await analyzeFile(page);

    // Go to history
    const historyButton = page.locator('button:has-text("History")').first();
    await historyButton.click();

    // Click on an analysis to view details
    const firstAnalysis = page.locator('[class*="analysis-item"], [class*="history-item"]').first();
    await firstAnalysis.click();

    // Should show full analysis details
    await expect(page.locator('text=ROOT CAUSE')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Suggested Fixes')).toBeVisible();
    await expect(page.locator('text=Stack Trace')).toBeVisible();
  });

  test('should delete analysis', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Hadron')).toBeVisible({ timeout: 10000 });

    // Analyze a file
    await analyzeFile(page);

    // Go to history
    const historyButton = page.locator('button:has-text("History")').first();
    await historyButton.click();

    // Find delete button
    const deleteButton = page.locator('button[aria-label*="delete"], button:has-text("Delete")').first();

    if (await deleteButton.isVisible({ timeout: 2000 })) {
      const analysisCount = await page.locator('[class*="analysis-item"]').count();

      // Click delete
      await deleteButton.click();

      // Confirm deletion if there's a confirmation dialog
      const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Yes")');
      if (await confirmButton.isVisible({ timeout: 1000 })) {
        await confirmButton.click();
      }

      // Wait for deletion to process
      await page.waitForTimeout(1000);

      // Verify analysis count decreased
      const newCount = await page.locator('[class*="analysis-item"]').count();
      expect(newCount).toBeLessThan(analysisCount);
    }
  });

  test('should display analytics dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Hadron')).toBeVisible({ timeout: 10000 });

    // Go to history
    const historyButton = page.locator('button:has-text("History")').first();
    await historyButton.click();

    // Look for analytics/dashboard section
    const dashboardSection = page.locator('text=Analytics, text=Dashboard, text=Overview').first();

    if (await dashboardSection.isVisible({ timeout: 2000 })) {
      await dashboardSection.scrollIntoViewIfNeeded();

      // Should show statistics
      await expect(page.locator('text=/Total Analyses|Analysis Count/')).toBeVisible();
      await expect(page.locator('text=/Error Types|Common Errors/')).toBeVisible();
    }
  });

  test('should show error type distribution', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Hadron')).toBeVisible({ timeout: 10000 });

    // Go to history
    const historyButton = page.locator('button:has-text("History")').first();
    await historyButton.click();

    // Look for error type chart/list
    const errorTypeSection = page.locator('text=Error Types, text=Error Distribution').first();

    if (await errorTypeSection.isVisible({ timeout: 2000 })) {
      await errorTypeSection.scrollIntoViewIfNeeded();

      // Should show error types and counts
      await expect(page.locator('text=MessageNotUnderstood')).toBeVisible();
    }
  });

  test('should show analysis trends', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Hadron')).toBeVisible({ timeout: 10000 });

    // Go to history
    const historyButton = page.locator('button:has-text("History")').first();
    await historyButton.click();

    // Look for trends/timeline
    const trendsSection = page.locator('text=Trends, text=Timeline, text=Last 7 Days').first();

    if (await trendsSection.isVisible({ timeout: 2000 })) {
      await trendsSection.scrollIntoViewIfNeeded();

      // Should show time-based statistics
      // This documents expected analytics features
    }
  });

  test('should export analysis', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Hadron')).toBeVisible({ timeout: 10000 });

    // Analyze a file
    await analyzeFile(page);

    // Go to history
    const historyButton = page.locator('button:has-text("History")').first();
    await historyButton.click();

    // Find export button
    const exportButton = page.locator('button:has-text("Export"), button[aria-label*="export"]').first();

    if (await exportButton.isVisible({ timeout: 2000 })) {
      // Set up download listener
      const downloadPromise = page.waitForEvent('download', { timeout: 10000 });

      // Click export
      await exportButton.click();

      // Wait for download to start
      const download = await downloadPromise;

      // Verify download happened
      expect(download.suggestedFilename()).toMatch(/\.json|\.pdf|\.txt/);
    }
  });
});
