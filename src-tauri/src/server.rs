use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::Emitter;
use tiny_http::{Header, Response, Server, StatusCode};
use urlencoding::decode;

use std::collections::HashMap;

static SERVER_RUNNING: AtomicBool = AtomicBool::new(false);
static SERVER_INSTANCE: Mutex<Option<Arc<Server>>> = Mutex::new(None);
static PORT: u16 = 8080;

static BYTES_PER_IP: Mutex<Option<HashMap<String, u64>>> = Mutex::new(None);
static UA_PER_IP: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);
static SERVER_TIMER_THREAD_SPAWNED: AtomicBool = AtomicBool::new(false);

fn parse_device_name(ua: &str) -> String {
    let lower_ua = ua.to_lowercase();
    if lower_ua.contains("ipad") {
        return "iPad".to_string();
    }
    if lower_ua.contains("iphone") {
        return "iPhone".to_string();
    }
    if lower_ua.contains("macintosh") || lower_ua.contains("mac os x") {
        return "Mac".to_string();
    }
    if lower_ua.contains("windows") {
        return "Windows PC".to_string();
    }
    if lower_ua.contains("android") {
        return "Android 設備".to_string();
    }
    if lower_ua.contains("tizen") || lower_ua.contains("webos") || lower_ua.contains("smart-tv") {
        return "智慧電視".to_string();
    }
    "未知設備".to_string()
}

pub struct TrackingReader<R: Read> {
    inner: R,
    client_ip: String,
}

impl<R: Read> TrackingReader<R> {
    pub fn new(inner: R, client_ip: String) -> Self {
        Self { inner, client_ip }
    }

    fn track(&mut self, bytes: u64) {
        if let Ok(mut guard) = BYTES_PER_IP.lock() {
            if let Some(map) = guard.as_mut() {
                *map.entry(self.client_ip.clone()).or_insert(0) += bytes;
            }
        }
    }
}

impl<R: Read> Read for TrackingReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        if n > 0 {
            self.track(n as u64);
        }
        Ok(n)
    }
}

pub fn get_local_ip() -> String {
    local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string())
}

fn get_downloads_dir() -> PathBuf {
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        let p = PathBuf::from(user_profile).join("Downloads").join("AVD");
        if !p.exists() {
            let _ = std::fs::create_dir_all(&p);
        }
        return p;
    }
    let p = PathBuf::from("./AVD");
    if !p.exists() {
        let _ = std::fs::create_dir_all(&p);
    }
    p
}

