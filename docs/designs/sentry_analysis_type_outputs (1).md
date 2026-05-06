# Sentry Issue Analysis Types - Mock Outputs
**Source Issue:** WHATSON-4A7 (Sentry Issue ID: `3847291056`)  
**Analysis Framework:** analyze_sentry_issue.py

This document demonstrates the expected output format for each analysis type defined in the system, adapted for Sentry.io issue analysis. All examples use a single representative Sentry issue from a WHATS'ON production environment.

---

## 1. COMPLETE ANALYSIS (`analysis_type="complete"`)

### PART 1: STRUCTURED METADATA
```json
{
  "sentry": {
    "issue_id": "3847291056",
    "short_id": "WHATSON-4A7",
    "issue_url": "https://mediagenix.sentry.io/issues/3847291056/",
    "first_seen": "2025-04-18T09:14:22Z",
    "last_seen": "2025-04-28T14:47:03Z",
    "event_count": 37,
    "user_count": 5,
    "status": "unresolved",
    "priority": "high",
    "level": "error",
    "platform": "java",
    "assigned_to": null
  },

  "release": {
    "version": "whatson@2024r8.000.003a",
    "environment": "production",
    "first_release": "whatson@2024r8.000.002c",
    "deploy_label": "BBC-PROD-2025-04-18"
  },

  "tags": {
    "site": "BBC-Production",
    "server": "mgx-app-bbc-03",
    "oracle.version": "19c",
    "whatson.module": "CM2RUN",
    "browser.window": "G4BrowserCM2Run",
    "user.role": "planner",
    "session.window_count": "4"
  },

  "exception": {
    "type": "ORA-01652",
    "value": "unable to extend temp segment by 128 in tablespace TEMP",
    "mechanism": "oracleSQLException",
    "module": "MediaGeniX.OracleDatabaseConnector"
  },

  "top_frames": [
    "oracle.jdbc.driver.T4CTTIoer.processError(T4CTTIoer.java:450)",
    "oracle.jdbc.driver.T4CTTIoer.processError(T4CTTIoer.java:399)",
    "MediaGeniX.OOPLensQuery>>executeOn:",
    "MediaGeniX.G4BrowserCM2Run>>refreshBrowserContents",
    "MediaGeniX.G4Browser>>doSearch"
  ],

  "failing_component": "G4BrowserCM2Run",
  "failing_operation": "refreshBrowserContents (via doSearch)",

  "breadcrumbs": [
    { "timestamp": "14:46:41", "category": "ui.click", "message": "User clicked 'Search' in CM2Run browser" },
    { "timestamp": "14:46:41", "category": "query", "message": "OOPLensQuery building SELECT DISTINCT on CM2RUN" },
    { "timestamp": "14:46:42", "category": "db", "message": "Executing query against Oracle 19c — TEMP tablespace at 94% capacity" },
    { "timestamp": "14:47:03", "category": "db.error", "message": "ORA-01652: unable to extend temp segment by 128 in tablespace TEMP" }
  ],

  "contexts": {
    "oracle": {
      "temp_tablespace_size_gb": 32,
      "temp_usage_pct_at_crash": 100,
      "active_sessions": 48,
      "largest_temp_consumer_sid": 1247,
      "query_elapsed_sec": 21
    },
    "app": {
      "active_users": 23,
      "open_browsers": 67,
      "jvm_heap_used_mb": 3104,
      "jvm_heap_max_mb": 4096
    }
  },

  "fingerprint": ["ORA-01652", "TEMP", "CM2RUN", "G4Browser", "SELECT-DISTINCT"],

  "classification": "DATABASE — TEMP TABLESPACE EXHAUSTION",
  "severity": "critical"
}
```

### PART 2: ERROR CLASSIFICATION

**Type:** DATABASE — RESOURCE EXHAUSTION  
**Subtype:** Oracle TEMP Tablespace Overflow  
**Pattern:** SELECT DISTINCT on all projected columns in G4Browser subclass generates excessive TEMP usage

**Signature:** `ORA-01652 + TEMP + CM2RUN + G4BrowserCM2Run + OOPLensQuery`

**Sentry Fingerprint Rule:**
```python
# Custom fingerprint to group all TEMP exhaustion from G4Browser subclasses
fingerprint = ["ora-01652-temp-g4browser"]
```

### PART 3: USER ACTION RECONSTRUCTION

**Evidence Sources:**
- **Breadcrumbs:** ui.click → query build → db execute → db.error
- **Tags:** `browser.window=G4BrowserCM2Run`, `user.role=planner`
- **Stack Frames:** `doSearch` → `refreshBrowserContents` → `OOPLensQuery>>executeOn:`
- **Contexts (oracle):** TEMP at 100%, 48 active sessions, query ran 21 seconds before failure

**Inferred User Journey:**
1. User (planner role) logged into WHATS'ON BBC Production environment
2. Opened CM2Run browser (contract run management)
3. Entered search criteria or left filters broad
4. Clicked "Search" button to refresh browser contents
5. System built SELECT DISTINCT query on CM2RUN table via OOPLensQuery
6. Oracle attempted to sort/hash the DISTINCT result set in TEMP tablespace
7. TEMP tablespace (32 GB) was already at 94% from concurrent sessions
8. Query's incremental TEMP demand (128-extent request) exceeded remaining capacity
9. Oracle raised ORA-01652 → propagated as unhandled exception → Sentry captured event

**Behavioral Conclusion:**
User performed a routine search operation. The crash was caused by systemic TEMP tablespace pressure from the SELECT DISTINCT pattern across all active G4Browser sessions, not by any unusual user behavior.

### PART 4: ROOT CAUSE — TECHNICAL VIEW

**Primary Cause:**
The `OOPLensQuery` class generates `SELECT DISTINCT` on *all projected columns* (including OID, display fields, and sort columns) when building queries for any `G4Browser` subclass. On large tables like CM2RUN (millions of rows at BBC), the DISTINCT operation forces Oracle to create TEMP segment sort/hash areas. When multiple planners execute these queries concurrently, TEMP tablespace (32 GB) is exhausted.

**Causal Chain:**
1. **User Action:** User clicked "Search" in G4BrowserCM2Run
2. **Query Generation:** `OOPLensQuery>>executeOn:` built `SELECT DISTINCT col1, col2, ..., colN FROM CM2RUN WHERE ...`
3. **DISTINCT Scope:** All projected columns included in DISTINCT (not just OID)
4. **Oracle Execution Plan:** Full table sort/hash required for multi-column DISTINCT
5. **TEMP Allocation:** Oracle requested 128 additional extents in TEMP tablespace
6. **Resource Exhaustion:** TEMP tablespace at 100% — no extents available
7. **ORA-01652 Raised:** Oracle aborted the query
8. **Unhandled Exception:** Exception propagated through JDBC → OOPLensQuery → G4Browser → Sentry

**Why This Occurred:**
- `SELECT DISTINCT` on OID alone is logically equivalent (OID is unique), but query generates DISTINCT on all columns
- TEMP tablespace sized for lighter workload profile; concurrent browser usage has grown
- No query-level TEMP quota or resource profile limiting per-session consumption
- No circuit-breaker or fallback when TEMP pressure is high

### PART 5: ROOT CAUSE — FUNCTIONAL VIEW

**What User Experienced:**
User searched for contract runs and the application froze for ~21 seconds, then showed an error. Other users on the system may have experienced slowdowns simultaneously.

**Why It Happened (User Terms):**
The system's search function creates a database query that uses more temporary storage than available. When many users search at the same time, the shared temporary storage fills up and queries start failing.

**Business Context:**
BBC Production is one of the largest WHATS'ON deployments. During peak planning hours, 20+ users may have browser windows open simultaneously, each generating these expensive queries. The problem is structural — it will recur whenever concurrent usage exceeds a threshold relative to TEMP tablespace capacity.

### PART 6: DEVELOPER REMEDIATION

**P0 — IMMEDIATE FIX (Today):**

