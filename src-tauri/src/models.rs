use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceFormat {
    Text,
    Csv,
    Tsv,
    Delimited,
    Jsonl,
    Gzip,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FieldType {
    Email,
    Username,
    FirstName,
    LastName,
    FullName,
    Phone,
    IpAddress,
    Domain,
    Url,
    Password,
    PasswordHash,
    Salt,
    DateOfBirth,
    Address,
    City,
    Country,
    PostalCode,
    Company,
    JobTitle,
    UserId,
    Timestamp,
    Unknown,
}

impl FieldType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Email => "email",
            Self::Username => "username",
            Self::FirstName => "first_name",
            Self::LastName => "last_name",
            Self::FullName => "full_name",
            Self::Phone => "phone",
            Self::IpAddress => "ip_address",
            Self::Domain => "domain",
            Self::Url => "url",
            Self::Password => "password",
            Self::PasswordHash => "password_hash",
            Self::Salt => "salt",
            Self::DateOfBirth => "date_of_birth",
            Self::Address => "address",
            Self::City => "city",
            Self::Country => "country",
            Self::PostalCode => "postal_code",
            Self::Company => "company",
            Self::JobTitle => "job_title",
            Self::UserId => "user_id",
            Self::Timestamp => "timestamp",
            Self::Unknown => "unknown",
        }
    }

    pub fn is_sensitive(self) -> bool {
        matches!(
            self,
            Self::Password
                | Self::PasswordHash
                | Self::Salt
                | Self::Phone
                | Self::DateOfBirth
                | Self::Address
        )
    }

    pub fn is_secret(self) -> bool {
        matches!(self, Self::Password | Self::PasswordHash | Self::Salt)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldMapping {
    pub source_name: String,
    pub field_type: FieldType,
    pub confidence: f32,
    pub is_sensitive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewRow {
    pub source_location: u64,
    pub values: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInspection {
    pub absolute_path: String,
    pub relative_path: String,
    pub file_name: String,
    pub file_size: u64,
    pub modified_at: Option<String>,
    pub format: SourceFormat,
    pub compressed: bool,
    pub encoding: String,
    pub line_ending: String,
    pub delimiter: Option<String>,
    pub has_header: bool,
    pub estimated_records: Option<u64>,
    pub column_count: usize,
    pub row_consistency: f32,
    pub mappings: Vec<FieldMapping>,
    pub preview: Vec<PreviewRow>,
    pub warnings: Vec<String>,
    pub eligible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectionResult {
    pub files: Vec<FileInspection>,
    pub rejected_paths: Vec<String>,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOptions {
    pub skip_invalid_rows: bool,
    pub stop_on_severe_error: bool,
    pub extract_urls: bool,
    pub extract_domains: bool,
    pub group_identities: bool,
    pub deduplicate: bool,
    pub store_offsets: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPlan {
    pub dataset_label: String,
    pub authorization_note: String,
    pub files: Vec<FileInspection>,
    pub options: ImportOptions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportStartResult {
    pub job_id: String,
    pub dataset_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub job_id: String,
    pub dataset_id: String,
    pub status: String,
    pub current_file: Option<String>,
    pub bytes_read: u64,
    pub total_bytes: u64,
    pub records_processed: u64,
    pub records_indexed: u64,
    pub invalid_records: u64,
    pub duplicate_records: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetSummary {
    pub id: String,
    pub name: String,
    pub status: String,
    pub record_count: u64,
    pub file_count: u64,
    pub total_bytes: u64,
    pub warning_count: u64,
    pub created_at: String,
    pub last_indexed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverviewStats {
    pub identity_group_count: u64,
    pub parent_domain_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub query: String,
    pub mode: SearchMode,
    pub dataset_id: Option<String>,
    pub field_type: Option<FieldType>,
    pub offset: usize,
    pub limit: usize,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchMode {
    Exact,
    Contains,
    Prefix,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchField {
    pub name: String,
    pub field_type: FieldType,
    pub display_value: String,
    pub sensitive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub record_id: String,
    pub dataset_id: String,
    pub dataset_name: String,
    pub source_file_id: String,
    pub source_file: String,
    pub source_location: String,
    pub parser: String,
    pub match_reason: String,
    pub fields: Vec<SearchField>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub total: usize,
    pub offset: usize,
    pub hits: Vec<SearchHit>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainSummary {
    pub id: String,
    pub hostname: String,
    pub registrable_domain: String,
    pub public_suffix: Option<String>,
    pub is_subdomain: bool,
    pub record_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainGroupSummary {
    pub registrable_domain: String,
    pub public_suffix: Option<String>,
    pub hostname_count: u64,
    pub record_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainSearchResponse {
    pub total: u64,
    pub offset: usize,
    pub groups: Vec<DomainGroupSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainBreachSummary {
    pub dataset_id: String,
    pub dataset_name: String,
    pub record_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainRecordSummary {
    pub record_id: String,
    pub dataset_id: String,
    pub dataset_name: String,
    pub source_file: String,
    pub source_location: String,
    pub parser: String,
    pub fields: Vec<SearchField>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainDetailsResponse {
    pub registrable_domain: String,
    pub selected_hostname: Option<String>,
    pub hostnames: Vec<DomainSummary>,
    pub breaches: Vec<DomainBreachSummary>,
    pub total_records: u64,
    pub record_offset: usize,
    pub records: Vec<DomainRecordSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentitySummary {
    pub id: String,
    pub display_label: String,
    pub confidence_level: String,
    pub member_count: u64,
    pub link_type: String,
    pub explanation: String,
    pub user_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityMember {
    pub record_id: String,
    pub dataset_name: String,
    pub source_file: String,
    pub source_location: String,
    pub user_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityMembersResponse {
    pub total: u64,
    pub offset: usize,
    pub members: Vec<IdentityMember>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityActionInput {
    pub action: String,
    pub group_id: String,
    pub record_ids: Vec<String>,
    pub target_group_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualIdentityInput {
    pub name: String,
    pub record_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedSearchInput {
    pub name: String,
    pub query: String,
    pub filters_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedSearch {
    pub id: String,
    pub name: String,
    pub query: String,
    pub filters_json: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub destination_path: String,
    pub format: String,
    pub record_ids: Vec<String>,
    pub mask_email_local_part: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub export_id: String,
    pub destination_path: String,
    pub manifest_path: String,
    pub record_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportHistoryItem {
    pub id: String,
    pub format: String,
    pub destination_path: String,
    pub record_count: usize,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupRequest {
    pub index: bool,
    pub cache: bool,
    pub temp: bool,
    pub search_history: bool,
    pub all_generated: bool,
}
