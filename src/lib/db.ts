import Database from "@tauri-apps/plugin-sql";

let _db: Database | null = null;

async function getDb(): Promise<Database> {
  if (_db) return _db;
  const db = await Database.load("sqlite:origin-chat.db");
  await _initSchema(db);
  // Only cache the singleton after schema init succeeds — otherwise a failed
  // init would leave an unusable instance cached and every later call would
  // skip re-initialization.
  _db = db;
  return _db;
}

async function _initSchema(db: Database): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      workspace_path TEXT NOT NULL,
      title TEXT NOT NULL,
      active_model TEXT NOT NULL,
      active_provider TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      message_type TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      attachments_json TEXT,
      editor_context_json TEXT,
      tool_calls_json TEXT,
      status TEXT NOT NULL DEFAULT 'complete',
      model TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  // Migration: add column for existing databases that pre-date tool call persistence
  try {
    await db.execute(`ALTER TABLE messages ADD COLUMN tool_calls_json TEXT`);
  } catch (_e) {
    // Column already exists — ignore
  }
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_path, updated_at DESC)`
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at ASC)`
  );
  // Mark messages left in-flight from a previous crash as interrupted
  await db.execute(`UPDATE messages SET status = 'interrupted' WHERE status = 'streaming'`);
}

export interface DbSession {
  id: string;
  workspace_path: string;
  title: string;
  active_model: string;
  active_provider: string;
  created_at: number;
  updated_at: number;
}

export interface DbMessage {
  id: string;
  session_id: string;
  message_type: string;
  content: string;
  attachments_json: string | null;
  editor_context_json: string | null;
  tool_calls_json: string | null;
  status: string;
  model: string | null;
  created_at: number;
}

export async function initDb(): Promise<void> {
  await getDb();
}

export async function createSession(
  workspacePath: string,
  title: string,
  model: string,
  provider: string,
  id?: string,
): Promise<string> {
  const db = await getDb();
  const sessionId = id ?? crypto.randomUUID();
  const now = Date.now();
  await db.execute(
    `INSERT INTO sessions (id, workspace_path, title, active_model, active_provider, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [sessionId, workspacePath, title, model, provider, now, now],
  );
  return sessionId;
}

export async function touchSession(id: string, model: string, provider: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE sessions SET active_model = ?, active_provider = ?, updated_at = ? WHERE id = ?`,
    [model, provider, Date.now(), id],
  );
}

export async function listSessions(workspacePath: string): Promise<DbSession[]> {
  const db = await getDb();
  return db.select<DbSession[]>(
    `SELECT * FROM sessions WHERE workspace_path = ? ORDER BY updated_at DESC`,
    [workspacePath],
  );
}

export async function insertMessage(params: {
  sessionId: string;
  messageType: string;
  content: string;
  status?: string;
  attachmentsJson?: string | null;
  editorContextJson?: string | null;
  model?: string | null;
}): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.execute(
    `INSERT INTO messages (id, session_id, message_type, content, attachments_json, editor_context_json, status, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.sessionId,
      params.messageType,
      params.content,
      params.attachmentsJson ?? null,
      params.editorContextJson ?? null,
      params.status ?? 'complete',
      params.model ?? null,
      Date.now(),
    ],
  );
  return id;
}

export async function updateMessageContent(
  id: string,
  content: string,
  status: string,
  toolCallsJson?: string | null,
): Promise<void> {
  const db = await getDb();
  if (toolCallsJson !== undefined) {
    await db.execute(
      `UPDATE messages SET content = ?, status = ?, tool_calls_json = ? WHERE id = ?`,
      [content, status, toolCallsJson, id],
    );
  } else {
    await db.execute(
      `UPDATE messages SET content = ?, status = ? WHERE id = ?`,
      [content, status, id],
    );
  }
}

export async function loadMessages(sessionId: string): Promise<DbMessage[]> {
  const db = await getDb();
  return db.select<DbMessage[]>(
    `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC`,
    [sessionId],
  );
}

export async function deleteSession(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM messages WHERE session_id = ?`, [id]);
  await db.execute(`DELETE FROM sessions WHERE id = ?`, [id]);
}
