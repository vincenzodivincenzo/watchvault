use std::fs;
use std::path::PathBuf;
use tauri::Manager;

fn library_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("cannot resolve app data dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create app data dir: {e}"))?;
    Ok(dir.join("library.json"))
}

#[tauri::command]
fn load_library(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = library_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_library(app: tauri::AppHandle, data: String) -> Result<(), String> {
    // Refuse to persist anything that isn't valid JSON — protects the data file.
    serde_json::from_str::<serde_json::Value>(&data)
        .map_err(|e| format!("refusing to save invalid JSON: {e}"))?;
    let path = library_path(&app)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &data).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[tauri::command]
fn library_file_path(app: tauri::AppHandle) -> Result<String, String> {
    Ok(library_path(&app)?.to_string_lossy().into_owned())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_text_file(path: String, data: String) -> Result<(), String> {
    fs::write(&path, &data).map_err(|e| e.to_string())
}

/// Apple Podcasts keeps its library in a Core Data SQLite store inside its
/// group container. There is no API, but the file is readable, and it holds
/// per-episode play state, play counts, durations and playhead positions.
///
/// The live file is opened by the Podcasts app and is in WAL mode, so it is
/// copied to a temporary path first and read from there. Opening the original
/// read-only would still touch the -wal and -shm sidecars.
#[tauri::command]
fn read_apple_podcasts() -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|_| "no HOME".to_string())?;
    let src = PathBuf::from(&home).join(
        "Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Documents/MTLibrary.sqlite",
    );
    if !src.exists() {
        return Err("Apple Podcasts library not found on this Mac".into());
    }

    let tmp = std::env::temp_dir().join("watchvault-podcasts.sqlite");
    fs::copy(&src, &tmp).map_err(|e| format!("cannot read the Podcasts library: {e}"))?;

    let conn = rusqlite::Connection::open_with_flags(
        &tmp,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| format!("cannot open the Podcasts library: {e}"))?;

    // Core Data stores timestamps as seconds since 2001-01-01; +978307200 makes
    // them Unix. Only episodes with real play state are worth carrying over.
    let mut stmt = conn
        .prepare(
            "SELECT p.ZTITLE, p.ZAUTHOR, p.ZFEEDURL, p.ZIMAGEURL,
                    e.ZTITLE, e.ZITEMDESCRIPTION, e.ZDURATION, e.ZPLAYCOUNT,
                    e.ZPLAYSTATE, e.ZPLAYHEAD,
                    e.ZLASTDATEPLAYED, e.ZPUBDATE, e.ZUUID
             FROM ZMTEPISODE e
             JOIN ZMTPODCAST p ON e.ZPODCAST = p.Z_PK
             WHERE e.ZLASTDATEPLAYED IS NOT NULL OR e.ZPLAYCOUNT > 0 OR e.ZPLAYHEAD > 0",
        )
        .map_err(|e| format!("query failed: {e}"))?;

    let rows = stmt
        .query_map([], |r| {
            Ok(serde_json::json!({
                "podcast":     r.get::<_, Option<String>>(0)?,
                "author":      r.get::<_, Option<String>>(1)?,
                "feedUrl":     r.get::<_, Option<String>>(2)?,
                "imageUrl":    r.get::<_, Option<String>>(3)?,
                "title":       r.get::<_, Option<String>>(4)?,
                "description": r.get::<_, Option<String>>(5)?,
                "duration":    r.get::<_, Option<f64>>(6)?,
                "playCount":   r.get::<_, Option<i64>>(7)?,
                "playState":   r.get::<_, Option<i64>>(8)?,
                "playhead":    r.get::<_, Option<f64>>(9)?,
                "lastPlayed":  r.get::<_, Option<f64>>(10)?,
                "pubDate":     r.get::<_, Option<f64>>(11)?,
                "uuid":        r.get::<_, Option<String>>(12)?,
            }))
        })
        .map_err(|e| format!("query failed: {e}"))?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("row failed: {e}"))?);
    }
    let _ = fs::remove_file(&tmp);
    serde_json::to_string(&out).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            load_library,
            save_library,
            library_file_path,
            read_text_file,
            write_text_file,
            read_apple_podcasts
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
