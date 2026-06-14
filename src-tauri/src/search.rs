pub(crate) const SEARCH_IGNORE: &[&str] = &[
    ".git", "node_modules", "target", ".next", "dist", "build",
    ".cache", "__pycache__", ".venv", "venv", ".turbo", "coverage",
    "out", ".parcel-cache", ".svelte-kit",
];

// ── Text search ───────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct SearchMatch {
    path: String,
    line: u32,
    col:  u32,
    text: String,
}

fn search_file(path: &std::path::Path, query: &str, results: &mut Vec<SearchMatch>) {
    let Ok(bytes) = std::fs::read(path) else { return };
    if bytes.contains(&0u8) { return }
    let Ok(text) = std::str::from_utf8(&bytes) else { return };
    for (i, line) in text.lines().enumerate() {
        if results.len() >= 500 { return }
        if let Some(col) = line.to_lowercase().find(query) {
            results.push(SearchMatch {
                path: path.to_string_lossy().into_owned(),
                line: (i + 1) as u32,
                col:  col as u32,
                text: line.trim().to_string(),
            });
        }
    }
}

fn walk_search(dir: &std::path::Path, query: &str, results: &mut Vec<SearchMatch>) {
    if results.len() >= 500 { return }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut subdirs = vec![];
    for entry in rd.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let ns = name.to_string_lossy();
        if SEARCH_IGNORE.iter().any(|&s| s == ns.as_ref()) { continue }
        if path.is_dir() { subdirs.push(path) } else { search_file(&path, query, results) }
    }
    for d in subdirs { walk_search(&d, query, results) }
}

#[tauri::command]
pub async fn search_in_files(folder: String, query: String) -> Result<Vec<SearchMatch>, String> {
    if query.trim().is_empty() { return Ok(vec![]) }
    let q = query.to_lowercase();
    tokio::task::spawn_blocking(move || {
        let mut results = Vec::new();
        walk_search(std::path::Path::new(&folder), &q, &mut results);
        results
    }).await.map_err(|e| e.to_string())
}

// ── Symbol search ─────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct SymbolMatch {
    name:         String,
    kind:         String,
    path:         String,
    line:         u32,
    line_content: String,
}

fn extract_ident(s: &str) -> Option<String> {
    let s = s.trim_start();
    let end = s.find(|c: char| !c.is_alphanumeric() && c != '_').unwrap_or(s.len());
    if end == 0 { None } else { Some(s[..end].to_string()) }
}

fn classify_ts(s: &str) -> Option<(String, &'static str)> {
    let s = s.strip_prefix("export default ").unwrap_or(s);
    let s = s.strip_prefix("export ").unwrap_or(s);
    let s = s.strip_prefix("declare ").unwrap_or(s);
    if let Some(r) = s.strip_prefix("async function ").or_else(|| s.strip_prefix("function ")) {
        return extract_ident(r).map(|n| (n, "fn"));
    }
    if let Some(r) = s.strip_prefix("class ")     { return extract_ident(r).map(|n| (n, "class")); }
    if let Some(r) = s.strip_prefix("interface ") { return extract_ident(r).map(|n| (n, "interface")); }
    if let Some(r) = s.strip_prefix("type ") {
        let name = extract_ident(r)?;
        let after = r[name.len()..].trim_start();
        if after.starts_with('=') || after.starts_with('<') {
            return Some((name, "type"));
        }
    }
    if let Some(r) = s.strip_prefix("const ").or_else(|| s.strip_prefix("let ")) {
        let name = extract_ident(r)?;
        let after = r[name.len()..].trim_start();
        if after.starts_with("= (") || after.starts_with("= async") || after.starts_with("= function") {
            return Some((name, "fn"));
        }
        if after.starts_with(':') || after.starts_with("= ") {
            return Some((name, "const"));
        }
    }
    None
}

