# Crash Analysis Fixture Corpus

Shared test fixtures for evaluating crash analysis quality across both hadron-desktop and hadron-web.

## Fixtures

| # | File | Category | Difficulty | Key Challenge |
|---|------|----------|------------|---------------|
| 01 | clean-null-pointer | Clean crash | Easy | Straightforward nil reference |
| 02 | large-walkback | Large walkback | Medium | 30-frame stack, key clue in context args |
| 03 | ambiguous-root-cause | Ambiguous | Hard | Multiple competing causes (memory + DB locks) |
| 04 | memory-exhaustion | Memory | Medium | OOM importing 2GB CSV on 8GB server |
| 05 | database-deadlock | Database | Medium | SQL deadlock with full deadlock graph |
| 06 | whatson-namespace | WHATS'ON namespace | Medium | Version mismatch in namespace resolution |
| 07 | sentry-event | Sentry JSON | Medium | SSO timeout (different format than WCR) |
| 08 | noisy-low-signal | Low signal | Hard | Generic error, no useful stack, DB disconnected |
| 09 | historical-regression | Regression | Medium | Concurrent modification during collection iteration |
| 10 | multithread-deadlock | Multi-thread | Hard | Three-way circular lock dependency |

## Rubric format

Each `.rubric.json` contains:
- `category` — fixture category tag
- `expected_severity` — what a good analysis should conclude
- `expected_root_cause_category` — general root cause class
- `key_terms` — terms that should appear in a good analysis
- `expected_component` — the module/component at fault
- `notes` — human explanation of what makes this fixture interesting

## Usage

```bash
# Desktop eval
cargo run --bin eval -- --fixtures-dir tests/fixtures/crash-analysis --model gpt-4.1 --provider openai

# Web eval
cargo run --bin eval -- --fixtures-dir tests/fixtures/crash-analysis --model gpt-4.1
```

## Adding fixtures

1. Add `NN-short-name.txt` (crash log content)
2. Add `NN-short-name.rubric.json` (expected results)
3. Update this README table
