use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex},
};

use rusqlite::{Connection, OptionalExtension, params, params_from_iter};
use tauri::State;
use uuid::Uuid;

use crate::{
    domain_analysis::{NormalizedDomain, normalize_domain},
    models::{
        DomainBreachSummary, DomainDetailsResponse, DomainGroupSummary, DomainRecordSummary,
        DomainSearchResponse, DomainSummary, FieldType, IdentityActionInput, IdentityMember,
        IdentityMembersResponse, IdentitySummary, ManualIdentityInput, OverviewStats, SavedSearch,
        SavedSearchInput, SearchField, SearchHit, SearchMode, SearchRequest, SearchResponse,
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
            .query_row(
                "SELECT COUNT(*) FROM (
                   SELECT identity_group_id
                   FROM identity_memberships
                   GROUP BY identity_group_id
                   HAVING COUNT(*) >= 2
                 )",
                [],
                |row| row.get::<_, i64>(0),
            )
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
pub async fn search_records(
    request: SearchRequest,
    state: State<'_, AppState>,
) -> Result<SearchResponse, String> {
    let root = state
        .current_storage_root()
        .map_err(|_| "storage location is unavailable".to_string())?;
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || search_records_inner(request, database, &root))
        .await
        .map_err(|_| "search task failed".to_string())?
}

fn search_records_inner(
    request: SearchRequest,
    database: Arc<Mutex<Connection>>,
    root: &Path,
) -> Result<SearchResponse, String> {
    if request
        .field_type
        .is_some_and(|field_type| field_type.is_secret())
    {
        return Err("secret fields cannot be searched".to_string());
    }
    let domain = exact_domain_query(&request);
    let (total, record_ids) = if let Some(domain) = domain.as_ref() {
        let domain_results = {
            let connection = database
                .lock()
                .map_err(|_| "metadata database is unavailable".to_string())?;
            ensure_url_domain_links(&connection, domain)?;
            search_domain_record_ids(
                &connection,
                domain,
                request.dataset_id.as_deref(),
                request.offset,
                request.limit,
            )?
        };
        if domain_results.0 > 0 {
            domain_results
        } else {
            let index = SearchIndex::open_or_create(root)?;
            let field_type = request.field_type.map(FieldType::as_str);
            index.search_record_ids(
                &request.query,
                request.mode,
                request.dataset_id.as_deref(),
                field_type,
                request.offset,
                request.limit,
            )?
        }
    } else {
        let index = SearchIndex::open_or_create(root)?;
        let field_type = request.field_type.map(FieldType::as_str);
        index.search_record_ids(
            &request.query,
            request.mode,
            request.dataset_id.as_deref(),
            field_type,
            request.offset,
            request.limit,
        )?
    };
    let connection = database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    let hits = load_search_hits(&connection, &record_ids)?;
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
pub async fn list_domains(
    query: String,
    offset: usize,
    limit: usize,
    state: State<'_, AppState>,
) -> Result<DomainSearchResponse, String> {
    if query.chars().count() > 253 {
        return Err("domain search exceeds 253 characters".to_string());
    }
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let connection = database
            .lock()
            .map_err(|_| "metadata database is unavailable".to_string())?;
        search_domain_groups(&connection, &query, offset, limit)
    })
    .await
    .map_err(|_| "domain search task failed".to_string())?
}

#[tauri::command]
pub async fn get_domain_details(
    registrable_domain: String,
    hostname: Option<String>,
    hostname_query: Option<String>,
    dataset_id: Option<String>,
    record_offset: usize,
    record_limit: usize,
    state: State<'_, AppState>,
) -> Result<DomainDetailsResponse, String> {
    let Some(domain) = normalize_domain(&registrable_domain) else {
        return Err("domain is invalid".to_string());
    };
    let parent = domain.registrable_domain.clone();
    let hostname = hostname
        .map(|value| {
            normalize_domain(&value)
                .filter(|candidate| candidate.registrable_domain == parent)
                .map(|candidate| candidate.hostname)
                .ok_or_else(|| "hostname filter is invalid".to_string())
        })
        .transpose()?;
    let hostname_query = hostname_query
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty());
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let connection = database
            .lock()
            .map_err(|_| "metadata database is unavailable".to_string())?;
        load_domain_details(
            &connection,
            &parent,
            hostname.as_deref(),
            hostname_query.as_deref(),
            dataset_id.as_deref(),
            record_offset,
            record_limit,
        )
    })
    .await
    .map_err(|_| "domain details task failed".to_string())?
}

