use serde::Serialize;
use std::io::ErrorKind;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri::menu::{MenuBuilder, SubmenuBuilder};
use tauri::path::BaseDirectory;

/// Serializes all CLI subprocess invocations so only one Node.js process
/// accesses the SQLite database at a time, preventing "database is locked".
struct CliSerializer(Arc<tokio::sync::Mutex<()>>);

struct BackgroundSyncState(Arc<tokio::sync::Mutex<BackgroundSyncStatus>>);

const SETTINGS_MENU_ID: &str = "app-settings";
const NEW_WINDOW_MENU_ID: &str = "app-new-window";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CliRunResult {
    exit_code: i32,
    stdout: String,
    stderr: String,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackgroundSyncStatus {
    syncing: bool,
    last_started_at: Option<u64>,
    last_finished_at: Option<u64>,
    last_succeeded_at: Option<u64>,
    last_error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackgroundSyncStartResult {
    started: bool,
    status: BackgroundSyncStatus,
}

enum BackgroundSyncCompletion {
    Success,
    Failure(String),
}

fn unix_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn mark_background_sync_started(status: &mut BackgroundSyncStatus, started_at: u64) -> BackgroundSyncStartResult {
    if status.syncing {
        return BackgroundSyncStartResult {
            started: false,
            status: status.clone(),
        };
    }

    status.syncing = true;
    status.last_started_at = Some(started_at);
    status.last_error = None;

    BackgroundSyncStartResult {
        started: true,
        status: status.clone(),
    }
}

fn mark_background_sync_finished(
    status: &mut BackgroundSyncStatus,
    finished_at: u64,
    completion: BackgroundSyncCompletion,
) {
    status.syncing = false;
    status.last_finished_at = Some(finished_at);

    match completion {
        BackgroundSyncCompletion::Success => {
            status.last_succeeded_at = Some(finished_at);
            status.last_error = None;
        }
        BackgroundSyncCompletion::Failure(error) => {
            status.last_error = Some(error);
        }
    }
}

fn resolve_cli_path(app: &tauri::AppHandle) -> PathBuf {
    for candidate in ["cli.mjs", "_up_/cli.mjs"] {
        if let Ok(path) = app.path().resolve(candidate, BaseDirectory::Resource) {
            if path.exists() {
                return path;
            }
        }
    }

    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("cli.mjs")
}

fn resolve_node_candidates() -> Vec<String> {
    let mut candidates: Vec<String> = Vec::new();

    for env_var in ["PUZZLEPKM_NODE_PATH", "NODE_BINARY"] {
        if let Ok(value) = std::env::var(env_var) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                candidates.push(trimmed.to_string());
            }
        }
    }

    candidates.push("node".to_string());

    // macOS GUI apps launched from Finder commonly miss shell PATH entries.
    candidates.push("/opt/homebrew/bin/node".to_string());
    candidates.push("/usr/local/bin/node".to_string());
    candidates.push("/opt/local/bin/node".to_string());

    let mut deduped: Vec<String> = Vec::new();
    for candidate in candidates {
        if !deduped.contains(&candidate) {
            deduped.push(candidate);
        }
    }

    deduped
}

