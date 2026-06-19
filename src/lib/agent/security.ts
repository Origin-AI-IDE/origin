/**
 * Path-safety guards for agent file-system tool calls.
 *
 * Pure validation layer — no Tauri imports, no side effects — that rejects
 * dangerous or sensitive paths before any FS command is invoked. A defense
 * layer, not a sandbox: the user-confirmation UI for write/exec is the real
 * safety net. These checks ensure auto-approved reads can never silently
 * exfiltrate obvious secrets, that a bad approval can't blow up the system,
 * and that Trojan-Source style attacks (bidi overrides, traversal) are caught
 * before they reach disk.
 */

export type SecurityResult = { ok: true } | { ok: false; reason: string };

// ── Secret file patterns (basename, case-insensitive) ──────────────────────────

const SECRET_BASENAME_PATTERNS: RegExp[] = [
  /^\.env$/i,
  /^\.env\..+$/i,
  /^.*\.pem$/i,
  /^.*\.key$/i,
  /^.*\.p12$/i,
  /^.*\.pfx$/i,
  /^id_rsa$/i,
  /^id_ed25519$/i,
  /^.*\.secret$/i,
  /^\.netrc$/i,
  /^\.htpasswd$/i,
  /^credentials$/i,
  /^secrets\.json$/i,
  /^.*\.keystore$/i,
];

// ── Protected directories (exact prefix after normalization) ───────────────────

const PROTECTED_DIRS = [
  "c:/windows",
  "c:/program files",
  "c:/program files (x86)",
  "/etc",
  "/usr",
  "/bin",
  "/sbin",
  "/sys",
  "/proc",
];

// ── Bidi-override / Trojan-Source codepoints ───────────────────────────────────

const BIDI_OVERRIDE = /[‪‫‬‭‮⁦⁧⁨⁩‏]/;

// ── Exec-only destructive patterns ─────────────────────────────────────────────

const FORK_BOMB = ":(){:|:&};:";
const EXEC_DENY_SUBSTRINGS = ["rm -rf /", "format ", "mkfs", "dd if="];

// ── Helpers ────────────────────────────────────────────────────────────────────

function basename(p: string): string {
  const norm = p.replace(/\\/g, "/");
  const trimmed = norm.endsWith("/") && norm.length > 1 ? norm.slice(0, -1) : norm;
  const i = trimmed.lastIndexOf("/");
  return i >= 0 ? trimmed.slice(i + 1) : trimmed;
}

/**
 * Normalize a path to a comparison surface:
 *  - back-slashes → forward-slashes
 *  - collapse duplicate slashes
 *  - lowercase (case-insensitive prefix matching)
 *  - drop trailing slash (except root)
 */
function normalize(p: string): string {
  let s = p.replace(/\\/g, "/");
  s = s.replace(/\/{2,}/g, "/");
  s = s.toLowerCase();
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

function isUnderProtectedDir(normPath: string, dir: string): boolean {
  return normPath === dir || normPath.startsWith(dir + "/");
}

// ── checkPath ──────────────────────────────────────────────────────────────────

export function checkPath(path: string, op: "read" | "write" | "exec"): SecurityResult {
  if (typeof path !== "string" || path.length === 0) {
    return { ok: false, reason: "Refused: empty path." };
  }

  // Rule 4 — bidi-override characters (applies to every op, including exec).
  if (BIDI_OVERRIDE.test(path)) {
    return {
      ok: false,
      reason: "Refused: path contains Unicode bidirectional override characters.",
    };
  }

  // Exec is command text, not a filesystem path — apply only exec rules.
  if (op === "exec") {
    const lower = path.toLowerCase();
    for (const bad of EXEC_DENY_SUBSTRINGS) {
      if (lower.includes(bad)) {
        return { ok: false, reason: `Refused: command contains a destructive pattern ("${bad.trim()}").` };
      }
    }
    if (path.replace(/\s+/g, "").includes(FORK_BOMB)) {
      return { ok: false, reason: "Refused: fork-bomb pattern detected." };
    }
    return { ok: true };
  }

  // Rule 1 — secret file patterns (read and write).
  const base = basename(path);
  for (const re of SECRET_BASENAME_PATTERNS) {
    if (re.test(base)) {
      return { ok: false, reason: `Refused: "${base}" matches a sensitive-file pattern.` };
    }
  }

  const norm = normalize(path);

  // Rule 3 — path traversal: reject any unresolved ".." segment.
  if (norm === ".." || norm.startsWith("../") || norm.endsWith("/..") || norm.includes("/../")) {
    return { ok: false, reason: "Refused: path contains a parent-directory (..) traversal segment." };
  }

  // Rule 2 — protected directories.
  for (const dir of PROTECTED_DIRS) {
    if (isUnderProtectedDir(norm, dir)) {
      return { ok: false, reason: `Refused: path is inside a protected directory (${dir}).` };
    }
  }

  return { ok: true };
}