fn search_domain_groups(
    connection: &Connection,
    query: &str,
    offset: usize,
    limit: usize,
) -> Result<DomainSearchResponse, String> {
    let query = query.trim().to_lowercase();
    if query
        .chars()
        .any(|character| character.is_control() || matches!(character, '*' | '?' | '[' | ']'))
    {
        return Err("domain search contains unsupported characters".to_string());
    }
    let pattern = format!("{query}*");
    let filter = if query.is_empty() {
        ""
    } else {
        "WHERE d.registrable_domain GLOB ?1 OR d.hostname GLOB ?1"
    };
    let count_sql = format!(
        "SELECT COUNT(*) FROM (
           SELECT d.registrable_domain FROM domains d
           {filter}
           GROUP BY d.registrable_domain
         )"
    );
    let total = if query.is_empty() {
        connection
            .query_row(&count_sql, [], |row| row.get::<_, i64>(0))
            .map_err(sanitized)?
    } else {
        connection
            .query_row(&count_sql, [&pattern], |row| row.get::<_, i64>(0))
            .map_err(sanitized)?
    };

    let data_sql = format!(
        "SELECT d.registrable_domain, MIN(d.public_suffix), COUNT(*),
                COALESCE(
                  NULLIF((
                    SELECT SUM(c.record_count)
                    FROM domain_dataset_counts c
                    WHERE c.registrable_domain = d.registrable_domain
                  ), 0),
                  SUM(d.record_count)
                )
         FROM domains d
         {filter}
         GROUP BY d.registrable_domain
         ORDER BY 4 DESC, d.registrable_domain
         LIMIT ?{} OFFSET ?{}",
        if query.is_empty() { 1 } else { 2 },
        if query.is_empty() { 2 } else { 3 }
    );
    let mut statement = connection.prepare(&data_sql).map_err(sanitized)?;
    let bounded_limit = limit.clamp(1, 100) as i64;
    let bounded_offset = offset.min(i64::MAX as usize) as i64;
    let mut rows = if query.is_empty() {
        statement
            .query(params![bounded_limit, bounded_offset])
            .map_err(sanitized)?
    } else {
        statement
            .query(params![pattern, bounded_limit, bounded_offset])
            .map_err(sanitized)?
    };
    let mut groups = Vec::with_capacity(bounded_limit as usize);
    while let Some(row) = rows.next().map_err(sanitized)? {
        groups.push(DomainGroupSummary {
            registrable_domain: row.get(0).map_err(sanitized)?,
            public_suffix: row.get(1).map_err(sanitized)?,
            hostname_count: row.get::<_, i64>(2).map_err(sanitized)? as u64,
            record_count: row.get::<_, i64>(3).map_err(sanitized)? as u64,
        });
    }
    Ok(DomainSearchResponse {
        total: total as u64,
        offset,
        groups,
    })
}