fn classify_rs(s: &str) -> Option<(String, &'static str)> {
    let s = s.strip_prefix("pub(crate) ").unwrap_or(s);
    let s = s.strip_prefix("pub(super) ").unwrap_or(s);
    let s = s.strip_prefix("pub ").unwrap_or(s);
    if let Some(r) = s.strip_prefix("async fn ").or_else(|| s.strip_prefix("fn ")) {
        return extract_ident(r).map(|n| (n, "fn"));
    }
    if let Some(r) = s.strip_prefix("struct ") { return extract_ident(r).map(|n| (n, "struct")); }
    if let Some(r) = s.strip_prefix("enum ")   { return extract_ident(r).map(|n| (n, "enum")); }
    if let Some(r) = s.strip_prefix("trait ")  { return extract_ident(r).map(|n| (n, "trait")); }
    if let Some(r) = s.strip_prefix("type ")   { return extract_ident(r).map(|n| (n, "type")); }
    None
}

fn classify_py(s: &str) -> Option<(String, &'static str)> {
    if let Some(r) = s.strip_prefix("async def ").or_else(|| s.strip_prefix("def ")) {
        return extract_ident(r).map(|n| (n, "fn"));
    }
    if let Some(r) = s.strip_prefix("class ") { return extract_ident(r).map(|n| (n, "class")); }
    None
}

fn classify_line(line: &str, ext: &str) -> Option<(String, &'static str)> {
    let s = line.trim();
    if s.is_empty() || s.starts_with("//") || s.starts_with('#') || s.starts_with('*') { return None; }
    match ext {
        "ts" | "tsx" | "js" | "jsx" | "vue" | "svelte" => classify_ts(s),
        "rs" => classify_rs(s),
        "py" => classify_py(s),
        _ => None,
    }
}

fn search_symbols_file(path: &std::path::Path, query: &str, results: &mut Vec<SymbolMatch>) {
    let ext = match path.extension().and_then(|e| e.to_str()) {
        Some(e) => e,
        None => return,
    };
    if !matches!(ext, "ts" | "tsx" | "js" | "jsx" | "rs" | "py" | "vue" | "svelte") { return }
    let Ok(bytes) = std::fs::read(path) else { return };
    if bytes.contains(&0u8) { return }
    let Ok(text) = std::str::from_utf8(&bytes) else { return };
    for (i, line) in text.lines().enumerate() {
        if results.len() >= 300 { return }
        if let Some((name, kind)) = classify_line(line, ext) {
            if query.is_empty() || name.to_lowercase().contains(query) {
                results.push(SymbolMatch {
                    name,
                    kind: kind.to_string(),
                    path: path.to_string_lossy().into_owned(),
                    line: (i + 1) as u32,
                    line_content: line.trim().to_string(),
                });
            }
        }
    }
}

fn walk_symbols(dir: &std::path::Path, query: &str, results: &mut Vec<SymbolMatch>) {
    if results.len() >= 300 { return }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut subdirs = vec![];
    for entry in rd.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let ns = name.to_string_lossy();
        if SEARCH_IGNORE.iter().any(|&s| s == ns.as_ref()) { continue }
        if path.is_dir() { subdirs.push(path) } else { search_symbols_file(&path, query, results) }
    }
    for d in subdirs { walk_symbols(&d, query, results) }
}

#[tauri::command]
pub async fn search_symbols(folder: String, query: String) -> Result<Vec<SymbolMatch>, String> {
    if folder.is_empty() { return Ok(vec![]) }
    let q = query.to_lowercase();
    tokio::task::spawn_blocking(move || {
        let mut results = Vec::new();
        walk_symbols(std::path::Path::new(&folder), &q, &mut results);
        results
    }).await.map_err(|e| e.to_string())
}

// ── Workspace file listing ────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct WorkspaceFile {
    name: String,
    path: String,
    ext:  String,
}

