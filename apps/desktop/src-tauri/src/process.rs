use std::{
    ffi::{OsStr, c_void},
    fs::File,
    io,
    mem::{size_of, zeroed},
    os::windows::{
        ffi::OsStrExt,
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
    },
    path::Path,
    ptr::{null, null_mut},
};
use windows_sys::Win32::{
    Foundation::{HANDLE, HANDLE_FLAG_INHERIT, SetHandleInformation, WAIT_OBJECT_0},
    Security::SECURITY_ATTRIBUTES,
    System::{
        JobObjects::{
            CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JobObjectBasicAccountingInformation, JobObjectExtendedLimitInformation,
            QueryInformationJobObject, SetInformationJobObject, TerminateJobObject,
        },
        Pipes::CreatePipe,
        Threading::{
            CREATE_NO_WINDOW, CreateProcessW, DeleteProcThreadAttributeList,
            EXTENDED_STARTUPINFO_PRESENT, InitializeProcThreadAttributeList,
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST, PROC_THREAD_ATTRIBUTE_JOB_LIST, PROCESS_INFORMATION,
            STARTF_USESTDHANDLES, STARTUPINFOEXW, UpdateProcThreadAttribute, WaitForSingleObject,
        },
    },
};

pub struct HostProcess {
    job: OwnedHandle,
    process: OwnedHandle,
    pub input: File,
}

impl HostProcess {
    pub fn waiter(&self) -> io::Result<OwnedHandle> {
        self.process.try_clone()
    }

    pub fn running(&self) -> bool {
        unsafe { WaitForSingleObject(self.process.as_raw_handle(), 0) != WAIT_OBJECT_0 }
    }

    pub fn terminate_tree(&self) -> io::Result<()> {
        check(unsafe { TerminateJobObject(self.job.as_raw_handle(), 1) })
    }

    pub fn tree_running(&self) -> io::Result<bool> {
        let mut info: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { zeroed() };
        check(unsafe {
            QueryInformationJobObject(
                self.job.as_raw_handle(),
                JobObjectBasicAccountingInformation,
                (&mut info as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                null_mut(),
            )
        })?;
        Ok(info.ActiveProcesses > 0)
    }
}

pub fn wait(handle: OwnedHandle) {
    unsafe { WaitForSingleObject(handle.as_raw_handle(), u32::MAX) };
}

pub fn spawn(
    node: &Path,
    entry: &Path,
    data: &Path,
    web: &Path,
) -> io::Result<(HostProcess, File, File)> {
    let (child_input, parent_input) = pipe()?;
    let (parent_output, child_output) = pipe()?;
    let (parent_error, child_error) = pipe()?;
    for handle in [&parent_input, &parent_output, &parent_error] {
        check(unsafe { SetHandleInformation(handle.as_raw_handle(), HANDLE_FLAG_INHERIT, 0) })?;
    }

    let job = owned(unsafe { CreateJobObjectW(null(), null()) })?;
    let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    check(unsafe {
        SetInformationJobObject(
            job.as_raw_handle(),
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    })?;

    let mut attributes = Attributes::new()?;
    let handles = [
        child_input.as_raw_handle(),
        child_output.as_raw_handle(),
        child_error.as_raw_handle(),
    ];
    let jobs = [job.as_raw_handle()];
    attributes.add(PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize, &handles)?;
    attributes.add(PROC_THREAD_ATTRIBUTE_JOB_LIST as usize, &jobs)?;

    let mut startup: STARTUPINFOEXW = unsafe { zeroed() };
    startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = handles[0];
    startup.StartupInfo.hStdOutput = handles[1];
    startup.StartupInfo.hStdError = handles[2];
    startup.lpAttributeList = attributes.raw();
    let mut information: PROCESS_INFORMATION = unsafe { zeroed() };
    let mut args = Vec::new();
    for (i, arg) in [
        node.as_os_str(),
        OsStr::new("--use-system-ca"),
        entry.as_os_str(),
        OsStr::new("desktop"),
        OsStr::new("--data-dir"),
        data.as_os_str(),
        OsStr::new("--web-dir"),
        web.as_os_str(),
    ]
    .into_iter()
    .enumerate()
    {
        if i > 0 {
            args.push(b' ' as u16);
        }
        append_argument(&mut args, arg);
    }
    args.push(0);
    let executable: Vec<_> = node.as_os_str().encode_wide().chain([0]).collect();
    check(unsafe {
        CreateProcessW(
            executable.as_ptr(),
            args.as_mut_ptr(),
            null(),
            null(),
            1,
            EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW,
            null(),
            null(),
            &startup.StartupInfo,
            &mut information,
        )
    })?;
    drop(owned(information.hThread)?);
    Ok((
        HostProcess {
            job,
            process: owned(information.hProcess)?,
            input: File::from(parent_input),
        },
        File::from(parent_output),
        File::from(parent_error),
    ))
}

fn append_argument(command: &mut Vec<u16>, value: &OsStr) {
    let quote = b'"' as u16;
    let slash = b'\\' as u16;
    command.push(quote);
    let mut slashes = 0;
    for unit in value.encode_wide() {
        if unit == slash {
            slashes += 1;
        } else {
            let count = if unit == quote {
                2 * slashes + 1
            } else {
                slashes
            };
            command.extend(std::iter::repeat_n(slash, count));
            slashes = 0;
            command.push(unit);
        }
    }
    command.extend(std::iter::repeat_n(slash, 2 * slashes));
    command.push(quote);
}

fn pipe() -> io::Result<(OwnedHandle, OwnedHandle)> {
    let security = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: null_mut(),
        bInheritHandle: 1,
    };
    let (mut read, mut write) = (null_mut(), null_mut());
    check(unsafe { CreatePipe(&mut read, &mut write, &security, 0) })?;
    Ok((owned(read)?, owned(write)?))
}

fn owned(handle: HANDLE) -> io::Result<OwnedHandle> {
    if handle.is_null() {
        Err(io::Error::last_os_error())
    } else {
        // Win32 returned a unique handle that this scope must close.
        Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
    }
}

fn check(result: i32) -> io::Result<()> {
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

struct Attributes(Vec<usize>);

impl Attributes {
    fn new() -> io::Result<Self> {
        let mut size = 0;
        // The first call reports the required storage size.
        unsafe { InitializeProcThreadAttributeList(null_mut(), 2, 0, &mut size) };
        let mut data = vec![0; size.div_ceil(size_of::<usize>())];
        check(unsafe {
            InitializeProcThreadAttributeList(data.as_mut_ptr().cast(), 2, 0, &mut size)
        })?;
        Ok(Self(data))
    }

    fn raw(&mut self) -> *mut c_void {
        self.0.as_mut_ptr().cast()
    }

    fn add<const N: usize>(&mut self, key: usize, value: &[HANDLE; N]) -> io::Result<()> {
        // The caller keeps the handle arrays alive through CreateProcessW.
        check(unsafe {
            UpdateProcThreadAttribute(
                self.raw(),
                0,
                key,
                value.as_ptr().cast(),
                size_of::<[HANDLE; N]>(),
                null_mut(),
                null(),
            )
        })
    }
}

impl Drop for Attributes {
    fn drop(&mut self) {
        unsafe { DeleteProcThreadAttributeList(self.raw()) };
    }
}