fn load_domain_details(
    connection: &Connection,
    registrable_domain: &str,
    hostname: Option<&str>,
    hostname_query: Option<&str>,
    dataset_id: Option<&str>,
    record_offset: usize,
    record_limit: usize,
) -> Result<DomainDetailsResponse, String> {
    if dataset_id.is_some_and(|value| value.len() > 128) {
        return Err("dataset filter is invalid".to_string());
    }
    if hostname_query.is_some_and(|value| {
        value.chars().count() > 253
            || value.chars().any(|character| {
                character.is_control() || matches!(character, '*' | '?' | '[' | ']')
            })
    }) {
        return Err("hostname search is invalid".to_string());
    }
    let domain =
        normalize_domain(registrable_domain).ok_or_else(|| "domain is invalid".to_string())?;
    ensure_url_domain_links(connection, &domain)?;
    if hostname.is_some_and(|value| {
        normalize_domain(value)
            .is_none_or(|candidate| candidate.registrable_domain != registrable_domain)
    }) {
        return Err("hostname filter is invalid".to_string());
    }

    let host_filter = hostname_query.unwrap_or_default();
    let host_pattern = format!("{host_filter}*");
    let mut host_statement = connection
        .prepare(
            "SELECT id, hostname, registrable_domain, public_suffix, is_subdomain, record_count
             FROM domains
             WHERE registrable_domain = ?1
               AND (?2 = '*' OR hostname GLOB ?2)
             ORDER BY record_count DESC, hostname
             LIMIT 250",
        )
        .map_err(sanitized)?;
    let hostnames = host_statement
        .query_map(params![registrable_domain, host_pattern], |row| {
            Ok(DomainSummary {
                id: row.get(0)?,
                hostname: row.get(1)?,
                registrable_domain: row.get(2)?,
                public_suffix: row.get(3)?,
                is_subdomain: row.get(4)?,
                record_count: row.get::<_, i64>(5)? as u64,
            })
        })
        .map_err(sanitized)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sanitized)?;

    let (count_table, count_column, link_table, link_column, link_value) =
        if let Some(hostname) = hostname {
            (
                "hostname_dataset_counts",
                "hostname",
                "record_domains",
                "hostname",
                hostname,
            )
        } else {
            (
                "domain_dataset_counts",
                "registrable_domain",
                "record_domain_parents",
                "registrable_domain",
                registrable_domain,
            )
        };
    let breach_sql = format!(
        "SELECT d.id, d.name, c.record_count
         FROM {count_table} c
         JOIN datasets d ON d.id = c.dataset_id
         WHERE c.{count_column} = ?1
         ORDER BY c.record_count DESC, d.name
         LIMIT 1000"
    );
    let mut breach_statement = connection.prepare(&breach_sql).map_err(sanitized)?;
    let breaches = breach_statement
        .query_map([link_value], |row| {
            Ok(DomainBreachSummary {
                dataset_id: row.get(0)?,
                dataset_name: row.get(1)?,
                record_count: row.get::<_, i64>(2)? as u64,
            })
        })
        .map_err(sanitized)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sanitized)?;

    let total_sql = format!(
        "SELECT COALESCE(SUM(record_count), 0)
         FROM {count_table}
         WHERE {count_column} = ?1
           AND (?2 IS NULL OR dataset_id = ?2)"
    );
    let total_records = connection
        .query_row(&total_sql, params![link_value, dataset_id], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(sanitized)?;

    let record_sql = format!(
        "SELECT r.id, d.id, d.name, sf.relative_path,
                r.source_location, r.parser
         FROM {link_table} domain_link
         JOIN records r ON r.id = domain_link.record_id
         JOIN datasets d ON d.id = r.dataset_id
         JOIN source_files sf ON sf.id = r.source_file_id
         WHERE domain_link.{link_column} = ?1
           AND (?2 IS NULL OR r.dataset_id = ?2)
         ORDER BY domain_link.record_id
         LIMIT ?3 OFFSET ?4"
    );
    let mut record_statement = connection.prepare(&record_sql).map_err(sanitized)?;
    let bounded_limit = record_limit.clamp(1, 100) as i64;
    let bounded_offset = record_offset.min(i64::MAX as usize) as i64;
    let mut records = record_statement
        .query_map(
            params![link_value, dataset_id, bounded_limit, bounded_offset],
            |row| {
                Ok(DomainRecordSummary {
                    record_id: row.get(0)?,
                    dataset_id: row.get(1)?,
                    dataset_name: row.get(2)?,
                    source_file: row.get(3)?,
                    source_location: row.get(4)?,
                    parser: row.get(5)?,
                    fields: Vec::new(),
                })
            },
        )
        .map_err(sanitized)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sanitized)?;
    drop(record_statement);
    let record_ids = records
        .iter()
        .map(|record| record.record_id.clone())
        .collect::<Vec<_>>();
    let mut display_fields = load_display_fields_batch(connection, &record_ids, 16)?;
    for record in &mut records {
        record.fields = display_fields.remove(&record.record_id).unwrap_or_default();
    }

    Ok(DomainDetailsResponse {
        registrable_domain: registrable_domain.to_string(),
        selected_hostname: hostname.map(str::to_string),
        hostnames,
        breaches,
        total_records: total_records as u64,
        record_offset,
        records,
    })
}

