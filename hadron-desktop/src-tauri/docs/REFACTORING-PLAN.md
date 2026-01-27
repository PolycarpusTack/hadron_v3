# Commands.rs Refactoring Plan

## Current State
- **File**: `src-tauri/src/commands.rs`
- **Lines**: 5,216
- **Commands**: 117 Tauri commands
- **Issue**: Monolithic file causing merge conflicts and maintenance difficulty

## Target Structure

```
src-tauri/src/commands/
├── mod.rs              # Module exports
├── common.rs           # Shared types, helpers, constants (CREATED)
├── analysis.rs         # Core analysis CRUD (20 commands)
├── translation.rs      # Translation operations (5 commands)
├── tags.rs             # Tag management (10 commands)
├── bulk.rs             # Bulk operations (8 commands)
├── notes.rs            # Analysis notes (6 commands)
├── patterns.rs         # Pattern matching (12 commands)
├── reports.rs          # Report generation (5 commands)
├── integrations.rs     # JIRA, Keeper, signatures (15 commands)
├── database.rs         # Database maintenance (8 commands)
└── intelligence.rs     # Feedback, gold, export (18 commands)
```

## Migration Strategy

### Phase 1: Setup (Complete)
- [x] Create `commands/` directory
- [x] Create `mod.rs` with module structure
- [x] Create `common.rs` with shared types

### Phase 2: Incremental Migration
1. Start with smallest, most isolated modules
2. Keep original `commands.rs` working during migration
3. Use re-exports to maintain API compatibility

### Recommended Order
1. `intelligence.rs` - Isolated, Phase 1/4 features
2. `notes.rs` - Small, isolated
3. `tags.rs` - Small, isolated
4. `translation.rs` - Small, isolated
5. `bulk.rs` - Moderate complexity
6. `patterns.rs` - Pattern engine dependency
7. `integrations.rs` - External service integrations
8. `database.rs` - DB maintenance
9. `reports.rs` - Report generation
10. `analysis.rs` - Core, depends on many others

### Commands by Module

#### analysis.rs (~800 lines)
- analyze_crash_log
- save_external_analysis
- get_all_analyses
- get_analyses_paginated
- get_analyses_count
- get_analysis_by_id
- delete_analysis
- export_analysis
- search_analyses
- toggle_favorite
- get_favorites
- get_recent
- get_analyses_filtered
- save_analysis
- get_similar_analyses
- count_similar_analyses
- get_trend_data
- get_top_error_patterns
- archive_analysis
- restore_analysis
- get_archived_analyses
- permanently_delete_analysis

#### translation.rs (~200 lines)
- translate_content
- get_all_translations
- get_translation_by_id
- delete_translation
- toggle_translation_favorite
- archive_translation
- restore_translation

#### tags.rs (~250 lines)
- create_tag
- update_tag
- delete_tag
- get_all_tags
- add_tag_to_analysis
- remove_tag_from_analysis
- get_tags_for_analysis
- add_tag_to_translation
- remove_tag_from_translation
- get_tags_for_translation

#### bulk.rs (~300 lines)
- bulk_delete_analyses
- bulk_delete_translations
- bulk_add_tag_to_analyses
- bulk_remove_tag_from_analyses
- bulk_set_favorite_analyses
- bulk_set_favorite_translations
- bulk_archive_analyses

#### notes.rs (~150 lines)
- add_note_to_analysis
- update_note
- delete_note
- get_notes_for_analysis
- get_note_count
- analysis_has_notes

#### patterns.rs (~600 lines)
- match_patterns
- get_best_pattern_match
- list_patterns
- get_pattern_by_id
- reload_patterns
- quick_pattern_match
- get_patterns_by_category
- get_patterns_by_tag
- get_pattern_tags
- get_pattern_categories
- parse_crash_file
- parse_crash_content
- parse_crash_files_batch

#### reports.rs (~500 lines)
- generate_report
- get_export_formats
- get_audience_options
- preview_report
- check_sensitive_content
- sanitize_content
- generate_report_multi

#### integrations.rs (~500 lines)
- initialize_keeper
- list_keeper_secrets
- get_keeper_status
- clear_keeper_config
- test_keeper_connection
- test_jira_connection
- create_jira_ticket
- search_jira_issues
- compute_crash_signature
- register_crash_signature
- get_signature_occurrences
- get_top_signatures
- update_signature_status
- link_ticket_to_signature

#### database.rs (~300 lines)
- get_database_statistics
- optimize_fts_index
- check_database_integrity
- compact_database
- checkpoint_wal
- get_database_info
- list_models
- test_connection
- save_pasted_log
- get_file_stats
- analyze_performance_trace

#### intelligence.rs (~800 lines)
- submit_analysis_feedback
- get_feedback_for_analysis
- promote_to_gold
- get_gold_analyses
- is_gold_analysis
- get_pending_gold_analyses
- verify_gold_analysis
- reject_gold_analysis
- check_auto_promotion_eligibility
- auto_promote_if_eligible
- export_gold_jsonl
- count_gold_for_export
- export_gold_jsonl_enhanced
- get_export_statistics
- link_jira_to_analysis
- unlink_jira_from_analysis
- get_jira_links_for_analysis
- get_analyses_for_jira_ticket
- update_jira_link_metadata
- count_jira_links_for_analysis
- get_all_jira_links

## Estimated Effort
- Total: 3-4 days
- Per module: 2-4 hours

## Notes
- Maintain backwards compatibility during migration
- Run tests after each module migration
- Update main.rs imports incrementally