**Fix #1 — Change DISTINCT to OID-Only**
- **Location:** `OOPLensQuery>>buildSelectClause`
- **Issue:** Currently applies DISTINCT to all projected columns
- **Fix:**
  ```smalltalk
  buildSelectClause
    "Apply DISTINCT only to OID, then join back for display columns"
    ^'SELECT * FROM (SELECT DISTINCT t.OID FROM ', self tableName, ' t ',
      self whereClause, ') ids INNER JOIN ', self tableName, ' t ON ids.OID = t.OID'
  ```
- **Before:** `SELECT DISTINCT oid, col1, col2, ..., colN FROM CM2RUN WHERE ...` → massive TEMP sort
- **After:** `SELECT DISTINCT oid FROM CM2RUN WHERE ... → tiny TEMP sort, then join`
- **Rationale:** OID is unique; DISTINCT on OID alone is logically equivalent and reduces TEMP usage by orders of magnitude
- **Risk:** Low — semantically identical result set; verify no edge cases where duplicate OIDs are expected
- **Estimated Time:** 4 hours (including regression testing across all G4Browser subclasses)

**Fix #2 — Extend TEMP Tablespace (Operational)**
- **Action:** DBA extends TEMP tablespace as interim relief
  ```sql
  ALTER TABLESPACE TEMP ADD TEMPFILE '/u02/oradata/TEMP03.dbf' SIZE 16G AUTOEXTEND ON MAXSIZE 32G;
  ```
- **Before:** 32 GB TEMP, saturated under peak load
- **After:** 48–64 GB TEMP, buys time for code fix
- **Risk:** Very low — standard DBA operation, no downtime required

**P1 — SHORT-TERM IMPROVEMENTS (This sprint):**
1. Add Oracle Resource Manager profile to cap per-session TEMP consumption at 2 GB
2. Implement query timeout (30 seconds) in OOPLensQuery with user-friendly timeout message
3. Add TEMP tablespace usage metric to Sentry context on every query execution
4. Create Sentry alert rule: warn when TEMP > 80%, critical when > 95%

**P2 — LONG-TERM PREVENTION (Next release):**
1. Refactor OOPLensQuery to use server-side pagination (FETCH FIRST N ROWS ONLY)
2. Implement browser-level result caching to reduce redundant queries
3. Add query cost estimation — reject queries with estimated TEMP > threshold before execution
4. Create an index coverage audit for all G4Browser subclasses

### PART 7: USER/FUNCTIONAL REMEDIATION

**Immediate Workaround:**
- Narrow search criteria before clicking "Search" to reduce result set size
- Avoid peak hours (10:00–14:00) for large searches if possible
- If error recurs, wait 2–3 minutes for TEMP segments to be released, then retry

**User Guidance:**
Clear error message to show users:
```
"Search could not complete: the database is under heavy load. 
Try narrowing your search filters or retry in a few minutes. 
If this persists, contact support — reference WHATSON-4A7."
```

**Operational Fix:**
- DBA team should:
  1. Monitor TEMP tablespace usage via V$TEMP_SPACE_HEADER
  2. Extend TEMP tablespace to 64 GB as immediate relief
  3. Implement Oracle Resource Manager plan to prevent single-session runaway
  4. Schedule off-peak maintenance window for TEMP cleanup

**Data Cleanup (if needed):**
- No data cleanup required — failed queries rolled back automatically
- TEMP segments are released when sessions disconnect or queries complete/fail

### PART 8: REPRODUCTION STEPS

**To Reproduce:**
1. Connect to BBC Production (or equivalent large dataset)
2. Open 5+ G4BrowserCM2Run browser windows across different user sessions
3. In each browser, set broad or empty search criteria
4. Click "Search" in all browsers within a 30-second window
5. At least one session will fail with ORA-01652 when TEMP is exhausted

**Expected Behavior:**
- Query should complete using minimal TEMP (DISTINCT on OID only)
- OR: Query should timeout gracefully with user-friendly message
- OR: System should queue or throttle queries when TEMP pressure is high

**Actual Behavior:**
- Application shows unhandled error after ~21 second hang
- Sentry captures ORA-01652 event
- User must close and reopen the browser to recover

### PART 9: MONITORING & DETECTION

**Sentry Alert Rules to Configure:**

**Alert #1 — TEMP Exhaustion Spike**
```yaml
# sentry alert rule
conditions:
  - event.type: error
  - event.exception.type: "ORA-01652"
  - tags.whatson.module: ["CM2RUN", "CM2CONTRACT"]
actions:
  - notify: team-whatson-dba
  - priority: critical
frequency: 5 events in 10 minutes
```

**Alert #2 — G4Browser Query Timeout**
```yaml
conditions:
  - event.type: error
  - tags.browser.window: starts_with("G4Browser")
  - contexts.oracle.query_elapsed_sec: > 15
actions:
  - notify: team-whatson-backend
  - priority: high
frequency: 3 events in 5 minutes
```

**Custom Sentry Dashboard Widgets:**
- **Widget 1:** Time series — ORA-01652 events per hour, grouped by `tags.site`
- **Widget 2:** Table — Top 10 users by event count for this issue
- **Widget 3:** Bar chart — TEMP usage percentage distribution from `contexts.oracle.temp_usage_pct_at_crash`
- **Widget 4:** Event count by `tags.browser.window` — identifies which G4Browser subclass is most expensive

**Logging Enhancement (Sentry SDK):**
```python
# Add TEMP tablespace context to every query event
sentry_sdk.set_context("oracle", {
    "temp_usage_pct": get_temp_usage_percentage(),
    "active_sessions": get_active_session_count(),
    "query_sql_hash": hash(query_text),
    "estimated_temp_mb": estimate_query_temp(query_text)
})
```

### PART 10: SIMILAR ISSUES TO WATCH

**Sentry Issue Grouping:**
- Search for issues matching: `ORA-01652 OR (tags.browser.window:G4Browser* AND level:error)`
- Cross-reference with other G4Browser subclasses: G4BrowserCM2Contract, G4BrowserCM2MediaAsset
- Check if CM2CONTRACT table produces same pattern

**Pattern Signature:**
- `ORA-01652 + G4Browser* + OOPLensQuery` → same DISTINCT-on-all-columns structural defect
- `ORA-01652 + TEMP + any module` → TEMP capacity planning issue regardless of query source

**Related Known Issues:**
- All G4Browser subclasses share OOPLensQuery and will exhibit the same TEMP pressure
- Large report exports may also exhaust TEMP via different code paths
- Batch processing jobs running during business hours compete for TEMP

**Prevention Strategy:**
- Audit all OOPLensQuery consumers for DISTINCT scope
- Implement Sentry fingerprint rules to group all TEMP-related issues together
- Add TEMP usage as a custom Sentry metric for proactive alerting
- Create a "Database Health" Sentry dashboard covering TEMP, sessions, and long-running queries

---

## 2. PATTERN ANALYSIS (`analysis_type="pattern"`)

### PATTERN CLASSIFICATION
**Primary Pattern Type:** Systemic / Recurring  
**Confidence:** High  
**Pattern Signature:** `ORA-01652-TEMP-G4BROWSER-DISTINCT-ALL-COLUMNS`

### STATISTICAL PATTERNS IDENTIFIED (from Sentry Issue Data)

**Event Distribution:**
- **Total Events:** 37 over 10 days
- **Unique Users Affected:** 5
- **Environments:** production only
- **Releases Affected:** whatson@2024r8.000.002c, whatson@2024r8.000.003a (persists across releases)

**Time-of-Day Distribution (from Sentry event timestamps):**
```
06:00–09:00  ██░░░░░░░░  3 events  (8%)
09:00–12:00  ██████████  14 events (38%)
12:00–15:00  ████████░░  12 events (32%)
15:00–18:00  ██████░░░░  8 events  (22%)
18:00–06:00  ░░░░░░░░░░  0 events  (0%)
```

**Tag Correlation (Sentry tag facets):**
- **`tags.site`:** 100% BBC-Production (not seen on other sites)
- **`tags.browser.window`:** 78% G4BrowserCM2Run, 22% G4BrowserCM2Contract
- **`tags.user.role`:** 100% planner
- **`contexts.oracle.active_sessions`:** Mean 42, spikes to 55+ during failures