fn exact_domain_query(request: &SearchRequest) -> Option<NormalizedDomain> {
    if !matches!(request.mode, SearchMode::Exact) {
        return None;
    }
    let raw = request.query.trim().to_lowercase();
    let candidate = if let Some(value) = raw.strip_prefix("domain:") {
        if request
            .field_type
            .is_some_and(|field_type| !matches!(field_type, FieldType::Domain | FieldType::Url))
        {
            return None;
        }
        value.trim_matches('"')
    } else if matches!(request.field_type, Some(FieldType::Domain | FieldType::Url))
        || (request.field_type.is_none()
            && !raw.contains(['/', '@', ' '])
            && (raw.contains('.') || raw.parse::<std::net::IpAddr>().is_ok()))
    {
        raw.trim_matches('"')
    } else {
        return None;
    };
    normalize_domain(candidate)
}

fn ensure_url_domain_links(
    connection: &Connection,
    domain: &NormalizedDomain,
) -> Result<(), String> {
    let parent = domain.registrable_domain.as_str();
    let repaired = connection
        .query_row(
            "SELECT EXISTS(
               SELECT 1 FROM domain_link_repairs WHERE registrable_domain = ?1
             )",
            [parent],
            |row| row.get::<_, bool>(0),
        )
        .map_err(sanitized)?;
    if repaired {
        return Ok(());
    }
    let transaction = connection.unchecked_transaction().map_err(sanitized)?;
    transaction
        .execute(
            "INSERT OR IGNORE INTO record_domains(record_id, hostname, registrable_domain)
             SELECT record_id, hostname, registrable_domain
             FROM urls WHERE registrable_domain = ?1",
            [parent],
        )
        .map_err(sanitized)?;
    transaction
        .execute(
            "INSERT OR IGNORE INTO record_domain_parents(record_id, registrable_domain)
             SELECT DISTINCT record_id, registrable_domain
             FROM urls WHERE registrable_domain = ?1",
            [parent],
        )
        .map_err(sanitized)?;
    transaction
        .execute(
            "INSERT INTO hostname_dataset_counts(hostname, dataset_id, record_count)
             SELECT rd.hostname, r.dataset_id, COUNT(*)
             FROM record_domains rd
             JOIN records r ON r.id = rd.record_id
             WHERE rd.registrable_domain = ?1
             GROUP BY rd.hostname, r.dataset_id
             ON CONFLICT(hostname, dataset_id) DO UPDATE SET
               record_count = excluded.record_count",
            [parent],
        )
        .map_err(sanitized)?;
    transaction
        .execute(
            "INSERT INTO domain_dataset_counts(
                registrable_domain, dataset_id, record_count
             )
             SELECT rdp.registrable_domain, r.dataset_id, COUNT(*)
             FROM record_domain_parents rdp
             JOIN records r ON r.id = rdp.record_id
             WHERE rdp.registrable_domain = ?1
             GROUP BY rdp.registrable_domain, r.dataset_id
             ON CONFLICT(registrable_domain, dataset_id) DO UPDATE SET
               record_count = excluded.record_count",
            [parent],
        )
        .map_err(sanitized)?;
    transaction
        .execute(
            "UPDATE domains
             SET record_count = (
               SELECT COUNT(*) FROM record_domains rd
               WHERE rd.hostname = domains.hostname
             )
             WHERE registrable_domain = ?1",
            [parent],
        )
        .map_err(sanitized)?;
    transaction
        .execute(
            "INSERT OR REPLACE INTO domain_link_repairs(
                registrable_domain, repaired_at
             ) VALUES (?1, CURRENT_TIMESTAMP)",
            [parent],
        )
        .map_err(sanitized)?;
    transaction.commit().map_err(sanitized)?;
    Ok(())
}

fn search_domain_record_ids(
    connection: &Connection,
    domain: &NormalizedDomain,
    dataset_id: Option<&str>,
    offset: usize,
    limit: usize,
) -> Result<(usize, Vec<String>), String> {
    let (link_table, link_column, value) = if domain.hostname == domain.registrable_domain {
        (
            "record_domain_parents",
            "registrable_domain",
            domain.registrable_domain.as_str(),
        )
    } else {
        ("record_domains", "hostname", domain.hostname.as_str())
    };
    let count_sql = format!(
        "SELECT COUNT(*)
         FROM {link_table} rd
         JOIN records r ON r.id = rd.record_id
         WHERE rd.{link_column} = ?1
           AND (?2 IS NULL OR r.dataset_id = ?2)"
    );
    let total = connection
        .query_row(&count_sql, params![value, dataset_id], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(sanitized)?;
    let data_sql = format!(
        "SELECT rd.record_id
         FROM {link_table} rd
         JOIN records r ON r.id = rd.record_id
         WHERE rd.{link_column} = ?1
           AND (?2 IS NULL OR r.dataset_id = ?2)
         ORDER BY rd.record_id
         LIMIT ?3 OFFSET ?4"
    );
    let mut statement = connection.prepare(&data_sql).map_err(sanitized)?;
    let bounded_limit = limit.clamp(1, 200) as i64;
    let bounded_offset = offset.min(i64::MAX as usize) as i64;
    let record_ids = statement
        .query_map(
            params![value, dataset_id, bounded_limit, bounded_offset],
            |row| row.get::<_, String>(0),
        )
        .map_err(sanitized)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sanitized)?;
    Ok((total as usize, record_ids))
}

