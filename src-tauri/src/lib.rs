pub mod detection;
mod direct_scan;
pub mod domain_analysis;
mod export_cleanup;
mod importer;
mod investigation;
pub mod models;
pub mod search_index;
mod settings;
mod storage;
mod updater;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let state = storage::AppState::initialize(app.handle())?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            settings::get_settings,
            settings::save_onboarding,
            settings::update_theme,
            settings::update_security_settings,
            settings::get_system_status,
            updater::check_for_updates,
            detection::inspect_sources,
            direct_scan::start_direct_search,
            direct_scan::cancel_direct_search,
            direct_scan::pause_direct_search,
            direct_scan::resume_direct_search,
            importer::start_import,
            importer::resume_dataset_import,
            importer::rebuild_identities,
            importer::rebuild_domains,
            importer::pause_import,
            importer::resume_import,
            importer::cancel_import,
            importer::list_datasets,
            importer::delete_dataset,
            investigation::get_overview_stats,
            investigation::search_records,
            investigation::search_identity_records,
            investigation::list_domains,
            investigation::get_domain_details,
            investigation::list_identities,
            investigation::list_identity_members,
            investigation::apply_identity_action,
            investigation::create_manual_identity,
            investigation::save_search,
            investigation::list_saved_searches,
            export_cleanup::export_records,
            export_cleanup::list_exports,
            export_cleanup::cleanup_generated,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Aletheia");
}
