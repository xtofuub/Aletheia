use rusqlite::{Connection, OptionalExtension, params};
use tauri::State;
use uuid::Uuid;

use crate::{
    models::{
        DomainSummary, FieldType, IdentityActionInput, IdentityMember, IdentitySummary,
        OverviewStats, SavedSearch, SavedSearchInput, SearchField, SearchHit, SearchRequest,
        SearchResponse,
    },
    search_index::SearchIndex,
    storage::AppState,
};

#[tauri::command]
pub async fn get_overview_stats(state: State<'_, AppState>) -> Result<OverviewStats, String> {
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let connection = database
            .lock()
            .map_err(|_| "metadata database is unavailable".to_string())?;
        let identity_group_count = connection
            .query_row("SELECT COUNT(*) FROM identity_groups", [], |row| {
                row.get::<_, i64>(0)
            })
            .map_err(sanitized)?;
        let parent_domain_count = connection
            .query_row(
                "SELECT COUNT(DISTINCT registrable_domain) FROM domains",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(sanitized)?;
        Ok(OverviewStats {
            identity_group_count: identity_group_count as u64,
            parent_domain_count: parent_domain_count as u64,
        })
    })
    .await
    .map_err(|_| "overview statistics task failed".to_string())?
}

#[tauri::command]
pub fn search_records(
    request: SearchRequest,
    state: State<'_, AppState>,
) -> Result<SearchResponse, String> {
    if request
        .field_type
        .is_some_and(|field_type| field_type.is_secret())
    {
        return Err("secret fields cannot be searched".to_string());
    }
    let root = state
        .current_storage_root()
        .map_err(|_| "storage location is unavailable".to_string())?;
    let index = SearchIndex::open_or_create(&root)?;
    let field_type = request.field_type.map(FieldType::as_str);
    let (total, record_ids) = index.search_record_ids(
        &request.query,
        request.mode,
        request.dataset_id.as_deref(),
        field_type,
        request.offset,
        request.limit,
    )?;
    let connection = state
        .database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    let mut hits = Vec::with_capacity(record_ids.len());
    for record_id in record_ids {
        if let Some(hit) = load_search_hit(&connection, &record_id)? {
            hits.push(hit);
        }
    }
    connection
        .execute(
            "INSERT INTO search_history(id, query, mode) VALUES (?1, ?2, ?3)",
            params![
                Uuid::new_v4().to_string(),
                request.query.chars().take(512).collect::<String>(),
                mode_name(request.mode)
            ],
        )
        .map_err(sanitized)?;
    connection
        .execute(
            "DELETE FROM search_history WHERE id NOT IN (
                SELECT id FROM search_history ORDER BY created_at DESC LIMIT 200
             )",
            [],
        )
        .map_err(sanitized)?;
    Ok(SearchResponse {
        total,
        offset: request.offset,
        hits,
    })
}

#[tauri::command]
pub fn list_domains(state: State<'_, AppState>) -> Result<Vec<DomainSummary>, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT id, hostname, registrable_domain, public_suffix, is_subdomain, record_count
             FROM domains
             ORDER BY record_count DESC, registrable_domain, hostname
             LIMIT 5000",
        )
        .map_err(sanitized)?;
    let rows = statement
        .query_map([], |row| {
            Ok(DomainSummary {
                id: row.get(0)?,
                hostname: row.get(1)?,
                registrable_domain: row.get(2)?,
                public_suffix: row.get(3)?,
                is_subdomain: row.get(4)?,
                record_count: row.get::<_, i64>(5)? as u64,
            })
        })
        .map_err(sanitized)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(sanitized)
}