fn run_cli_subprocess(
    cli_path: PathBuf,
    node_candidates: Vec<String>,
    args: Vec<String>,
) -> Result<CliRunResult, String> {
    let mut last_not_found_error: Option<String> = None;

    for node_binary in &node_candidates {
        match Command::new(node_binary).arg(&cli_path).args(&args).output() {
            Ok(output) => {
                return Ok(CliRunResult {
                    exit_code: output.status.code().unwrap_or(1),
                    stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                    stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                });
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {
                last_not_found_error = Some(format!("{node_binary}: {error}"));
                continue;
            }
            Err(error) => {
                return Err(format!(
                    "Failed to execute Node CLI via `{node_binary}`: {error}"
                ));
            }
        }
    }

    let details = last_not_found_error
        .unwrap_or_else(|| "no candidate binaries were attempted".to_string());
    Err(format!(
        "Failed to execute Node CLI: no Node binary found. Install Node and ensure it is available to GUI apps, or set PUZZLEPKM_NODE_PATH. Last error: {details}"
    ))
}

async fn execute_cli_command(
    app: tauri::AppHandle,
    args: Vec<String>,
    serialize: bool,
) -> Result<CliRunResult, String> {
    if args.is_empty() {
        return Err("Provide at least one CLI argument (example: `help`).".to_string());
    }

    if args.iter().any(|arg| arg == "shell") {
        return Err("Interactive shell mode is not supported in the desktop command panel. Run concrete commands instead.".to_string());
    }

    let cli_path = resolve_cli_path(&app);
    if !cli_path.exists() {
        return Err(format!("Could not find cli.mjs at {}", cli_path.display()));
    }

    let node_candidates = resolve_node_candidates();

    if serialize {
        let serializer = app.state::<CliSerializer>();
        let _guard = serializer.0.lock().await;

        tauri::async_runtime::spawn_blocking(move || run_cli_subprocess(cli_path, node_candidates, args))
            .await
            .map_err(|e| format!("Spawn-blocking join error: {e}"))?
    } else {
        tauri::async_runtime::spawn_blocking(move || run_cli_subprocess(cli_path, node_candidates, args))
            .await
            .map_err(|e| format!("Spawn-blocking join error: {e}"))?
    }
}

#[tauri::command]
async fn run_puzzlepkm_cli(app: tauri::AppHandle, args: Vec<String>) -> Result<CliRunResult, String> {
    execute_cli_command(app, args, true).await
}

#[tauri::command]
async fn get_background_sync_status(app: tauri::AppHandle) -> Result<BackgroundSyncStatus, String> {
    let state = app.state::<BackgroundSyncState>();
    let snapshot = state.0.lock().await.clone();
    Ok(snapshot)
}

#[tauri::command]
async fn start_background_sync(app: tauri::AppHandle) -> Result<BackgroundSyncStartResult, String> {
    let state = app.state::<BackgroundSyncState>();
    let snapshot = {
        let mut status = state.0.lock().await;
        mark_background_sync_started(&mut status, unix_timestamp_ms())
    };

    if !snapshot.started {
        return Ok(snapshot);
    }

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = execute_cli_command(app_handle.clone(), vec!["sync".to_string()], false).await;
        let state = app_handle.state::<BackgroundSyncState>();
        let mut status = state.0.lock().await;
        let completion = match result {
            Ok(run) if run.exit_code == 0 => BackgroundSyncCompletion::Success,
            Ok(run) => {
                let stderr = run.stderr.trim();
                let message = if stderr.is_empty() {
                    format!("sync failed with exit code {}", run.exit_code)
                } else {
                    stderr.to_string()
                };
                BackgroundSyncCompletion::Failure(message)
            }
            Err(error) => BackgroundSyncCompletion::Failure(error),
        };
        mark_background_sync_finished(&mut status, unix_timestamp_ms(), completion);
    });

    Ok(snapshot)
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    use std::process::Stdio;

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&url)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("Failed to open URL: {error}"))?;
        Ok(())
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(&["/C", "start", &url])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("Failed to open URL: {error}"))?;
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&url)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("Failed to open URL: {error}"))?;
        Ok(())
    }
}

fn open_settings_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    let _ = WebviewWindowBuilder::new(
        app,
        "settings",
        WebviewUrl::App("index.html?settings=true".into()),
    )
    .title("Settings")
    .inner_size(680.0, 620.0)
    .resizable(true)
    .closable(true)
    .focused(true)
    .build();
}

fn open_new_main_window(app: &tauri::AppHandle) {
    let mut index: u32 = 1;
    let label = loop {
        let candidate = format!("main-{index}");
        if app.get_webview_window(&candidate).is_none() {
            break candidate;
        }
        index += 1;
    };

    let _ = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("PuzzlePKM")
        .focused(true)
        .build();
}