#[tauri::command]
pub async fn list_identities(state: State<'_, AppState>) -> Result<Vec<IdentitySummary>, String> {
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || list_identities_inner(database))
        .await
        .map_err(|_| "identity list task failed".to_string())?
}

fn list_identities_inner(database: Arc<Mutex<Connection>>) -> Result<Vec<IdentitySummary>, String> {
    let connection = database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    let mut statement = connection
        .prepare(
            "WITH membership_summary AS (
               SELECT identity_group_id,
                      COUNT(*) AS member_count,
                      MIN(link_type) AS link_type,
                      MIN(explanation_json) AS explanation_json,
                      CASE
                        WHEN SUM(user_status = 'rejected') > 0
                          THEN 'needs review'
                        WHEN SUM(user_status = 'confirmed') > 0
                          THEN 'confirmed'
                        ELSE 'automatic'
                      END AS review_status
               FROM identity_memberships
               GROUP BY identity_group_id
               HAVING COUNT(*) >= 2
             )
             SELECT ig.id, ig.display_label, ig.confidence_level,
                    ms.member_count, ms.link_type, ms.explanation_json,
                    ms.review_status
             FROM identity_groups ig
             JOIN membership_summary ms ON ms.identity_group_id = ig.id
             ORDER BY ig.updated_at DESC, ig.id
             LIMIT 500",
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
pub async fn list_identity_members(
    group_id: String,
    offset: usize,
    limit: usize,
    state: State<'_, AppState>,
) -> Result<IdentityMembersResponse, String> {
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let connection = database
            .lock()
            .map_err(|_| "metadata database is unavailable".to_string())?;
        load_identity_members(&connection, &group_id, offset, limit)
    })
    .await
    .map_err(|_| "identity members task failed".to_string())?
}

fn load_identity_members(
    connection: &Connection,
    group_id: &str,
    offset: usize,
    limit: usize,
) -> Result<IdentityMembersResponse, String> {
    let total = connection
        .query_row(
            "SELECT COUNT(*) FROM identity_memberships
             WHERE identity_group_id = ?1",
            [group_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(sanitized)?;
    let mut statement = connection
        .prepare(
            "SELECT im.record_id, d.name, sf.relative_path, r.source_location, im.user_status
             FROM identity_memberships im
             JOIN records r ON r.id = im.record_id
             JOIN datasets d ON d.id = r.dataset_id
             JOIN source_files sf ON sf.id = r.source_file_id
             WHERE im.identity_group_id = ?1
             ORDER BY im.record_id
             LIMIT ?2 OFFSET ?3",
        )
        .map_err(sanitized)?;
    let rows = statement
        .query_map(
            params![
                group_id,
                limit.clamp(1, 200) as i64,
                offset.min(i64::MAX as usize) as i64
            ],
            |row| {
                Ok(IdentityMember {
                    record_id: row.get(0)?,
                    dataset_name: row.get(1)?,
                    source_file: row.get(2)?,
                    source_location: row.get(3)?,
                    user_status: row.get(4)?,
                })
            },
        )
        .map_err(sanitized)?;
    let members = rows.collect::<Result<Vec<_>, _>>().map_err(sanitized)?;
    Ok(IdentityMembersResponse {
        total: total.max(0) as u64,
        offset,
        members,
    })
}

#[tauri::command]
pub async fn apply_identity_action(
    input: IdentityActionInput,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || apply_identity_action_inner(input, database))
        .await
        .map_err(|_| "identity review task failed".to_string())?
}

#[tauri::command]
pub async fn create_manual_identity(
    input: ManualIdentityInput,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || create_manual_identity_inner(input, database))
        .await
        .map_err(|_| "manual identity task failed".to_string())?
}

