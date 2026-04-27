// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai_service;
mod breadcrumbs;
mod chat_commands;
mod chat_tools;
mod commands;
mod crash_handler;
mod database;
mod error;
mod export;
mod jira_service;
mod jira_deep_analysis;
mod jira_triage;
mod jira_brief;
mod jira_poller;
mod keeper_service;
mod release_notes_service;
mod sentry_service;
mod migrations;
mod model_fetcher;
mod models;
mod parser;
mod patterns;
// python_runner — removed: translation now handled natively in Rust (commands/ai.rs)
mod rag_commands;
mod retrieval;
mod signature;
mod stability;
// Token-safe analysis modules
mod chunker;
mod deep_scan;
mod evidence_extractor;
mod token_budget;
mod ticket_briefs;
mod ticket_embeddings;
mod str_utils;
mod webview_recovery;
mod webview_udf;
mod widget_commands;

use database::Database;
use rag_commands::*;
use std::sync::{Arc, RwLock};
use tauri::Manager;

fn log_level_from_env_or_default() -> log::LevelFilter {
    match std::env::var("HADRON_LOG_LEVEL")
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "off" => log::LevelFilter::Off,
        "error" => log::LevelFilter::Error,
        "warn" | "warning" => log::LevelFilter::Warn,
        "info" => log::LevelFilter::Info,
        "debug" => log::LevelFilter::Debug,
        "trace" => log::LevelFilter::Trace,
        // Default to Info for production. Set HADRON_LOG_LEVEL=debug to diagnose.
        _ => log::LevelFilter::Info,
    }
}

