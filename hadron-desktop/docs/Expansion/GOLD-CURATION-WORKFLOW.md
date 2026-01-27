# Gold Curation Workflow Implementation

## Overview
Phase 1-2, Week 3 implementation of the Gold Curation Workflow for the Hadron Intelligence Platform. This feature enables quality control and verification of gold standard analyses before they're used in the RAG (Retrieval-Augmented Generation) system.

## Architecture

### Database Layer (`src-tauri/src/database.rs`)

#### New Methods

1. **`get_pending_gold_analyses()`**
   - Returns all gold analyses with `validation_status = 'pending'`
   - Ordered by creation date (oldest first for FIFO review)
   - Returns: `Vec<GoldAnalysis>`

2. **`verify_gold_analysis(gold_analysis_id: i64)`**
   - Sets `validation_status = 'verified'` for approved analyses
   - Makes the analysis available for RAG retrieval
   - Returns: `Result<()>`

3. **`reject_gold_analysis(gold_analysis_id: i64)`**
   - Sets `validation_status = 'rejected'` for rejected analyses
   - Removes from review queue without deletion
   - Returns: `Result<()>`

4. **`check_auto_promotion_eligibility(analysis_id: i64)`**
   - Evaluates if an analysis meets auto-promotion criteria:
     - Has 'accept' feedback (thumbs up) - REQUIRED
     - No 'reject' feedback - DISQUALIFIES
     - Average rating >= 4 stars (if ratings exist) - REQUIRED
   - Returns: `Result<bool>`

5. **`auto_promote_if_eligible(analysis_id: i64)`**
   - Checks eligibility and auto-promotes if criteria met
   - Prevents duplicate promotion
   - Returns: `Result<bool>` (true if promoted, false if not eligible/already promoted)

#### Modified Methods

- **`promote_to_gold()`**: Changed initial `validation_status` from `'verified'` to `'pending'` to enable review workflow

### Rust Commands Layer (`src-tauri/src/commands.rs`)

Added Tauri commands:
- `get_pending_gold_analyses()` - Fetch pending reviews
- `verify_gold_analysis(gold_analysis_id)` - Approve analysis
- `reject_gold_analysis(gold_analysis_id)` - Reject analysis
- `check_auto_promotion_eligibility(analysis_id)` - Check if eligible
- `auto_promote_if_eligible(analysis_id)` - Auto-promote if criteria met

All commands registered in `src-tauri/src/main.rs`.

### TypeScript/React Layer

#### Components

**GoldReviewQueue.tsx** (`src/components/GoldReviewQueue.tsx`)
- Modal dialog for reviewing pending gold analyses
- Features:
  - Lists all pending analyses (status = 'pending')
  - Displays error signature, severity, root cause, suggested fixes
  - Verify/Reject action buttons
  - Real-time refresh
  - Empty state handling
  - Error handling with retry
  - Loading states

**DatabaseAdminSection.tsx** (Updated)
- Added "Intelligence Platform" section
- "Gold Review Queue" button with gradient styling
- Lazy-loaded modal for performance
- Award icon for visual branding

#### Integration Points

The Gold Review Queue is accessible via:
1. Settings Panel → Database Admin Section → Gold Review Queue button
2. Future: Could be added to History View for in-context review

## User Workflows

### Manual Promotion Workflow

1. User analyzes a crash and reviews the results
2. User clicks "Promote to Gold" button (existing GoldBadge component)
3. Analysis is inserted with `validation_status = 'pending'`
4. Admin opens Settings → Database Admin → Gold Review Queue
5. Admin reviews error signature, root cause, and suggested fixes
6. Admin clicks:
   - **Verify**: Approves for RAG use (status → 'verified')
   - **Reject**: Removes from queue (status → 'rejected')

### Auto-Promotion Workflow

1. User provides feedback on an analysis:
   - Clicks "Accept" (thumbs up)
   - Rates 4-5 stars
2. System automatically checks eligibility
3. If criteria met:
   - Analysis promoted to gold with status 'pending'
   - Added to review queue for verification
4. Admin reviews and verifies/rejects as normal

## Quality Criteria

### Auto-Promotion Eligibility

An analysis is eligible for auto-promotion if:
- ✅ Has at least one 'accept' feedback (thumbs up)
- ❌ Has NO 'reject' feedback
- ✅ Average rating >= 4.0 stars (if ratings exist)
- ❌ Not already promoted to gold

### Manual Review Standards

Reviewers should verify:
1. **Error Signature**: Accurately identifies the crash pattern
2. **Root Cause**: Technical explanation is correct
3. **Suggested Fixes**: Actionable and appropriate
4. **Component**: Correctly identified
5. **Severity**: Matches impact level

## Database Schema

The `gold_analyses` table (created in migration 006):

```sql
CREATE TABLE gold_analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_analysis_id INTEGER,
    source_type TEXT NOT NULL DEFAULT 'crash',
    error_signature TEXT NOT NULL,
    crash_content_hash TEXT,
    root_cause TEXT NOT NULL,
    suggested_fixes TEXT NOT NULL,
    component TEXT,
    severity TEXT,
    validation_status TEXT DEFAULT 'pending',  -- 'pending', 'verified', 'rejected'
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    verified_by TEXT,
    times_referenced INTEGER DEFAULT 0,
    success_rate REAL,
    FOREIGN KEY (source_analysis_id) REFERENCES analyses(id) ON DELETE SET NULL
);
```

