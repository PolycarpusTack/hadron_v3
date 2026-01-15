// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod database;
mod migrations;
mod python_runner;
mod model_fetcher;
mod ai_service;

use commands::*;
use database::Database;

fn main() {
    // Initialize database
    let db = Database::new().expect("Failed to initialize database");

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("hadron".to_string())
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                ])
                .level(log::LevelFilter::Info)
                .build()
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(db)
        .invoke_handler(tauri::generate_handler![
            analyze_crash_log,
            translate_content,
            get_all_analyses,
            get_analyses_paginated,
            get_analyses_count,
            get_analysis_by_id,
            delete_analysis,
            export_analysis,
            // Phase 2: Search & Favorites
            search_analyses,
            toggle_favorite,
            get_favorites,
            get_recent,
            // Phase 2: Database Management
            get_database_statistics,
            optimize_fts_index,
            check_database_integrity,
            compact_database,
            checkpoint_wal,
            // Translation Management
            get_all_translations,
            get_translation_by_id,
            delete_translation,
            toggle_translation_favorite,
            // Model Management
            list_models,
            test_connection,
            // File Management
            save_pasted_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
