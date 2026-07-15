use tauri::{Manager, WebviewWindow};
fn test(window: &WebviewWindow) {
    let _ = window.navigate("http://127.0.0.1:4567".parse().unwrap());
}