pub fn start_server(app_handle: tauri::AppHandle) -> Result<String, String> {
    if SERVER_RUNNING.load(Ordering::SeqCst) {
        let ip = get_local_ip();
        return Ok(format!("http://{}:{}", ip, PORT));
    }

    let server = Arc::new(
        Server::http(format!("0.0.0.0:{}", PORT))
            .map_err(|e| format!("無法啟動 HTTP 伺服器: {}", e))?,
    );

    SERVER_RUNNING.store(true, Ordering::SeqCst);
    if let Ok(mut guard) = SERVER_INSTANCE.lock() {
        *guard = Some(server.clone());
    }

    let server_clone = server.clone();

    if !SERVER_TIMER_THREAD_SPAWNED.swap(true, Ordering::SeqCst) {
        let app_handle_timer = app_handle.clone();
        *BYTES_PER_IP.lock().unwrap() = Some(HashMap::new());
        *UA_PER_IP.lock().unwrap() = Some(HashMap::new());

        thread::spawn(move || loop {
            thread::sleep(std::time::Duration::from_millis(1000));
            let mut total_speed = 0;
            let mut current_speeds = HashMap::new();
            let mut devices_obj = serde_json::Map::new();

            if let Ok(mut guard) = BYTES_PER_IP.lock() {
                if let Some(map) = guard.as_mut() {
                    for (ip, bytes) in map.iter_mut() {
                        let speed = *bytes;
                        *bytes = 0;
                        if speed > 0 {
                            total_speed += speed;
                            current_speeds.insert(ip.clone(), speed);
                        }
                    }
                }
            }

            if let Ok(guard) = UA_PER_IP.lock() {
                if let Some(ua_map) = guard.as_ref() {
                    for (ip, speed) in current_speeds.iter() {
                        let ua = ua_map
                            .get(ip)
                            .cloned()
                            .unwrap_or_else(|| "未知設備".to_string());
                        let friendly_name = parse_device_name(&ua);
                        let key = format!("{} ({})", ip, friendly_name);
                        devices_obj.insert(key, serde_json::json!(speed));
                    }
                }
            }

            let _ = app_handle_timer.emit(
                "serverUploadSpeed",
                serde_json::json!({
                    "speed": total_speed,
                    "devices": devices_obj
                }),
            );
        });
    }

    thread::spawn(move || {
        let downloads_dir = get_downloads_dir();

        while SERVER_RUNNING.load(Ordering::SeqCst) {
            match server_clone.recv() {
                Ok(request) => {
                    let client_ip = request
                        .remote_addr()
                        .map(|addr| addr.ip().to_string())
                        .unwrap_or_else(|| "unknown".to_string());
                    let user_agent = request
                        .headers()
                        .iter()
                        .find(|h| h.field.equiv("User-Agent"))
                        .map(|h| h.value.as_str().to_string())
                        .unwrap_or_else(|| "unknown".to_string());

                    if let Ok(mut guard) = UA_PER_IP.lock() {
                        if let Some(map) = guard.as_mut() {
                            map.insert(client_ip.clone(), user_agent);
                        }
                    }

                    let url = request.url().to_string();
                    let decoded_url = decode(&url)
                        .unwrap_or(std::borrow::Cow::Borrowed(&url))
                        .to_string();

                    if decoded_url == "/" {
                        let html = serve_index(&downloads_dir);
                        let response = Response::from_string(html).with_header(
                            Header::from_bytes(
                                &b"Content-Type"[..],
                                &b"text/html; charset=UTF-8"[..],
                            )
                            .unwrap(),
                        );
                        let _ = request.respond(response);
                    } else if decoded_url == "/api/list" {
                        let json = serve_api_list(&downloads_dir);
                        let response = Response::from_string(json).with_header(
                            Header::from_bytes(
                                &b"Content-Type"[..],
                                &b"application/json; charset=UTF-8"[..],
                            )
                            .unwrap(),
                        );
                        let _ = request.respond(response);
                    } else if decoded_url.starts_with("/api/remote-play") {
                        let play_uri = url
                            .split("uri=")
                            .nth(1)
                            .or_else(|| url.split("url=").nth(1))
                            .unwrap_or("");
                        let play_uri = decode(play_uri)
                            .unwrap_or(std::borrow::Cow::Borrowed(play_uri))
                            .to_string();
                        if !play_uri.is_empty() {
                            let _ = std::process::Command::new("cmd")
                                .args(["/C", "start", "", &play_uri])
                                .spawn();
                            let response = Response::from_string("{\"success\":true}").with_header(
                                Header::from_bytes(
                                    &b"Content-Type"[..],
                                    &b"application/json; charset=UTF-8"[..],
                                )
                                .unwrap(),
                            );
                            let _ = request.respond(response);
                        } else {
                            let response = Response::from_string(
                                "{\"success\":false,\"error\":\"Missing uri parameter\"}",
                            )
                            .with_status_code(StatusCode(400));
                            let _ = request.respond(response);
                        }
                    } else if decoded_url.starts_with("/play/") {
                        let filename = decoded_url.trim_start_matches("/play/");
                        serve_media(request, &downloads_dir, filename, false, client_ip);
                    } else if decoded_url.starts_with("/files/") {
                        let filename = decoded_url.trim_start_matches("/files/");
                        serve_media(request, &downloads_dir, filename, true, client_ip);
                    } else {
                        let response = Response::from_string("404 Not Found")
                            .with_status_code(StatusCode(404));
                        let _ = request.respond(response);
                    }
                }
                Err(_) => {
                    break;
                }
            }
        }

        if let Ok(mut guard) = SERVER_INSTANCE.lock() {
            *guard = None;
        }
        SERVER_RUNNING.store(false, Ordering::SeqCst);
    });

    let ip = get_local_ip();
    Ok(format!("http://{}:{}", ip, PORT))
}

pub fn stop_server() {
    SERVER_RUNNING.store(false, Ordering::SeqCst);
    if let Ok(mut guard) = SERVER_INSTANCE.lock() {
        if let Some(server) = guard.take() {
            server.unblock();
        }
    }
}

