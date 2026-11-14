// Da far: Aufgaben in farbigen Kacheln. Die Oberfläche läuft im System-Webview,
// alle Aufgaben bleiben auf dem Gerät. Kein Server, kein Tracking, keine Plugins mit Netzwerk.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("Da far konnte nicht gestartet werden");
}
