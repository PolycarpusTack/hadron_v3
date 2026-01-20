use crate::patterns::pattern::*;

/// Get all built-in patterns
pub fn get_builtin_patterns() -> Vec<CrashPattern> {
    vec![
        subscript_out_of_bounds_collection(),
        message_not_understood_nil(),
        postgres_prepared_statement_not_found(),
        oracle_connection_lost(),
        txblock_segment_duration_mismatch(),
    ]
}

fn subscript_out_of_bounds_collection() -> CrashPattern {
    CrashPattern {
        id: "BUILTIN-001".to_string(),
        name: "Collection Index Out of Bounds".to_string(),
        description: "Attempting to access a collection at an index that doesn't exist".to_string(),
        category: PatternCategory::CollectionError,
        matchers: PatternMatchers {
            exception_type: Some("SubscriptOutOfBounds".to_string()),
            stack_contains_any: vec![
                "OrderedCollection>>at:".to_string(),
                "Array>>at:".to_string(),
            ],
            context: Some(ContextMatcher {
                receiver_is_collection: Some(true),
                ..Default::default()
            }),
            ..Default::default()
        },
        analysis: PatternAnalysis {
            root_cause: "Code attempted to access a collection element at an index greater than the collection size".to_string(),
            root_cause_plain: "The system tried to get item #X from a list that only has Y items".to_string(),
            severity: Severity::High,
            data_at_risk: false,
            fix_summary: "Add bounds checking before accessing collection elements".to_string(),
            fix_details: Some("Verify the index is within range (1 to collection size) before accessing. Consider why the collection has fewer items than expected.".to_string()),
            fix_code_hints: vec![
                "Check: index <= collection size".to_string(),
                "Use #at:ifAbsent: for safe access".to_string(),
            ],
            workarounds: vec![],
            affected_features: vec![],
            test_scenarios: vec![
                TestScenario {
                    id: "TC-001".to_string(),
                    name: "Verify bounds checking".to_string(),
                    priority: "P1".to_string(),
                    steps: vec![
                        "Create scenario with mismatched data counts".to_string(),
                        "Trigger the operation".to_string(),
                        "Verify graceful error handling".to_string(),
                    ],
                    expected_result: "Application should handle gracefully without crash".to_string(),
                },
            ],
            documentation_links: vec![],
            investigation_queries: vec![],
        },
        versioning: PatternVersioning::default(),
        priority: 50,
        enabled: true,
        tags: vec!["collection".to_string(), "index".to_string()],
    }
}

fn message_not_understood_nil() -> CrashPattern {
    CrashPattern {
        id: "BUILTIN-002".to_string(),
        name: "Message Sent to Nil".to_string(),
        description: "A message was sent to nil (UndefinedObject)".to_string(),
        category: PatternCategory::NullReference,
        matchers: PatternMatchers {
            exception_type: Some("MessageNotUnderstood".to_string()),
            context: Some(ContextMatcher {
                receiver_class: Some(StringMatcher::Exact("UndefinedObject".to_string())),
                ..Default::default()
            }),
            ..Default::default()
        },
        analysis: PatternAnalysis {
            root_cause: "A message was sent to nil - an object that should exist is missing".to_string(),
            root_cause_plain: "The system tried to use something that doesn't exist (nil/null value)".to_string(),
            severity: Severity::High,
            data_at_risk: false,
            fix_summary: "Add nil check or ensure object is properly initialized".to_string(),
            fix_details: Some("Trace back to find where the nil value originated. Common causes: failed lookups, uninitialized variables, deleted objects.".to_string()),
            fix_code_hints: vec![
                "Add: object ifNil: [^self] before sending messages".to_string(),
                "Use #ifNotNil: for conditional execution".to_string(),
            ],
            workarounds: vec![],
            affected_features: vec![],
            test_scenarios: vec![],
            documentation_links: vec![],
            investigation_queries: vec![],
        },
        versioning: PatternVersioning::default(),
        priority: 50,
        enabled: true,
        tags: vec!["nil".to_string(), "null".to_string()],
    }
}