#[tauri::command]
pub fn list_identities(state: State<'_, AppState>) -> Result<Vec<IdentitySummary>, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT ig.id, ig.display_label, ig.confidence_level, COUNT(im.record_id),
                    COALESCE(MIN(im.link_type), 'manual'),
                    COALESCE(MIN(im.explanation_json), '{}'),
                    CASE
                      WHEN SUM(CASE WHEN im.user_status = 'rejected' THEN 1 ELSE 0 END) > 0
                        THEN 'needs review'
                      WHEN SUM(CASE WHEN im.user_status = 'confirmed' THEN 1 ELSE 0 END) > 0
                        THEN 'confirmed'
                      ELSE 'automatic'
                    END
             FROM identity_groups ig
             LEFT JOIN identity_memberships im ON im.identity_group_id = ig.id
             GROUP BY ig.id
             ORDER BY COUNT(im.record_id) DESC, ig.display_label
             LIMIT 5000",
        )
        .map_err(sanitized)?;
    let rows = statement
        .query_map([], |row| {
            let explanation_json: String = row.get(5)?;
            let explanation = serde_json::from_str::<serde_json::Value>(&explanation_json)
                .ok()
                .and_then(|value| {
                    value
                        .get("rule")
                        .and_then(|rule| rule.as_str())
                        .map(str::to_string)
                })
                .unwrap_or_else(|| "user-reviewed link".to_string());
            Ok(IdentitySummary {
                id: row.get(0)?,
                display_label: row.get(1)?,
                confidence_level: row.get(2)?,
                member_count: row.get::<_, i64>(3)? as u64,
                link_type: row.get(4)?,
                explanation,
                user_status: row.get(6)?,
            })
        })
        .map_err(sanitized)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(sanitized)
}

#[tauri::command]
pub fn list_identity_members(
    group_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<IdentityMember>, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT im.record_id, d.name, sf.relative_path, r.source_location, im.user_status
             FROM identity_memberships im
             JOIN records r ON r.id = im.record_id
             JOIN datasets d ON d.id = r.dataset_id
             JOIN source_files sf ON sf.id = r.source_file_id
             WHERE im.identity_group_id = ?1
             ORDER BY d.name, sf.relative_path, r.source_location
             LIMIT 10000",
        )
        .map_err(sanitized)?;
    let rows = statement
        .query_map(params![group_id], |row| {
            Ok(IdentityMember {
                record_id: row.get(0)?,
                dataset_name: row.get(1)?,
                source_file: row.get(2)?,
                source_location: row.get(3)?,
                user_status: row.get(4)?,
            })
        })
        .map_err(sanitized)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(sanitized)
}

#[tauri::command]
pub fn apply_identity_action(
    input: IdentityActionInput,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let mut connection = state
        .database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    let transaction = connection.transaction().map_err(sanitized)?;
    let event_id = Uuid::new_v4().to_string();
    match input.action.as_str() {
        "confirm" | "reject" => {
            let next_status = if input.action == "confirm" {
                "confirmed"
            } else {
                "rejected"
            };
            let records =
                selected_or_all_records(&transaction, &input.group_id, &input.record_ids)?;
            let previous = previous_statuses(&transaction, &input.group_id, &records)?;
            for record_id in &records {
                transaction
                    .execute(
                        "UPDATE identity_memberships SET user_status = ?3
                         WHERE identity_group_id = ?1 AND record_id = ?2",
                        params![input.group_id, record_id, next_status],
                    )
                    .map_err(sanitized)?;
            }
            insert_audit(
                &transaction,
                &event_id,
                &input.action,
                &input.group_id,
                serde_json::json!({"records": records, "previous": previous}),
                None,
            )?;
        }
        "merge" => {
            let target = input
                .target_group_id
                .as_deref()
                .filter(|target| *target != input.group_id)
                .ok_or_else(|| "choose a different target identity".to_string())?;
            let records =
                selected_or_all_records(&transaction, &input.group_id, &input.record_ids)?;
            for record_id in &records {
                transaction
                    .execute(
                        "INSERT OR REPLACE INTO identity_memberships(
                            identity_group_id, record_id, link_type, confidence_score,
                            explanation_json, user_status
                         ) SELECT ?1, record_id, 'user_merge', 1.0,
                                  '{\"rule\":\"user_confirmed_merge\"}', 'confirmed'
                           FROM identity_memberships
                          WHERE identity_group_id = ?2 AND record_id = ?3",
                        params![target, input.group_id, record_id],
                    )
                    .map_err(sanitized)?;
                transaction
                    .execute(
                        "DELETE FROM identity_memberships
                         WHERE identity_group_id = ?1 AND record_id = ?2",
                        params![input.group_id, record_id],
                    )
                    .map_err(sanitized)?;
            }
            insert_audit(
                &transaction,
                &event_id,
                "merge",
                &input.group_id,
                serde_json::json!({"records": records, "from": input.group_id, "to": target}),
                None,
            )?;
        }
        "split" => {
            if input.record_ids.is_empty() {
                return Err("select at least one record to split".to_string());
            }
            let new_group = Uuid::new_v4().to_string();
            transaction
                .execute(
                    "INSERT INTO identity_groups(id, display_label, confidence_level)
                     VALUES (?1, 'User split identity', 'user-confirmed')",
                    params![new_group],
                )
                .map_err(sanitized)?;
            for record_id in &input.record_ids {
                transaction
                    .execute(
                        "INSERT OR REPLACE INTO identity_memberships(
                            identity_group_id, record_id, link_type, confidence_score,
                            explanation_json, user_status
                         ) SELECT ?1, record_id, 'user_split', 1.0,
                                  '{\"rule\":\"user_confirmed_split\"}', 'confirmed'
                           FROM identity_memberships
                          WHERE identity_group_id = ?2 AND record_id = ?3",
                        params![new_group, input.group_id, record_id],
                    )
                    .map_err(sanitized)?;
                transaction
                    .execute(
                        "DELETE FROM identity_memberships
                         WHERE identity_group_id = ?1 AND record_id = ?2",
                        params![input.group_id, record_id],
                    )
                    .map_err(sanitized)?;
            }
            insert_audit(
                &transaction,
                &event_id,
                "split",
                &input.group_id,
                serde_json::json!({
                    "records": input.record_ids,
                    "from": input.group_id,
                    "to": new_group
                }),
                None,
            )?;
        }
        "undo" => {
            undo_event(&transaction, &input.group_id, &event_id)?;
        }
        _ => return Err("unsupported identity action".to_string()),
    }
    transaction.commit().map_err(sanitized)?;
    Ok(event_id)
}