fn create_manual_identity_inner(
    input: ManualIdentityInput,
    database: Arc<Mutex<Connection>>,
) -> Result<String, String> {
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > 120 {
        return Err("identity name must contain between 1 and 120 characters".to_string());
    }
    let mut record_ids = input.record_ids;
    record_ids.sort_unstable();
    record_ids.dedup();
    if !(2..=10_000).contains(&record_ids.len()) {
        return Err("select between 2 and 10,000 records".to_string());
    }
    let mut connection = database
        .lock()
        .map_err(|_| "metadata database is unavailable".to_string())?;
    let transaction = connection.transaction().map_err(sanitized)?;
    let group_id = Uuid::new_v4().to_string();
    transaction
        .execute(
            "INSERT INTO identity_groups(id, display_label, confidence_level)
             VALUES (?1, ?2, 'user-confirmed')",
            params![group_id, name],
        )
        .map_err(sanitized)?;
    let explanation = serde_json::json!({
        "rule": "manual_search_bundle",
        "deterministic": false
    })
    .to_string();
    let mut inserted = 0_usize;
    for record_id in &record_ids {
        inserted += transaction
            .prepare_cached(
                "INSERT OR IGNORE INTO identity_memberships(
                    identity_group_id, record_id, link_type, confidence_score,
                    explanation_json, user_status
                 )
                 SELECT ?1, id, 'manual_bundle', 1.0, ?3, 'confirmed'
                 FROM records WHERE id = ?2",
            )
            .map_err(sanitized)?
            .execute(params![group_id, record_id, explanation])
            .map_err(sanitized)?;
    }
    if inserted != record_ids.len() {
        return Err("one or more selected records are no longer available".to_string());
    }
    insert_audit(
        &transaction,
        &Uuid::new_v4().to_string(),
        "create_manual",
        &group_id,
        serde_json::json!({"records": record_ids, "name": name}),
        None,
    )?;
    transaction.commit().map_err(sanitized)?;
    Ok(group_id)
}

