use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewWindow};
use crate::error::{CommandResult, HadronError};

pub const WIDGET_LABEL: &str = "widget";
pub const MAIN_LABEL: &str = "main";

const MIN_WIDGET_DIMENSION: f64 = 44.0;
const MAX_WIDGET_WIDTH: f64 = 800.0;
const MAX_WIDGET_HEIGHT: f64 = 1200.0;

/// Serialization lock for widget window operations.
/// Prevents concurrent show/hide/resize/move from corrupting wry/WebView2
/// event loop state, which causes ILLEGAL_INSTRUCTION (0xc000001d) crashes
/// on Windows.
///
/// Uses tokio::sync::Mutex (not parking_lot) to avoid blocking the Tokio
/// runtime when multiple widget commands arrive concurrently.
pub struct WidgetLock(tokio::sync::Mutex<()>);

impl WidgetLock {
    pub fn new() -> Self {
        Self(tokio::sync::Mutex::new(()))
    }
}

/// Runtime feature flag for the hover button/widget.
pub struct HoverButtonEnabledState(parking_lot::RwLock<bool>);

impl HoverButtonEnabledState {
    pub fn new(enabled: bool) -> Self {
        Self(parking_lot::RwLock::new(enabled))
    }
}

/// Get the widget window handle, if it exists
fn get_widget(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(WIDGET_LABEL)
}

fn is_hover_button_enabled(app: &AppHandle) -> bool {
    *app.state::<HoverButtonEnabledState>().0.read()
}

/// Toggle the widget window visibility
#[tauri::command]
pub async fn toggle_widget(app: AppHandle) -> CommandResult<()> {
    let wl = app.state::<WidgetLock>();
    let _guard = wl.0.lock().await;
    log::debug!("cmd: toggle_widget");
    let widget = get_widget(&app)
        .ok_or_else(|| HadronError::Internal("Widget window not found".into()))?;
    if !is_hover_button_enabled(&app) {
        if widget.is_visible()? {
            widget.hide()?;
        }
        return Ok(());
    }
    if widget.is_visible()? {
        widget.hide()?;
    } else {
        widget.show()?;
        widget.set_focus()?;
    }
    Ok(())
}

/// Show the widget without stealing focus from other windows
#[tauri::command]
pub async fn show_widget(app: AppHandle) -> CommandResult<()> {
    let wl = app.state::<WidgetLock>();
    let _guard = wl.0.lock().await;
    log::debug!("cmd: show_widget");
    let widget = get_widget(&app)
        .ok_or_else(|| HadronError::Internal("Widget window not found".into()))?;
    if !is_hover_button_enabled(&app) {
        if widget.is_visible()? {
            widget.hide()?;
        }
        return Ok(());
    }
    if widget.is_visible()? {
        return Ok(());
    }
    // Set alwaysOnTop just before showing to avoid a black box
    // from the transparent window being above everything before paint.
    widget.set_always_on_top(true)?;
    widget.show()?;
    Ok(())
}

/// Hide the widget
#[tauri::command]
pub async fn hide_widget(app: AppHandle) -> CommandResult<()> {
    let wl = app.state::<WidgetLock>();
    let _guard = wl.0.lock().await;
    log::debug!("cmd: hide_widget");
    let widget = get_widget(&app)
        .ok_or_else(|| HadronError::Internal("Widget window not found".into()))?;
    if !widget.is_visible()? {
        return Ok(());
    }
    widget.hide()?;
    widget.set_always_on_top(false)?;
    Ok(())
}

/// Check if the widget window is currently visible.
#[tauri::command]
pub async fn is_widget_visible(app: AppHandle) -> CommandResult<bool> {
    let wl = app.state::<WidgetLock>();
    let _guard = wl.0.lock().await;
    log::debug!("cmd: is_widget_visible");
    let widget = get_widget(&app)
        .ok_or_else(|| HadronError::Internal("Widget window not found".into()))?;
    Ok(widget.is_visible()?)
}

