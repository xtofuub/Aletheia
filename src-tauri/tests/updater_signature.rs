use std::{env, fs, path::PathBuf};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use minisign_verify::{PublicKey, Signature};

#[test]
#[ignore = "requires signed Windows release artifacts"]
fn signed_updater_matches_embedded_public_key() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let project_root = manifest_dir
        .parent()
        .expect("Tauri crate should be inside the project root");
    let release_dir = env::var_os("ALETHEIA_RELEASE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| project_root.join("release"));

    let config: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(manifest_dir.join("tauri.conf.json"))
            .expect("tauri.conf.json should be readable"),
    )
    .expect("tauri.conf.json should be valid JSON");
    let version = config["version"]
        .as_str()
        .expect("Tauri config should contain a version");
    let encoded_public_key = config["plugins"]["updater"]["pubkey"]
        .as_str()
        .expect("Tauri config should contain an updater public key");
    let setup_name = format!("aletheia_{version}_x64-setup.exe");

    let public_key_text = String::from_utf8(
        STANDARD
            .decode(encoded_public_key)
            .expect("updater public key should be base64 encoded"),
    )
    .expect("updater public key should be UTF-8");
    let signature_text = String::from_utf8(
        STANDARD
            .decode(
                fs::read_to_string(release_dir.join(format!("{setup_name}.sig")))
                    .expect("updater signature should exist")
                    .trim(),
            )
            .expect("updater signature should be base64 encoded"),
    )
    .expect("updater signature should be UTF-8");

    let public_key = PublicKey::decode(&public_key_text).expect("updater public key should decode");
    let signature = Signature::decode(&signature_text).expect("updater signature should decode");
    let installer = fs::read(release_dir.join(setup_name)).expect("NSIS updater should exist");

    public_key
        .verify(&installer, &signature, true)
        .expect("NSIS updater signature should match Aletheia's embedded public key");
}
