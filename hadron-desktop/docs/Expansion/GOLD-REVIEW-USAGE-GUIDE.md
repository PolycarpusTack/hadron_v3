# Gold Review Queue - User Guide

## Overview

The Gold Review Queue is a quality control system for curated crash analyses. It ensures that only high-quality, verified analyses are used to improve the AI's recommendations through the RAG (Retrieval-Augmented Generation) system.

## For End Users

### Promoting an Analysis to Gold

1. **Analyze a Crash**
   - Upload or paste a crash log
   - Wait for analysis to complete

2. **Review the Analysis**
   - Verify the root cause is accurate
   - Check suggested fixes are appropriate
   - Ensure error signature is correct

3. **Promote to Gold**
   - Click the "☆ Promote" button near the analysis
   - Analysis enters the review queue with 'pending' status
   - Badge changes to show pending status

### Providing Feedback for Auto-Promotion

Your feedback helps the system automatically identify high-quality analyses:

1. **Accept/Reject**
   - Click thumbs up (👍) if the analysis helped you
   - Click thumbs down (👎) if it was incorrect or unhelpful

2. **Rate the Analysis**
   - Give 4-5 stars for excellent analyses
   - Give 1-3 stars for poor analyses

3. **Auto-Promotion**
   - If an analysis receives:
     - At least one thumbs up
     - No thumbs down
     - Average rating of 4+ stars
   - It will be auto-promoted to the review queue

## For Administrators

### Accessing the Review Queue

1. **Open Settings**
   - Click the gear icon (⚙️) in the top navigation
   - Or press your settings keyboard shortcut

2. **Navigate to Database Admin**
   - Scroll down to the "Database Status" section

3. **Open Gold Review Queue**
   - Look for "Intelligence Platform" section
   - Click "Gold Review Queue" button with the award icon (🏆)

### Reviewing Pending Analyses

The review queue displays all pending gold analyses:

#### Information Displayed

For each analysis you'll see:
- **Error Signature**: Unique identifier for this crash pattern
- **Severity Badge**: Critical, High, Medium, or Low (color-coded)
- **Component**: Which system component is affected
- **Root Cause**: Technical explanation of what went wrong
- **Suggested Fixes**: Recommended solutions (bulleted list)
- **Created Date**: When it was promoted
- **Source Analysis ID**: Link back to original analysis

#### Making a Decision

**Verify (Green Button)**
- Click this if the analysis is:
  - Technically accurate
  - Has clear, actionable fixes
  - Would be helpful for similar crashes
- Status changes to 'verified'
- Analysis becomes available for RAG retrieval
- Removed from pending queue

**Reject (Red Button)**
- Click this if the analysis is:
  - Technically incorrect
  - Has poor or unclear fixes
  - Would not be helpful
- Status changes to 'rejected'
- Removed from pending queue
- Does NOT enter the gold dataset

### Best Practices

#### Review Criteria

✅ **Verify if:**
- Root cause accurately explains the crash
- Suggested fixes are specific and actionable
- Error signature correctly identifies the pattern
- Component attribution is correct
- Would help developers fix similar issues

❌ **Reject if:**
- Root cause is vague or incorrect
- Fixes are generic or unhelpful
- Error signature is wrong
- Would mislead or confuse users

#### Workflow Tips

1. **Regular Reviews**
   - Check the queue daily or weekly
   - Prevents backlog buildup
   - Ensures fresh data for RAG

2. **Batch Processing**
   - Review multiple similar analyses together
   - Easier to spot patterns and duplicates

3. **Verification**
   - Cross-reference with actual code when possible
   - Consult documentation
   - Ask development team if unsure

## Understanding the Review Process

### Lifecycle of a Gold Analysis

```
User Analysis
     ↓
[Promote to Gold Button]
     ↓
Status: pending
     ↓
[Review Queue]
     ↓
   ┌────────┐
   ↓        ↓
Verify   Reject
   ↓        ↓
verified  rejected
   ↓        ↓
In RAG   Excluded
```

### Status Meanings

- **pending**: Waiting for admin review
- **verified**: Approved for use in RAG system
- **rejected**: Declined, not used in RAG

## Troubleshooting

### Queue is Empty

- **Cause**: No pending analyses
- **Solution**: This is normal - all reviews are complete!

### Cannot Verify/Reject

- **Cause**: Network or database error
- **Solution**:
  1. Check error message
  2. Click Refresh button
  3. Try again
  4. Check database connectivity

### Analysis Details Incomplete

- **Cause**: Data corruption or parsing error
- **Solution**:
  1. Check source analysis ID
  2. View original analysis
  3. Reject if data is invalid

## Metrics to Monitor

### Queue Health
- **Pending count**: Should stay low (< 10)
- **Average age**: Should be < 7 days
- **Verify/Reject ratio**: Typically 70-80% verify

### Quality Indicators
- **Auto-promotion rate**: Higher is better (shows good feedback)
- **Rejection rate**: Should be < 30%
- **Duplicate signatures**: Should be flagged

## FAQ

**Q: Can I edit a gold analysis before verifying?**
A: Not currently. You can only verify or reject. Future enhancement planned.

**Q: What happens to rejected analyses?**
A: They stay in the database but aren't used for RAG. They can be re-reviewed if needed.

**Q: Can I see verified gold analyses?**
A: Yes, use the existing "Get Gold Analyses" feature in the History view.

**Q: How do I know if auto-promotion is working?**
A: Check the source analysis ID - if it has user feedback, it was likely auto-promoted.

**Q: Can I verify in bulk?**
A: Not yet - planned for future enhancement.

**Q: Who can access the review queue?**
A: Anyone with access to Settings → Database Admin. Configure role-based access in enterprise deployments.

## Keyboard Shortcuts

Future enhancement - planned shortcuts:
- `V` - Verify current analysis
- `R` - Reject current analysis
- `↓` - Next analysis
- `↑` - Previous analysis
- `Esc` - Close queue

## Support

For issues or questions:
1. Check the implementation documentation
2. Review error messages carefully
3. Check database integrity
4. Consult with development team

---

**Version**: 1.0.0
**Last Updated**: 2026-01-21
**Phase**: 1-2, Week 3
