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

/// 網路狀態探測固定端點：僅回應 204 且無內容，用於判定「已連線但能否連上網際網路」，
/// 不代表任何特定網站可用（見 show-network-status/design.md）。
const NETWORK_PROBE_URL: &str = "https://www.gstatic.com/generate_204";

/// 主畫面網路狀態探測：只有取得預期的 204 才回傳 true。
/// 任何失敗（連線層、逾時、非 204 狀態碼）一律回傳 false，不視為例外——
/// 呼叫端（`useNetworkStatus`）依此區分 online 與 degraded，此處不代為判斷。
#[tauri::command]
fn probe_internet_connectivity(timeout_ms: u64) -> bool {
    use std::time::Duration;

    let timeout = Duration::from_millis(timeout_ms.max(1));
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(timeout)
        .timeout_read(timeout)
        .redirects(0)
        .build();

    match agent.get(NETWORK_PROBE_URL).call() {
        Ok(response) => response.status() == 204,
        Err(_) => false,
    }
}

/// 自訊息中移除網址的 query string。
///
/// 抽為自由函式以便單元測試：這是機密不外流的最後一道防線，
/// 而它保護的東西（API 金鑰）一旦寫進 avd_error_log 就等同公開
/// —— 錯誤日誌的設計目的就是讓使用者複製出來求助。
fn redact_query(message: String, query: Option<&str>) -> String {
    match query {
        Some(q) => message.replace(q, ""),
        None => message,
    }
}

/// 傳輸層錯誤是否為逾時。
///
/// `ureq` 把「DNS 解析失敗」「連線被拒」與「連線／讀取逾時」全都歸為
/// `Error::Transport`，但這三者對上層的意涵完全不同：前兩者代表**這台裝置**
/// 連不上網，逾時只代表**這一個請求**沒等到回應。
///
/// 前端的「提早停止」以裝置離線為唯一判準 —— 偵測到即中止整輪，因為剩餘
/// 頻道逐一嘗試也不會有不同結果。若逾時被歸為裝置離線，一個慢頻道就會讓
/// 整輪其餘頻道全部被跳過，並對使用者宣稱裝置無法連線。那比原本的慢嚴重
/// 得多，因為它會**靜默地**讓多數頻道整輪不被檢查。
///
/// 以訊息文字判定而非 `ErrorKind`：`ureq` 的 `ErrorKind::Io` 同時涵蓋逾時與
/// 其他 I/O 失敗（例如連線被對端關閉），單看 kind 分不出來；而逾時的訊息
/// 一律來自 `std::io::ErrorKind::TimedOut` 的 Display，穩定含有 "timed out"。
/// 誤判的代價不對稱：漏判（逾時被當成離線）會靜默跳過整輪，誤判（離線被當成
/// 逾時）只是少一次提早停止、其餘頻道照樣逐一失敗 —— 後者明顯較輕。
///
/// 抽為自由函式以便單元測試：`ureq::Transport` 無法在測試中直接建構。
fn is_timeout_transport_message(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("timed out") || lower.contains("timeout")
}