**Stack Trace Pattern:**
- **Common Frames (100% of events):**
  1. `oracle.jdbc.driver.T4CTTIoer.processError`
  2. `MediaGeniX.OOPLensQuery>>executeOn:`
  3. `MediaGeniX.G4Browser>>doSearch`
- **Frame Sequence Signature:** `ORACLE-TEMP-EXHAUST → OOPLENS-QUERY → G4BROWSER-SEARCH`
- **Variation Points:** Specific G4Browser subclass varies (CM2Run vs CM2Contract)

### TEMPORAL ANALYSIS

**Time Pattern:**
- **Occurrence Schedule:** Weekdays only, business hours (09:00–17:30)
- **Peak Window:** 10:00–14:00 (correlates with peak concurrent usage)
- **Trend Direction:** Increasing — 2 events in week 1, 8 events in week 2, trending higher
- **Frequency Estimate:** 3–5 events per business day, accelerating

**Temporal Triggers:**
- **Deployment Correlation:** First seen in whatson@2024r8.000.002c, persists in .003a — not deployment-caused
- **Load Correlation:** Strong correlation with active session count > 40
- **Day-of-Week Clustering:** Monday and Thursday peaks (heavier planning days at BBC)

### SIMILARITY TO KNOWN PATTERNS

**Sentry Issue Cross-Reference:**
- **Similar Issue #1:** WHATSON-3F2 — ORA-01652 on G4BrowserCM2Contract
  - **Similarity Score:** 0.92
  - **Shared:** Same OOPLensQuery path, same TEMP exhaustion mechanism
  - **Difference:** Different target table (CM2CONTRACT vs CM2RUN)

- **Similar Issue #2:** WHATSON-2B9 — Query timeout in G4BrowserCM2MediaAsset
  - **Similarity Score:** 0.71
  - **Shared:** Same G4Browser search pattern, same OOPLensQuery
  - **Difference:** Manifests as timeout rather than TEMP exhaustion (smaller table)

### CLUSTERING ANALYSIS

**Cluster Membership:** Yes — part of "G4Browser TEMP Exhaustion" cluster

**Cluster Details:**
- **Cluster ID:** `g4browser-temp-exhaust`
- **Sentry Issues in Cluster:** WHATSON-4A7, WHATSON-3F2, WHATSON-2B9
- **Combined Event Count:** 64 events across 3 issues
- **Combined User Count:** 8 unique users
- **Cluster Characteristics:**
  - All originate from G4Browser subclasses
  - All involve OOPLensQuery SELECT DISTINCT on all columns
  - All manifest under concurrent load (40+ sessions)
  - All limited to BBC-Production (largest dataset)

**Blast Radius:** All BBC planners using any G4Browser search during peak hours

### ROOT CAUSE HYPOTHESIS (Pattern-Based)

**Likely root cause class:** Structural query design defect — SELECT DISTINCT applied to all projected columns instead of OID-only

**Evidence from pattern:**
- 100% of events involve OOPLensQuery
- 100% occur on BBC-Production (largest dataset)
- 100% during high-concurrency periods
- Persists across releases (not a regression)
- Mathematically: DISTINCT on OID alone is equivalent (OID is unique) and uses negligible TEMP

**Confidence:** Very High (95%)

### PREDICTIVE INSIGHTS

**Future Occurrence Probability:**
- **Likelihood this pattern continues:** Near certain without code fix
- **Expected frequency:** Increasing — as BBC data volume grows, threshold for TEMP exhaustion drops
- **Expected severity:** Will escalate to blocking multiple users simultaneously
- **Tipping Point:** When daily CM2RUN row count exceeds ~4M, single-user queries may exhaust TEMP alone

**Early Warning Indicators (Sentry-detectable):**
- **Leading Metric:** `contexts.oracle.temp_usage_pct_at_crash` trending upward
- **Session Threshold:** Events spike when `contexts.oracle.active_sessions` > 40
- **Query Duration:** `contexts.oracle.query_elapsed_sec` increasing over time (TEMP contention causes slower sorts)

### PREVENTIVE RECOMMENDATIONS

**Pattern-Breaking Changes:**

**P0 — Immediate:**
1. Fix OOPLensQuery to use DISTINCT on OID only (eliminates root cause)
2. Extend TEMP tablespace to 64 GB (buys time)

**P1 — Short-term:**
1. Add per-session TEMP quota via Oracle Resource Manager
2. Implement query timeouts with graceful error handling
3. Add Sentry custom metrics for TEMP usage trends

**P2 — Long-term:**
1. Server-side pagination to eliminate large result set sorting
2. Query cost estimation and pre-execution rejection

**Sentry Detection & Monitoring Strategy:**
- **Metric to Track:** Event count for fingerprint `ora-01652-temp-g4browser` per hour
- **Alert Threshold:** > 3 events per hour → page DBA
- **Dashboard Widget:** Overlay of event count vs. `contexts.oracle.active_sessions` to visualize correlation
- **Anomaly Detection:** Sentry metric alert on `contexts.oracle.temp_usage_pct_at_crash` mean > 85%

### CROSS-PATTERN CORRELATION

**Related Sentry Issues to Investigate:**
- **ORA-04031 (shared pool exhaustion):** Different Oracle resource, but same concurrent-load trigger
- **JVM OutOfMemoryError on app server:** May correlate with same peak-usage windows
- **G4Browser UI timeout events:** Leading indicator of TEMP pressure (queries slow before they fail)

**Compound Pattern Risk:**
- If TEMP exhaustion coincides with JVM memory pressure, recovery time increases — users may see both database errors and application-level errors in rapid succession

---

## 3. RECOMMENDATIONS ANALYSIS (`analysis_type="recommendations"`)

### DETAILED REMEDIATION RECOMMENDATIONS

#### P0 — IMMEDIATE FIXES (Fix Today)

**Recommendation #1: Fix DISTINCT Scope in OOPLensQuery**
- **Priority:** P0 | **Impact:** Critical | **Effort:** Medium | **Risk:** Low

**Problem:** OOPLensQuery generates `SELECT DISTINCT col1, col2, ..., colN` on all projected columns for every G4Browser search. On large tables (CM2RUN at BBC: millions of rows), the multi-column DISTINCT forces Oracle to create massive TEMP sort segments. Under concurrent load, TEMP tablespace (32 GB) is exhausted.

**Mathematical Proof:**
- OID is the unique row identifier in CM2RUN
- `SELECT DISTINCT oid, col1, col2, ..., colN` ≡ `SELECT oid, col1, col2, ..., colN` (since OID is unique, no duplicate rows exist)
- Therefore, DISTINCT on all columns is logically redundant and only adds TEMP overhead
- DISTINCT on OID alone achieves identical deduplication with ~1/50th the sort width

**Proposed Fix:**
```smalltalk
OOPLensQuery>>buildSelectClause
  "DISTINCT on OID only, then join for display columns.
   Eliminates TEMP tablespace pressure from multi-column sort."
  | oidSubquery |
  oidSubquery := 'SELECT DISTINCT t.OID FROM ', self tableName, ' t ', self whereClause.
  ^'SELECT t.* FROM (', oidSubquery, ') ids INNER JOIN ', self tableName, ' t ON ids.OID = t.OID'
```

**Implementation Steps:**
1. Locate method: `OOPLensQuery>>buildSelectClause`
2. Replace multi-column DISTINCT with OID-only subquery + join
3. Run regression suite across all G4Browser subclasses
4. Verify identical result sets with before/after comparison on staging
5. Monitor Sentry for recurrence after deployment

**Validation:**
1. Execute both old and new queries on BBC staging with identical filters
2. Compare result sets — must be identical (row-for-row, column-for-column)
3. Compare TEMP usage: `SELECT * FROM V$TEMP_SPACE_HEADER` before and after
4. Load test: 10 concurrent G4Browser searches — no ORA-01652

