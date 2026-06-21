Sort Zone Solution - Raw ZPL Print Fix

Changes in this build:
- Sort Zone and OV/PS/STG/ENDCP labels now print as RAW ZPL instead of HTML/browser print.
- Label size is set for Zebra ZD621 300dpi, 100mm x 25mm.
- ZPL dimensions: ^PW1181 and ^LL295.
- Multiple Sort Zone labels are sent as separate ZPL labels in one print job.

Why this fixes blank labels:
The previous build used Electron/Windows HTML silent printing. Some Zebra drivers receive that job but output blank labels. This build sends Zebra ZPL directly to the Windows printer spooler.

Printer requirements:
- Zebra ZD621 should be in ZPL mode.
- Select the Zebra printer in Settings inside the app.
- If you choose Windows default printer, make sure the Zebra is the default printer.

Build commands:
npm install
npm run dist



V1.8 layout update:
- 100mm x 25mm Zebra ZPL layout restored closer to original label.
- Bigger location text.
- Bigger QR code.
- Down arrows are drawn as graphics instead of text, so they no longer print as V.
- Small resource ID text removed from printed label for cleaner layout.
