use crate::models::{DbConnection, DbSession};
use crate::parser::patterns::*;

pub fn parse_db_connections(content: &str) -> Vec<DbConnection> {
    let mut connections = Vec::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Try structured pattern: #hash state (user@env)
        if let Some(caps) = DB_CONNECTION.captures(line) {
            let hash = caps
                .get(1)
                .map(|m| m.as_str().to_string())
                .unwrap_or_default();
            let state = caps
                .get(2)
                .map(|m| m.as_str().to_string())
                .unwrap_or_default();
            let username = caps.get(3).map(|m| m.as_str().to_string());
            let environment = caps.get(4).map(|m| m.as_str().to_string());

            let has_transaction = state.to_lowercase().contains("xactyes")
                || TRANSACTION_STATE
                    .captures(&state)
                    .map(|c| c.get(1).map(|m| m.as_str()) == Some("Yes"))
                    .unwrap_or(false);

            connections.push(DbConnection {
                hash,
                state,
                username,
                environment,
                has_transaction,
            });
        } else {
            // Fallback: space-separated parsing
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                let hash = parts[0].to_string();
                let state = parts.get(1).unwrap_or(&"").to_string();
                let has_transaction = state.to_lowercase().contains("xactyes");

                connections.push(DbConnection {
                    hash,
                    state,
                    username: None,
                    environment: None,
                    has_transaction,
                });
            }
        }
    }

    connections
}

pub fn parse_db_sessions(content: &str) -> Vec<DbSession> {
    let mut sessions = Vec::new();
    let mut current_session: Option<DbSession> = None;

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            if let Some(session) = current_session.take() {
                sessions.push(session);
            }
            continue;
        }

        // Check for hash at start (new session)
        if line.starts_with('#') || line.starts_with("0x") {
            if let Some(session) = current_session.take() {
                sessions.push(session);
            }

            let parts: Vec<&str> = line.splitn(2, char::is_whitespace).collect();
            current_session = Some(DbSession {
                hash: parts[0].to_string(),
                state: parts.get(1).unwrap_or(&"").to_string(),
                query: None,
                prepared_statement: None,
            });
        } else if let Some(ref mut session) = current_session {
            // Look for SQL query
            if line.to_uppercase().starts_with("SELECT")
                || line.to_uppercase().starts_with("INSERT")
                || line.to_uppercase().starts_with("UPDATE")
                || line.to_uppercase().starts_with("DELETE")
            {
                session.query = Some(line.to_string());
            }

            // Look for prepared statement name
            if let Some(caps) = PREPARED_STATEMENT.captures(line) {
                session.prepared_statement = caps.get(1).map(|m| m.as_str().to_string());
            }

            // Append to query if it looks like continuation
            if session.query.is_some() && !line.contains(':') {
                if let Some(ref mut query) = session.query {
                    query.push(' ');
                    query.push_str(line);
                }
            }
        }
    }

    // Don't forget the last session
    if let Some(session) = current_session {
        sessions.push(session);
    }

    sessions
}