fn apply_identity_action_inner(
    input: IdentityActionInput,
    database: Arc<Mutex<Connection>>,
) -> Result<String, String> {
    let mut connection = database
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
    transaction
        .execute(
            "DELETE FROM identity_groups
             WHERE NOT EXISTS (
               SELECT 1 FROM identity_memberships im
               WHERE im.identity_group_id = identity_groups.id
             )",
            [],
        )
        .map_err(sanitized)?;
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

fn load_search_hits(
    connection: &Connection,
    record_ids: &[String],
) -> Result<Vec<SearchHit>, String> {
    if record_ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = std::iter::repeat_n("?", record_ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT r.id, r.dataset_id, d.name, r.source_file_id, sf.relative_path,
                r.source_location, r.parser, fv.field_name, fv.field_type,
                fv.original_value, fv.normalized_value, fv.is_sensitive
         FROM records r
         JOIN datasets d ON d.id = r.dataset_id
         JOIN source_files sf ON sf.id = r.source_file_id
         LEFT JOIN field_values fv ON fv.record_id = r.id
         WHERE r.id IN ({placeholders})
         ORDER BY r.id, fv.id"
    );
    let mut statement = connection.prepare(&sql).map_err(sanitized)?;
    let mut rows = statement
        .query(params_from_iter(record_ids.iter()))
        .map_err(sanitized)?;
    let mut by_id = HashMap::<String, SearchHit>::with_capacity(record_ids.len());
    while let Some(row) = rows.next().map_err(sanitized)? {
        let record_id: String = row.get(0).map_err(sanitized)?;
        let hit = by_id.entry(record_id.clone()).or_insert_with(|| SearchHit {
            record_id,
            dataset_id: row.get(1).unwrap_or_default(),
            dataset_name: row.get(2).unwrap_or_default(),
            source_file_id: row.get(3).unwrap_or_default(),
            source_file: row.get(4).unwrap_or_default(),
            source_location: row.get(5).unwrap_or_default(),
            parser: row.get(6).unwrap_or_default(),
            match_reason: "normalized field match".to_string(),
            fields: Vec::new(),
        });
        let Some(name) = row.get::<_, Option<String>>(7).map_err(sanitized)? else {
            continue;
        };
        let field_type_name: String = row.get(8).map_err(sanitized)?;
        let original: String = row.get(9).map_err(sanitized)?;
        let normalized: String = row.get(10).map_err(sanitized)?;
        let sensitive: bool = row.get(11).map_err(sanitized)?;
        let field_type = parse_field_type(&field_type_name);
        hit.fields.push(SearchField {
            name,
            field_type,
            display_value: mask_for_display(field_type, sensitive, &original, &normalized),
            sensitive,
        });
    }
    Ok(record_ids
        .iter()
        .filter_map(|record_id| by_id.get(record_id).cloned())
        .collect())
}

fn load_display_fields_batch(
    connection: &Connection,
    record_ids: &[String],
    per_record_limit: usize,
) -> Result<HashMap<String, Vec<SearchField>>, String> {
    if record_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let placeholders = std::iter::repeat_n("?", record_ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT record_id, field_name, field_type, original_value,
                normalized_value, is_sensitive
         FROM field_values
         WHERE record_id IN ({placeholders})
         ORDER BY record_id, id"
    );
    let mut statement = connection.prepare(&sql).map_err(sanitized)?;
    let mut rows = statement
        .query(params_from_iter(record_ids.iter()))
        .map_err(sanitized)?;
    let mut fields = HashMap::<String, Vec<SearchField>>::with_capacity(record_ids.len());
    while let Some(row) = rows.next().map_err(sanitized)? {
        let record_id: String = row.get(0).map_err(sanitized)?;
        let values = fields.entry(record_id).or_default();
        if values.len() >= per_record_limit {
            continue;
        }
        let field_type_name: String = row.get(2).map_err(sanitized)?;
        let original: String = row.get(3).map_err(sanitized)?;
        let normalized: String = row.get(4).map_err(sanitized)?;
        let sensitive: bool = row.get(5).map_err(sanitized)?;
        let field_type = parse_field_type(&field_type_name);
        values.push(SearchField {
            name: row.get(1).map_err(sanitized)?,
            field_type,
            display_value: mask_for_display(field_type, sensitive, &original, &normalized),
            sensitive,
        });
    }
    Ok(fields)
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
    use std::sync::{Arc, Mutex};

    use tempfile::tempdir;

    use super::{
        create_manual_identity_inner, ensure_url_domain_links, exact_domain_query,
        list_identities_inner, load_domain_details, load_identity_members, mask_for_display,
        search_domain_groups, search_domain_record_ids,
    };
    use crate::models::{FieldType, ManualIdentityInput, SearchMode, SearchRequest};
    use crate::storage::open_database;

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

    #[test]
    fn domain_search_and_details_keep_dataset_traceability() {
        let workspace = tempdir().expect("temporary workspace");
        let connection = open_database(workspace.path()).expect("database");
        connection
            .execute_batch(
                "INSERT INTO datasets(
                    id, name, parser_version, status, record_count, file_count
                 ) VALUES ('dataset-1', 'Synthetic breach', 'test', 'ready', 1, 1);
                 INSERT INTO source_files(
                    id, dataset_id, absolute_path, relative_path, file_size, format
                 ) VALUES (
                    'file-1', 'dataset-1', 'C:\\Synthetic\\records.csv',
                    'records.csv', 128, 'csv'
                 );
                 INSERT INTO records(
                    id, dataset_id, source_file_id, source_location,
                    record_fingerprint, parser
                 ) VALUES (
                    'record-1', 'dataset-1', 'file-1', 'line 2',
                    'synthetic-fingerprint', 'test-parser'
                 );
                 INSERT INTO field_values(
                    record_id, field_name, field_type, original_value,
                    normalized_value, is_sensitive, confidence
                 ) VALUES
                    ('record-1', 'email', 'email', 'person@example.co.uk',
                     'person@example.co.uk', 0, 1.0),
                    ('record-1', 'url', 'url', 'https://portal.example.co.uk/account',
                     'https://portal.example.co.uk/account', 0, 1.0),
                    ('record-1', 'password', 'password', '[REDACTED]',
                     'blake3:synthetic', 1, 1.0);
                 INSERT INTO domains(
                    id, hostname, registrable_domain, public_suffix,
                    is_subdomain, record_count
                 ) VALUES (
                    'domain-1', 'portal.example.co.uk', 'example.co.uk',
                    'co.uk', 1, 1
                 );
                 INSERT INTO record_domains(record_id, hostname, registrable_domain)
                 VALUES ('record-1', 'portal.example.co.uk', 'example.co.uk');
                 INSERT INTO record_domain_parents(record_id, registrable_domain)
                 VALUES ('record-1', 'example.co.uk');",
            )
            .expect("synthetic domain data");

        let groups = search_domain_groups(&connection, "portal", 0, 50).expect("domain search");
        assert_eq!(groups.total, 1);
        assert_eq!(groups.groups[0].registrable_domain, "example.co.uk");

        let request = SearchRequest {
            query: "example.co.uk".to_string(),
            mode: SearchMode::Exact,
            dataset_id: None,
            field_type: Some(FieldType::Domain),
            offset: 0,
            limit: 50,
        };
        let domain = exact_domain_query(&request).expect("exact domain");
        let (total, records) =
            search_domain_record_ids(&connection, &domain, None, 0, 50).expect("domain records");
        assert_eq!(total, 1);
        assert_eq!(records, ["record-1"]);

        ensure_url_domain_links(&connection, &domain).expect("repair domain counts");
        let details = load_domain_details(&connection, "example.co.uk", None, None, None, 0, 50)
            .expect("details");
        assert_eq!(details.breaches.len(), 1);
        assert_eq!(details.breaches[0].dataset_name, "Synthetic breach");
        assert_eq!(details.total_records, 1);
        assert_eq!(details.records[0].source_location, "line 2");
        let email = details.records[0]
            .fields
            .iter()
            .find(|field| field.name == "email")
            .expect("email field");
        let password = details.records[0]
            .fields
            .iter()
            .find(|field| field.name == "password")
            .expect("password field");
        assert_eq!(email.display_value, "p•••@example.co.uk");
        assert_eq!(password.display_value, "[REDACTED]");

        let hostname_details = load_domain_details(
            &connection,
            "example.co.uk",
            Some("portal.example.co.uk"),
            Some("portal"),
            None,
            0,
            50,
        )
        .expect("hostname details");
        assert_eq!(
            hostname_details.selected_hostname.as_deref(),
            Some("portal.example.co.uk")
        );
        assert_eq!(hostname_details.breaches.len(), 1);
        assert_eq!(hostname_details.hostnames.len(), 1);
    }

    #[test]
    fn manual_identity_bundles_selected_records_and_lists_members() {
        let workspace = tempdir().expect("temporary workspace");
        let connection = open_database(workspace.path()).expect("database");
        connection
            .execute_batch(
                "INSERT INTO datasets(
                    id, name, parser_version, status, record_count, file_count
                 ) VALUES ('dataset-manual', 'Synthetic source', 'test', 'ready', 2, 1);
                 INSERT INTO source_files(
                    id, dataset_id, absolute_path, relative_path, file_size, format
                 ) VALUES (
                    'file-manual', 'dataset-manual', 'C:\\Synthetic\\manual.csv',
                    'manual.csv', 128, 'csv'
                 );
                 INSERT INTO records(
                    id, dataset_id, source_file_id, source_location,
                    record_fingerprint, parser
                 ) VALUES
                    ('manual-a', 'dataset-manual', 'file-manual', 'line 2', 'manual-fp-a', 'test'),
                    ('manual-b', 'dataset-manual', 'file-manual', 'line 3', 'manual-fp-b', 'test');",
            )
            .expect("synthetic manual identity data");
        let database = Arc::new(Mutex::new(connection));
        let group_id = create_manual_identity_inner(
            ManualIdentityInput {
                name: "Reviewed synthetic person".to_string(),
                record_ids: vec!["manual-a".to_string(), "manual-b".to_string()],
            },
            database.clone(),
        )
        .expect("manual identity");

        let identities = list_identities_inner(database.clone()).expect("identity list");
        assert_eq!(identities.len(), 1);
        assert_eq!(identities[0].display_label, "Reviewed synthetic person");
        assert_eq!(identities[0].member_count, 2);
        assert_eq!(identities[0].link_type, "manual_bundle");

        let connection = database.lock().expect("database lock");
        let members =
            load_identity_members(&connection, &group_id, 0, 25).expect("identity members");
        assert_eq!(members.total, 2);
        assert_eq!(members.members.len(), 2);
    }
}
