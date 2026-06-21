Sort Zone Solution Desktop

This is a Windows desktop version of the Sort Zone Solution userscript.

Included features

1. Import STEM data per station.
2. Store STEM data locally.
3. Generate Sort Zone QR label previews.
4. Print Sort Zone labels.
5. Generate and print OV, PS, STG and ENDCP labels.
6. Quick Print flow.
7. Cluster setup.
8. Station label format setup.
9. Printer name fields.
10. A9-1A and A-9.1A format support.

How to run

1. Install Node.js LTS.
2. Open this folder in VS Code or Command Prompt.
3. Run:

npm install

4. Start the app:

npm start

How to create Windows EXE

Run:

npm run dist

Your EXE and installer will be created inside:

dist

Important

The app uses the same QR API style as the userscript:

https://api.qrserver.com/v1/create-qr-code/

So the PC needs internet access unless you later switch to an offline QR library.

STEM CSV format

The CSV must contain:

Resource Label
Resource Id

Example:

Resource Label,Resource Id
A1-1A,123456789
PS-A1,987654321
ENDCP.C25,555555555