fn walk_files(dir: &std::path::Path, results: &mut Vec<WorkspaceFile>) {
    if results.len() >= 2000 { return }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        if results.len() >= 2000 { break }
        let path = entry.path();
        let name = entry.file_name();
        let ns = name.to_string_lossy();
        if SEARCH_IGNORE.iter().any(|&s| s == ns.as_ref()) { continue }
        if path.is_dir() {
            walk_files(&path, results);
        } else {
            let ext = path.extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_default();
            results.push(WorkspaceFile {
                name: ns.to_string(),
                path: path.to_string_lossy().into_owned(),
                ext,
            });
        }
    }
}

#[tauri::command]
pub async fn list_workspace_files(folder: String) -> Result<Vec<WorkspaceFile>, String> {
    tokio::task::spawn_blocking(move || {
        let mut results = Vec::new();
        walk_files(std::path::Path::new(&folder), &mut results);
        results
    }).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── classify_ts ────────────────────────────────────────────────────────────

    #[test]
    fn ts_plain_function() {
        assert_eq!(classify_ts("function foo() {}"), Some(("foo".into(), "fn")));
    }

    #[test]
    fn ts_async_function() {
        assert_eq!(classify_ts("async function bar()"), Some(("bar".into(), "fn")));
    }

    #[test]
    fn ts_export_function() {
        assert_eq!(classify_ts("export function baz()"), Some(("baz".into(), "fn")));
    }

    #[test]
    fn ts_export_default_function() {
        assert_eq!(classify_ts("export default function qux()"), Some(("qux".into(), "fn")));
    }

    #[test]
    fn ts_declare_function() {
        assert_eq!(classify_ts("declare function declared()"), Some(("declared".into(), "fn")));
    }

    #[test]
    fn ts_class() {
        assert_eq!(classify_ts("class MyClass {"), Some(("MyClass".into(), "class")));
        assert_eq!(classify_ts("export class Exported {"), Some(("Exported".into(), "class")));
    }

    #[test]
    fn ts_interface() {
        assert_eq!(classify_ts("interface FooBar {"), Some(("FooBar".into(), "interface")));
        assert_eq!(classify_ts("export interface Iface"), Some(("Iface".into(), "interface")));
    }

    #[test]
    fn ts_type_alias_eq() {
        assert_eq!(classify_ts("type Foo = string"), Some(("Foo".into(), "type")));
        assert_eq!(classify_ts("export type Bar = number | string"), Some(("Bar".into(), "type")));
    }

    #[test]
    fn ts_type_alias_generic() {
        assert_eq!(classify_ts("type Result<T> = T[]"), Some(("Result".into(), "type")));
    }

    #[test]
    fn ts_type_no_eq_or_generic_is_not_matched() {
        // "type" keyword followed by an identifier but no '=' or '<'
        assert_eq!(classify_ts("type"), None);
    }

    #[test]
    fn ts_const_arrow_fn() {
        assert_eq!(classify_ts("const foo = () => {}"), Some(("foo".into(), "fn")));
        assert_eq!(classify_ts("const bar = async () => {}"), Some(("bar".into(), "fn")));
        assert_eq!(classify_ts("const baz = function() {}"), Some(("baz".into(), "fn")));
    }

    #[test]
    fn ts_const_value() {
        assert_eq!(classify_ts("const MAX: number = 100"), Some(("MAX".into(), "const")));
        assert_eq!(classify_ts("const val = 42"), Some(("val".into(), "const")));
        assert_eq!(classify_ts("let count = 0"), Some(("count".into(), "const")));
    }

    #[test]
    fn ts_no_match() {
        assert_eq!(classify_ts("import { foo } from './bar'"), None);
        assert_eq!(classify_ts("// a comment"), None);
        assert_eq!(classify_ts(""), None);
    }

    // ── classify_rs ────────────────────────────────────────────────────────────

    #[test]
    fn rs_plain_fn() {
        assert_eq!(classify_rs("fn foo()"), Some(("foo".into(), "fn")));
    }

    #[test]
    fn rs_async_fn() {
        assert_eq!(classify_rs("async fn bar()"), Some(("bar".into(), "fn")));
    }

    #[test]
    fn rs_pub_fn() {
        assert_eq!(classify_rs("pub fn baz()"), Some(("baz".into(), "fn")));
        assert_eq!(classify_rs("pub async fn qux()"), Some(("qux".into(), "fn")));
    }

    #[test]
    fn rs_pub_crate_fn() {
        assert_eq!(classify_rs("pub(crate) fn internal()"), Some(("internal".into(), "fn")));
        assert_eq!(classify_rs("pub(super) fn super_fn()"), Some(("super_fn".into(), "fn")));
    }

    #[test]
    fn rs_struct() {
        assert_eq!(classify_rs("struct Foo {"), Some(("Foo".into(), "struct")));
        assert_eq!(classify_rs("pub struct Bar"), Some(("Bar".into(), "struct")));
    }

    #[test]
    fn rs_enum() {
        assert_eq!(classify_rs("enum Status {"), Some(("Status".into(), "enum")));
        assert_eq!(classify_rs("pub enum Direction"), Some(("Direction".into(), "enum")));
    }

    #[test]
    fn rs_trait() {
        assert_eq!(classify_rs("trait Serialize"), Some(("Serialize".into(), "trait")));
        assert_eq!(classify_rs("pub trait Display"), Some(("Display".into(), "trait")));
    }

    #[test]
    fn rs_type_alias() {
        assert_eq!(classify_rs("type Result<T>"), Some(("Result".into(), "type")));
        assert_eq!(classify_rs("pub type Alias = String"), Some(("Alias".into(), "type")));
    }

    #[test]
    fn rs_no_match() {
        assert_eq!(classify_rs("let x = 5;"), None);
        assert_eq!(classify_rs("use std::io;"), None);
        assert_eq!(classify_rs("// comment"), None);
        assert_eq!(classify_rs(""), None);
    }

    // ── classify_py ────────────────────────────────────────────────────────────

    #[test]
    fn py_def() {
        assert_eq!(classify_py("def foo():"), Some(("foo".into(), "fn")));
        assert_eq!(classify_py("def bar(x, y):"), Some(("bar".into(), "fn")));
    }

    #[test]
    fn py_async_def() {
        assert_eq!(classify_py("async def baz():"), Some(("baz".into(), "fn")));
    }

    #[test]
    fn py_class() {
        assert_eq!(classify_py("class Foo:"), Some(("Foo".into(), "class")));
        assert_eq!(classify_py("class Bar(Base):"), Some(("Bar".into(), "class")));
    }

    #[test]
    fn py_no_match() {
        assert_eq!(classify_py("x = 5"), None);
        assert_eq!(classify_py("import os"), None);
        assert_eq!(classify_py("# comment"), None);
        assert_eq!(classify_py(""), None);
    }

    // ── extract_ident ──────────────────────────────────────────────────────────

    #[test]
    fn extract_ident_basic() {
        assert_eq!(extract_ident("foo()"), Some("foo".into()));
        assert_eq!(extract_ident("my_var: T"), Some("my_var".into()));
        assert_eq!(extract_ident("CamelCase {"), Some("CamelCase".into()));
    }

    #[test]
    fn extract_ident_empty_or_non_alpha_start() {
        assert_eq!(extract_ident(""), None);
        assert_eq!(extract_ident("(args)"), None);
        // extract_ident extracts any [a-zA-Z0-9_]+ run — it does not enforce
        // that identifiers start with a letter (callers rely on keyword-prefix
        // stripping to ensure the remaining text is a valid identifier).
        assert_eq!(extract_ident("123abc"), Some("123abc".into()));
    }

    #[test]
    fn extract_ident_trims_leading_whitespace() {
        assert_eq!(extract_ident("  foo()"), Some("foo".into()));
    }
}