fn main() {
    // Install panic hook first — captures crash info if anything panics during init
    crash_handler::install_panic_hook();
    crash_handler::install_native_crash_handler();

    // Pin WebView2's user-data-folder to a known user-local path BEFORE
    // Tauri creates the webview. See webview_udf for rationale.
    webview_udf::configure_udf();

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
    let pattern_engine_state = commands::PatternEngineState(RwLock::new(pattern_engine));

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
                ])
                .level(log_level_from_env_or_default())
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
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .skip_initial_state("widget")
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            // Register global hotkey: Ctrl+Shift+H to toggle widget
            use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
            use std::sync::atomic::{AtomicU64, Ordering};
            use std::sync::Arc;

            let shortcut_mgr = app.global_shortcut();

            // Unregister first in case a previous instance didn't clean up
            let _ = shortcut_mgr.unregister("CmdOrCtrl+Shift+H");

            let last_toggle = Arc::new(AtomicU64::new(0));
            let last_toggle_ref = Arc::clone(&last_toggle);

            if let Err(e) = shortcut_mgr.on_shortcut("CmdOrCtrl+Shift+H", move |app, _shortcut, event| {
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
            }) {
                log::warn!("Failed to register Ctrl+Shift+H hotkey: {} — widget toggle unavailable", e);
            }

            log::info!(
                "Hadron {} started (crash logging active)",
                env!("CARGO_PKG_VERSION")
            );
            log::info!(
                "Log level configured via HADRON_LOG_LEVEL={} (default: debug)",
                std::env::var("HADRON_LOG_LEVEL").unwrap_or_else(|_| "<unset>".to_string())
            );

            // Install WebView2 process-failure recovery handlers on the main
            // window. Windows-only; a no-op on macOS/Linux.
            if let Some(main_window) = app.get_webview_window("main") {
                webview_recovery::install_recovery(&main_window);
            }

            // Auto-start JIRA Assist poller if enabled in settings
            {
                let app_handle = app.handle().clone();
                let db = app.state::<Arc<Database>>().inner().clone();
                let poller_state = app.state::<jira_poller::PollerState>();
                jira_poller::start_poller(app_handle, db, &poller_state);
            }

            Ok(())
        })
        .manage(db)
        .manage(pattern_engine_state)
        .manage(embedding_cache)
        .manage(widget_commands::WidgetLock::new())
        .manage(widget_commands::HoverButtonEnabledState::new(true))
        .manage(jira_poller::PollerState::new())
        .manage(chat_commands::ChatStreamShared(std::sync::Arc::new(parking_lot::RwLock::new(chat_commands::ChatStreamState::default()))))
        .invoke_handler(tauri::generate_handler![
            // ── AI Analysis ──
            commands::ai::analyze_crash_log,
            commands::ai::analyze_jira_ticket,
            commands::ai::translate_content,
            commands::ai::call_ai,
            commands::ai::save_analysis,
            commands::ai::save_external_analysis,
            commands::ai::save_pasted_log,
            commands::ai::analyze_sentry_issue,
            // ── Providers ──
            commands::providers::list_models,
            commands::providers::test_connection,
            // ── Info ──
            commands::info::get_database_info,
            commands::info::get_file_stats,
            commands::info::get_crash_log_dir,
            commands::info::set_crash_log_dir,
            commands::info::get_stability_mode,
            commands::info::set_stability_mode,
            // ── CRUD ──
            commands::crud::get_all_analyses,
            commands::crud::get_analyses_paginated,
            commands::crud::get_analyses_count,
            commands::crud::get_analysis_by_id,
            commands::crud::delete_analysis,
            commands::crud::export_analysis,
            commands::crud::toggle_favorite,
            commands::crud::get_favorites,
            commands::crud::get_recent,
            commands::crud::get_database_statistics,
            commands::crud::optimize_fts_index,
            commands::crud::check_database_integrity,
            commands::crud::compact_database,
            commands::crud::checkpoint_wal,
            commands::crud::get_all_translations,
            commands::crud::get_translation_by_id,
            commands::crud::delete_translation,
            commands::crud::toggle_translation_favorite,
            // ── Search ──
            commands::search::search_analyses,
            commands::search::get_analyses_filtered,
            // ── Tags ──
            commands::tags::create_tag,
            commands::tags::update_tag,
            commands::tags::delete_tag,
            commands::tags::get_all_tags,
            commands::tags::add_tag_to_analysis,
            commands::tags::remove_tag_from_analysis,
            commands::tags::get_tags_for_analysis,
            commands::tags::add_tag_to_translation,
            commands::tags::remove_tag_from_translation,
            commands::tags::get_tags_for_translation,
            commands::tags::auto_tag_analyses,
            commands::tags::count_analyses_without_tags,
            // ── Bulk Operations ──
            commands::bulk_ops::bulk_delete_analyses,
            commands::bulk_ops::bulk_delete_translations,
            commands::bulk_ops::bulk_add_tag_to_analyses,
            commands::bulk_ops::bulk_remove_tag_from_analyses,
            commands::bulk_ops::bulk_set_favorite_analyses,
            commands::bulk_ops::bulk_set_favorite_translations,
            // ── Archive ──
            commands::archive::archive_analysis,
            commands::archive::restore_analysis,
            commands::archive::get_archived_analyses,
            commands::archive::permanently_delete_analysis,
            commands::archive::bulk_archive_analyses,
            commands::archive::archive_translation,
            commands::archive::restore_translation,
            // ── Notes ──
            commands::notes::add_note_to_analysis,
            commands::notes::update_note,
            commands::notes::delete_note,
            commands::notes::get_notes_for_analysis,
            commands::notes::get_note_count,
            commands::notes::analysis_has_notes,
            // ── Analytics ──
            commands::analytics::get_similar_analyses,
            commands::analytics::count_similar_analyses,
            commands::analytics::get_trend_data,
            commands::analytics::get_dashboard_stats,
            commands::analytics::get_top_error_patterns,
            // ── Keeper ──
            commands::keeper::initialize_keeper,
            commands::keeper::list_keeper_secrets,
            commands::keeper::get_keeper_status,
            commands::keeper::clear_keeper_config,
            commands::keeper::test_keeper_connection,
            // ── Signatures ──
            commands::signatures::compute_crash_signature,
            commands::signatures::register_crash_signature,
            commands::signatures::get_signature_occurrences,
            commands::signatures::get_top_signatures,
            commands::signatures::update_signature_status,
            commands::signatures::link_ticket_to_signature,
            // ── Patterns / WCR Parser ──
            commands::patterns::parse_crash_file,
            commands::patterns::parse_crash_content,
            commands::patterns::parse_crash_files_batch,
            commands::patterns::match_patterns,
            commands::patterns::get_best_pattern_match,
            commands::patterns::list_patterns,
            commands::patterns::get_pattern_by_id,
            commands::patterns::reload_patterns,
            commands::patterns::quick_pattern_match,
            commands::patterns::get_patterns_by_category,
            commands::patterns::get_patterns_by_tag,
            commands::patterns::get_pattern_tags,
            commands::patterns::get_pattern_categories,
            commands::export::check_sensitive_content,
            commands::export::sanitize_content,
            // ── Export ──
            commands::export::generate_report,
            commands::export::get_export_formats,
            commands::export::get_audience_options,
            commands::export::preview_report,
            commands::export::generate_report_multi,
            commands::export::export_generic_report,
            commands::export::preview_generic_report,
            commands::export::write_export_text,
            commands::export::write_export_bytes,
            // ── Performance ──
            commands::performance::analyze_performance_trace,
            // ── Progress Polling (P2.2) ──
            commands::common::helpers::get_analysis_progress,
            // ── Chat Stream Polling ──
            chat_commands::poll_chat_stream,
            // ── Intelligence ──
            commands::intelligence::submit_analysis_feedback,
            commands::intelligence::get_feedback_for_analysis,
            commands::intelligence::promote_to_gold,
            commands::intelligence::get_gold_analyses,
            commands::intelligence::is_gold_analysis,
            commands::intelligence::get_pending_gold_analyses,
            commands::intelligence::verify_gold_analysis,
            commands::intelligence::reject_gold_analysis,
            commands::intelligence::get_rejected_gold_analyses,
            commands::intelligence::reopen_gold_analysis,
            commands::intelligence::check_auto_promotion_eligibility,
            commands::intelligence::auto_promote_if_eligible,
            commands::intelligence::export_gold_jsonl,
            commands::intelligence::count_gold_for_export,
            commands::intelligence::export_gold_jsonl_enhanced,
            commands::intelligence::get_export_statistics,
            // ── Sentry ──
            commands::sentry::test_sentry_connection,
            commands::sentry::list_sentry_projects,
            commands::sentry::list_sentry_issues,
            commands::sentry::list_sentry_org_issues,
            commands::sentry::fetch_sentry_issue,
            commands::sentry::fetch_sentry_latest_event,
            // ── JIRA (migrated) ──
            commands::jira::test_jira_connection,
            commands::jira::list_jira_projects,
            commands::jira::create_jira_ticket,
            commands::jira::search_jira_issues,
            commands::jira::post_jira_comment,
            commands::jira::search_jira_issues_next_page,
            commands::jira::analyze_jira_ticket_deep,
            commands::jira::link_jira_to_analysis,
            commands::jira::unlink_jira_from_analysis,
            commands::jira::get_jira_links_for_analysis,
            commands::jira::get_analyses_for_jira_ticket,
            commands::jira::update_jira_link_metadata,
            commands::jira::count_jira_links_for_analysis,
            commands::jira::get_all_jira_links,
            // ── RAG ──
            rag_query,
            rag_index_analysis,
            rag_build_context,
            rag_get_stats,
            kb_query,
            kb_test_connection,
            kb_list_indices,
            kb_import_docs,
            kb_get_stats,
            // ── Chat ──
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
            chat_commands::run_retrieval_eval,
            // ── Gold Answers ──
            commands::gold_answers::save_gold_answer,
            commands::gold_answers::list_gold_answers,
            commands::gold_answers::search_gold_answers_cmd,
            commands::gold_answers::delete_gold_answer_cmd,
            commands::gold_answers::export_gold_answers_jsonl,
            // ── Summaries ──
            commands::summaries::generate_session_summary,
            commands::summaries::save_session_summary,
            commands::summaries::get_session_summary,
            commands::summaries::export_summaries_bundle,
            // ── Release Notes ──
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
            // ── Widget ──
            widget_commands::toggle_widget,
            widget_commands::show_widget,
            widget_commands::hide_widget,
            widget_commands::is_widget_visible,
            widget_commands::resize_widget,
            widget_commands::focus_main_window,
            widget_commands::get_widget_position,
            widget_commands::move_widget,
            widget_commands::is_main_window_visible,
            widget_commands::set_hover_button_enabled,
            // ── Investigation ──
            commands::investigation::investigate_jira_ticket,
            commands::investigation::investigate_jira_regression_family,
            commands::investigation::investigate_jira_expected_behavior,
            commands::investigation::investigate_jira_customer_history,
            commands::investigation::search_confluence_docs,
            commands::investigation::get_confluence_page,
            // ── JIRA Assist ──
            commands::jira_assist::get_ticket_brief,
            commands::jira_assist::get_ticket_briefs_batch,
            commands::jira_assist::get_all_ticket_briefs,
            commands::jira_assist::delete_ticket_brief,
            commands::jira_assist::triage_jira_ticket,
            commands::jira_assist::generate_ticket_brief,
            commands::jira_assist::find_similar_tickets,
            commands::jira_assist::post_brief_to_jira,
            commands::jira_assist::submit_engineer_feedback,
            commands::jira_assist::start_poller,
            commands::jira_assist::stop_poller,
            commands::jira_assist::get_poller_status,
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
                // Hide widget when main window is minimized.
                // Routed through the WidgetLock to prevent racing with
                // JS-triggered show/resize operations on the widget.
                tauri::WindowEvent::Resized(_) if window.label() == "main" => {
                    if let Ok(true) = window.is_minimized() {
                        let app = window.app_handle().clone();
                        tauri::async_runtime::spawn(async move {
                            let wl = app.state::<widget_commands::WidgetLock>();
                            let _guard = wl.0.lock().await;
                            if let Some(widget) = app.get_webview_window("widget") {
                                if widget.is_visible().unwrap_or(false) {
                                    let _ = widget.hide();
                                    let _ = widget.set_always_on_top(false);
                                    log::debug!("widget: hidden on main minimize (lock-aware)");
                                }
                            }
                        });
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