#[allow(dead_code)]
pub fn is_server_running() -> bool {
    SERVER_RUNNING.load(Ordering::SeqCst)
}

fn collect_files_from_dir(
    dir: &PathBuf,
    base_dir: &PathBuf,
    files_list: &mut Vec<(String, u64, std::time::SystemTime, String)>,
) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    let ext_lower = ext.to_lowercase();
                    if matches!(ext_lower.as_str(), "mp4" | "m4a" | "mp3" | "webm" | "mkv") {
                        let rel_path = path
                            .strip_prefix(base_dir)
                            .unwrap_or(&path)
                            .to_string_lossy()
                            .to_string()
                            .replace('\\', "/");
                        let metadata = entry.metadata().ok();
                        let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
                        let modified = metadata
                            .as_ref()
                            .and_then(|m| m.modified().ok())
                            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                        let folder_name = if dir != base_dir {
                            dir.file_name()
                                .map(|n| n.to_string_lossy().to_string())
                                .unwrap_or_default()
                        } else {
                            String::new()
                        };
                        files_list.push((rel_path, size, modified, folder_name));
                    }
                }
            } else if path.is_dir() {
                collect_files_from_dir(&path, base_dir, files_list);
            }
        }
    }
}

fn serve_api_list(downloads_dir: &PathBuf) -> String {
    let mut files_list = Vec::new();
    collect_files_from_dir(downloads_dir, downloads_dir, &mut files_list);
    files_list.sort_by(|a, b| b.2.cmp(&a.2));

    let mut json_arr = Vec::new();
    for (rel_path, size, _, folder_name) in files_list {
        let encoded_rel_path = urlencoding::encode(&rel_path).replace("%2F", "/");
        let file_display_name = rel_path.split('/').last().unwrap_or(&rel_path).to_string();
        let obj = serde_json::json!({
            "name": file_display_name,
            "folder": folder_name,
            "size": size,
            "playUrl": format!("/play/{}", encoded_rel_path),
            "downloadUrl": format!("/files/{}", encoded_rel_path)
        });
        json_arr.push(obj);
    }
    serde_json::to_string(&json_arr).unwrap_or_else(|_| "[]".to_string())
}