fn postgres_prepared_statement_not_found() -> CrashPattern {
    CrashPattern {
        id: "BUILTIN-003".to_string(),
        name: "PostgreSQL Prepared Statement Not Found".to_string(),
        description: "A prepared statement was deallocated before use, often due to connection pooling".to_string(),
        category: PatternCategory::DatabaseError,
        matchers: PatternMatchers {
            exception_message: Some(StringMatcher::Contains {
                contains: "prepared statement".to_string(),
            }),
            database: Some(DatabaseMatcher {
                backend: Some("postgresql".to_string()),
                error_contains: Some("does not exist".to_string()),
                ..Default::default()
            }),
            ..Default::default()
        },
        analysis: PatternAnalysis {
            root_cause: "Prepared statement was deallocated by connection pooling (e.g., PgBouncer) or connection reuse".to_string(),
            root_cause_plain: "The database forgot a query that the application thought was saved, usually due to connection sharing settings".to_string(),
            severity: Severity::High,
            data_at_risk: false,
            fix_summary: "Review connection pooling configuration; use session mode or handle statement lifecycle".to_string(),
            fix_details: Some("If using PgBouncer in transaction mode, prepared statements are lost between transactions. Either switch to session mode, disable prepared statements, or recreate statements on demand.".to_string()),
            fix_code_hints: vec![
                "PgBouncer: Set pool_mode = session".to_string(),
                "Or: Handle 26000 error by recreating statement".to_string(),
            ],
            workarounds: vec![
                "Restart the application to clear statement cache".to_string(),
            ],
            affected_features: vec!["All database operations".to_string()],
            test_scenarios: vec![],
            documentation_links: vec![],
            investigation_queries: vec![],
        },
        versioning: PatternVersioning::default(),
        priority: 70,
        enabled: true,
        tags: vec!["database".to_string(), "postgresql".to_string(), "connection".to_string()],
    }
}

fn oracle_connection_lost() -> CrashPattern {
    CrashPattern {
        id: "BUILTIN-004".to_string(),
        name: "Oracle Connection Lost".to_string(),
        description: "The Oracle database connection was unexpectedly closed".to_string(),
        category: PatternCategory::DatabaseError,
        matchers: PatternMatchers {
            exception_message: Some(StringMatcher::Regex {
                regex: r"ORA-(03113|03114|03135|12541)".to_string(),
            }),
            database: Some(DatabaseMatcher {
                backend: Some("oracle".to_string()),
                ..Default::default()
            }),
            ..Default::default()
        },
        analysis: PatternAnalysis {
            root_cause: "Oracle database connection was terminated unexpectedly".to_string(),
            root_cause_plain: "The connection to the database was lost, possibly due to network issues, server restart, or timeout".to_string(),
            severity: Severity::High,
            data_at_risk: true,
            fix_summary: "Check network connectivity, database server status, and connection timeout settings".to_string(),
            fix_details: Some("ORA-03113/03114 typically indicate end-of-file on communication channel. Check for database server restarts, network interruptions, or firewall timeouts.".to_string()),
            fix_code_hints: vec![],
            workarounds: vec![
                "Restart the application".to_string(),
                "Check database server is running".to_string(),
            ],
            affected_features: vec!["All database operations".to_string()],
            test_scenarios: vec![],
            documentation_links: vec![],
            investigation_queries: vec![],
        },
        versioning: PatternVersioning::default(),
        priority: 80,
        enabled: true,
        tags: vec!["database".to_string(), "oracle".to_string(), "connection".to_string()],
    }
}

