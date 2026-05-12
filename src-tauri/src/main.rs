use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;
use tauri::Manager;
use tauri::path::BaseDirectory;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CliRunResult {
    exit_code: i32,
    stdout: String,
    stderr: String,
}

fn resolve_cli_path(app: &tauri::AppHandle) -> PathBuf {
    let bundled_path = app
        .path()
        .resolve("cli.mjs", BaseDirectory::Resource)
        .ok();

    if let Some(path) = bundled_path {
        if path.exists() {
            return path;
        }
    }

    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("cli.mjs")
}

#[tauri::command]
fn run_dropith_cli(app: tauri::AppHandle, args: Vec<String>) -> Result<CliRunResult, String> {
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

    let output = Command::new("node")
        .arg(cli_path)
        .args(args)
        .output()
        .map_err(|error| format!("Failed to execute Node CLI: {error}"))?;

    Ok(CliRunResult {
        exit_code: output.status.code().unwrap_or(1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![run_dropith_cli])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

