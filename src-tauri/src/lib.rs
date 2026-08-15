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
fn download_win_update_file(
    app: tauri::AppHandle,
    url: String,
    file_path: String,
) -> Result<String, String> {
    use std::fs::File;
    use std::io::{Read, Write};
    use std::time::Instant;
    use tauri::Emitter;

    let response = ureq::get(&url)
        .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AVD-Updater")
        .call()
        .map_err(|e| format!("下載請求失敗: {}", e))?;

    let total_bytes: i64 = response
        .header("Content-Length")
        .and_then(|l| l.parse().ok())
        .unwrap_or(0);

    let mut reader = response.into_reader();
    let mut file = File::create(&file_path)
        .map_err(|e| format!("無法建立檔案: {}", e))?;

    let mut buffer = [0u8; 16384];
    let mut downloaded_bytes: i64 = 0;
    let mut last_emit = Instant::now();

    loop {
        let bytes_read = reader.read(&mut buffer)
            .map_err(|e| format!("讀取下載流失敗: {}", e))?;
        if bytes_read == 0 {
            break;
        }
        file.write_all(&buffer[..bytes_read])
            .map_err(|e| format!("寫入檔案失敗: {}", e))?;
        downloaded_bytes += bytes_read as i64;

        if last_emit.elapsed().as_millis() >= 100 || (total_bytes > 0 && downloaded_bytes == total_bytes) {
            last_emit = Instant::now();
            let percent = if total_bytes > 0 {
                ((downloaded_bytes as f64 / total_bytes as f64) * 100.0).round() as i64
            } else {
                0
            };
            let _ = app.emit(
                "updateDownloadProgress",
                serde_json::json!({
                    "percent": percent,
                    "downloadedBytes": downloaded_bytes,
                    "totalBytes": total_bytes
                }),
            );
        }
    }

    file.flush().map_err(|e| format!("寫入完成失敗: {}", e))?;

    Ok(file_path)
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
        download_win_update_file,
        install_win_msi
    ])
    .setup(|_app| {
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
