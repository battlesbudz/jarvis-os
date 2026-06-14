use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem};
use tauri::path::BaseDirectory;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::{process::CommandEvent, ShellExt};
use url::Url;

const AWAKENING_SCRIPT_NAME: &str = "jarvis:desktop-connector:awaken";
const PENDING_SETUP_FILE: &str = "pending-setup.json";

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectorStatus {
    daemon: String,
    detail: String,
    quiet_startup: bool,
    last_verification: Option<String>,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingSetup {
    server_url: String,
    setup_id: String,
    pair_code: String,
    saved_at_unix: u64,
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

fn attention_for_spawn_error(state: &State<ConnectorState>, error: &str) -> ConnectorStatus {
    update_status(
        state,
        "attention",
        &format!("Jarvis desktop daemon sidecar spawn failed: {error}. Use Reconnect to try again."),
    )
}

fn next_daemon_generation(state: &State<ConnectorState>) -> u64 {
    let mut generation = state.daemon_generation.lock().expect("daemon generation lock poisoned");
    *generation += 1;
    *generation
}

fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn pending_setup_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir.join(PENDING_SETUP_FILE))
}

fn parse_pending_setup_url(raw_url: &str) -> Result<PendingSetup, String> {
    let url = Url::parse(raw_url).map_err(|err| format!("Invalid Jarvis setup link: {err}"))?;
    if url.scheme() != "jarvis" || url.host_str() != Some("desktop-connector") || url.path() != "/setup" {
        return Err("Jarvis setup link was not meant for this desktop connector.".into());
    }

    let mut server_url = None;
    let mut setup_id = None;
    let mut pair_code = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "serverUrl" => server_url = Some(value.into_owned()),
            "setupId" => setup_id = Some(value.into_owned()),
            "pairCode" => pair_code = Some(value.into_owned()),
            _ => {}
        }
    }

    let server_url = server_url.ok_or_else(|| "Jarvis setup link is missing the server URL.".to_string())?;
    let parsed_server = Url::parse(&server_url).map_err(|err| format!("Invalid Jarvis server URL: {err}"))?;
    if !matches!(parsed_server.scheme(), "https" | "http") {
        return Err("Jarvis server URL must use HTTPS or HTTP.".into());
    }

    let setup_id = setup_id.ok_or_else(|| "Jarvis setup link is missing the setup session.".to_string())?;
    if !setup_id.starts_with("dc_") {
        return Err("Jarvis setup session is not valid.".into());
    }

    let pair_code = pair_code.ok_or_else(|| "Jarvis setup link is missing the pairing secret.".to_string())?;
    if pair_code.len() < 4 {
        return Err("Jarvis pairing secret is not valid.".into());
    }

    Ok(PendingSetup {
        server_url,
        setup_id,
        pair_code,
        saved_at_unix: now_unix_secs(),
    })
}

fn save_pending_setup(app: &AppHandle, setup: &PendingSetup) -> Result<(), String> {
    let path = pending_setup_path(app)?;
    let tmp = path.with_extension("json.tmp");
    let payload = serde_json::to_string_pretty(setup).map_err(|err| err.to_string())?;
    fs::write(&tmp, format!("{payload}\n")).map_err(|err| err.to_string())?;
    fs::rename(&tmp, &path).map_err(|err| err.to_string())?;
    Ok(())
}

fn read_pending_setup(app: &AppHandle) -> Result<Option<PendingSetup>, String> {
    let path = pending_setup_path(app)?;
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|err| format!("Jarvis saved setup handoff could not be read: {err}"))
}

fn persist_setup_handoff(app: &AppHandle, raw_url: &str) -> Result<PendingSetup, String> {
    let setup = parse_pending_setup_url(raw_url)?;
    save_pending_setup(app, &setup)?;
    let state = app.state::<ConnectorState>();
    update_status(
        &state,
        "reconnecting",
        "Jarvis received the desktop setup handoff and is finishing pairing.",
    );
    Ok(setup)
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

    let mut sidecar = app
        .shell()
        .sidecar("jarvis-desktop-daemon")
        .map_err(|err| {
            let error = err.to_string();
            attention_for_spawn_error(state, &error);
            error
        })?;

    let pending_setup = read_pending_setup(app).map_err(|err| {
        update_status(state, "attention", &format!("{err} Use Reconnect after starting setup again."));
        err
    })?;
    if let Some(setup) = pending_setup {
        sidecar = sidecar.args(vec![
            "--server".to_string(),
            setup.server_url,
            "--code".to_string(),
            setup.pair_code,
        ]);
    }

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|err| {
            let error = err.to_string();
            attention_for_spawn_error(state, &error);
            error
        })?;

    *state.daemon_child.lock().expect("daemon child lock poisoned") = Some(child);
    monitor_sidecar_events(app.clone(), generation, rx);

    Ok(update_status(state, "connected", "Jarvis desktop daemon is running in the background."))
}

fn apply_setup_handoff(app: &AppHandle, raw_url: &str) {
    match persist_setup_handoff(app, raw_url) {
        Ok(_) => {
            let state = app.state::<ConnectorState>();
            if let Err(err) = spawn_daemon(app, &state) {
                attention_for_spawn_error(&state, &err);
            }
            show_window(app);
        }
        Err(err) => {
            let state = app.state::<ConnectorState>();
            update_status(
                &state,
                "attention",
                &format!("Jarvis could not use that desktop setup handoff: {err}"),
            );
            show_window(app);
        }
    }
}

fn register_deep_link_handlers(app: &AppHandle) {
    let app_handle = app.clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            apply_setup_handoff(&app_handle, url.as_str());
        }
    });
}

fn persist_startup_deep_links(app: &AppHandle) {
    match app.deep_link().get_current() {
        Ok(Some(urls)) => {
            for url in urls {
                if let Err(err) = persist_setup_handoff(app, url.as_str()) {
                    let state = app.state::<ConnectorState>();
                    update_status(
                        &state,
                        "attention",
                        &format!("Jarvis could not use the startup setup handoff: {err}"),
                    );
                }
            }
        }
        Ok(None) => {}
        Err(err) => {
            let state = app.state::<ConnectorState>();
            update_status(
                &state,
                "attention",
                &format!("Jarvis could not read startup setup handoffs: {err}"),
            );
        }
    }
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
    let script_arg = format!("\"{}\"", script.to_string_lossy());

    app.shell()
        .command("cmd.exe")
        .args([
            "/c",
            "start",
            "\"Jarvis Awakening\"",
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            script_arg.as_str(),
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
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            for arg in argv {
                if arg.starts_with("jarvis://") {
                    apply_setup_handoff(&app, &arg);
                }
            }
        }));
    }

    builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
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
            register_deep_link_handlers(app.handle());
            persist_startup_deep_links(app.handle());
            if let Err(err) = spawn_daemon(app.handle(), &state) {
                attention_for_spawn_error(&state, &err);
            }
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
