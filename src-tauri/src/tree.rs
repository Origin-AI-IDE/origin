use crate::search::SEARCH_IGNORE;

#[derive(serde::Serialize)]
pub struct FileTreeNode {
    name:     String,
    path:     String,
    size:     u64,
    is_dir:   bool,
    children: Vec<FileTreeNode>,
}

fn build_file_tree(dir: &std::path::Path, depth: usize) -> FileTreeNode {
    let name = dir.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| dir.to_string_lossy().to_string());
    if depth > 7 {
        return FileTreeNode { name, path: dir.to_string_lossy().into_owned(), size: 0, is_dir: true, children: vec![] };
    }
    let Ok(rd) = std::fs::read_dir(dir) else {
        return FileTreeNode { name, path: dir.to_string_lossy().into_owned(), size: 0, is_dir: true, children: vec![] };
    };
    let mut children: Vec<FileTreeNode> = rd.flatten()
        .filter_map(|e| {
            let p = e.path();
            let n = e.file_name().to_string_lossy().to_string();
            if SEARCH_IGNORE.iter().any(|&s| s == n.as_str()) { return None; }
            if p.is_dir() {
                Some(build_file_tree(&p, depth + 1))
            } else {
                let size = p.metadata().map(|m| m.len()).unwrap_or(0);
                Some(FileTreeNode { name: n, path: p.to_string_lossy().into_owned(), size, is_dir: false, children: vec![] })
            }
        })
        .collect();
    children.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    FileTreeNode { name, path: dir.to_string_lossy().into_owned(), size: 0, is_dir: true, children }
}

#[tauri::command]
pub async fn get_file_tree(folder: String) -> Result<FileTreeNode, String> {
    tokio::task::spawn_blocking(move || Ok(build_file_tree(std::path::Path::new(&folder), 0)))
        .await.map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
pub struct ImportEdge {
    from: String,
    to:   String,
}

fn parse_imports(text: &str) -> Vec<String> {
    let mut out = vec![];
    for line in text.lines().take(600) {
        for prefix in &["from '", "from \""] {
            if let Some(idx) = line.find(prefix) {
                let after = &line[idx + prefix.len()..];
                let end_ch = if prefix.ends_with('\'') { '\'' } else { '"' };
                if let Some(end) = after.find(end_ch) {
                    let p = &after[..end];
                    if p.starts_with('.') && !p.contains('\n') {
                        out.push(p.split('?').next().unwrap_or(p).to_string());
                    }
                }
            }
        }
    }
    out
}

fn resolve_import(from: &std::path::Path, import: &str) -> Option<String> {
    let base = from.parent()?;
    let raw = base.join(import);
    if raw.is_file() { return Some(raw.to_string_lossy().into_owned()); }
    for ext in &["ts", "tsx", "js", "jsx"] {
        let c = std::path::PathBuf::from(format!("{}.{}", raw.to_string_lossy(), ext));
        if c.is_file() { return Some(c.to_string_lossy().into_owned()); }
    }
    for ext in &["ts", "tsx", "js", "jsx"] {
        let c = raw.join(format!("index.{}", ext));
        if c.is_file() { return Some(c.to_string_lossy().into_owned()); }
    }
    None
}

fn collect_edges(dir: &std::path::Path, out: &mut Vec<ImportEdge>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if SEARCH_IGNORE.iter().any(|&s| s == name.as_str()) { continue }
        if path.is_dir() { collect_edges(&path, out); continue }
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if !matches!(ext, "ts" | "tsx" | "js" | "jsx") { continue }
        let Ok(bytes) = std::fs::read(&path) else { continue };
        if bytes.contains(&0u8) { continue }
        let Ok(text) = std::str::from_utf8(&bytes) else { continue };
        let from_str = path.to_string_lossy().into_owned();
        for imp in parse_imports(text) {
            if let Some(to) = resolve_import(&path, &imp) {
                out.push(ImportEdge { from: from_str.clone(), to });
            }
        }
    }
}

#[tauri::command]
pub async fn get_import_edges(folder: String) -> Result<Vec<ImportEdge>, String> {
    tokio::task::spawn_blocking(move || {
        let mut edges = vec![];
        collect_edges(std::path::Path::new(&folder), &mut edges);
        Ok(edges)
    }).await.map_err(|e| e.to_string())?
}
