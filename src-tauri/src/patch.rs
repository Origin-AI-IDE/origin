use patch_engine::{
    apply_snippet, delete_region, replace_region,
    DeleteRegionRequest, PatchRequest, PatchResult, ReplaceRegionRequest,
};

#[tauri::command]
pub fn patch_apply_snippet(req: PatchRequest) -> PatchResult {
    apply_snippet(req)
}

#[tauri::command]
pub fn patch_replace_region(req: ReplaceRegionRequest) -> PatchResult {
    replace_region(req)
}

#[tauri::command]
pub fn patch_delete_region(req: DeleteRegionRequest) -> PatchResult {
    delete_region(req)
}