#[tauri::command]
pub fn save_search(
    input: SavedSearchInput,
    state: State<'_, AppState>,
) -> Result<SavedSearch, String> {
    let name = input.name.trim();
    if name.is_empty() || name.len() > 120 || input.query.len() > 512 {
        return Err("saved search name or query is outside the allowed limit".to_string());
    }
    serde_json::from_str::<serde_json::Value>(&input.filters_json)
        .map_err(|_| "saved search filters are invalid".to_string())?;
    let saved = SavedSearch {
        id: Uuid::new_v4().to_string(),
        name: name.to_string(),
        query: input.query,
        filters_json: input.filters_json,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    let connection = state
        .database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    connection
        .execute(
            "INSERT INTO saved_searches(id, name, query, filters_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                saved.id,
                saved.name,
                saved.query,
                saved.filters_json,
                saved.created_at
            ],
        )
        .map_err(sanitized)?;
    Ok(saved)
}

#[tauri::command]
pub fn list_saved_searches(state: State<'_, AppState>) -> Result<Vec<SavedSearch>, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT id, name, query, filters_json, created_at
             FROM saved_searches ORDER BY created_at DESC",
        )
        .map_err(sanitized)?;
    let rows = statement
        .query_map([], |row| {
            Ok(SavedSearch {
                id: row.get(0)?,
                name: row.get(1)?,
                query: row.get(2)?,
                filters_json: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(sanitized)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(sanitized)
}

fn load_search_hit(connection: &Connection, record_id: &str) -> Result<Option<SearchHit>, String> {
    let base = connection
        .query_row(
            "SELECT r.id, r.dataset_id, d.name, r.source_file_id, sf.relative_path,
                    r.source_location, r.parser
             FROM records r
             JOIN datasets d ON d.id = r.dataset_id
             JOIN source_files sf ON sf.id = r.source_file_id
             WHERE r.id = ?1",
            params![record_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                ))
            },
        )
        .optional()
        .map_err(sanitized)?;
    let Some((id, dataset_id, dataset_name, source_file_id, source_file, location, parser)) = base
    else {
        return Ok(None);
    };
    let mut statement = connection
        .prepare(
            "SELECT field_name, field_type, original_value, normalized_value, is_sensitive
             FROM field_values WHERE record_id = ?1 ORDER BY id",
        )
        .map_err(sanitized)?;
    let rows = statement
        .query_map(params![record_id], |row| {
            let field_type_name: String = row.get(1)?;
            let original: String = row.get(2)?;
            let normalized: String = row.get(3)?;
            let sensitive: bool = row.get(4)?;
            let field_type = parse_field_type(&field_type_name);
            Ok(SearchField {
                name: row.get(0)?,
                field_type,
                display_value: mask_for_display(field_type, sensitive, &original, &normalized),
                sensitive,
            })
        })
        .map_err(sanitized)?;
    let fields = rows.collect::<Result<Vec<_>, _>>().map_err(sanitized)?;
    Ok(Some(SearchHit {
        record_id: id,
        dataset_id,
        dataset_name,
        source_file_id,
        source_file,
        source_location: location,
        parser,
        match_reason: "normalized field match".to_string(),
        fields,
    }))
}

fn selected_or_all_records(
    connection: &Connection,
    group_id: &str,
    selected: &[String],
) -> Result<Vec<String>, String> {
    if !selected.is_empty() {
        return Ok(selected.iter().take(10_000).cloned().collect());
    }
    let mut statement = connection
        .prepare(
            "SELECT record_id FROM identity_memberships
             WHERE identity_group_id = ?1 LIMIT 10000",
        )
        .map_err(sanitized)?;
    let rows = statement
        .query_map(params![group_id], |row| row.get(0))
        .map_err(sanitized)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(sanitized)
}

fn previous_statuses(
    connection: &Connection,
    group_id: &str,
    records: &[String],
) -> Result<Vec<(String, String)>, String> {
    let mut previous = Vec::new();
    for record in records {
        let status = connection
            .query_row(
                "SELECT user_status FROM identity_memberships
                 WHERE identity_group_id = ?1 AND record_id = ?2",
                params![group_id, record],
                |row| row.get(0),
            )
            .optional()
            .map_err(sanitized)?;
        if let Some(status) = status {
            previous.push((record.clone(), status));
        }
    }
    Ok(previous)
}

fn insert_audit(
    connection: &Connection,
    event_id: &str,
    event_type: &str,
    entity_id: &str,
    details: serde_json::Value,
    undo_of: Option<&str>,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO audit_events(
                id, event_type, entity_type, entity_id, details_json, undo_of
             ) VALUES (?1, ?2, 'identity_group', ?3, ?4, ?5)",
            params![
                event_id,
                event_type,
                entity_id,
                details.to_string(),
                undo_of
            ],
        )
        .map_err(sanitized)?;
    Ok(())
}

