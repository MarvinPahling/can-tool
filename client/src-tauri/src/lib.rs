mod dbc;

use dbc::parse_dbc_file;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![parse_dbc_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
