use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::path::BaseDirectory;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

const AWAKENING_SCRIPT_NAME: &str = "jarvis:desktop-connector:awaken";

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectorStatus {
    daemon: String,
    detail: String,
    quiet_startup: bool,
    last_verification: Option<String>,
}

struct ConnectorState {
    daemon_child: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
    daemon_generation: Mutex<u64>,
    status: Mutex<ConnectorStatus>,
}

fn default_status() -> ConnectorStatus {
    ConnectorStatus {
        daemon: "starting".into(),
        detail: "Starting the desktop daemon in the background.".into(),
        quiet_startup: true,
        last_verification: None,
    }
}

fn update_status(state: &State<ConnectorState>, daemon: &str, detail: &str) -> ConnectorStatus {
    let mut status = state.status.lock().expect("connector status lock poisoned");
    status.daemon = daemon.into();
    status.detail = detail.into();
    status.clone()
}

fn append_status_detail(state: &State<ConnectorState>, detail: &str) {
    let mut status = state.status.lock().expect("connector status lock poisoned");
    status.detail = if status.detail.is_empty() {
        detail.into()
    } else {
        format!("{} {}", status.detail, detail)
    };
}

fn powershell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn next_daemon_generation(state: &State<ConnectorState>) -> u64 {
    let mut generation = state.daemon_generation.lock().expect("daemon generation lock poisoned");
    *generation += 1;
    *generation
}

fn update_status_for_generation(app: &AppHandle, generation: u64, daemon: &str, detail: &str, clear_child: bool) {
    let state = app.state::<ConnectorState>();
    let current_generation = *state
        .daemon_generation
        .lock()
        .expect("daemon generation lock poisoned");
    if current_generation != generation {
        return;
    }

    let mut status = state.status.lock().expect("connector status lock poisoned");
    status.daemon = daemon.into();
    status.detail = detail.into();
    drop(status);

    if clear_child {
        *state.daemon_child.lock().expect("daemon child lock poisoned") = None;
    }
}

fn monitor_sidecar_events(app: AppHandle, generation: u64, mut rx: tauri::async_runtime::Receiver<CommandEvent>) {
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Terminated(payload) => {
                    update_status_for_generation(
                        &app,
                        generation,
                        "attention",
                        &format!(
                            "Jarvis desktop daemon stopped (code {:?}, signal {:?}). Use Reconnect to start it again.",
                            payload.code, payload.signal
                        ),
                        true,
                    );
                    break;
                }
                CommandEvent::Stderr(line) => {
                    let stderr = String::from_utf8_lossy(&line);
                    if stderr.to_ascii_lowercase().contains("error") {
                        update_status_for_generation(
                            &app,
                            generation,
                            "attention",
                            "Jarvis desktop daemon reported an error. Use Reconnect to try again.",
                            false,
                        );
                    }
                }
                CommandEvent::Error(error) => {
                    update_status_for_generation(
                        &app,
                        generation,
                        "attention",
                        &format!("Jarvis desktop daemon event stream failed: {error}. Use Reconnect to try again."),
                        true,
                    );
                    break;
                }
                _ => {}
            }
        }
    });
}

fn spawn_daemon(app: &AppHandle, state: &State<ConnectorState>) -> Result<ConnectorStatus, String> {
    let generation = next_daemon_generation(state);

    if let Some(mut child) = state.daemon_child.lock().expect("daemon child lock poisoned").take() {
        let _ = child.kill();
    }

    let (mut rx, child) = app
        .shell()
        .sidecar("jarvis-desktop-daemon")
        .map_err(|err| err.to_string())?
        .spawn()
        .map_err(|err| err.to_string())?;

    *state.daemon_child.lock().expect("daemon child lock poisoned") = Some(child);
    monitor_sidecar_events(app.clone(), generation, rx);

    Ok(update_status(
        state,
        "connected",
        "Jarvis desktop daemon is running in the background.",
    ))
}

#[tauri::command]
fn get_status(state: State<ConnectorState>) -> ConnectorStatus {
    state.status.lock().expect("connector status lock poisoned").clone()
}

#[tauri::command]
fn reconnect_daemon(app: AppHandle, state: State<ConnectorState>) -> Result<ConnectorStatus, String> {
    update_status(&state, "reconnecting", "Reconnecting the desktop daemon.");
    spawn_daemon(&app, &state)
}

#[tauri::command]
fn run_verification_again(app: AppHandle, state: State<ConnectorState>) -> Result<ConnectorStatus, String> {
    let script = app
        .path()
        .resolve("jarvis-desktop-connector-awaken.ps1", BaseDirectory::Resource)
        .map_err(|err| err.to_string())?;
    let launch_command = format!(
        "Start-Process -FilePath powershell.exe -WindowStyle Normal -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',{})",
        powershell_single_quote(&script.to_string_lossy()),
    );

    app.shell()
        .command("powershell.exe")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            launch_command.as_str(),
        ])
        .spawn()
        .map_err(|err| err.to_string())?;

    let mut status = state.status.lock().expect("connector status lock poisoned");
    status.last_verification = Some("Opening".into());
    status.detail = format!("Opening the Jarvis desktop verification ceremony ({AWAKENING_SCRIPT_NAME}).");
    Ok(status.clone())
}

#[tauri::command]
fn open_jarvis(app: AppHandle) -> Result<(), String> {
    app.opener()
        .open_url("https://gameplanjarvisai.up.railway.app", None::<&str>)
        .map_err(|err| err.to_string())
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Jarvis", true, None::<&str>)?;
    let check = MenuItem::with_id(app, "check", "Check connection", true, None::<&str>)?;
    let reconnect = MenuItem::with_id(app, "reconnect", "Reconnect", true, None::<&str>)?;
    let verify = MenuItem::with_id(app, "verify", "Run verification again", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &check, &reconnect, &verify, &quit])?;

    TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_window(&tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                let _ = open_jarvis(app.clone());
            }
            "check" => show_window(app),
            "reconnect" => {
                let state = app.state::<ConnectorState>();
                let _ = spawn_daemon(app, &state);
                show_window(app);
            }
            "verify" => {
                let state = app.state::<ConnectorState>();
                let _ = run_verification_again(app.clone(), state);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

fn enable_autostart(app: &AppHandle, state: &State<ConnectorState>) {
    if let Err(err) = app.autolaunch().enable() {
        append_status_detail(
            state,
            &format!("Autostart could not be enabled yet: {}.", err),
        );
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--quiet"]),
        ))
        .manage(ConnectorState {
            daemon_child: Mutex::new(None),
            daemon_generation: Mutex::new(0),
            status: Mutex::new(default_status()),
        })
        .setup(|app| {
            build_tray(app.handle())?;
            let state = app.state::<ConnectorState>();
            let _ = spawn_daemon(app.handle(), &state);
            enable_autostart(app.handle(), &state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_status,
            reconnect_daemon,
            run_verification_again,
            open_jarvis
        ])
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Jarvis Desktop Connector");
}