#[tauri::command]
fn fetch_http_text(
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
) -> Result<String, String> {
    use std::time::Duration;

    // 錯誤訊息 MUST NOT 帶出網址的 query string。
    //
    // 該處可能含機密（例如 YouTube Data API 金鑰），而 ureq 的錯誤字串會嵌入
    // 完整網址；這些訊息經 reportError 寫入 avd_error_log，而錯誤日誌的設計
    // 目的就是讓使用者複製出來求助 —— 機密一旦寫入其中，貼出日誌即等同公開。
    //
    // 前綴（HTTP_STATUS: / NETWORK_ERROR: / REQUEST_TIMEOUT:）刻意保留不變：
    // 前端的 `classifyApiError` 依 HTTP_STATUS 的 body 區分配額耗盡與金鑰無效，
    // `isDeviceOfflineError` 依 NETWORK_ERROR 判定裝置離線而提早結束整輪，
    // `isRequestTimeoutError` 依 REQUEST_TIMEOUT 將逾時排除於「裝置離線」之外。
    let query = url.find('?').map(|i| url[i..].to_string());
    let redact = |message: String| redact_query(message, query.as_deref());

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout_read(Duration::from_secs(10))
        .build();

    let mut request = agent.get(&url).set(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );

    // 選填標頭：供需要以標頭傳送認證的通道使用（YouTube Data API 的
    // X-goog-api-key）。金鑰因此不必進入網址，從結構上避免經錯誤訊息外流，
    // 而非只倚賴上方的遮蔽。未傳此參數時行為與加入前完全一致。
    if let Some(map) = &headers {
        for (key, value) in map {
            request = request.set(key, value);
        }
    }

    let response = request
        .call()
        .map_err(|e| {
            let message = redact(e.to_string());
            match e {
                ureq::Error::Status(status, response) => {
                    // 狀態碼不足以區分 API 的錯誤原因：403 可能是配額耗盡
                    // （quotaExceeded），也可能是服務未啟用（accessNotConfigured），
                    // 兩者的處置完全不同 —— 前者等待每日重置，後者要使用者修正金鑰。
                    // reason 只在回應 body 的 JSON 中，故於此附上。
                    //
                    // 只在 Content-Type 為 JSON 時附上：Google 的 API 錯誤是 JSON，
                    // 而一般網站的錯誤頁是整頁 HTML —— 附上只會把它塞進錯誤日誌。
                    // 截斷長度避免任何來源的巨大 body 灌爆日誌。
                    let is_json = response
                        .header("Content-Type")
                        .map(|value| value.to_lowercase().contains("json"))
                        .unwrap_or(false);

                    let detail = if is_json {
                        match response.into_string() {
                            Ok(body) => {
                                let excerpt: String = body.chars().take(500).collect();
                                format!("{} {}", message, redact(excerpt))
                            }
                            Err(_) => message,
                        }
                    } else {
                        message
                    };

                    format!("HTTP_STATUS:{}:{}", status, detail)
                }
                ureq::Error::Transport(_) => {
                    // 逾時 MUST NOT 併入 NETWORK_ERROR —— 見 is_timeout_transport_message
                    if is_timeout_transport_message(&message) {
                        format!("REQUEST_TIMEOUT:{}", message)
                    } else {
                        format!("NETWORK_ERROR:{}", message)
                    }
                }
            }
        })?;

    let text = response
        .into_string()
        .map_err(|e| format!("讀取回應內容失敗: {}", e))?;

    Ok(text)
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
            probe_internet_connectivity,
            update_yt_dlp,
            get_yt_dlp_version
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


#[cfg(test)]
mod timeout_classify_tests {
    use super::is_timeout_transport_message;

    #[test]
    fn timeout_messages_are_recognised() {
        for message in [
            "Network Error: Connection timed out",
            "io: connection timed out (os error 10060)",
            "read timeout",
            "The operation TIMED OUT",
        ] {
            assert!(is_timeout_transport_message(message), "{}", message);
        }
    }

    #[test]
    fn offline_messages_are_not_timeouts() {
        // 這三者代表這台裝置連不上網，必須維持 NETWORK_ERROR 以觸發提早停止
        for message in [
            "Dns Failed: failed to resolve host name",
            "Connection Failed: connection refused (os error 10061)",
            "io: broken pipe",
        ] {
            assert!(!is_timeout_transport_message(message), "{}", message);
        }
    }
}

#[cfg(test)]
mod redact_tests {
    use super::redact_query;

    #[test]
    fn removes_query_string_from_message() {
        let url = "https://www.googleapis.com/youtube/v3/videos?part=snippet&id=abc";
        let query = url.find('?').map(|i| &url[i..]);
        let message = format!("{}: status code 403", url);
        let got = redact_query(message, query);
        assert_eq!(got, "https://www.googleapis.com/youtube/v3/videos: status code 403");
        assert!(!got.contains("part="));
        assert!(!got.contains("id=abc"));
    }

    #[test]
    fn removes_secret_bearing_query_even_if_key_were_in_url() {
        // 金鑰現在走 X-goog-api-key 標頭，此處為縱深防禦：
        // 即使日後有人把金鑰放回網址，也不得從錯誤訊息漏出。
        let url = "https://www.googleapis.com/youtube/v3/videos?key=AIzaSECRET123";
        let query = url.find('?').map(|i| &url[i..]);
        let message = format!("{}: status code 400", url);
        let got = redact_query(message, query);
        assert!(!got.contains("AIzaSECRET123"));
        assert!(!got.contains("key="));
    }

    #[test]
    fn non_secret_query_is_also_removed_but_host_kept() {
        // 遮蔽不挑對象：任何網址的 query string 一律移除，host 與路徑保留，
        // 使錯誤訊息仍可辨識是哪個端點失敗。
        let url = "https://www.googleapis.com/youtube/v3/channels?part=snippet&id=UCtest";
        let query = url.find('?').map(|i| &url[i..]);
        let got = redact_query(format!("{}: status code 404", url), query);
        assert_eq!(got, "https://www.googleapis.com/youtube/v3/channels: status code 404");
    }

    #[test]
    fn message_without_query_is_unchanged() {
        let got = redact_query("https://example.com/x: status code 500".to_string(), None);
        assert_eq!(got, "https://example.com/x: status code 500");
    }

    #[test]
    fn removes_every_occurrence_in_message() {
        let url = "https://a.test/p?k=v";
        let query = url.find('?').map(|i| &url[i..]);
        let got = redact_query(format!("{} failed; retried {}", url, url), query);
        assert!(!got.contains("k=v"));
    }
}
