use crate::process::{self, HostProcess};
use serde::Deserialize;
use std::{
    io::{self, BufRead, BufReader, Write},
    os::windows::io::OwnedHandle,
    path::Path,
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};
use tauri::Url;

pub struct LocalHost {
    pub ready: Ready,
    process: HostProcess,
}

#[derive(Clone, Deserialize)]
pub struct Ready {
    pub origin: Url,
    pub cookie: String,
    pub token: String,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Message {
    Ready(Ready),
    Stopped,
}

impl LocalHost {
    pub fn start(node: &Path, entry: &Path, data: &Path, web: &Path) -> io::Result<Self> {
        let (mut process, output, mut diagnostics) = process::spawn(node, entry, data, web)?;
        let (sender, receiver) = mpsc::sync_channel(1);
        thread::spawn(move || {
            // Stdout contains the local session credential. Never log or replay it.
            let mut sender = Some(sender);
            for line in BufReader::new(output).lines().map_while(Result::ok) {
                if let Ok(Message::Ready(ready)) = serde_json::from_str(&line)
                    && let Some(sender) = sender.take()
                {
                    let _ = sender.send(ready);
                }
            }
        });
        thread::spawn(move || {
            let _ = io::copy(&mut diagnostics, &mut io::sink());
        });
        writeln!(process.input, "start")?;
        let ready = receiver
            .recv_timeout(Duration::from_secs(20))
            .map_err(|error| {
                io::Error::other(format!("The local Host did not report readiness: {error}"))
            })?;
        if !ready.valid() {
            return Err(io::Error::other(
                "The local Host returned an invalid readiness message.",
            ));
        }
        Ok(Self { ready, process })
    }

    pub fn waiter(&self) -> io::Result<OwnedHandle> {
        self.process.waiter()
    }

    pub fn stop(mut self) -> io::Result<()> {
        let _ = writeln!(self.process.input, "shutdown");
        let deadline = Instant::now() + Duration::from_secs(3);
        while self.process.running() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        if self.process.tree_running()? {
            self.process.terminate_tree()?;
            let deadline = Instant::now() + Duration::from_secs(2);
            while self.process.tree_running()? {
                if Instant::now() >= deadline {
                    return Err(io::Error::other(
                        "The local Host did not exit after termination.",
                    ));
                }
                thread::sleep(Duration::from_millis(20));
            }
        }
        Ok(())
    }
}

impl Ready {
    fn valid(&self) -> bool {
        self.origin.scheme() == "http"
            && self.origin.host_str() == Some("127.0.0.1")
            && self.origin.port().is_some()
            && self.origin.username().is_empty()
            && self.origin.password().is_none()
            && self.origin.path() == "/"
            && self.origin.query().is_none()
            && self.origin.fragment().is_none()
            && self.cookie == "beluga_desktop_session"
            && self.token.len() == 43
            && self
                .token
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    }
}
