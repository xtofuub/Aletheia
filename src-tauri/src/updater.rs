use std::time::Duration;

use serde::{Deserialize, Serialize};

const RELEASES_API: &str = "https://api.github.com/repos/xtofuub/Aletheia/releases/latest";
const RELEASES_PREFIX: &str = "https://github.com/xtofuub/Aletheia/releases/";

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    html_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    current_version: String,
    latest_version: String,
    update_available: bool,
    release_url: String,
}

#[tauri::command]
pub async fn check_for_updates() -> Result<UpdateStatus, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .build()
        .map_err(sanitized)?;
    let release = client
        .get(RELEASES_API)
        .header(
            reqwest::header::USER_AGENT,
            format!("Aletheia/{current_version}"),
        )
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(sanitized)?
        .error_for_status()
        .map_err(sanitized)?
        .json::<GitHubRelease>()
        .await
        .map_err(sanitized)?;
    if !release.html_url.starts_with(RELEASES_PREFIX) {
        return Err("update response contained an invalid release link".to_string());
    }
    let latest_version = release.tag_name.trim_start_matches('v').to_string();
    let update_available = parse_version(&latest_version).is_some_and(|latest| {
        parse_version(&current_version).is_some_and(|current| latest > current)
    });
    Ok(UpdateStatus {
        current_version,
        latest_version,
        update_available,
        release_url: release.html_url,
    })
}

fn parse_version(value: &str) -> Option<(u64, u64, u64)> {
    let core = value.split_once('-').map_or(value, |(core, _)| core);
    let mut parts = core.split('.');
    let version = (
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
    );
    parts.next().is_none().then_some(version)
}

fn sanitized(error: impl std::fmt::Display) -> String {
    let _ = error;
    "update check could not reach GitHub".to_string()
}

#[cfg(test)]
mod tests {
    use super::parse_version;

    #[test]
    fn semantic_versions_compare_numerically() {
        assert!(parse_version("0.10.0") > parse_version("0.9.9"));
        assert_eq!(parse_version("v1.2.3"), None);
        assert_eq!(parse_version("1.2"), None);
    }
}
