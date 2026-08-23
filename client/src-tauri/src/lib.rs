mod dbc;
mod posts;

use dbc::parse_dbc_file;
use posts::{create_post, delete_post, fetch_post, fetch_posts, update_post, PostsStore};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(PostsStore::new())
        .invoke_handler(tauri::generate_handler![
            greet,
            fetch_posts,
            fetch_post,
            create_post,
            update_post,
            delete_post,
            parse_dbc_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
