mod server;

#[tauri::command]
fn start_win_local_server(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    match server::start_server(app) {
        Ok(url) => {
            let mut val = serde_json::Map::new();
            val.insert("url".to_string(), serde_json::Value::String(url));
            val.insert(
                "mdnsUrl".to_string(),
                serde_json::Value::String("".to_string()),
            );
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
        .set(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AVD-Updater",
        )
        .call()
        .map_err(|e| format!("下載請求失敗: {}", e))?;

    let total_bytes: i64 = response
        .header("Content-Length")
        .and_then(|l| l.parse().ok())
        .unwrap_or(0);

    let mut reader = response.into_reader();
    let mut file = File::create(&file_path).map_err(|e| format!("無法建立檔案: {}", e))?;

    let mut buffer = [0u8; 16384];
    let mut downloaded_bytes: i64 = 0;
    let mut last_emit = Instant::now();

    loop {
        let bytes_read = reader
            .read(&mut buffer)
            .map_err(|e| format!("讀取下載流失敗: {}", e))?;
        if bytes_read == 0 {
            break;
        }
        file.write_all(&buffer[..bytes_read])
            .map_err(|e| format!("寫入檔案失敗: {}", e))?;
        downloaded_bytes += bytes_read as i64;

        if last_emit.elapsed().as_millis() >= 100
            || (total_bytes > 0 && downloaded_bytes == total_bytes)
        {
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
    let win_path = msi_path.replace("/", "\\");

    // 取得目前 exe 路徑，安裝完後重新啟動
    let current_exe =
        std::env::current_exe().map_err(|e| format!("無法取得目前程式路徑: {}", e))?;
    let exe_path = current_exe.to_string_lossy().to_string();

    // 建立臨時 bat 腳本：等 AVD 關閉 → 安裝 MSI → 重啟 AVD → 自刪
    let temp_dir = std::env::temp_dir();
    let bat_path = temp_dir.join("avd_update.bat");

    let bat_content = format!(
        "@echo off\r\ntimeout /t 3 /nobreak >nul\r\nmsiexec /i \"{}\" /passive\r\ntimeout /t 2 /nobreak >nul\r\nstart \"\" \"{}\"\r\ndel \"%~f0\"\r\n",
        win_path, exe_path
    );

    std::fs::write(&bat_path, &bat_content).map_err(|e| format!("建立更新腳本失敗: {}", e))?;

    std::process::Command::new("cmd")
        .args(["/C", "start", "/min", "", &bat_path.to_string_lossy()])
        .spawn()
        .map_err(|e| format!("啟動更新腳本失敗: {}", e))?;

    std::process::exit(0);
}

#[tauri::command]
fn fetch_http_text(url: String) -> Result<String, String> {
    use std::time::Duration;

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout_read(Duration::from_secs(10))
        .build();

    let response = agent
        .get(&url)
        .set(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        .call()
        .map_err(|e| format!("HTTP 請求失敗: {}", e))?;

    let text = response
        .into_string()
        .map_err(|e| format!("讀取回應內容失敗: {}", e))?;

    Ok(text)
}

#[tauri::command]
async fn fetch_channel_videos_fallback(app: tauri::AppHandle, channel_id: String) -> Result<String, String> {
    use tauri_plugin_shell::ShellExt;
    let sidecar_command = app.shell().sidecar("yt-dlp").map_err(|e| e.to_string())?;
    
    // URL 保持 /channel/{id}（不加 /videos），以同時涵蓋 Videos + Shorts；Live 分頁由前端過濾。
    let url = format!("https://www.youtube.com/channel/{}", channel_id);
    // 不使用 --flat-playlist：該模式下 yt-dlp 不回傳 timestamp 與 upload_date（皆為 null），
    // 會迫使前端 fallback 至 Date.now() 而污染 lastPublishedTime 基準。
    // 改以 --skip-download 逐一解析影片頁面取得精確發布時間，並以 --playlist-end 2 限制解析數量。
    let output = sidecar_command
        .args(["--dump-json", "--skip-download", "--playlist-end", "2", &url])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into_owned())
    }
}

#[tauri::command]
async fn update_yt_dlp(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_shell::ShellExt;
    let sidecar_command = app.shell().sidecar("yt-dlp").map_err(|e| e.to_string())?;
    let output = sidecar_command
        .args(["--update-to", "nightly"])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into_owned())
    }
}

#[tauri::command]
async fn get_yt_dlp_version(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_shell::ShellExt;
    let sidecar_command = app.shell().sidecar("yt-dlp").map_err(|e| e.to_string())?;
    let output = sidecar_command
        .args(["--version"])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into_owned())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .invoke_handler(tauri::generate_handler![
            start_win_local_server,
            stop_win_local_server,
            download_win_update_file,
            install_win_msi,
            fetch_http_text,
            fetch_channel_videos_fallback,
            update_yt_dlp,
            get_yt_dlp_version
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
