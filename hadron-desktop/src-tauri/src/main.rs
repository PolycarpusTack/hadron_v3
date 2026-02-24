// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai_service;
mod chat_commands;
mod chat_tools;
mod commands;
mod commands_legacy;
mod crash_handler;
mod database;
mod error;
mod export;
mod jira_service;
mod keeper_service;
mod release_notes_service;
mod sentry_service;
mod migrations;
mod model_fetcher;
mod models;
mod parser;
mod patterns;
mod python_runner;
mod rag_commands;
mod retrieval;
mod signature;
// Token-safe analysis modules
mod chunker;
mod deep_scan;
mod evidence_extractor;
mod token_budget;
mod widget_commands;

use commands::*;
use database::Database;
use rag_commands::*;
use std::sync::{Arc, RwLock};
use tauri::Manager;

fn main() {
    // If launched as crash monitor (child process), run the monitor and exit
    if std::env::args().any(|a| a == crash_handler::CRASH_MONITOR_ARG) {
        crash_handler::run_crash_monitor();
    }

    // Install panic hook first — captures crash info if anything panics during init
    crash_handler::install_panic_hook();

    // NOTE: Minidump crash handler DISABLED — causes heap corruption on Windows.
    // The crash-handler 0.6 / minidumper 0.8 crates corrupt the heap via their
    // unsafe signal handler + IPC child process. All 6 crash dumps since
    // installation showed HEAP_CORRUPTION / ILLEGAL_INSTRUCTION / ACCESS_VIOLATION.
    // The panic hook above still captures Rust panics to disk.
    // See: C:\Users\...\AppData\Roaming\hadron\crashes\ for the evidence.
    //
    // if let Err(e) = crash_handler::install_crash_handler() {
    //     eprintln!("Warning: minidump crash handler not available: {}", e);
    // }

    // Initialize database wrapped in Arc for safe sharing across spawn_blocking tasks
    let db = Arc::new(match Database::new() {
        Ok(db) => db,
        Err(e) => {
            // Note: log plugin not yet initialized; eprintln is the real output here
            eprintln!("FATAL: Failed to initialize database: {}", e);
            std::process::exit(1);
        }
    });

    // Initialize pattern engine with built-in patterns
    let pattern_engine = patterns::create_pattern_engine(None);
    let pattern_engine_state = PatternEngineState(RwLock::new(pattern_engine));

    // Initialize embedding cache for retrieval pipeline
    let embedding_cache = retrieval::cache::EmbeddingCache::new();

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("hadron".to_string()),
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                ])
                .level(if cfg!(debug_assertions) { log::LevelFilter::Debug } else { log::LevelFilter::Info })
                .max_file_size(50_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
                .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            // Register global hotkey: Ctrl+Shift+H to toggle widget
            use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
            use std::sync::atomic::{AtomicU64, Ordering};
            use std::sync::Arc;

            let last_toggle = Arc::new(AtomicU64::new(0));
            let last_toggle_ref = Arc::clone(&last_toggle);

            app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+H", move |app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    // Debounce: ignore presses within 300ms of the last one
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64;
                    let prev = last_toggle_ref.swap(now, Ordering::Relaxed);
                    if now.saturating_sub(prev) < 300 {
                        return;
                    }

                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = widget_commands::toggle_widget(app).await {
                            log::warn!("Failed to toggle widget via hotkey: {}", e);
                        }
                    });
                }
            })?;

            log::info!(
                "Hadron {} started (crash logging active)",
                env!("CARGO_PKG_VERSION")
            );

            Ok(())
        })
        .manage(db)
        .manage(pattern_engine_state)
        .manage(embedding_cache)
        .manage(widget_commands::WidgetLock::new())
        .invoke_handler(tauri::generate_handler![
            analyze_crash_log,
            analyze_jira_ticket,
            translate_content,
            save_external_analysis,
            // CRUD (migrated to commands::crud)
            commands::crud::get_all_analyses,
            commands::crud::get_analyses_paginated,
            commands::crud::get_analyses_count,
            commands::crud::get_analysis_by_id,
            commands::crud::delete_analysis,
            commands::crud::export_analysis,
            // Phase 2: Search & Favorites
            search_analyses,
            commands::crud::toggle_favorite,
            commands::crud::get_favorites,
            commands::crud::get_recent,
            // Phase 2: Database Management
            commands::crud::get_database_statistics,
            commands::crud::optimize_fts_index,
            commands::crud::check_database_integrity,
            commands::crud::compact_database,
            commands::crud::checkpoint_wal,
            // Translation Management
            commands::crud::get_all_translations,
            commands::crud::get_translation_by_id,
            commands::crud::delete_translation,
            commands::crud::toggle_translation_favorite,
            // Tag Management
            create_tag,
            update_tag,
            delete_tag,
            get_all_tags,
            add_tag_to_analysis,
            remove_tag_from_analysis,
            get_tags_for_analysis,
            add_tag_to_translation,
            remove_tag_from_translation,
            get_tags_for_translation,
            auto_tag_analyses,
            count_analyses_without_tags,
            // Advanced Filtering
            get_analyses_filtered,
            // Bulk Operations
            bulk_delete_analyses,
            bulk_delete_translations,
            bulk_add_tag_to_analyses,
            bulk_remove_tag_from_analyses,
            bulk_set_favorite_analyses,
            bulk_set_favorite_translations,
            // Archive System (migrated to commands::archive)
            commands::archive::archive_analysis,
            commands::archive::restore_analysis,
            commands::archive::get_archived_analyses,
            commands::archive::permanently_delete_analysis,
            commands::archive::bulk_archive_analyses,
            // Notes System (migrated to commands::notes)
            commands::notes::add_note_to_analysis,
            commands::notes::update_note,
            commands::notes::delete_note,
            commands::notes::get_notes_for_analysis,
            commands::notes::get_note_count,
            commands::notes::analysis_has_notes,
            // Translation Archive System (migrated to commands::archive)
            commands::archive::archive_translation,
            commands::archive::restore_translation,
            // Similar Crash Detection & Analytics
            get_similar_analyses,
            count_similar_analyses,
            get_trend_data,
            get_top_error_patterns,
            // Model Management
            list_models,
            test_connection,
            // File Management
            save_pasted_log,
            // Keeper Secrets Manager Integration
            initialize_keeper,
            list_keeper_secrets,
            get_keeper_status,
            clear_keeper_config,
            test_keeper_connection,
            // JIRA Integration
            test_jira_connection,
            list_jira_projects,
            create_jira_ticket,
            search_jira_issues,
            post_jira_comment,
            // JIRA Ticket Linking (Phase 3)
            link_jira_to_analysis,
            unlink_jira_from_analysis,
            get_jira_links_for_analysis,
            get_analyses_for_jira_ticket,
            update_jira_link_metadata,
            count_jira_links_for_analysis,
            get_all_jira_links,
            // Crash Signatures
            compute_crash_signature,
            register_crash_signature,
            get_signature_occurrences,
            get_top_signatures,
            update_signature_status,
            link_ticket_to_signature,
            // WCR Parser
            parse_crash_file,
            parse_crash_content,
            parse_crash_files_batch,
            // Known Patterns
            match_patterns,
            get_best_pattern_match,
            list_patterns,
            get_pattern_by_id,
            reload_patterns,
            quick_pattern_match,
            // Report Export
            generate_report,
            get_export_formats,
            get_audience_options,
            preview_report,
            // Sensitive Content Detection
            check_sensitive_content,
            sanitize_content,
            // Pattern Filtering
            get_patterns_by_category,
            get_patterns_by_tag,
            get_pattern_tags,
            get_pattern_categories,
            // Multi-Format Export
            generate_report_multi,
            // Database Admin
            get_database_info,
            // Performance Trace Analysis (migrated to commands::performance)
            commands::performance::analyze_performance_trace,
            get_file_stats,
            // Intelligence Platform (Phase 1-2)
            submit_analysis_feedback,
            get_feedback_for_analysis,
            promote_to_gold,
            get_gold_analyses,
            is_gold_analysis,
            // Gold Review Workflow (Phase 1-2 Week 3)
            get_pending_gold_analyses,
            verify_gold_analysis,
            reject_gold_analysis,
            get_rejected_gold_analyses,
            reopen_gold_analysis,
            check_auto_promotion_eligibility,
            auto_promote_if_eligible,
            // Fine-Tuning Export (Phase 1.4)
            export_gold_jsonl,
            count_gold_for_export,
            // Enhanced Export (Phase 4)
            export_gold_jsonl_enhanced,
            get_export_statistics,
            // RAG System (Phase 1-2, Week 4)
            rag_query,
            rag_index_analysis,
            rag_build_context,
            rag_get_stats,
            // Knowledge Base RAG
            kb_query,
            kb_test_connection,
            kb_list_indices,
            kb_import_docs,
            kb_get_stats,
            // Sentry Integration
            test_sentry_connection,
            list_sentry_projects,
            list_sentry_issues,
            list_sentry_org_issues,
            fetch_sentry_issue,
            fetch_sentry_latest_event,
            analyze_sentry_issue,
            // Ask Hadron Chat
            chat_commands::chat_send,
            chat_commands::chat_submit_feedback,
            chat_commands::chat_delete_feedback,
            chat_commands::chat_save_session,
            chat_commands::chat_list_sessions,
            chat_commands::chat_get_messages,
            chat_commands::chat_delete_session,
            chat_commands::chat_rename_session,
            chat_commands::chat_star_session,
            chat_commands::chat_tag_session,
            chat_commands::chat_update_session_metadata,
            // Retrieval Evaluation
            chat_commands::run_retrieval_eval,
            // Gold Answers (Ask Hadron 2.0)
            commands::gold_answers::save_gold_answer,
            commands::gold_answers::list_gold_answers,
            commands::gold_answers::search_gold_answers_cmd,
            commands::gold_answers::delete_gold_answer_cmd,
            commands::gold_answers::export_gold_answers_jsonl,
            // Session Summaries (Ask Hadron 2.0)
            commands::summaries::generate_session_summary,
            commands::summaries::save_session_summary,
            commands::summaries::get_session_summary,
            commands::summaries::export_summaries_bundle,
            // Release Notes Generator
            commands::release_notes::generate_release_notes,
            commands::release_notes::preview_release_notes_tickets,
            commands::release_notes::list_jira_fix_versions,
            commands::release_notes::get_release_notes,
            commands::release_notes::list_release_notes,
            commands::release_notes::update_release_notes_content,
            commands::release_notes::update_release_notes_status,
            commands::release_notes::update_release_notes_checklist,
            commands::release_notes::append_to_release_notes,
            commands::release_notes::export_release_notes,
            commands::release_notes::delete_release_notes,
            commands::release_notes::check_release_notes_compliance,
            // Widget
            widget_commands::toggle_widget,
            widget_commands::show_widget,
            widget_commands::hide_widget,
            widget_commands::resize_widget,
            widget_commands::focus_main_window,
            widget_commands::get_widget_position,
            widget_commands::move_widget,
            widget_commands::is_main_window_visible,
        ])
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { .. } => {
                    log::info!("window: {} close requested", window.label());
                    if window.label() == "main" {
                        window.app_handle().exit(0);
                    }
                }
                tauri::WindowEvent::Focused(focused) => {
                    log::debug!("window: {} focused={}", window.label(), focused);
                }
                tauri::WindowEvent::Destroyed => {
                    log::info!("window: {} destroyed", window.label());
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
