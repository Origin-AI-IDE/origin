#[derive(serde::Serialize)]
pub struct MemoryInfo {
    used_gb:  f64,
    total_gb: f64,
}

#[tauri::command]
pub fn sys_memory() -> Option<MemoryInfo> {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    let total = sys.total_memory() as f64 / (1u64 << 30) as f64;
    let used  = sys.used_memory()  as f64 / (1u64 << 30) as f64;
    Some(MemoryInfo {
        used_gb:  (used  * 10.0).round() / 10.0,
        total_gb: (total * 10.0).round() / 10.0,
    })
}