fn serve_index(downloads_dir: &PathBuf) -> String {
    let mut files_list = Vec::new();
    collect_files_from_dir(downloads_dir, downloads_dir, &mut files_list);

    files_list.sort_by(|a, b| b.2.cmp(&a.2));

    // Group files by folder_name preserving order
    let mut grouped_files: HashMap<String, Vec<(String, u64, std::time::SystemTime, String)>> =
        HashMap::new();
    let mut group_order = Vec::new();

    for file in files_list {
        let folder = file.3.clone();
        if !grouped_files.contains_key(&folder) {
            group_order.push(folder.clone());
        }
        grouped_files.entry(folder).or_default().push(file);
    }

    let mut html = String::new();
    html.push_str("<!DOCTYPE html><html><head><meta charset=\"UTF-8\">");
    html.push_str("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">");
    html.push_str("<title>AVD 影音快傳 (Windows 伺服器)</title>");
    html.push_str("<style>");
    html.push_str("body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 16px; background-color: #f8fafc; color: #0f172a; }");
    html.push_str(".header { background: linear-gradient(135deg, #2563eb, #3b82f6); color: white; padding: 20px 16px; border-radius: 16px; margin-bottom: 20px; text-align: center; box-shadow: 0 10px 15px -3px rgba(37, 99, 235, 0.3); }");
    html.push_str(".header h1 { margin: 0 0 6px 0; font-size: 22px; font-weight: 700; }");
    html.push_str(".header p { margin: 0; font-size: 13px; opacity: 0.9; }");
    html.push_str(".group-card { background: white; border-radius: 12px; margin-bottom: 16px; border: 1px solid #e2e8f0; box-shadow: 0 2px 4px rgba(0,0,0,0.04); overflow: hidden; }");
    html.push_str(".group-header { background: #f1f5f9; padding: 12px 16px; font-weight: 700; font-size: 15px; color: #334155; display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none; }");
    html.push_str(".group-header:hover { background: #e2e8f0; }");
    html.push_str(".group-title { display: flex; align-items: center; gap: 8px; }");
    html.push_str(".badge-count { background: #3b82f6; color: white; border-radius: 20px; padding: 2px 8px; font-size: 11px; font-weight: 600; }");
    html.push_str(".file-card { padding: 14px 16px; border-bottom: 1px solid #f1f5f9; display: flex; flex-direction: column; gap: 8px; }");
    html.push_str(".file-card:last-child { border-bottom: none; }");
    html.push_str(".file-name { font-weight: 600; font-size: 15px; word-break: break-all; color: #1e293b; display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }");
    html.push_str(".file-meta { font-size: 12px; color: #64748b; }");
    html.push_str(".btn-group { display: flex; gap: 8px; margin-top: 4px; }");
    html.push_str(".btn { color: white; border: none; padding: 8px 14px; border-radius: 8px; text-align: center; font-weight: 600; flex: 1; cursor: pointer; font-size: 13px; text-decoration: none; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease; }");
    html.push_str(
        ".btn-primary { background: #3b82f6; } .btn-primary:hover { background: #2563eb; }",
    );
    html.push_str(
        ".btn-secondary { background: #10b981; } .btn-secondary:hover { background: #059669; }",
    );
    html.push_str("</style>");
    html.push_str("<script>");
    html.push_str("function toggleGroup(id) {");
    html.push_str("  var el = document.getElementById(id);");
    html.push_str("  var arrow = document.getElementById('arrow-' + id);");
    html.push_str("  if (el.style.display === 'none') { el.style.display = 'block'; if (arrow) arrow.innerText = '▼'; }");
    html.push_str("  else { el.style.display = 'none'; if (arrow) arrow.innerText = '▶'; }");
    html.push_str("}");
    html.push_str("</script>");
    html.push_str("</head><body>");
    html.push_str("<div class=\"header\"><h1>💻 AVD 影音快傳服務器 (Windows)</h1><p>已下載影音檔案 (依頻道與播放清單分組)</p></div>");

    if group_order.is_empty() {
        html.push_str("<p style=\"text-align: center; color: #94a3b8; margin-top: 40px;\">目前沒有已下載的影音檔案。</p>");
    } else {
        let mut group_idx = 0;
        for folder_name in group_order {
            if let Some(files) = grouped_files.get(&folder_name) {
                group_idx += 1;
                let group_id = format!("group-{}", group_idx);

                html.push_str("<div class=\"group-card\">");
                if !folder_name.is_empty() {
                    html.push_str(&format!(
                        "<div class=\"group-header\" onclick=\"toggleGroup('{}')\"><div class=\"group-title\"><span>📂 {}</span><span class=\"badge-count\">{} 個內容</span></div><span id=\"arrow-{}\">▼</span></div>",
                        group_id, folder_name, files.len(), group_id
                    ));
                } else {
                    html.push_str(&format!(
                        "<div class=\"group-header\" onclick=\"toggleGroup('{}')\"><div class=\"group-title\"><span>🎬 單一影音檔案</span><span class=\"badge-count\">{} 個內容</span></div><span id=\"arrow-{}\">▼</span></div>",
                        group_id, files.len(), group_id
                    ));
                }

                html.push_str(&format!("<div id=\"{}\">", group_id));
                for (rel_path, size, _, _) in files {
                    let size_mb = size / (1024 * 1024);
                    let encoded_rel_path = urlencoding::encode(rel_path).replace("%2F", "/");
                    let file_display_name = rel_path.split('/').last().unwrap_or(rel_path);

                    html.push_str("<div class=\"file-card\">");
                    html.push_str(&format!(
                        "<div class=\"file-name\"><span>{}</span></div>",
                        file_display_name
                    ));
                    html.push_str(&format!(
                        "<div class=\"file-meta\">檔案大小: {} MB</div>",
                        size_mb
                    ));
                    html.push_str("<div class=\"btn-group\">");
                    html.push_str(&format!("<a class=\"btn btn-primary\" href=\"/files/{}\" download=\"{}\">⬇ 下載檔案</a>", encoded_rel_path, file_display_name));
                    html.push_str(&format!("<a class=\"btn btn-secondary\" href=\"/play/{}\" target=\"_blank\">▶ 線上播放</a>", encoded_rel_path));
                    html.push_str("</div></div>");
                }
                html.push_str("</div></div>");
            }
        }
    }

    html.push_str("</body></html>");
    html
}

fn serve_media(
    request: tiny_http::Request,
    downloads_dir: &PathBuf,
    filename: &str,
    is_download: bool,
    client_ip: String,
) {
    let mut target_file_path = downloads_dir.join(filename);
    if !target_file_path.exists() || !target_file_path.is_file() {
        if let Ok(raw_decoded) = urlencoding::decode(filename) {
            let alt_path = downloads_dir.join(raw_decoded.as_ref());
            if alt_path.exists() && alt_path.is_file() {
                target_file_path = alt_path;
            }
        }
    }

    if !target_file_path.exists() || !target_file_path.is_file() {
        let _ = request
            .respond(Response::from_string("404 File Not Found").with_status_code(StatusCode(404)));
        return;
    }

    let mut file = match File::open(&target_file_path) {
        Ok(f) => f,
        Err(_) => {
            let _ = request.respond(
                Response::from_string("500 File Read Error").with_status_code(StatusCode(500)),
            );
            return;
        }
    };

    let file_len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let mime_type = if filename.ends_with(".mp3") {
        "audio/mpeg"
    } else if filename.ends_with(".mp4") {
        "video/mp4"
    } else if filename.ends_with(".m4a") {
        "audio/mp4"
    } else {
        "application/octet-stream"
    };

    // 檢查 Range 請求標頭
    let range_header = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("Range"))
        .map(|h| h.value.as_str());

    if let Some(range_val) = range_header {
        if range_val.starts_with("bytes=") {
            let parts: Vec<&str> = range_val["bytes=".len()..].split('-').collect();
            let start: u64 = parts[0].parse().unwrap_or(0);
            let end: u64 = if parts.len() > 1 && !parts[1].is_empty() {
                parts[1].parse().unwrap_or(file_len - 1)
            } else {
                file_len - 1
            };

            let end = if end >= file_len { file_len - 1 } else { end };
            let chunk_size = if end >= start { end - start + 1 } else { 0 };

            if file.seek(SeekFrom::Start(start)).is_ok() {
                let reader = TrackingReader::new(file.take(chunk_size), client_ip.clone());

                let mut headers = vec![
                    Header::from_bytes(&b"Content-Type"[..], mime_type.as_bytes()).unwrap(),
                    Header::from_bytes(&b"Accept-Ranges"[..], &b"bytes"[..]).unwrap(),
                    Header::from_bytes(
                        &b"Content-Range"[..],
                        format!("bytes {}-{}/{}", start, end, file_len).as_bytes(),
                    )
                    .unwrap(),
                ];

                if is_download {
                    let encoded = urlencoding::encode(filename);
                    let fallback_name = if filename.to_lowercase().ends_with(".mp3") {
                        "download.mp3"
                    } else {
                        "download.mp4"
                    };
                    let header_val = format!(
                        "attachment; filename=\"{}\"; filename*=UTF-8''{}",
                        fallback_name, encoded
                    );
                    headers.push(
                        Header::from_bytes(&b"Content-Disposition"[..], header_val.as_bytes())
                            .unwrap(),
                    );
                }

                let response = Response::new(
                    StatusCode(206),
                    headers,
                    reader,
                    Some(chunk_size as usize),
                    None,
                );

                let _ = request.respond(response);
                return;
            }
        }
    }

    // 普通整檔響應
    let reader = TrackingReader::new(file, client_ip);

    let mut headers = vec![
        Header::from_bytes(&b"Content-Type"[..], mime_type.as_bytes()).unwrap(),
        Header::from_bytes(&b"Accept-Ranges"[..], &b"bytes"[..]).unwrap(),
    ];

    if is_download {
        let encoded = urlencoding::encode(filename);
        let fallback_name = if filename.to_lowercase().ends_with(".mp3") {
            "download.mp3"
        } else {
            "download.mp4"
        };
        let header_val = format!(
            "attachment; filename=\"{}\"; filename*=UTF-8''{}",
            fallback_name, encoded
        );
        headers
            .push(Header::from_bytes(&b"Content-Disposition"[..], header_val.as_bytes()).unwrap());
    }

    let response = Response::new(
        StatusCode(200),
        headers,
        reader,
        Some(file_len as usize),
        None,
    );

    let _ = request.respond(response);
}
