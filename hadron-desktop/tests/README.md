# Hadron Desktop - E2E Testing Suite

Comprehensive End-to-End testing for Hadron Desktop using Playwright.

## 🎯 Test Coverage

### File Upload & Analysis (`file-upload.spec.ts`)
- ✅ Upload and analyze crash log files
- ✅ Handle unsupported file types
- ✅ File drag-and-drop functionality
- ✅ Cancel analysis in progress
- ✅ Save analysis to history

### Settings Panel (`settings.spec.ts`)
- ✅ Open/close settings panel
- ✅ Display all 6 AI providers
- ✅ Provider toggle switches (activation/deactivation)
- ✅ Prevent deactivating last active provider
- ✅ Switch between providers
- ✅ Model selection per provider
- ✅ PII redaction toggle
- ✅ API key management
- ✅ Settings persistence
- ✅ Circuit breaker status display

### History & Analytics (`history.spec.ts`)
- ✅ Navigate to history view
- ✅ Display past analyses
- ✅ Filter by severity
- ✅ Filter by provider
- ✅ Search analyses
- ✅ Toggle favorite status
- ✅ View favorites only
- ✅ View analysis details
- ✅ Delete analysis
- ✅ Analytics dashboard
- ✅ Error type distribution
- ✅ Analysis trends
- ✅ Export analysis

## 🚀 Running Tests

### Prerequisites
```bash
# Install dependencies (already done if you ran npm install)
npm install

# Install Playwright browsers (if not already installed)
npx playwright install chromium
```

### Run Tests

**Headless mode** (CI/automated):
```bash
npm run test:e2e
```

**Headed mode** (see browser):
```bash
npm run test:e2e:headed
```

**UI Mode** (interactive test explorer):
```bash
npm run test:e2e:ui
```

**Debug mode** (step through tests):
```bash
npm run test:e2e:debug
```

**Run specific test file**:
```bash
npx playwright test tests/e2e/file-upload.spec.ts
```

**Run specific test**:
```bash
npx playwright test -g "should upload and analyze"
```

## 📁 Test Structure

```
tests/
├── e2e/
│   ├── file-upload.spec.ts   # File upload and analysis flows
│   ├── settings.spec.ts       # Settings panel functionality
│   └── history.spec.ts        # History and analytics features
├── fixtures/
│   └── sample-crash.log       # Sample crash log for testing
└── README.md                  # This file
```

## 🔧 Configuration

Tests are configured in `playwright.config.ts`:

- **Test directory**: `./tests/e2e`
- **Timeout**: 60 seconds per test
- **Base URL**: `http://localhost:1420` (Tauri dev server)
- **Retries**: 2 on CI, 0 locally
- **Screenshots**: On failure
- **Videos**: Retained on failure
- **Trace**: On first retry

## 📊 Test Reports

After running tests, view the HTML report:

```bash
npx playwright show-report
```

Reports include:
- Test results with pass/fail status
- Screenshots of failures
- Videos of failed tests
- Execution timeline

## 🐛 Debugging Tests

### Visual Debugging
```bash
npm run test:e2e:debug
```

This opens Playwright Inspector for step-by-step debugging.

### Check Selectors
Use Playwright codegen to validate selectors:
```bash
npx playwright codegen http://localhost:1420
```

### View Test Artifacts
Failed test artifacts are saved in:
- **Screenshots**: `test-results/`
- **Videos**: `test-results/`
- **Traces**: `test-results/`

## ✅ Best Practices

1. **Wait for elements**: Always use `await expect().toBeVisible()` instead of hard delays
2. **Use accessible selectors**: Prefer `role`, `label`, or `text` over CSS classes
3. **Independent tests**: Each test should be runnable in isolation
4. **Cleanup**: Tests should clean up their own data when possible
5. **Descriptive names**: Test names should clearly describe what they're testing

## 🔄 CI/CD Integration

### GitHub Actions Example
```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v3
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
```

## 🎭 Playwright Resources

- [Playwright Documentation](https://playwright.dev)
- [API Reference](https://playwright.dev/docs/api/class-playwright)
- [Best Practices](https://playwright.dev/docs/best-practices)
- [Debugging Guide](https://playwright.dev/docs/debug)

## 📝 Adding New Tests

1. Create a new `.spec.ts` file in `tests/e2e/`
2. Import test and expect from `@playwright/test`
3. Use `test.describe()` to group related tests
4. Write individual tests with `test('should...', async ({ page }) => {})`
5. Use descriptive test names that explain the behavior
6. Run tests locally before committing

## 🚨 Known Limitations

- Some tests require actual AI analysis which can take 10-60 seconds
- Tests assume dev server is running on `localhost:1420`
- Circuit breaker tests may be affected by provider availability
- File download tests require proper browser permissions

## 💡 Tips

- Run `npm run test:e2e:ui` for the best development experience
- Use `test.only()` to focus on a single test during development
- Check `playwright.config.ts` for timeout adjustments if tests are flaky
- Keep test data in `fixtures/` directory for reusability

---

**Last Updated**: 2025-11-14
**Test Coverage**: 35+ E2E tests
**Frameworks**: Playwright 1.56+, Vitest 2.1+