## UI/UX Design

### Gold Review Queue Modal

- **Header**: Title, description, close button
- **Content Area**: Scrollable list of pending analyses
- **Each Review Card**:
  - Error signature (prominent)
  - Severity badge (color-coded)
  - Component
  - Created timestamp
  - Root cause (expandable)
  - Suggested fixes (bulleted list)
  - Source analysis ID (for traceability)
  - Verify/Reject buttons (green/red)
- **Footer**: Count of pending reviews, Refresh button
- **Empty State**: Friendly message when no reviews pending
- **Loading State**: Spinner during data fetch
- **Error State**: Error message with retry option

### Color Scheme

- **Gold Gradient**: Yellow-to-orange for branding
- **Verify**: Green (#10B981)
- **Reject**: Red (#EF4444)
- **Pending Badge**: Yellow (#EAB308)

## Performance Considerations

1. **Lazy Loading**: GoldReviewQueue component loaded on-demand
2. **Suspense Boundaries**: Smooth loading experience
3. **Database Indexes**:
   - `idx_gold_signature` for signature lookups
   - `idx_gold_component` for component filtering
4. **Query Optimization**: Single query for pending analyses

## Security & Validation

1. **Input Validation**: All IDs validated before database operations
2. **Error Handling**: Comprehensive try-catch with user-friendly messages
3. **Transaction Safety**: State changes in transactions
4. **Permission Control**: Admin access via Settings panel

## Testing Recommendations

### Unit Tests
- Database methods for CRUD operations
- Auto-promotion eligibility logic
- Edge cases (empty queue, invalid IDs)

### Integration Tests
- Full promotion workflow
- Verify/reject state transitions
- UI component rendering

### Manual Testing
1. Create an analysis and promote to gold
2. Verify it appears in review queue
3. Test verify action → status changes to 'verified'
4. Test reject action → status changes to 'rejected'
5. Test auto-promotion with feedback
6. Test empty queue state
7. Test error handling

## Future Enhancements

1. **Batch Operations**: Verify/reject multiple analyses at once
2. **Filtering**: Filter by severity, component, date range
3. **Search**: Full-text search within pending analyses
4. **Comments**: Add reviewer notes/feedback
5. **Audit Trail**: Track who verified/rejected each analysis
6. **Notifications**: Alert admins of pending reviews
7. **Metrics Dashboard**: Review queue statistics
8. **Similarity Detection**: Flag duplicate gold analyses
9. **Version Control**: Track changes to gold analyses
10. **Export**: Export gold dataset for training/analysis

## API Reference

### Tauri Commands

```rust
// Get pending gold analyses
get_pending_gold_analyses() -> Result<Vec<GoldAnalysis>, String>

// Verify a gold analysis
verify_gold_analysis(gold_analysis_id: i64) -> Result<(), String>

// Reject a gold analysis
reject_gold_analysis(gold_analysis_id: i64) -> Result<(), String>

// Check auto-promotion eligibility
check_auto_promotion_eligibility(analysis_id: i64) -> Result<bool, String>

// Auto-promote if eligible
auto_promote_if_eligible(analysis_id: i64) -> Result<bool, String>
```

### React Component Props

```typescript
interface GoldReviewQueueProps {
  onClose?: () => void;
}
```

## Files Modified

### New Files
- `/src/components/GoldReviewQueue.tsx` - Review queue UI component
- `/GOLD-CURATION-WORKFLOW.md` - This documentation

### Modified Files
- `/src-tauri/src/database.rs` - Database methods for gold workflow
- `/src-tauri/src/commands.rs` - Tauri command handlers
- `/src-tauri/src/main.rs` - Command registration
- `/src/components/DatabaseAdminSection.tsx` - Added access button

## Deployment Notes

1. **Database Migration**: Migration 006 already creates gold_analyses table
2. **No Breaking Changes**: Existing gold analyses work unchanged
3. **Backward Compatible**: Old 'verified' analyses still function
4. **Configuration**: No additional config required

## Monitoring & Metrics

Track these metrics:
- Pending review queue depth
- Average time to review
- Verify vs. reject ratio
- Auto-promotion success rate
- Gold analysis usage in RAG

## Success Criteria

✅ Users can promote analyses to gold with pending status
✅ Admins can access Gold Review Queue from Settings
✅ Pending analyses display with all relevant information
✅ Verify action changes status to 'verified'
✅ Reject action changes status to 'rejected'
✅ Auto-promotion criteria evaluated correctly
✅ UI is responsive and user-friendly
✅ Error handling is comprehensive
✅ Code compiles without warnings

## Version History

- **v1.0.0** (2026-01-21): Initial implementation
  - Gold Review Queue UI component
  - Database methods for review workflow
  - Auto-promotion eligibility checking
  - Integration with Settings panel

---

**Implementation Status**: ✅ Complete
**Phase**: 1-2, Week 3
**Feature**: Intelligence Platform - Gold Curation Workflow