**Before:**
```
User searches → SELECT DISTINCT all_columns → 800 MB TEMP per query → 5 concurrent = 4 GB → TEMP exhausted → ORA-01652 → Sentry event
```

**After:**
```
User searches → SELECT DISTINCT oid_only → 12 MB TEMP per query → 50 concurrent = 600 MB → TEMP healthy → results returned
```

**Risk Assessment:** Low
- Mathematically proven equivalent result set
- Uses standard SQL subquery pattern
- Falls back gracefully (worst case: slightly slower JOIN, still no TEMP issue)
- Does not change data model, permissions, or UI behavior

**Estimated Time:** 4–6 hours
- 1 hour: Code change and unit tests
- 2 hours: Regression testing across G4Browser subclasses
- 1 hour: Before/after TEMP usage validation on staging
- 1 hour: Code review, deployment, Sentry monitoring

**Dependencies:** None

**Sentry Verification:**
- After deployment, event count for WHATSON-4A7 should drop to zero
- Create Sentry alert: if new ORA-01652 event on this fingerprint → immediate notification
- Mark issue as "resolved in whatson@2024r8.000.004a" (or applicable release)

**Rollback Plan:** Simple code revert, no database changes

---

**Recommendation #2: Extend TEMP Tablespace (Operational — Immediate Relief)**
- **Priority:** P0 | **Impact:** High | **Effort:** Very Low | **Risk:** Very Low

**Problem:** 32 GB TEMP is insufficient for current BBC concurrent workload even without the DISTINCT fix.

**Proposed Fix:**
```sql
-- Add second TEMP datafile for immediate capacity doubling
ALTER TABLESPACE TEMP ADD TEMPFILE '/u02/oradata/bbcprod/temp03.dbf' 
  SIZE 16G AUTOEXTEND ON MAXSIZE 32G;

-- Verify
SELECT tablespace_name, SUM(bytes)/1024/1024/1024 AS size_gb 
FROM dba_temp_files GROUP BY tablespace_name;
```

**Implementation:** DBA operation, no downtime, immediate effect.

**Estimated Time:** 30 minutes (including verification)

---

#### P1 — SHORT-TERM IMPROVEMENTS (This Sprint)

**Recommendation #3: Add Oracle Resource Manager TEMP Quota**
- **Priority:** P1 | **Impact:** High | **Effort:** Medium

**Goal:** Prevent any single session from consuming more than a fair share of TEMP, so one expensive query can't starve all others.

**Implementation:**
```sql
-- Create resource plan limiting per-session TEMP
BEGIN
  DBMS_RESOURCE_MANAGER.CREATE_SIMPLE_PLAN(
    simple_plan => 'WHATSON_TEMP_PLAN',
    consumer_group1 => 'WHATSON_USERS',
    group1_temp_limit => 2048  -- 2 GB max TEMP per session
  );
END;
/
```

**Sentry Integration:**
- When session hits TEMP quota, raise a specific error code
- Capture in Sentry with tag `oracle.resource_manager=temp_quota_exceeded`
- Distinguish "single expensive query" from "aggregate TEMP exhaustion"

**Benefits:**
- No single query can exhaust TEMP for all users
- Graceful per-session failure instead of system-wide outage
- Sentry events become diagnostic (which queries are too expensive?) rather than emergency

**Estimated Time:** 1 day

---

**Recommendation #4: Add Query Timeout with Graceful Error Handling**
- **Priority:** P1 | **Impact:** Medium | **Effort:** Low

**Goal:** Queries that run longer than 30 seconds are likely in TEMP contention — fail fast with a user-friendly message instead of hanging.

**Implementation:**
```smalltalk
OOPLensQuery>>executeOn: aConnection
  "Execute with timeout and graceful error handling"
  | result |
  aConnection queryTimeout: 30.  "30 second limit"
  [result := super executeOn: aConnection]
    on: OracleSQLException
    do: [:ex |
      (ex errorCode = 1652 or: [ex errorCode = 1013]) ifTrue: [
        "TEMP exhaustion or timeout — show friendly message"
        Sentry captureMessage: 'Query timeout/TEMP exhaustion' 
          withContext: (self buildDiagnosticContext).
        Dialog warn: 'Search could not complete due to high system load. ',
                     'Try narrowing your filters or retry in a few minutes.'.
        ^OrderedCollection new  "Return empty results"
      ].
      ex pass  "Re-raise other SQL exceptions"
    ].
  ^result
```

**Estimated Time:** 4 hours

---

**Recommendation #5: Enrich Sentry Context for Database Operations**
- **Priority:** P1 | **Impact:** Medium | **Effort:** Low

**Goal:** Every database-related Sentry event should carry rich Oracle diagnostic context for faster triage.

**Implementation:**
```python
# In the JDBC wrapper / database connector
import sentry_sdk

def execute_query(connection, sql, params):
    # Capture pre-execution context
    sentry_sdk.set_context("oracle", {
        "temp_usage_pct": query_temp_usage(connection),
        "active_sessions": query_active_sessions(connection),
        "pga_usage_mb": query_pga_usage(connection),
        "query_sql_hash": hashlib.md5(sql.encode()).hexdigest()[:12],
        "query_table": extract_table_name(sql),
        "query_has_distinct": "DISTINCT" in sql.upper()
    })
    
    sentry_sdk.add_breadcrumb(
        category="db",
        message=f"Executing query on {extract_table_name(sql)}",
        data={"sql_hash": hashlib.md5(sql.encode()).hexdigest()[:12]},
        level="info"
    )
    
    return connection.execute(sql, params)
```

**Benefits:**
- Every Sentry event includes Oracle health snapshot at time of failure
- Enables Sentry dashboard widgets for TEMP usage trends
- Correlate application errors with database state without separate DBA investigation

**Estimated Time:** 1 day

---

#### P2 — ARCHITECTURAL IMPROVEMENTS (Next Quarter)

**Recommendation #6: Server-Side Pagination for G4Browser**
- **Priority:** P2 | **Impact:** Very High | **Effort:** High

**Strategic Goal:** Eliminate large result set processing entirely. Instead of fetching all matching rows and deduplicating, fetch pages of N rows using `FETCH FIRST N ROWS ONLY` / `OFFSET ... FETCH NEXT ...`.

**Current Architecture:**
```
User searches → SELECT DISTINCT * FROM CM2RUN WHERE ... → fetch ALL rows → display in grid
Problem: Unbounded result set, TEMP pressure, network transfer, JVM memory
```

**Proposed Architecture:**
```
User searches → SELECT * FROM CM2RUN WHERE ... ORDER BY ... FETCH FIRST 100 ROWS ONLY → display page
User scrolls → OFFSET 100 FETCH NEXT 100 → display next page
Benefit: Bounded TEMP, bounded memory, instant response
```

**Migration Path:**
- **Phase 1 (Month 1):** Create pagination-capable query builder alongside OOPLensQuery
- **Phase 2 (Month 2–3):** Retrofit G4Browser base class to use paginated queries
- **Phase 3 (Month 4):** Roll out to all G4Browser subclasses, remove old SELECT DISTINCT path

**Estimated Time:** 3–4 months (full team effort)

---

### SENTRY MONITORING & ALERTING STRATEGY

#### Alert Rules (configure in Sentry):

**1. Issue Alert — TEMP Exhaustion Recurrence**
```yaml
name: "ORA-01652 TEMP Exhaustion"
conditions:
  - type: event_frequency
    value: 3
    interval: 1h
filters:
  - type: tagged_event
    key: "exception.type"
    match: "eq"
    value: "ORA-01652"
actions:
  - type: notify_email
    targetType: team
    targetIdentifier: whatson-dba
  - type: slack
    channel: "#whatson-prod-alerts"
```

**2. Metric Alert — TEMP Usage Trending High**
```yaml
name: "TEMP Usage Above 80%"
dataset: custom_metrics
query: "avg(oracle.temp_usage_pct) > 80"
time_window: 15m
resolve_threshold: 70
actions:
  - type: slack
    channel: "#whatson-dba"
```

