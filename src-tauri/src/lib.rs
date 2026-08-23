mod can;
mod dbc;

use can::{
    can_connection_status, connect_can_device, disconnect_can_device, encode_can_message,
    generate_checksum, list_can_devices, send_can_frame, send_can_message, CanState,
};
use dbc::parse_dbc_file;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    Emitter,
};

/// Menu item ids that are forwarded to the frontend as-is; they double as the
/// `commands` ids in `src/commands/definitions.ts` so the same accelerator
/// (e.g. "Mod+O") shown in the app and the native menu trigger the same command.
const MENU_EVENT: &str = "menu-command";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(debug_assertions)] // only enable instrumentation in development builds
    {
        builder = builder.plugin(tauri_plugin_devtools::init());
    }
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(CanState::default())
        .invoke_handler(tauri::generate_handler![
            parse_dbc_file,
            list_can_devices,
            connect_can_device,
            disconnect_can_device,
            can_connection_status,
            encode_can_message,
            generate_checksum,
            send_can_frame,
            send_can_message,
        ])
        .menu(|handle| {
            // On macOS the *first* top-level submenu is always coerced into the
            // bold application menu (named after the app, holding About/Quit/etc)
            // regardless of what it's titled — so it must come before "File" or
            // "File" gets swallowed into it.
            let app_menu = SubmenuBuilder::new(handle, "CAN Tool")
                .item(&PredefinedMenuItem::about(handle, None, None)?)
                .separator()
                .item(&PredefinedMenuItem::services(handle, None)?)
                .separator()
                .item(&PredefinedMenuItem::hide(handle, None)?)
                .item(&PredefinedMenuItem::hide_others(handle, None)?)
                .item(&PredefinedMenuItem::show_all(handle, None)?)
                .separator()
                .item(&PredefinedMenuItem::quit(handle, None)?)
                .build()?;

            let open_file = MenuItemBuilder::with_id("file.open", "Open File…")
                .accelerator("CmdOrCtrl+O")
                .build(handle)?;

            let file_menu = SubmenuBuilder::new(handle, "File")
                .item(&open_file)
                .separator()
                .item(&PredefinedMenuItem::close_window(handle, None)?)
                .build()?;

            let edit_menu = SubmenuBuilder::new(handle, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            MenuBuilder::new(handle)
                .item(&app_menu)
                .item(&file_menu)
                .item(&edit_menu)
                .build()
        })
        .on_menu_event(|app, event| {
            let _ = app.emit(MENU_EVENT, event.id().0.clone());
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
