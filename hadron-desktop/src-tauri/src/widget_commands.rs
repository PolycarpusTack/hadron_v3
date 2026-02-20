use tauri::{AppHandle, Manager, WebviewWindow};

/// Get the widget window handle, if it exists
fn get_widget(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("widget")
}

/// Toggle the widget window visibility
#[tauri::command]
pub async fn toggle_widget(app: AppHandle) -> Result<(), String> {
    let widget = get_widget(&app).ok_or("Widget window not found")?;
    if widget.is_visible().map_err(|e| e.to_string())? {
        widget.hide().map_err(|e| e.to_string())?;
    } else {
        widget.show().map_err(|e| e.to_string())?;
        widget.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Show and focus the widget
#[tauri::command]
pub async fn show_widget(app: AppHandle) -> Result<(), String> {
    let widget = get_widget(&app).ok_or("Widget window not found")?;
    widget.show().map_err(|e| e.to_string())?;
    widget.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

/// Hide the widget
#[tauri::command]
pub async fn hide_widget(app: AppHandle) -> Result<(), String> {
    let widget = get_widget(&app).ok_or("Widget window not found")?;
    widget.hide().map_err(|e| e.to_string())?;
    Ok(())
}

/// Resize the widget window (for FAB <-> expanded transitions)
#[tauri::command]
pub async fn resize_widget(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let widget = get_widget(&app).ok_or("Widget window not found")?;
    widget
        .set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Show the main window and bring it to focus
#[tauri::command]
pub async fn focus_main_window(app: AppHandle) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;
    main.show().map_err(|e| e.to_string())?;
    main.unminimize().map_err(|e| e.to_string())?;
    main.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}
