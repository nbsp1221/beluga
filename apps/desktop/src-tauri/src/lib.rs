mod host;
mod process;

use host::{LocalHost, Ready};
use std::{
    io,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
};
use tauri::{
    AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent,
    menu::{Menu, MenuItem},
    path::BaseDirectory,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::{Cookie, NewWindowResponse},
};

const LOCAL: &str = "product-local";
const SHELL: &str = "desktop-shell";

#[derive(Default)]
struct Desktop {
    host: Mutex<Option<LocalHost>>,
    exiting: AtomicBool,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show(app)))
        .manage(Desktop::default())
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "Open Beluga", true, None::<&str>)?;
            let exit = MenuItem::with_id(app, "exit", "Exit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &exit])?;
            TrayIconBuilder::with_id("beluga")
                .icon(
                    app.default_window_icon()
                        .cloned()
                        .ok_or("Missing tray icon.")?,
                )
                .tooltip("Beluga")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => show(app),
                    "exit" => exit_desktop(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) {
                        show(tray.app_handle());
                    }
                })
                .build(app)?;

            let app = app.handle().clone();
            thread::spawn(move || {
                if let Err(error) = start(&app) {
                    eprintln!("Beluga desktop: {error}");
                    show_recovery(&app);
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event
                && window.label() == LOCAL
                && !window.state::<Desktop>().exiting.load(Ordering::Acquire)
            {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("Unable to start Beluga desktop")
        .run(|_, event| {
            if let RunEvent::ExitRequested {
                code: None, api, ..
            } = event
            {
                api.prevent_exit();
            }
        });
}

fn start(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let node = std::env::current_exe()?.with_file_name("beluga-node.exe");
    let entry = app
        .path()
        .resolve("host/dist/main.js", BaseDirectory::Resource)?;
    let web = app.path().resolve("web", BaseDirectory::Resource)?;
    let data = app.path().app_local_data_dir()?.join("host");
    let host = LocalHost::start(&node, &entry, &data, &web)?;
    let waiter = host.waiter()?;
    let ready = host.ready.clone();
    let state = app.state::<Desktop>();
    {
        let mut owner = state.host.lock().unwrap();
        if state.exiting.load(Ordering::Acquire) {
            return Ok(());
        }
        *owner = Some(host);
    }
    let watch_app = app.clone();
    thread::spawn(move || {
        process::wait(waiter);
        let state = watch_app.state::<Desktop>();
        if !state.exiting.load(Ordering::Acquire) {
            state.host.lock().unwrap().take();
            if let Some(window) = watch_app.get_webview_window(LOCAL) {
                let _ = window.destroy();
            }
            show_recovery(&watch_app);
        }
    });
    if let Err(error) = open_local(app, &ready) {
        if let Some(host) = state.host.lock().unwrap().take() {
            let _ = host.stop();
        }
        return Err(error.into());
    }
    Ok(())
}

fn open_local(app: &AppHandle, ready: &Ready) -> tauri::Result<()> {
    let window = product_window(app, LOCAL, &ready.origin)?;
    window.set_cookie(
        Cookie::build((ready.cookie.clone(), ready.token.clone()))
            .domain("127.0.0.1")
            .path("/")
            .http_only(true)
            .same_site(tauri::webview::cookie::SameSite::Strict)
            .build(),
    )?;
    window.navigate(ready.origin.clone())?;
    window.show()?;
    window.set_focus()
}

fn product_window(app: &AppHandle, label: &str, url: &Url) -> tauri::Result<tauri::WebviewWindow> {
    let blank = Url::parse("about:blank").expect("valid blank URL");
    let origin = url.origin();
    WebviewWindowBuilder::new(app, label, WebviewUrl::External(blank.clone()))
        .title("Beluga")
        .inner_size(1280.0, 820.0)
        .min_inner_size(520.0, 600.0)
        .data_directory(app.path().app_local_data_dir()?.join(label))
        .visible(false)
        .on_navigation(move |url| url == &blank || url.origin() == origin)
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .build()
}

fn show(app: &AppHandle) {
    if app.state::<Desktop>().exiting.load(Ordering::Acquire) {
        return;
    }
    if let Some(window) = app
        .get_webview_window(LOCAL)
        .or_else(|| app.get_webview_window(SHELL))
    {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn show_recovery(app: &AppHandle) {
    if app.state::<Desktop>().exiting.load(Ordering::Acquire) {
        return;
    }
    let _ = WebviewWindowBuilder::new(app, SHELL, WebviewUrl::App("index.html".into()))
        .title("Beluga")
        .inner_size(520.0, 300.0)
        .build();
}

fn exit_desktop(app: &AppHandle) {
    let state = app.state::<Desktop>();
    if state.exiting.swap(true, Ordering::AcqRel) {
        return;
    }
    let host = state.host.lock().unwrap().take();
    let app = app.clone();
    thread::spawn(move || {
        let stop = host.map(LocalHost::stop).transpose();
        if let Err(error) = stop {
            let error: io::Error = error;
            eprintln!("Beluga desktop: {error}");
        }
        app.exit(0);
    });
}