fn undo_event(connection: &Connection, original_id: &str, undo_id: &str) -> Result<(), String> {
    let (event_type, entity_id, details, already_undone) = connection
        .query_row(
            "SELECT a.event_type, a.entity_id, a.details_json,
                    EXISTS(SELECT 1 FROM audit_events u WHERE u.undo_of = a.id)
             FROM audit_events a WHERE a.id = ?1 AND a.undo_of IS NULL",
            params![original_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, bool>(3)?,
                ))
            },
        )
        .optional()
        .map_err(sanitized)?
        .ok_or_else(|| "audit event was not found".to_string())?;
    if already_undone {
        return Err("audit event was already undone".to_string());
    }
    let details: serde_json::Value =
        serde_json::from_str(&details).map_err(|_| "audit event is invalid".to_string())?;
    match event_type.as_str() {
        "confirm" | "reject" => {
            let previous = details
                .get("previous")
                .and_then(|value| value.as_array())
                .ok_or_else(|| "audit event cannot be undone".to_string())?;
            for pair in previous {
                let Some(values) = pair.as_array() else {
                    continue;
                };
                let (Some(record), Some(status)) = (
                    values.first().and_then(|value| value.as_str()),
                    values.get(1).and_then(|value| value.as_str()),
                ) else {
                    continue;
                };
                connection
                    .execute(
                        "UPDATE identity_memberships SET user_status = ?3
                         WHERE identity_group_id = ?1 AND record_id = ?2",
                        params![entity_id, record, status],
                    )
                    .map_err(sanitized)?;
            }
        }
        "merge" | "split" => {
            let from = details
                .get("from")
                .and_then(|value| value.as_str())
                .ok_or_else(|| "audit event cannot be undone".to_string())?;
            let to = details
                .get("to")
                .and_then(|value| value.as_str())
                .ok_or_else(|| "audit event cannot be undone".to_string())?;
            let records = details
                .get("records")
                .and_then(|value| value.as_array())
                .ok_or_else(|| "audit event cannot be undone".to_string())?;
            for record in records.iter().filter_map(|value| value.as_str()) {
                connection
                    .execute(
                        "INSERT OR REPLACE INTO identity_memberships(
                            identity_group_id, record_id, link_type, confidence_score,
                            explanation_json, user_status
                         ) SELECT ?1, record_id, 'undo', 1.0,
                                  '{\"rule\":\"undo\"}', 'confirmed'
                           FROM identity_memberships
                          WHERE identity_group_id = ?2 AND record_id = ?3",
                        params![from, to, record],
                    )
                    .map_err(sanitized)?;
                connection
                    .execute(
                        "DELETE FROM identity_memberships
                         WHERE identity_group_id = ?1 AND record_id = ?2",
                        params![to, record],
                    )
                    .map_err(sanitized)?;
            }
        }
        _ => return Err("audit event cannot be undone".to_string()),
    }
    insert_audit(
        connection,
        undo_id,
        "undo",
        &entity_id,
        serde_json::json!({"restored_event": original_id}),
        Some(original_id),
    )
}

