Sort Zone Solution Desktop v2.0

Fixes:
- Zebra small labels still print RAW ZPL for 100mm x 25mm.
- Small label QR reduced in size.
- Side arrows removed from printed Zebra labels.
- OV / big labels print through selected OV printer.
- If OV printer is Zebra/ZDesigner, RAW ZPL is used.
- If OV printer is HP/normal Windows printer, Windows HTML printing is used instead of ZPL.
- Endcap Small and Endcap Big Label buttons are equal height.

Build:
npm install
npm run dist
