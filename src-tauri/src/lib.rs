mod server;

#[tauri::command]
fn start_win_local_server(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    match server::start_server(app) {
        Ok(url) => {
            let mut val = serde_json::Map::new();
            val.insert("url".to_string(), serde_json::Value::String(url));
            val.insert("mdnsUrl".to_string(), serde_json::Value::String("".to_string()));
            Ok(serde_json::Value::Object(val))
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
fn stop_win_local_server() {
    server::stop_server();
}

#[tauri::command]
fn install_win_msi(msi_path: String) -> Result<(), String> {
    std::process::Command::new("msiexec")
        .args(["/i", &msi_path, "/passive"])
        .spawn()
        .map_err(|e| format!("啟動 MSI 安裝失敗: {}", e))?;
    std::process::exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_os::init())
    .invoke_handler(tauri::generate_handler![
        start_win_local_server,
        stop_win_local_server,
        install_win_msi
    ])
    .setup(|_app| {
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
