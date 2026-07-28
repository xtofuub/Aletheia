use std::net::IpAddr;

use rusqlite::{Connection, params};
use url::Url;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedDomain {
    pub hostname: String,
    pub registrable_domain: String,
    pub public_suffix: Option<String>,
    pub is_subdomain: bool,
}

#[derive(Debug, Clone)]
pub struct NormalizedUrl {
    pub normalized_url: String,
    pub scheme: String,
    pub hostname: String,
    pub port: Option<u16>,
    pub path: String,
    pub query_keys: Vec<String>,
    pub has_fragment: bool,
    pub domain: NormalizedDomain,
}

pub fn normalize_domain(value: &str) -> Option<NormalizedDomain> {
    let raw = value.trim().trim_end_matches('.');
    if raw.is_empty() || raw.len() > 253 {
        return None;
    }
    let is_ip = raw.parse::<IpAddr>().is_ok();
    let hostname = if is_ip {
        raw.to_lowercase()
    } else {
        let parsed = Url::parse(&format!("https://{raw}/")).ok()?;
        parsed.host_str()?.trim_end_matches('.').to_lowercase()
    };
    if hostname.is_empty() {
        return None;
    }
    let registrable_domain = if is_ip {
        hostname.clone()
    } else {
        psl::domain_str(&hostname)
            .map(str::to_string)
            .unwrap_or_else(|| hostname.clone())
    };
    let public_suffix = if is_ip {
        None
    } else {
        psl::suffix_str(&hostname).map(str::to_string)
    };
    Some(NormalizedDomain {
        is_subdomain: hostname != registrable_domain,
        hostname,
        registrable_domain,
        public_suffix,
    })
}

pub fn normalize_url(value: &str) -> Option<NormalizedUrl> {
    let mut url = Url::parse(value.trim()).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    let hostname = url.host_str()?.trim_end_matches('.').to_lowercase();
    let domain = normalize_domain(&hostname)?;
    let scheme = url.scheme().to_string();
    let port = url.port();
    let path = if url.path().is_empty() {
        "/".to_string()
    } else {
        url.path().to_string()
    };
    let mut query_keys: Vec<String> = url
        .query_pairs()
        .map(|(key, _)| key.into_owned())
        .filter(|key| !key.is_empty())
        .take(100)
        .collect();
    query_keys.sort();
    query_keys.dedup();
    let has_fragment = url.fragment().is_some();
    let _ = url.set_username("");
    let _ = url.set_password(None);
    url.set_query(None);
    url.set_fragment(None);
    Some(NormalizedUrl {
        normalized_url: url.to_string(),
        scheme,
        hostname,
        port,
        path,
        query_keys,
        has_fragment,
        domain,
    })
}

pub fn store_domain(
    connection: &Connection,
    record_id: &str,
    domain: &NormalizedDomain,
    normalized_url: Option<&NormalizedUrl>,
) -> Result<(), rusqlite::Error> {
    let domain_id = stable_id("domain", &domain.hostname);
    connection.execute(
        "INSERT INTO domains(
            id, hostname, registrable_domain, public_suffix, is_subdomain,
            record_count, first_observed, last_observed
         ) VALUES (?1, ?2, ?3, ?4, ?5, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(hostname) DO UPDATE SET
            record_count = record_count + 1,
            last_observed = CURRENT_TIMESTAMP",
        params![
            domain_id,
            domain.hostname,
            domain.registrable_domain,
            domain.public_suffix,
            domain.is_subdomain
        ],
    )?;

    if let Some(url) = normalized_url {
        connection.execute(
            "INSERT OR IGNORE INTO urls(
                id, record_id, normalized_url, scheme, hostname, port, path,
                query_keys_json, has_fragment, registrable_domain
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                stable_id("url", &format!("{record_id}:{}", url.normalized_url)),
                record_id,
                url.normalized_url,
                url.scheme,
                url.hostname,
                url.port,
                url.path,
                serde_json::to_string(&url.query_keys).unwrap_or_else(|_| "[]".to_string()),
                url.has_fragment,
                url.domain.registrable_domain,
            ],
        )?;
    }
    Ok(())
}

fn stable_id(namespace: &str, value: &str) -> String {
    let hash = blake3::hash(format!("{namespace}\u{1f}{value}").as_bytes());
    format!("{namespace}-{}", &hash.to_hex()[..24])
}

#[cfg(test)]
mod tests {
    use super::{normalize_domain, normalize_url};

    #[test]
    fn public_suffix_resolution_handles_multi_label_suffixes() {
        let domain = normalize_domain("Portal.Example.CO.UK.").expect("domain");
        assert_eq!(domain.hostname, "portal.example.co.uk");
        assert_eq!(domain.registrable_domain, "example.co.uk");
        assert_eq!(domain.public_suffix.as_deref(), Some("co.uk"));
        assert!(domain.is_subdomain);
    }

    #[test]
    fn url_normalization_drops_credentials_query_values_and_fragments() {
        let url = normalize_url("https://user:pass@192.0.2.5:8443/path?token=secret&page=2#part")
            .expect("url");
        assert!(!url.normalized_url.contains("pass"));
        assert!(!url.normalized_url.contains("secret"));
        assert_eq!(url.query_keys, ["page", "token"]);
        assert!(url.has_fragment);
    }

    #[test]
    fn ips_remain_their_own_parent() {
        let domain = normalize_domain("192.0.2.12").expect("ip");
        assert_eq!(domain.hostname, domain.registrable_domain);
        assert!(domain.public_suffix.is_none());
    }
}
