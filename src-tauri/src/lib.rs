// Kachelkalender: die Oberfläche läuft im System-Webview.
// Netzwerk nur zu den Kalender-Servern, die du selbst einträgst (über das HTTP-Plugin),
// Erinnerungen über das Notification-Plugin. Kein eigener Server, kein Tracking.
// Startbildschirm-Widget (Android): die nächsten Termine als kleine Datei im App-Ordner,
// das Widget liest sie von dort. Nur lokal, nichts verlässt das Gerät.
#[tauri::command]
fn widget_data(app: tauri::AppHandle, json: String, name: Option<String>) -> Result<(), String> {
    use tauri::Manager;
    let file = match name.as_deref() { Some("tasks") => "kk-tasks.json", Some("week") => "kk-week.json", _ => "kk-widget.json" };
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(file), json).map_err(|e| e.to_string())
}

// Hat ein Widget gebeten, etwas Bestimmtes zu öffnen (z. B. die Aufgaben)? Einmal abholen und löschen.
#[tauri::command]
fn widget_open(app: tauri::AppHandle) -> String {
    use tauri::Manager;
    let Ok(dir) = app.path().app_data_dir() else { return String::new() };
    let f = dir.join("kk-open.txt");
    let s = std::fs::read_to_string(&f).unwrap_or_default();
    let _ = std::fs::remove_file(&f);
    s.trim().to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![widget_data, widget_open])
        .run(tauri::generate_context!())
        .expect("Kachelkalender konnte nicht gestartet werden");
}