/// Update whether the hover button/widget feature is enabled.
#[tauri::command]
pub async fn set_hover_button_enabled(app: AppHandle, enabled: bool) -> CommandResult<()> {
    {
        let hover_state = app.state::<HoverButtonEnabledState>();
        let mut state = hover_state.0.write();
        *state = enabled;
    }

    if !enabled {
        let wl = app.state::<WidgetLock>();
        let _guard = wl.0.lock().await;
        if let Some(widget) = get_widget(&app) {
            if widget.is_visible()? {
                widget.hide()?;
            }
        }
    }

    Ok(())
}

/// Resize the widget window (for FAB <-> expanded transitions)
#[tauri::command]
pub async fn resize_widget(app: AppHandle, width: f64, height: f64) -> CommandResult<()> {
    let wl = app.state::<WidgetLock>();
    let _guard = wl.0.lock().await;
    log::debug!("cmd: resize_widget");
    if width < MIN_WIDGET_DIMENSION || width > MAX_WIDGET_WIDTH
        || height < MIN_WIDGET_DIMENSION || height > MAX_WIDGET_HEIGHT
        || width.is_nan() || height.is_nan() || width.is_infinite() || height.is_infinite()
    {
        return Err(HadronError::Validation(
            format!("Invalid widget dimensions: {}x{}", width, height),
        ));
    }
    let widget = get_widget(&app)
        .ok_or_else(|| HadronError::Internal("Widget window not found".into()))?;
    widget.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }))?;
    Ok(())
}

/// Show the main window and bring it to focus
#[tauri::command]
pub async fn focus_main_window(app: AppHandle) -> CommandResult<()> {
    log::debug!("cmd: focus_main_window");
    {
        let wl = app.state::<WidgetLock>();
        let _guard = wl.0.lock().await;
        if let Some(widget) = get_widget(&app) {
            if widget.is_visible()? {
                widget.hide()?;
            }
        }
    }
    let main = app
        .get_webview_window(MAIN_LABEL)
        .ok_or_else(|| HadronError::Internal("Main window not found".into()))?;
    main.show()?;
    main.unminimize()?;
    main.set_focus()?;
    Ok(())
}

/// Widget position for persistence
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WidgetPosition {
    pub x: f64,
    pub y: f64,
}

/// Get the current widget window position
#[tauri::command]
pub async fn get_widget_position(app: AppHandle) -> CommandResult<WidgetPosition> {
    let wl = app.state::<WidgetLock>();
    let _guard = wl.0.lock().await;
    log::debug!("cmd: get_widget_position");
    let widget = get_widget(&app)
        .ok_or_else(|| HadronError::Internal("Widget window not found".into()))?;
    let pos = widget.outer_position()?;
    let scale = widget.scale_factor()?;
    Ok(WidgetPosition {
        x: pos.x as f64 / scale,
        y: pos.y as f64 / scale,
    })
}

/// Move the widget window to a specific logical position
#[tauri::command]
pub async fn move_widget(app: AppHandle, x: f64, y: f64) -> CommandResult<()> {
    let wl = app.state::<WidgetLock>();
    let _guard = wl.0.lock().await;
    log::debug!("cmd: move_widget");
    if x.is_nan() || x.is_infinite() || y.is_nan() || y.is_infinite() {
        return Err(HadronError::Validation(
            format!("Invalid widget position: ({}, {})", x, y),
        ));
    }
    let widget = get_widget(&app)
        .ok_or_else(|| HadronError::Internal("Widget window not found".into()))?;
    widget.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }))?;
    Ok(())
}

/// Check if the main window is currently visible and focused
#[tauri::command]
pub async fn is_main_window_visible(app: AppHandle) -> CommandResult<bool> {
    log::debug!("cmd: is_main_window_visible");
    let main = app.get_webview_window(MAIN_LABEL);
    match main {
        Some(w) => Ok(w.is_visible()? && !w.is_minimized()?),
        None => Ok(false),
    }
}
