use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;
use std::io::ErrorKind;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri::menu::{MenuBuilder, SubmenuBuilder};
use tauri::path::BaseDirectory;

const SETTINGS_MENU_ID: &str = "app-settings";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CliRunResult {
    exit_code: i32,
    stdout: String,
    stderr: String,
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

#[tauri::command]
fn run_puzzlepkm_cli(app: tauri::AppHandle, args: Vec<String>) -> Result<CliRunResult, String> {
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

    let mut last_not_found_error: Option<String> = None;

    for node_binary in resolve_node_candidates() {
        match Command::new(&node_binary).arg(&cli_path).args(&args).output() {
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

    let details = last_not_found_error.unwrap_or_else(|| "no candidate binaries were attempted".to_string());
    return Err(format!(
        "Failed to execute Node CLI: no Node binary found. Install Node and ensure it is available to GUI apps, or set PUZZLEPKM_NODE_PATH. Last error: {details}"
    ));
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
    .inner_size(680.0, 560.0)
    .resizable(false)
    .focused(true)
    .build();
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle();
            let app_menu = SubmenuBuilder::new(handle, "PuzzlePKM")
                .about_with_text("About PuzzlePKM", None)
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

            let menu = MenuBuilder::new(handle)
                .item(&app_menu)
                .item(&edit_menu)
                .build()?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == SETTINGS_MENU_ID {
                open_settings_window(app);
            }
        })
        .invoke_handler(tauri::generate_handler![run_puzzlepkm_cli, open_url])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

