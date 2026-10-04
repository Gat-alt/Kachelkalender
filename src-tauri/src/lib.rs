// Kachelkalender: die Oberfläche läuft im System-Webview.
// Netzwerk nur zu den Kalender-Servern, die du selbst einträgst (über das HTTP-Plugin),
// Erinnerungen über das Notification-Plugin. Kein eigener Server, kein Tracking.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .run(tauri::generate_context!())
        .expect("Kachelkalender konnte nicht gestartet werden");
}