**3. Issue Alert — G4Browser Errors Spiking**
```yaml
name: "G4Browser Error Spike"
conditions:
  - type: event_frequency
    value: 10
    interval: 30m
filters:
  - type: tagged_event
    key: "browser.window"
    match: "starts_with"
    value: "G4Browser"
actions:
  - type: pagerduty
    service: whatson-l2-support
```

#### Sentry Dashboard: "WHATS'ON Database Health"

| Widget | Type | Query |
|---|---|---|
| ORA-01652 Events/Hour | Time Series | `exception.type:ORA-01652` grouped by `tags.site` |
| TEMP Usage Distribution | Bar Chart | Custom metric: `oracle.temp_usage_pct` histogram |
| Top Affected Users | Table | Issue WHATSON-4A7, group by `user.username` |
| G4Browser Errors by Subclass | Pie Chart | `tags.browser.window:G4Browser*` group by tag |
| Query Duration Percentiles | Time Series | Custom metric: `oracle.query_elapsed_sec` p50, p95, p99 |
| Active Sessions vs. Error Rate | Overlay | `oracle.active_sessions` metric vs. event count |

---

### TESTING STRATEGY

#### Unit Tests:
- **Test:** `testOOPLensQueryDistinctOnOidOnly`
  - Verify generated SQL uses DISTINCT only on OID column
  - Assert no multi-column DISTINCT in output

- **Test:** `testQueryTimeoutHandledGracefully`
  - Simulate query timeout (mock 30s delay)
  - Verify user-friendly dialog shown, no exception propagation
  - Verify Sentry event captured with diagnostic context

#### Integration Tests:
- **Test:** `testConcurrentG4BrowserSearchNoTempExhaustion`
  - 10 concurrent G4BrowserCM2Run searches with broad criteria
  - Monitor TEMP usage — should stay under 20%
  - All searches should complete without ORA-01652

#### Load Tests:
- **Test:** `testPeakLoadBBCSimulation`
  - Simulate 50 concurrent users with BBC Production data volume
  - Mix of CM2Run, CM2Contract, and CM2MediaAsset browsers
  - Monitor TEMP, PGA, and query latency
  - Zero ORA-01652 events in Sentry

---

### IMPLEMENTATION ROADMAP

**Week 1:**
- P0 fixes deployed: OOPLensQuery DISTINCT fix + TEMP extension
- Sentry alerts configured
- Monitor for recurrence (target: 0 events)

**Week 2–3:**
- Resource Manager TEMP quota implemented
- Query timeout handling deployed
- Sentry context enrichment live
- Custom Sentry dashboard operational

**Quarter:**
- Server-side pagination design complete
- Phase 1 implementation started
- G4Browser pagination POC on staging

---

### SUCCESS METRICS (Sentry-Measurable)

| Metric | Current | Target | Sentry Query |
|---|---|---|---|
| ORA-01652 events/week | 18+ | 0 | `exception.type:ORA-01652` |
| Mean TEMP usage at query time | 87% | < 40% | `avg(oracle.temp_usage_pct)` |
| G4Browser search p95 latency | 21s | < 3s | `p95(oracle.query_elapsed_sec)` |
| Users blocked per week | 5 | 0 | Issue WHATSON-4A7 user count |

---

## 4. MEMORY ANALYSIS (`analysis_type="memory"` or `"memory/leak"`)

### MEMORY FORENSICS ANALYSIS

**Note:** This analysis examines the memory-related context captured by Sentry for this issue. Since Sentry captures JVM heap state, runtime contexts, and tag metadata, memory analysis focuses on application-level memory health rather than database-side TEMP (covered in the complete analysis).

#### ROOT CAUSE
**Cause:** No application memory leak detected — this is a database TEMP tablespace exhaustion issue, not a JVM memory problem.

**JVM Memory Profile (from Sentry contexts):**
- **Heap Used:** 3,104 MB of 4,096 MB max (75.8% — within normal range)
- **Heap Trend:** Stable across events (no upward drift indicating leak)
- **Open Browsers:** 67 (each holds result set references)

#### ANALYSIS

The Sentry event contexts show the JVM is healthy. However, there are indirect memory concerns worth monitoring:

**JVM Impact of Large Result Sets:**
- Each G4Browser holds its full result set in memory
- 67 open browsers × average result set = significant heap pressure
- If DISTINCT fix reduces result set sizes, JVM heap usage will also improve

**Sentry Memory Context Review:**
```json
{
  "contexts.app.jvm_heap_used_mb": 3104,
  "contexts.app.jvm_heap_max_mb": 4096,
  "contexts.app.open_browsers": 67,
  "contexts.app.active_users": 23
}
```

**Memory Leak Indicators (all negative):**
- Heap usage is not monotonically increasing across events
- No `OutOfMemoryError` events in Sentry for this release
- GC pause times (if captured) are within normal range

#### RECOMMENDATION

**For this specific issue:** No JVM memory remediation needed. The root cause is Oracle TEMP exhaustion.

**Proactive Sentry enhancements for memory monitoring:**
1. Add custom Sentry metric: `jvm.heap.used_mb` — enables time-series dashboards
2. Add breadcrumb on GC events: `sentry_sdk.add_breadcrumb(category="gc", message=f"GC pause {pause_ms}ms")`
3. Set Sentry metric alert: `avg(jvm.heap.used_mb) > 3500` for 15 minutes → warn
4. Tag events with `jvm.heap_pct` for correlation analysis

**If memory analysis WERE needed, this tool would extract from Sentry:**
1. `contexts.runtime` — JVM version, heap settings
2. Custom metrics — heap usage over time, GC frequency
3. Breadcrumbs — GC events, large allocation warnings
4. Tag correlation — which user actions precede high-memory events
5. Release comparison — heap usage before/after deployments

---

## 5. DATABASE ANALYSIS (`analysis_type="db"` or `"db/connectivity"`)

### DATABASE CONNECTIVITY & QUERY ANALYSIS

#### ROOT CAUSE
**Database Issue:** Oracle TEMP tablespace exhaustion caused by structurally expensive SELECT DISTINCT queries.

**Connection State (from Sentry tags and contexts):**
- **Database Server:** Oracle 19c Enterprise Edition
- **Connection String:** BBC-Production (mgx-db-bbc:1521/bbcprod)
- **Connection Status:** Established — connection itself is healthy
- **Encoding:** No mismatch indicators in Sentry context

**Query State (from Sentry breadcrumbs and contexts):**
- **Query Origin:** `OOPLensQuery>>executeOn:` → G4BrowserCM2Run
- **Query Type:** SELECT DISTINCT on CM2RUN (all projected columns)
- **Query Duration:** 21 seconds before ORA-01652
- **TEMP Usage at Failure:** 100% of 32 GB tablespace

#### ANALYSIS

This IS a database issue — specifically, a query design problem that causes resource exhaustion under load.

**Query Forensics (reconstructed from Sentry stack + breadcrumbs):**
```sql
-- Approximate generated query (from OOPLensQuery pattern)
SELECT DISTINCT 
  t.OID, t.TITLE, t.CHANNEL_OID, t.START_DATE, t.END_DATE,
  t.STATUS, t.CONTRACT_OID, t.RUN_NUMBER, t.CREATED_BY, 
  t.CREATED_DATE, t.MODIFIED_BY, t.MODIFIED_DATE
  -- ... potentially 30+ columns
FROM CM2RUN t
WHERE t.CHANNEL_OID IN (SELECT OID FROM CHANNEL WHERE ...)
  AND t.START_DATE BETWEEN :startDate AND :endDate
ORDER BY t.START_DATE, t.TITLE
```

**Why This Query Exhausts TEMP:**
1. DISTINCT on 30+ columns forces full-row sort/hash
2. CM2RUN at BBC has millions of rows — even filtered, result set is large
3. Sort area exceeds PGA, spills to TEMP
4. Multiple concurrent queries compound TEMP consumption
5. 32 GB TEMP saturated → ORA-01652

**Oracle Execution Plan Issues (inferred):**
- **Missing Indexes:** Likely no composite index on (CHANNEL_OID, START_DATE)
- **DISTINCT Cost:** Full-width sort on all projected columns — extremely expensive
- **No TEMP Quota:** Single query can consume unlimited TEMP

