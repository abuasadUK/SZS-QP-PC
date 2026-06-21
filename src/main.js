const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const { exec, execFile } = require("child_process");
const fs = require("fs");
const os = require("os");

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    title: "Sort Zone Solution",
    icon: path.join(__dirname, "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.setFullScreen(true);
    mainWindow.show();
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
}

ipcMain.handle("printers:list", async () => {
  const sourceWindow = BrowserWindow.getFocusedWindow() || mainWindow;
  if (!sourceWindow) return [];
  const printers = await sourceWindow.webContents.getPrintersAsync();
  return printers.map((printer) => ({
    name: printer.name,
    displayName: printer.displayName || printer.name,
    isDefault: !!printer.isDefault
  }));
});

ipcMain.handle("keyboard:open", async () => {
  const commands = [
    "start osk",
    "start tabtip",
    "start C:\\Windows\\System32\\osk.exe",
    "start C:\\Program Files\\Common Files\\Microsoft Shared\\ink\\TabTip.exe"
  ];

  for (const command of commands) {
    const result = await new Promise((resolve) => {
      exec(command, { windowsHide: false }, (error) => {
        resolve(error ? { ok: false, error: error.message || String(error) } : { ok: true });
      });
    });

    if (result.ok) return result;
  }

  return { ok: false, error: "Could not open Windows on-screen keyboard. Windows may be blocking osk.exe." };
});

ipcMain.handle("print:silent", async (_event, payload) => {
  const html = payload && payload.html ? String(payload.html) : "";
  const printerName = payload && payload.printerName ? String(payload.printerName) : "";

  if (!html) {
    return { ok: false, error: "No print content was provided." };
  }

  const printWindow = new BrowserWindow({
    show: false,
    width: 1000,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  try {
    const dataUrl = "data:text/html;charset=utf-8," + encodeURIComponent(html);
    await printWindow.loadURL(dataUrl);

    await new Promise((resolve) => setTimeout(resolve, 250));

    const result = await new Promise((resolve) => {
      printWindow.webContents.print(
        {
          silent: true,
          printBackground: true,
          deviceName: printerName || undefined,
          margins: { marginType: "none" },
          landscape: true,
          pageSize: "A4",
          duplexMode: "simplex"
        },
        (success, failureReason) => {
          resolve({ ok: success, error: failureReason || "Print failed." });
        }
      );
    });

    printWindow.close();
    return result;
  } catch (error) {
    if (!printWindow.isDestroyed()) printWindow.close();
    return { ok: false, error: error.message || String(error) };
  }
});

function sendRawZplToWindowsPrinter(printerName, zpl) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve({ ok: false, error: "Raw Zebra printing is only supported on Windows." });
      return;
    }

    const tempDir = os.tmpdir();
    const stamp = Date.now() + "-" + Math.random().toString(16).slice(2);
    const zplPath = path.join(tempDir, `sort-zone-${stamp}.zpl`);
    const psPath = path.join(tempDir, `sort-zone-raw-print-${stamp}.ps1`);

    const psScript = String.raw`param(
  [string]$PrinterName,
  [string]$FilePath
)

$source = @"
using System;
using System.IO;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

  public static bool SendBytesToPrinter(string printerName, byte[] bytes) {
    IntPtr hPrinter;
    DOCINFOA di = new DOCINFOA();
    di.pDocName = "Sort Zone Raw ZPL";
    di.pDataType = "RAW";

    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) return false;

    try {
      if (!StartDocPrinter(hPrinter, 1, di)) return false;
      try {
        if (!StartPagePrinter(hPrinter)) return false;
        IntPtr unmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
        try {
          Marshal.Copy(bytes, 0, unmanagedBytes, bytes.Length);
          int written;
          bool success = WritePrinter(hPrinter, unmanagedBytes, bytes.Length, out written);
          return success && written == bytes.Length;
        } finally {
          Marshal.FreeCoTaskMem(unmanagedBytes);
          EndPagePrinter(hPrinter);
        }
      } finally {
        EndDocPrinter(hPrinter);
      }
    } finally {
      ClosePrinter(hPrinter);
    }
  }
}
"@

Add-Type -TypeDefinition $source

if (-not $PrinterName) {
  $PrinterName = Get-CimInstance Win32_Printer | Where-Object { $_.Default -eq $true } | Select-Object -First 1 -ExpandProperty Name
}

if (-not $PrinterName) {
  throw "No printer selected and no Windows default printer found."
}

if (-not (Test-Path $FilePath)) {
  throw "ZPL file was not found: $FilePath"
}

[byte[]]$bytes = [System.IO.File]::ReadAllBytes($FilePath)
$ok = [RawPrinterHelper]::SendBytesToPrinter($PrinterName, $bytes)
if (-not $ok) {
  throw "Raw ZPL print failed for printer: $PrinterName"
}
`;

    try {
      fs.writeFileSync(zplPath, zpl, "ascii");
      fs.writeFileSync(psPath, psScript, "utf8");
    } catch (error) {
      resolve({ ok: false, error: error.message || String(error) });
      return;
    }

    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psPath, "-PrinterName", printerName || "", "-FilePath", zplPath],
      { windowsHide: true, timeout: 30000 },
      (error, stdout, stderr) => {
        try { fs.unlinkSync(zplPath); } catch {}
        try { fs.unlinkSync(psPath); } catch {}

        if (error) {
          resolve({ ok: false, error: (stderr || stdout || error.message || String(error)).trim() });
          return;
        }

        resolve({ ok: true });
      }
    );
  });
}


ipcMain.handle("print:zpl", async (_event, payload) => {
  const zpl = payload && payload.zpl ? String(payload.zpl) : "";
  const printerName = payload && payload.printerName ? String(payload.printerName) : "";

  if (!zpl.trim()) {
    return { ok: false, error: "No ZPL content was provided." };
  }

  return sendRawZplToWindowsPrinter(printerName, zpl);
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
