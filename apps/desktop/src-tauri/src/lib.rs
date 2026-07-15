use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use std::sync::Mutex;

struct SidecarState {
    child_id: Mutex<Option<u32>>,
}

#[tauri::command]
fn get_server_port() -> u16 {
    4567
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState {
            child_id: Mutex::new(None),
        })
        .setup(|app| {
            let handle = app.handle().clone();

            // Spawn the Next.js sidecar server
            tauri::async_runtime::spawn(async move {
                let shell = handle.shell();
                // Try "larkup-server" directly (Tauri strips directory paths for the sidecar key)
                let sidecar = shell.sidecar("larkup-server")
                    .or_else(|_| shell.sidecar("binaries/larkup-server"))
                    .expect("Failed to create sidecar command object");

                // Build the path to the bundled Next.js standalone server
                let server_dir = handle
                    .path()
                    .resource_dir()
                    .unwrap()
                    .join("server/apps/web");
                let resource_path = server_dir.join("server.js");

                let (mut rx, child) = sidecar
                    .current_dir(server_dir)
                    .arg(resource_path.to_string_lossy().to_string())
                    .env("PORT", "4567")
                    .env("HOSTNAME", "127.0.0.1")
                    .spawn()
                    .expect("Failed to start Larkup server sidecar");

                // Store the child pid so we can clean up later
                let state = handle.state::<SidecarState>();
                *state.child_id.lock().unwrap() = Some(child.pid());

                // Forward sidecar stdout/stderr to the Tauri console
                while let Some(event) = rx.recv().await {
                    use tauri_plugin_shell::process::CommandEvent;
                    match event {
                        CommandEvent::Stdout(line) => {
                            let text = String::from_utf8_lossy(&line);
                            println!("[server] {}", text);

                            // Once the server logs its ready message, navigate the webview
                            let text_lower = text.to_lowercase();
                            if text_lower.contains("ready") || text_lower.contains("started server") || text_lower.contains("listening on") || text_lower.contains("localhost:4567") {
                                if let Some(window) = handle.get_webview_window("main") {
                                    let _ = window.navigate("http://localhost:4567".parse().unwrap());
                                }
                            }
                        }
                        CommandEvent::Stderr(line) => {
                            eprintln!("[server:err] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Terminated(status) => {
                            eprintln!("[server] process exited: {:?}", status);
                            break;
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<SidecarState>();
                let pid = state.child_id.lock().unwrap().take();
                if let Some(pid) = pid {
                    #[cfg(unix)]
                    {
                        unsafe {
                            libc::kill(pid as i32, libc::SIGTERM);
                        }
                    }
                    #[cfg(windows)]
                    {
                        let _ = std::process::Command::new("taskkill")
                            .args(["/PID", &pid.to_string(), "/F"])
                            .output();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![get_server_port])
        .run(tauri::generate_context!())
        .expect("error while running Larkup Desktop");
}