#### IMMEDIATE ACTIONS (P0):

1. **Fix DISTINCT scope** — change to OID-only (see Recommendation #1)
2. **Extend TEMP tablespace** — add 16–32 GB capacity
3. **Verify index coverage:**
   ```sql
   -- Check for missing indexes on CM2RUN filter columns
   SELECT index_name, column_name, column_position
   FROM all_ind_columns 
   WHERE table_name = 'CM2RUN'
   ORDER BY index_name, column_position;
   
   -- Recommended missing indexes:
   CREATE INDEX IDX_CM2RUN_CHANNEL_DATE ON CM2RUN(CHANNEL_OID, START_DATE);
   CREATE INDEX IDX_CM2RUN_STATUS ON CM2RUN(STATUS) WHERE STATUS IN ('ACTIVE','PLANNED');
   ```

#### QUERY OPTIMIZATION (P1):

1. **Replace DISTINCT with subquery pattern:**
   ```sql
   SELECT t.* FROM (
     SELECT DISTINCT t.OID FROM CM2RUN t WHERE <filters>
   ) ids INNER JOIN CM2RUN t ON ids.OID = t.OID
   ORDER BY t.START_DATE, t.TITLE
   ```
   **Expected TEMP reduction:** ~98% (single-column sort vs. 30-column sort)

2. **Add query hints for TEMP management:**
   ```sql
   SELECT /*+ OPT_PARAM('_smm_auto_max_io_size','256') */ ...
   ```

3. **Add server-side pagination:**
   ```sql
   ... ORDER BY t.START_DATE OFFSET 0 ROWS FETCH FIRST 100 ROWS ONLY
   ```

#### DATA INTEGRITY:
- **Transaction Risk:** None — SELECT queries don't modify data
- **Recovery Action:** Not required — failed queries rolled back automatically

#### SENTRY MONITORING:
```yaml
# Sentry metric alert for TEMP pressure
name: "Oracle TEMP Above 80%"
query: "avg(d:custom/oracle.temp_usage_pct@ratio{}) > 0.8"
time_window: 10m
actions:
  - slack: "#whatson-dba"
```

---

## 6. PERFORMANCE ANALYSIS (`analysis_type="performance"` or `"performance/timeout"`)

### PERFORMANCE PROFILING & OPTIMIZATION

#### ROOT CAUSE
**Performance Issue:** YES — query execution time of 21 seconds before failure indicates severe performance degradation. Even if TEMP were sufficient, the query is orders of magnitude slower than acceptable.

**Performance Profile (from Sentry contexts and breadcrumbs):**
- **User-Perceived Latency:** 21+ seconds (from breadcrumb timestamps: click at 14:46:41, error at 14:47:03)
- **Acceptable Latency:** < 3 seconds for interactive search
- **Slowest Component:** Oracle DISTINCT sort operation in TEMP tablespace
- **Resource Bottleneck:** TEMP tablespace I/O (TEMP was at 94% when query started)

#### ANALYSIS

**Latency Breakdown (inferred from Sentry breadcrumbs):**

| Phase | Duration | Bottleneck |
|---|---|---|
| UI → Query Build | < 100ms | None |
| Query Build → Execute | < 100ms | None |
| Oracle Parse + Optimize | ~500ms | Possible (complex DISTINCT plan) |
| Oracle Execute (TEMP sort) | ~20 seconds | **PRIMARY BOTTLENECK** |
| TEMP exhaustion → error | < 100ms | N/A (failure) |

**Why Performance is Degraded:**
1. **DISTINCT on all columns** forces Oracle to sort/hash the full row width
2. **TEMP contention** from concurrent queries causes I/O wait (other sessions' TEMP segments)
3. **No index-driven DISTINCT** possible (Oracle can't use index for multi-column DISTINCT)
4. **Large result set** — even filtered, BBC's CM2RUN returns thousands of rows

**Sentry Performance Tracing (if enabled):**
```python
# Recommended: Add Sentry performance spans to query execution
with sentry_sdk.start_span(op="db.query", description="G4Browser search"):
    with sentry_sdk.start_span(op="db.query.build"):
        sql = query.buildSQL()
    with sentry_sdk.start_span(op="db.query.execute"):
        results = connection.execute(sql)
    with sentry_sdk.start_span(op="db.query.fetch"):
        rows = results.fetchAll()
```

#### IMMEDIATE OPTIMIZATIONS (P0):

1. **Fix DISTINCT scope** (see Recommendation #1)
   - **Expected impact:** Query time 21s → < 1s
   - **Measurement:** Compare `contexts.oracle.query_elapsed_sec` before/after in Sentry

2. **Add missing indexes** (see Database Analysis)
   - **Expected impact:** Further 2–5x speedup on filtered queries

#### PERFORMANCE MONITORING (P1):

**Sentry Performance Metrics to Track:**
```python
# Custom performance metrics
sentry_sdk.metrics.distribution(
    "whatson.query_duration_ms",
    value=query_elapsed_ms,
    tags={
        "browser": browser_class_name,
        "table": table_name,
        "has_distinct": str("DISTINCT" in sql)
    }
)
```

**Sentry Dashboard: "WHATS'ON Query Performance"**

| Widget | Type | Metric |
|---|---|---|
| Search Latency p50/p95/p99 | Time Series | `whatson.query_duration_ms` by percentile |
| Slow Queries (>5s) | Table | Events where `oracle.query_elapsed_sec > 5` |
| Latency by Browser Type | Bar Chart | `whatson.query_duration_ms` grouped by `tags.browser` |
| Before/After Fix Comparison | Time Series | `whatson.query_duration_ms` split by release |

#### EXPECTED IMPACT:
After DISTINCT fix:
- **p50 latency:** 21s → ~0.5s
- **p95 latency:** 21s+ → ~2s
- **TEMP usage per query:** ~800 MB → ~12 MB
- **Concurrent capacity:** ~4 simultaneous queries → 200+ simultaneous queries

---

## 7. ROOT CAUSE ANALYSIS (DEEP) (`analysis_type="root_cause"`)

### DEEP ROOT CAUSE ANALYSIS — FORENSIC INVESTIGATION

#### STEP 1: FAILURE POINT IDENTIFICATION

**Exact Failure Location (from Sentry stack trace):**
- **Exception Type:** ORA-01652 (wrapped in OracleSQLException)
- **Origin:** Oracle JDBC driver → `T4CTTIoer.processError`
- **Application Frame:** `MediaGeniX.OOPLensQuery>>executeOn:`
- **Calling Context:** `MediaGeniX.G4BrowserCM2Run>>refreshBrowserContents`
- **User Trigger:** `MediaGeniX.G4Browser>>doSearch` (UI action handler)
- **Sentry Event ID:** `a4f7c8d9e2b14a3f8c9d0e1f2a3b4c5d`

**Sentry Issue Metadata:**
- **First Seen:** 2025-04-18T09:14:22Z
- **Events:** 37 over 10 days
- **Users Affected:** 5
- **Releases:** whatson@2024r8.000.002c through .003a (persists across deployments)

#### STEP 2: CAUSAL CHAIN RECONSTRUCTION (5 Whys)

**Why Level 1 (Immediate):** What immediate condition triggered the failure?
→ Oracle could not allocate 128 additional extents in TEMP tablespace. The tablespace was at 100% capacity when the query's sort operation required more space.

**Why Level 2 (Precondition):** Why was TEMP tablespace full?
→ Multiple concurrent sessions were executing SELECT DISTINCT queries on large tables (CM2RUN, CM2CONTRACT). Each query consumed hundreds of megabytes of TEMP for full-width row sorting. With 48 active sessions, cumulative TEMP demand exceeded 32 GB.

**Why Level 3 (Design):** Why do queries consume so much TEMP?
→ `OOPLensQuery` generates `SELECT DISTINCT` on *all projected columns* (30+ columns) instead of just the unique identifier (OID). Multi-column DISTINCT requires Oracle to sort/hash the full row width, which is orders of magnitude more expensive than single-column DISTINCT.

**Why Level 4 (Architecture):** Why is DISTINCT applied to all columns?
→ The OOPLensQuery class was designed generically — it applies DISTINCT uniformly to prevent duplicate rows in browser displays. The implementation doesn't distinguish between "DISTINCT for deduplication" (needs OID only) and "DISTINCT for aggregation" (needs all columns). Since OID is unique per row, DISTINCT on all columns is logically redundant but computationally expensive.

**Why Level 5 (Process):** Why wasn't this caught before?
→ The query worked correctly (and quickly) on smaller datasets and lower-concurrency environments. BBC Production is the largest WHATS'ON deployment — the combination of data volume + concurrent users created TEMP pressure that doesn't manifest in development, staging, or smaller client environments. No performance benchmarking existed for BBC's specific data profile.

#### STEP 3: HYPOTHESIS TESTING

**Hypothesis A: Structural Query Defect — DISTINCT on All Columns (SELECTED)**
- **Supporting Evidence:**
  - Stack trace confirms OOPLensQuery as query source (100% of events)
  - All 37 events involve G4Browser subclass searches (breadcrumb: ui.click → doSearch)
  - TEMP at 100% at time of every event (contexts.oracle.temp_usage_pct_at_crash = 100)
  - Mathematical proof: DISTINCT on OID alone is equivalent for tables with unique OID
  - Issue persists across releases (not a regression from code change)
  - Issue only affects BBC (largest dataset — other sites have smaller tables)
- **Contradicting Evidence:**
  - None significant
- **Confidence:** 97%
- **Conclusion:** Root cause confirmed — fix DISTINCT scope

**Hypothesis B: Undersized TEMP Tablespace**
- **Supporting Evidence:**
  - 32 GB TEMP may be insufficient for 48+ concurrent sessions
  - BBC workload has grown over time (more users, more data)
- **Contradicting Evidence:**
  - Fixing the DISTINCT scope would reduce per-query TEMP by ~98%, making 32 GB more than sufficient
  - TEMP sizing is a symptom, not the root cause — the queries are structurally over-consuming
- **Confidence:** 60% (contributing factor, not root cause)
- **Conclusion:** TEMP extension is good practice but treats the symptom

**Hypothesis C: Missing Indexes Causing Full Table Sort**
- **Supporting Evidence:**
  - No evidence of composite indexes on CM2RUN filter columns
  - Without index-driven access, Oracle must scan + sort more rows
- **Contradicting Evidence:**
  - Even with perfect indexes, DISTINCT on all columns still requires TEMP for the sort/hash
  - Index improvement would reduce rows but not eliminate TEMP usage
- **Confidence:** 45% (contributing factor)
- **Conclusion:** Add indexes as complementary optimization, not primary fix

**Hypothesis D: Concurrent Load Spike / Unusual Usage Pattern**
- **Supporting Evidence:**
  - Events cluster during 09:00–14:00 (peak hours)
  - Active sessions > 40 correlates with failures
- **Contradicting Evidence:**
  - Usage patterns are consistent and expected for BBC planning operations
  - This is normal load, not a spike — the system should handle it
- **Confidence:** 20% (trigger, not cause)
- **Conclusion:** Load is normal; the system should handle normal load without failing

**Selected Hypothesis:** A — Structural query defect (DISTINCT on all columns)

#### STEP 4: IMPACT ZONES

**Affected Code Paths (from Sentry stack traces):**
1. All G4Browser subclasses that call `doSearch` → `refreshBrowserContents`
2. OOPLensQuery — shared by every G4Browser subclass
3. Any future component that uses OOPLensQuery for data retrieval

**Sentry Issue Cross-References:**
- WHATSON-3F2 (G4BrowserCM2Contract — same pattern, different table)
- WHATSON-2B9 (G4BrowserCM2MediaAsset — similar but manifests as timeout)

**Blast Radius:**
- **Users Affected:** All users performing searches in any G4Browser during peak hours at BBC
- **Operations Affected:** Every search/refresh in CM2Run, CM2Contract, CM2MediaAsset browsers
- **Sites at Risk:** BBC-Production (immediate), FranceTV and VRT (as data volumes grow)
- **Frequency:** Daily, increasing with data volume and user count

#### STEP 5: DEFINITIVE ROOT CAUSE STATEMENT

**Technical Root Cause:**
The `OOPLensQuery` class generates `SELECT DISTINCT` on all projected columns (30+) for every G4Browser search query. Since the row identifier (OID) is unique, DISTINCT on all columns is logically equivalent to DISTINCT on OID alone, but forces Oracle to sort/hash the full row width in TEMP tablespace. On BBC Production (the largest deployment, with millions of rows in CM2RUN and 48+ concurrent sessions), cumulative TEMP consumption from concurrent searches exceeds the 32 GB tablespace capacity, triggering ORA-01652. The defect is structural — it exists in the shared OOPLensQuery class and affects all G4Browser subclasses uniformly.

**Systemic Root Cause:**
The application lacks performance-aware query generation. OOPLensQuery was designed for correctness (prevent duplicates) without considering the database resource cost of its approach at scale. No performance benchmarking, query cost estimation, or resource quota mechanisms exist to detect or prevent expensive queries before they impact the system. Sentry monitoring was not configured to capture database-level resource metrics, so the degradation was invisible until it caused outright failures.

#### STEP 6: EVIDENCE SUMMARY

**Direct Evidence (from Sentry):**
- Stack trace: `OOPLensQuery>>executeOn:` → `G4BrowserCM2Run>>refreshBrowserContents` (100% of events)
- Exception: ORA-01652 (TEMP exhaustion) — unambiguous database resource error
- Context: `contexts.oracle.temp_usage_pct_at_crash = 100` in every event
- Tags: `browser.window=G4BrowserCM2Run` (78%), `G4BrowserCM2Contract` (22%)
- Breadcrumbs: User clicks Search → query builds → TEMP saturates → ORA-01652

**Circumstantial Evidence:**
- Events only on BBC-Production (largest dataset)
- Events only during business hours (peak concurrent usage)
- 5 unique users affected (rules out user-specific account issue)
- Persists across releases (rules out regression)

**Mathematical Evidence:**
- Given OID uniqueness: `SELECT DISTINCT oid, col1, ..., colN` ≡ `SELECT oid, col1, ..., colN`
- Therefore: DISTINCT on all columns is provably redundant
- TEMP cost ratio: ~800 MB (all columns) vs. ~12 MB (OID only) per query

#### STEP 7: FIX VERIFICATION STRATEGY

**Proposed Fix:**
Change OOPLensQuery to use DISTINCT on OID only with JOIN for remaining columns (see Recommendation #1).

**Sentry-Based Verification:**

1. **Pre-Fix Baseline (capture now):**
   - Event count for WHATSON-4A7: 37 events / 10 days
   - Mean `contexts.oracle.temp_usage_pct_at_crash`: 100%
   - Mean `contexts.oracle.query_elapsed_sec`: 21s

2. **Post-Fix Monitoring (after deployment):**
   - **Mark issue as resolved** in Sentry with release `whatson@2024r8.000.004a`
   - **Regression alert:** If WHATSON-4A7 receives new events after resolution → auto-reopen + page team
   - **Expected:** Zero new events
   - **Monitoring window:** 14 days post-deployment

3. **Performance Verification (Sentry metrics):**
   - `whatson.query_duration_ms` p95 for G4Browser searches: should drop from 21s+ to < 3s
   - `oracle.temp_usage_pct` mean during peak hours: should drop from 87% to < 30%
   - `oracle.active_sessions` should remain stable (proving queries are faster, not fewer)

4. **Load Test Verification:**
   - Simulate BBC peak load (50 concurrent G4Browser searches) on staging
   - Monitor TEMP: should stay under 20%
   - All queries should complete in < 5 seconds
   - Zero Sentry events generated

**Success Criteria:**
- ✓ Zero ORA-01652 events in Sentry for 14 days post-deployment
- ✓ G4Browser search p95 latency < 3 seconds (Sentry performance metric)
- ✓ Peak TEMP usage < 40% during business hours (Sentry custom metric)
- ✓ No regression in result set correctness (automated comparison test)
- ✓ Sentry issue WHATSON-4A7 remains resolved

---

## 8. GENERAL ANALYSIS (`analysis_type="general"`)

### COMPREHENSIVE ISSUE ANALYSIS — SYSTEMATIC INVESTIGATION PROTOCOL

#### PHASE 1: IMMEDIATE CONTEXT ANALYSIS

**Sentry Issue Overview:**
- **Issue:** WHATSON-4A7 — `ORA-01652: unable to extend temp segment by 128 in tablespace TEMP`
- **Level:** Error
- **Platform:** Java (VisualWorks Smalltalk via JDBC bridge)
- **First Seen:** 2025-04-18 | **Last Seen:** 2025-04-28
- **Events:** 37 | **Users:** 5 | **Status:** Unresolved

**Failing Component:** G4BrowserCM2Run (contract run management browser)
**Failing Operation:** refreshBrowserContents triggered by user search
**Execution State:** Active user session, interactive search operation

**Context:**
- Environment: BBC-Production
- Time pattern: Business hours only (09:00–17:30)
- Trend: Increasing frequency (2/week → 8/week)
- Concurrent sessions at failure: Mean 42, max 55

#### PHASE 2: ROOT CAUSE DETERMINATION (5 Whys)

1. **Why did this error occur?**
   → Oracle TEMP tablespace was full when a G4Browser search query needed TEMP for sorting

2. **Why was TEMP full?**
   → Multiple concurrent queries were consuming hundreds of MB each for SELECT DISTINCT sorting

3. **Why are queries so TEMP-hungry?**
   → OOPLensQuery applies DISTINCT to all 30+ projected columns instead of just the unique OID

4. **Why is DISTINCT on all columns?**
   → Generic implementation didn't account for OID uniqueness — applies DISTINCT uniformly

5. **Why wasn't this caught before?**
   → Smaller deployments don't hit the TEMP threshold; no performance benchmarking for BBC's scale

#### PHASE 3: IMPACT ASSESSMENT

**Severity:** Critical
**Justification:**
- Causes complete workflow interruption for searching users
- Affects all G4Browser searches during peak hours at BBC
- Increasing in frequency as data grows
- Collateral impact: TEMP contention slows ALL database operations, not just the failing query
- 5 users affected directly, but all 23 active BBC users experience degraded performance

**Affected Systems:**
- All G4Browser subclasses (CM2Run, CM2Contract, CM2MediaAsset, etc.)
- OOPLensQuery (shared query builder)
- Oracle TEMP tablespace (shared database resource)

**Risk Factors:**
- **Data Risk:** None — queries are read-only, failures roll back cleanly
- **Cascading Risk:** HIGH — TEMP exhaustion affects ALL concurrent database operations
- **Business Risk:** High — planners cannot search during peak hours, blocking schedule management
- **Trend Risk:** Worsening — BBC data grows monthly, lowering the threshold for TEMP exhaustion

**Blast Radius:**
- Users: All BBC planners using G4Browser during peak hours
- Frequency: Multiple times per day, trending upward
- Workaround: Narrow search criteria, avoid peak hours (limited effectiveness)

#### PHASE 4: ACTIONABLE RECOMMENDATIONS

**IMMEDIATE (Fix Now — P0):**

1. **Fix DISTINCT Scope in OOPLensQuery**
   - Change to DISTINCT on OID only with JOIN for display columns
   - Expected result: ~98% reduction in per-query TEMP consumption
   - Time: 4–6 hours

2. **Extend TEMP Tablespace**
   - Add 16–32 GB TEMP capacity as immediate relief
   - Expected result: Higher tolerance for concurrent queries until code fix deployed
   - Time: 30 minutes (DBA operation)

3. **Configure Sentry Alerts**
   - Alert on ORA-01652 recurrence after fix deployment
   - Alert on TEMP usage > 80%
   - Time: 1 hour

**SHORT-TERM (This Sprint — P1):**

1. **Query Timeout + Graceful Error Handling**
   - 30-second timeout with user-friendly message
   - Sentry event with diagnostic context on timeout
   - Time: 4 hours

2. **Oracle Resource Manager TEMP Quota**
   - Cap per-session TEMP at 2 GB
   - Prevents single query from starving others
   - Time: 1 day

3. **Sentry Context Enrichment**
   - Add Oracle health metrics to every database event
   - Enable trend dashboards and proactive alerting
   - Time: 1 day

**LONG-TERM (Architecture — P2):**

1. **Server-Side Pagination**
   - Eliminate unbounded result sets entirely
   - `FETCH FIRST N ROWS ONLY` pattern
   - Time: 3–4 months

2. **Query Cost Estimation**
   - Pre-execution check: estimated TEMP > threshold → reject with message
   - Time: 2 months

#### PATTERNS & PREVENTIVE INSIGHTS

**Patterns Observed (via Sentry):**
- 100% correlation: G4Browser search → OOPLensQuery → TEMP exhaustion
- Time clustering: peak business hours (09:00–14:00)
- Site isolation: BBC-Production only (largest dataset)
- Release persistence: spans multiple releases (not a regression)

**Similar Sentry Issues to Monitor:**
- Any new issue with `exception.type: ORA-01652`
- Any G4Browser error spike (`tags.browser.window: G4Browser*`)
- Query timeout events (`contexts.oracle.query_elapsed_sec > 15`)

**Prevention Strategy:**
- Implement "query budget" design principle — every query should have a bounded resource cost
- Add Sentry performance tracing to all database operations
- Benchmark all G4Browser queries against BBC-scale data before release
- Create automated load test in CI that simulates 50 concurrent BBC users

---

## Summary

This document demonstrates the expected output format for **8 different analysis types** adapted for Sentry.io issue analysis:

1. **complete** — Comprehensive forensic analysis with Sentry metadata, breadcrumbs, contexts, tags, and full remediation
2. **pattern** — Statistical pattern detection using Sentry event distribution, tag facets, temporal analysis, and cross-issue clustering
3. **recommendations** — Detailed, prioritized remediation with Sentry alert rules, dashboard configs, and verification metrics
4. **memory** — Application memory forensics using Sentry runtime contexts and custom metrics
5. **db** — Database connectivity and query analysis using Sentry stack traces, breadcrumbs, and Oracle contexts
6. **performance** — Performance profiling using Sentry breadcrumb timestamps, transaction tracing, and custom metrics
7. **root_cause** — Deep forensic root cause investigation with hypothesis testing and Sentry-based verification strategy
8. **general** — Systematic investigation protocol with impact assessment and actionable recommendations

### Key Differences from WCR Analysis

| Aspect | WCR Analysis | Sentry Analysis |
|---|---|---|
| **Data Source** | Single crash dump text file | Sentry issue (aggregated events, breadcrumbs, contexts, tags) |
| **Event Scope** | One crash instance | Multiple events over time (37 events, 5 users) |
| **Temporal Data** | Single timestamp | First seen, last seen, event frequency, time distribution |
| **User Context** | Username + machine | User count, affected roles, session metadata |
| **Stack Trace** | Raw Smalltalk frames | Multi-language frames (Java JDBC + Smalltalk), grouped by Sentry fingerprint |
| **Diagnostics** | Embedded in crash dump | Structured contexts, tags, breadcrumbs |
| **Monitoring** | Standalone recommendations | Native Sentry alert rules, dashboards, and metric queries |
| **Verification** | Manual test steps | Sentry-based: mark resolved in release, regression alerts, metric thresholds |
| **Pattern Detection** | Manual cross-WCR comparison | Sentry issue grouping, tag facets, event frequency analysis |
| **Collaboration** | Pass document around | Sentry issue link, assignee, comments, integrations (Jira, Slack) |

Each analysis type leverages Sentry's native capabilities — breadcrumbs for user journey reconstruction, contexts for system state, tags for faceted analysis, alerts for monitoring, and releases for deployment tracking — to provide richer, more actionable output than standalone crash dump analysis.