fn mask_for_display(
    field_type: FieldType,
    sensitive: bool,
    original: &str,
    normalized: &str,
) -> String {
    match field_type {
        FieldType::Email => {
            let Some((local, domain)) = normalized.split_once('@') else {
                return "masked email".to_string();
            };
            format!("{}•••@{domain}", local.chars().next().unwrap_or('•'))
        }
        FieldType::Phone => {
            let suffix: String = normalized
                .chars()
                .rev()
                .take(2)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            format!("••••••{suffix}")
        }
        FieldType::Password | FieldType::PasswordHash | FieldType::Salt => "[REDACTED]".to_string(),
        _ if sensitive => "••••••••".to_string(),
        _ => original.to_string(),
    }
}

fn parse_field_type(value: &str) -> FieldType {
    match value {
        "email" => FieldType::Email,
        "username" => FieldType::Username,
        "first_name" => FieldType::FirstName,
        "last_name" => FieldType::LastName,
        "full_name" => FieldType::FullName,
        "phone" => FieldType::Phone,
        "ip_address" => FieldType::IpAddress,
        "domain" => FieldType::Domain,
        "url" => FieldType::Url,
        "password" => FieldType::Password,
        "password_hash" => FieldType::PasswordHash,
        "salt" => FieldType::Salt,
        "date_of_birth" => FieldType::DateOfBirth,
        "address" => FieldType::Address,
        "city" => FieldType::City,
        "country" => FieldType::Country,
        "postal_code" => FieldType::PostalCode,
        "company" => FieldType::Company,
        "job_title" => FieldType::JobTitle,
        "user_id" => FieldType::UserId,
        "timestamp" => FieldType::Timestamp,
        _ => FieldType::Unknown,
    }
}

fn mode_name(mode: crate::models::SearchMode) -> &'static str {
    match mode {
        crate::models::SearchMode::Exact => "exact",
        crate::models::SearchMode::Contains => "contains",
        crate::models::SearchMode::Prefix => "prefix",
    }
}

fn sanitized(error: impl std::fmt::Display) -> String {
    let _ = error;
    "local investigation operation failed".to_string()
}

#[cfg(test)]
mod tests {
    use super::mask_for_display;
    use crate::models::FieldType;

    #[test]
    fn result_view_masks_sensitive_fields() {
        assert_eq!(
            mask_for_display(
                FieldType::Email,
                false,
                "person@example.com",
                "person@example.com"
            ),
            "p•••@example.com"
        );
        assert_eq!(
            mask_for_display(FieldType::Password, true, "[REDACTED]", "blake3:abc"),
            "[REDACTED]"
        );
    }
}
