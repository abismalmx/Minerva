use serde_json::json;
use tauri_plugin_native_bridge::AuthRequest;

#[test]
fn preserves_platform_callback_fields_across_the_mobile_bridge() {
    let request: AuthRequest = serde_json::from_value(json!({
        "authUrl": "https://provider.example/authorize",
        "callbackScheme": "minerva-onedrive",
        "callbackUrl": "minerva-onedrive://auth"
    }))
    .unwrap();

    assert_eq!(request.callback_scheme.as_deref(), Some("minerva-onedrive"));
    assert_eq!(
        request.callback_url.as_deref(),
        Some("minerva-onedrive://auth")
    );
    assert_eq!(
        serde_json::to_value(request).unwrap(),
        json!({
            "authUrl": "https://provider.example/authorize",
            "callbackScheme": "minerva-onedrive",
            "callbackUrl": "minerva-onedrive://auth"
        }),
    );
}

#[test]
fn omits_unused_callback_fields() {
    let request: AuthRequest = serde_json::from_value(json!({
        "authUrl": "https://provider.example/authorize"
    }))
    .unwrap();

    assert_eq!(
        serde_json::to_value(request).unwrap(),
        json!({"authUrl": "https://provider.example/authorize"}),
    );
}