fn main() {
    tauri::Builder::default()
        // Native folder picker for linking external project/ref-material directories.
        .plugin(tauri_plugin_dialog::init())
        .manage(CliSerializer(Arc::new(tokio::sync::Mutex::new(()))))
        .manage(BackgroundSyncState(Arc::new(tokio::sync::Mutex::new(
            BackgroundSyncStatus::default(),
        ))))
        .setup(|app| {
            let handle = app.handle();
            let app_menu = SubmenuBuilder::new(handle, "PuzzlePKM")
                .about_with_text("About PuzzlePKM", None)
                .separator()
                .text(NEW_WINDOW_MENU_ID, "New Window")
                .separator()
                .text(SETTINGS_MENU_ID, "Settings…")
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            let edit_menu = SubmenuBuilder::new(handle, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            // Replacing the default menu drops the standard Window menu with it, which
            // is what left secondary windows (Settings) with no Cmd+W.
            let window_menu = SubmenuBuilder::new(handle, "Window")
                .minimize()
                .close_window()
                .build()?;

            let menu = MenuBuilder::new(handle)
                .item(&app_menu)
                .item(&edit_menu)
                .item(&window_menu)
                .build()?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                NEW_WINDOW_MENU_ID => open_new_main_window(app),
                SETTINGS_MENU_ID => open_settings_window(app),
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            run_puzzlepkm_cli,
            get_background_sync_status,
            start_background_sync,
            open_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        mark_background_sync_finished,
        mark_background_sync_started,
        BackgroundSyncCompletion,
        BackgroundSyncStatus,
    };

    #[test]
    fn background_sync_start_sets_in_flight_state_and_clears_error() {
        let mut status = BackgroundSyncStatus {
            syncing: false,
            last_started_at: None,
            last_finished_at: Some(50),
            last_succeeded_at: Some(40),
            last_error: Some("old failure".to_string()),
        };

        let result = mark_background_sync_started(&mut status, 100);
        assert!(result.started);
        assert!(status.syncing);
        assert_eq!(status.last_started_at, Some(100));
        assert_eq!(status.last_error, None);
        assert_eq!(result.status.last_started_at, Some(100));
    }

    #[test]
    fn background_sync_start_is_idempotent_while_already_syncing() {
        let mut status = BackgroundSyncStatus {
            syncing: true,
            last_started_at: Some(70),
            last_finished_at: Some(60),
            last_succeeded_at: Some(60),
            last_error: None,
        };

        let result = mark_background_sync_started(&mut status, 120);
        assert!(!result.started);
        assert!(status.syncing);
        assert_eq!(status.last_started_at, Some(70));
        assert_eq!(result.status.last_started_at, Some(70));
    }

    #[test]
    fn background_sync_finish_success_sets_finish_and_success_timestamps() {
        let mut status = BackgroundSyncStatus {
            syncing: true,
            last_started_at: Some(100),
            last_finished_at: None,
            last_succeeded_at: Some(80),
            last_error: Some("old failure".to_string()),
        };

        mark_background_sync_finished(&mut status, 140, BackgroundSyncCompletion::Success);
        assert!(!status.syncing);
        assert_eq!(status.last_finished_at, Some(140));
        assert_eq!(status.last_succeeded_at, Some(140));
        assert_eq!(status.last_error, None);
    }

    #[test]
    fn background_sync_finish_failure_sets_error_without_touching_last_success() {
        let mut status = BackgroundSyncStatus {
            syncing: true,
            last_started_at: Some(100),
            last_finished_at: None,
            last_succeeded_at: Some(90),
            last_error: None,
        };

        mark_background_sync_finished(
            &mut status,
            160,
            BackgroundSyncCompletion::Failure("sync failed with exit code 1".to_string()),
        );

        assert!(!status.syncing);
        assert_eq!(status.last_finished_at, Some(160));
        assert_eq!(status.last_succeeded_at, Some(90));
        assert_eq!(
            status.last_error,
            Some("sync failed with exit code 1".to_string())
        );
    }
}