fn txblock_segment_duration_mismatch() -> CrashPattern {
    CrashPattern {
        id: "WHATSON-001".to_string(),
        name: "TxBlock Segment/Duration Count Mismatch".to_string(),
        description: "The number of TimeAllocations doesn't match the number of SegmentDurations".to_string(),
        category: PatternCategory::WhatsOnSpecific,
        matchers: PatternMatchers {
            exception_type: Some("SubscriptOutOfBounds".to_string()),
            stack_contains: vec![
                "PSITxBlock".to_string(),
            ],
            stack_contains_any: vec![
                "removeTimeAllocationsAndUpdateDesiredSegmentation".to_string(),
                "Segmentation".to_string(),
                "MakeContinuous".to_string(),
            ],
            context: Some(ContextMatcher {
                has_business_objects: vec![
                    "BMProgramSegmentDurations".to_string(),
                ],
                ..Default::default()
            }),
            ..Default::default()
        },
        analysis: PatternAnalysis {
            root_cause: "TxBlock has mismatched segment and duration counts - data integrity violation".to_string(),
            root_cause_plain: "A transmission block has 4 time segments but only 2 duration records, causing a crash when trying to process them together".to_string(),
            severity: Severity::Critical,
            data_at_risk: true,
            fix_summary: "Add bounds checking in segmentation code; investigate source of data mismatch".to_string(),
            fix_details: Some("The code iterates over TimeAllocations and accesses BMProgramSegmentDurations by index, assuming they match. When they don't (e.g., after import or manual editing), it crashes.".to_string()),
            fix_code_hints: vec![
                "Add: durations size >= allocations size check".to_string(),
                "Use: durations at: index ifAbsent: [nil]".to_string(),
                "Log warning when mismatch detected".to_string(),
            ],
            workarounds: vec![
                "Avoid using 'Make Continuous' on affected TxBlocks".to_string(),
                "Manually fix segment count in database".to_string(),
            ],
            affected_features: vec![
                "Continuity Planner - Make Continuous".to_string(),
                "Continuity Planner - Remove Empty Time Allocations".to_string(),
                "Schedule Import (data source)".to_string(),
            ],
            test_scenarios: vec![
                TestScenario {
                    id: "TC-WHATSON-001-1".to_string(),
                    name: "Make Continuous with matched segments".to_string(),
                    priority: "P1".to_string(),
                    steps: vec![
                        "Open Continuity Planner".to_string(),
                        "Select a TxBlock with equal segment/duration counts".to_string(),
                        "Click Make Continuous".to_string(),
                    ],
                    expected_result: "Operation completes successfully".to_string(),
                },
                TestScenario {
                    id: "TC-WHATSON-001-2".to_string(),
                    name: "Make Continuous with mismatched segments".to_string(),
                    priority: "P1".to_string(),
                    steps: vec![
                        "Create TxBlock with segment/duration mismatch".to_string(),
                        "Open Continuity Planner".to_string(),
                        "Select the affected TxBlock".to_string(),
                        "Click Make Continuous".to_string(),
                    ],
                    expected_result: "Graceful error message, no crash".to_string(),
                },
            ],
            documentation_links: vec![],
            investigation_queries: vec![
                InvestigationQuery {
                    name: "Find mismatched TxBlocks".to_string(),
                    description: "Find all TxBlocks where segment count != duration count".to_string(),
                    sql: r#"
SELECT
    tb.OID as txblock_oid,
    c.NAME as channel,
    tb.STARTDATETIME as start_time,
    (SELECT COUNT(*) FROM PSI.BMTIMEALLOCATION ta WHERE ta.TXBLOCK_ID = tb.OID AND ta.ALLOCATIONTYPE = 'Segment of program') as segment_count,
    (SELECT COUNT(*) FROM PSI.BMPROGRAMSEGMENTDURATIONS psd WHERE psd.TXBLOCK_ID = tb.OID) as duration_count
FROM PSI.PSITXBLOCK tb
JOIN PSI.PSICHANNEL c ON tb.CHANNEL_ID = c.OID
WHERE (SELECT COUNT(*) FROM PSI.BMTIMEALLOCATION ta WHERE ta.TXBLOCK_ID = tb.OID AND ta.ALLOCATIONTYPE = 'Segment of program')
   != (SELECT COUNT(*) FROM PSI.BMPROGRAMSEGMENTDURATIONS psd WHERE psd.TXBLOCK_ID = tb.OID)
ORDER BY tb.STARTDATETIME DESC
"#.to_string(),
                },
            ],
        },
        versioning: PatternVersioning {
            introduced_in: None,
            fixed_in: None, // Not yet fixed
            tickets: vec!["MTVNL-4521".to_string(), "MTVNL-4523".to_string()],
            pattern_version: "1.0.0".to_string(),
            last_updated: Some("2026-01-19".to_string()),
        },
        priority: 90,
        enabled: true,
        tags: vec![
            "whatson".to_string(),
            "txblock".to_string(),
            "segmentation".to_string(),
            "continuity".to_string(),
            "data-integrity".to_string(),
        ],
    }
}
