"use strict";

const SORT_ZONE_REGEX = /^(?:[A-Z]+\d+-\d+[A-Z]|[A-Z]+\d+-CART-\d+\.(?:[A-Z]{1,3}|\d[A-Z]{1,2})|[A-Z]+-\d+\.\d+[A-Z]|[A-Z]+\.[A-Z]\d+|[A-Z]+\.\d+|[A-Z]+\d+-\d+|[A-Z]+_\d+|[A-Z]+-\d+\.[A-Z]+\d+|[A-Z]+-\d+\.[A-Z]+|[A-Z]+\.\d+\.[A-Z]+)$/;
const OV_REGEX = /^(?:[A-Z]+\d+-[A-Z]+|[A-Z]+-[A-Z]+\d+|[A-Z]+\d+-CART-\d+\.(?:[A-Z]{1,3}|\d[A-Z]{1,2})|[A-Z]+-\d+\.\d+[A-Z]|[A-Z]+\.[A-Z]\d+|[A-Z]+\.\d+|[A-Z]+\d+-\d+|[A-Z]+_\d+|OV-[A-Z]+\d+-[A-Z]+|ENDCP\.[A-Z]+\d+|ENDCP-[A-Z]+\d+|STG\.[A-Z]+\d+|STG-[A-Z]+\d+|PS-[A-Z]+\d+|[A-Z]+-\d+\.[A-Z]+\d+)$/;
const QR_BASE_URL = "https://api.qrserver.com/v1/create-qr-code/";
const STORAGE_STEM_PREFIX = "szDesktopStemData_";
const STORAGE_SETTINGS = "szDesktopSettings";
const CLUSTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const ZONE_LETTERS = ["A","B","C","D","E","F","G","H","I","J","K","L"];
const BIG_TOP = ["P","T","W","Y"];
const BIG_BOTTOM = ["R","U","X","Z"];

function buildClusterDefaults() {
  return Object.fromEntries(CLUSTERS.map(c => [c, ["A","B","C","D"].includes(c)]));
}

function buildRangeDefaults() {
  return Object.fromEntries(CLUSTERS.map(c => [c, { start: 1, end: 56 }]));
}

function buildZoneDefaults() {
  return Object.fromEntries(CLUSTERS.map(c => [c, Object.fromEntries(ZONE_LETTERS.map(z => [z, true]))]));
}

const DEFAULT_SETTINGS = {
  stationCode: "DCE1",
  labelFormat: "A9-1A",
  aislesPerCluster: 56,
  clusterRanges: buildRangeDefaults(),
  clusterZones: buildZoneDefaults(),
  szPrinter: "",
  ovPrinter: "",
  clusters: buildClusterDefaults()
};

let stemMap = {};
let lastSortZoneItems = [];
let lastOvCode = "";
let toastTimer = null;
const $ = (id) => document.getElementById(id);

function getSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_SETTINGS)) || {};
    const defaults = {
      ...DEFAULT_SETTINGS,
      clusters: buildClusterDefaults(),
      clusterRanges: buildRangeDefaults(),
      clusterZones: buildZoneDefaults()
    };
    const merged = {
      ...defaults,
      ...saved,
      clusters: { ...defaults.clusters, ...(saved.clusters || {}) },
      clusterRanges: { ...defaults.clusterRanges, ...(saved.clusterRanges || {}) },
      clusterZones: { ...defaults.clusterZones }
    };
    for (const c of CLUSTERS) {
      merged.clusterZones[c] = { ...defaults.clusterZones[c], ...((saved.clusterZones || {})[c] || {}) };
    }
    return merged;
  } catch {
    return {
      ...DEFAULT_SETTINGS,
      clusters: buildClusterDefaults(),
      clusterRanges: buildRangeDefaults(),
      clusterZones: buildZoneDefaults()
    };
  }
}

function saveSettingsObject(settings) {
  localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(settings));
}

function getStationCode() {
  return ($("stationCode").value || getSettings().stationCode || "DCE1").trim().toUpperCase();
}

function stemKey() {
  return STORAGE_STEM_PREFIX + getStationCode();
}

function loadStem() {
  try {
    stemMap = JSON.parse(localStorage.getItem(stemKey())) || {};
  } catch {
    stemMap = {};
  }
  populateEndcpDropdown();
}

function saveStem(map) {
  stemMap = map;
  localStorage.setItem(stemKey(), JSON.stringify(stemMap));
  populateEndcpDropdown();
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quote = !quote;
    else if (ch === "," && !quote) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(v => v.trim().replace(/^"|"$/g, ""));
}

function addStemAlias(map, label, resourceId) {
  if (!label || !resourceId) return;
  const raw = label.trim().toUpperCase();
  const id = String(resourceId).trim();
  if (!raw || !id) return;

  map[raw] = id;
  map[raw.replace(/[^A-Z0-9]/g, "")] ||= id;

  if (raw.includes(".")) map[raw.replace(/\./g, "-")] ||= id;
  if (raw.includes("-")) map[raw.replace(/-/g, ".")] ||= id;

  if (raw.startsWith("ENDCP-")) map[raw.replace("ENDCP-", "ENDCP.")] ||= id;
  if (raw.startsWith("ENDCP.")) map[raw.replace("ENDCP.", "ENDCP-")] ||= id;
  if (raw.startsWith("STG-")) map[raw.replace("STG-", "STG.")] ||= id;
  if (raw.startsWith("STG.")) map[raw.replace("STG.", "STG-")] ||= id;

  const dotFormat = raw.match(/^([A-Z])-(\d+)\.(\d+[A-Z])$/);
  if (dotFormat) map[`${dotFormat[1]}${dotFormat[2]}-${dotFormat[3]}`] ||= id;

  const standardFormat = raw.match(/^([A-Z])(\d+)-(\d+[A-Z])$/);
  if (standardFormat) map[`${standardFormat[1]}-${standardFormat[2]}.${standardFormat[3]}`] ||= id;
}

function parseStemCsv(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) return null;

  const header = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  const labelIndex = header.indexOf("resource label");
  const idIndex = header.indexOf("resource id");

  if (labelIndex < 0 || idIndex < 0) {
    alert("CSV must contain Resource Label and Resource Id columns.");
    return null;
  }

  const map = {};
  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    addStemAlias(map, row[labelIndex], row[idIndex]);
  }
  return map;
}

function qrDataForLabel(label) {
  const upper = label.toUpperCase();
  const normalized = upper.replace(/[^A-Z0-9]/g, "");

  if (stemMap[upper]) return stemMap[upper];
  if (stemMap[normalized]) return stemMap[normalized];

  const dotFormat = upper.match(/^([A-Z])-(\d+)\.(\d+[A-Z])$/);
  if (dotFormat) {
    const standard = `${dotFormat[1]}${dotFormat[2]}-${dotFormat[3]}`;
    if (stemMap[standard]) return stemMap[standard];
  }

  const standardFormat = upper.match(/^([A-Z])(\d+)-(\d+[A-Z])$/);
  if (standardFormat) {
    const dot = `${standardFormat[1]}-${standardFormat[2]}.${standardFormat[3]}`;
    if (stemMap[dot]) return stemMap[dot];
  }

  if (upper.includes(".")) {
    const hyphen = upper.replace(/\./g, "-");
    if (stemMap[hyphen]) return stemMap[hyphen];
  }

  if (upper.includes("-")) {
    const dot = upper.replace(/-/g, ".");
    if (stemMap[dot]) return stemMap[dot];
  }

  for (const key of Object.keys(stemMap)) {
    if (key.replace(/[^A-Z0-9]/g, "") === normalized) return stemMap[key];
  }

  return null;
}

function qrDataForLabelLoose(label) {
  const value = String(label || "").trim().toUpperCase();
  if (!value) return null;
  return qrDataForLabel(value) || value;
}

function endcapLabelFor(cluster, aisle) {
  const compact = String(cluster || "").toUpperCase() + String(aisle || "").trim();
  const dotLabel = `ENDCP.${compact}`;
  const dashLabel = `ENDCP-${compact}`;
  if (stemMap[dotLabel] || stemMap[dotLabel.replace(/[^A-Z0-9]/g, "")]) return dotLabel;
  if (stemMap[dashLabel] || stemMap[dashLabel.replace(/[^A-Z0-9]/g, "")]) return dashLabel;
  return dotLabel;
}

function buildQrUrl(data, size) {
  return `${QR_BASE_URL}?data=${encodeURIComponent(data)}&size=${size}x${size}&charset-source=UTF-8&charset-target=UTF-8&ecc=L&margin=0&qzone=1&format=png`;
}

function requireStem() {
  if (!stemMap || !Object.keys(stemMap).length) {
    alert("Import STEM data first for station " + getStationCode() + ".");
    return false;
  }
  return true;
}

function makeInput(value = "") {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "sz-input";
  input.maxLength = 30;
  input.value = value;
  input.placeholder = "A9-1A";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.addEventListener("click", () => input.focus());
  input.addEventListener("focus", () => input.select());
  input.addEventListener("paste", handleInputPaste);
  input.addEventListener("input", () => {
    input.value = input.value.toUpperCase().replace(/\s+/g, "");
  });
  return input;
}

function setupInputs() {
  const list = $("sortZoneInputs");
  list.innerHTML = "";
  for (let i = 0; i < 11; i++) list.appendChild(makeInput());
}

function fillInputs(parts, startIndex = 0) {
  const list = $("sortZoneInputs");
  let inputs = [...list.querySelectorAll(".sz-input")];
  let index = startIndex;
  for (const part of parts) {
    while (index >= inputs.length) {
      list.appendChild(makeInput());
      inputs = [...list.querySelectorAll(".sz-input")];
    }
    inputs[index].value = part;
    index++;
  }
}

function handleInputPaste(e) {
  const text = e.clipboardData?.getData("text") || "";
  const parts = text.split(/[\s,]+/).map(x => x.trim().toUpperCase()).filter(Boolean);
  if (parts.length <= 1) return;

  e.preventDefault();
  const inputs = [...document.querySelectorAll(".sz-input")];
  fillInputs(parts, inputs.indexOf(e.target));
}

async function pasteMultiple() {
  try {
    const text = await navigator.clipboard.readText();
    const parts = text.split(/[\s,]+/).map(x => x.trim().toUpperCase()).filter(Boolean);
    if (parts.length) fillInputs(parts, 0);
  } catch {
    alert("Clipboard access failed. Click first input and press Ctrl+V.");
  }
}

function readSortZoneInputs() {
  const values = [...document.querySelectorAll(".sz-input")]
    .map(input => input.value.trim().toUpperCase().replace(/\s+/g, ""))
    .filter(Boolean);

  if (!values.length) {
    alert("No sort zones entered.");
    return null;
  }

  for (const value of values) {
    if (!SORT_ZONE_REGEX.test(value)) {
      alert("Invalid sort zone format: " + value);
      return null;
    }
  }

  return values;
}

function buildItemsFromInputs() {
  if (!requireStem()) return null;
  const labels = readSortZoneInputs();
  if (!labels) return null;

  const items = [];
  for (const label of labels) {
    const qrData = qrDataForLabel(label);
    if (!qrData) {
      alert("No Resource Id found in STEM data for label " + label + ".");
      return null;
    }
    items.push({ label, qrData });
  }
  return items;
}

function renderSortZonePreview(items) {
  const box = $("labelPreview");
  box.innerHTML = "";
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "label-row";
    row.innerHTML = `
      <div class="label-arrow">⇩</div>
      <div class="label-code">${escapeHtml(item.label)}</div>
      <div><img src="${buildQrUrl(item.qrData, 110)}" alt="QR"></div>
      <div class="label-arrow">⇩</div>
    `;
    box.appendChild(row);
  }
}

function generateSortZones() {
  const items = buildItemsFromInputs();
  if (!items) return;
  lastSortZoneItems = items;
  renderSortZonePreview(items);
}

function generateOv() {
  const code = $("ovEntry").value.trim().toUpperCase().replace(/\s+/g, "");
  if (!code) return alert("Enter OV / PS / STG / ENDCP label.");
  if (!OV_REGEX.test(code)) return alert("Invalid OV / PS / STG / ENDCP format: " + code);

  const qrData = qrDataForLabelLoose(code);
  lastOvCode = code;
  $("ovDisplay").textContent = code;
  $("ovQr").src = buildQrUrl(qrData, 250);
}

function showPrintSent(message = "Label sent to printer") {
  const toast = $("printSentToast");
  if (!toast) return;
  const text = $("printToastText");
  if (text) text.textContent = message;
  clearTimeout(toastTimer);
  toast.classList.remove("hidden");
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 1200);
}

async function printHtmlDirect(title, bodyHtml, styles, printerName) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${styles}</style></head><body>${bodyHtml}</body></html>`;

  if (!window.sortZoneDesktop || !window.sortZoneDesktop.silentPrint) {
    alert("Silent print bridge is not available. Rebuild the desktop app with the latest files.");
    return false;
  }

  showPrintSent("Sending label to printer...");
  const result = await window.sortZoneDesktop.silentPrint({ html, printerName });
  if (!result || !result.ok) {
    const toast = $("printSentToast");
    if (toast) toast.classList.add("hidden");
    alert("Print failed. Check printer name and Windows printer status.\n\n" + (result?.error || "Unknown error"));
    return false;
  }
  showPrintSent("Label sent to printer");
  return true;
}

function cleanZplText(value) {
  return String(value || "")
    .replace(/[\^~]/g, "")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function textFontForLabel(label, mode = "small") {
  const len = String(label || "").length;
  if (mode === "big") {
    if (len <= 6) return { h: 126, w: 112, y: 68, fieldWidth: 720 };
    if (len <= 10) return { h: 104, w: 92, y: 80, fieldWidth: 720 };
    if (len <= 16) return { h: 76, w: 68, y: 96, fieldWidth: 720 };
    return { h: 56, w: 50, y: 110, fieldWidth: 720 };
  }
  if (len <= 6) return { h: 132, w: 116, y: 74, fieldWidth: 630 };
  if (len <= 10) return { h: 110, w: 98, y: 86, fieldWidth: 630 };
  if (len <= 16) return { h: 78, w: 70, y: 104, fieldWidth: 630 };
  return { h: 58, w: 52, y: 116, fieldWidth: 630 };
}

function buildDownArrowGraphic(x, y) {
  // Draw a down arrow with boxes/diagonals instead of text, so Zebra does not print it as V.
  return `^FO${x + 30},${y}^GB9,72,9^FS
^FO${x},${y + 58}^GD40,40,9,B,R^FS
^FO${x + 30},${y + 58}^GD40,40,9,B,L^FS
`;
}

function buildZpl100x25Label(label, qrData, options = {}) {
  const safeLabel = cleanZplText(label);
  const safeQrData = cleanZplText(qrData || label);
  const mode = options.mode || "small";
  const font = textFontForLabel(safeLabel, mode);

  // Zebra ZD621 300dpi: 100mm x 25mm = approx 1181 x 295 dots.
  if (mode === "big") {
    return `^XA
^CI28
^PW1181
^LL295
^LH0,0
^MNY
^PR4
^MD24
^FO30,${font.y}^A0N,${font.h},${font.w}^FB${font.fieldWidth},1,0,C^FD${safeLabel}^FS
^FO835,42^BQN,2,7^FDLA,${safeQrData}^FS
^PQ1,0,1,Y
^XZ
`;
  }

  // Side arrows removed from printed labels because some Zebra fonts/drivers rendered them poorly.
  const arrows = "";

  return `^XA
^CI28
^PW1181
^LL295
^LH0,0
^MNY
^PR4
^MD24
${arrows}^FO45,${font.y}^A0N,${font.h},${font.w}^FB720,1,0,C^FD${safeLabel}^FS
^FO845,42^BQN,2,7^FDLA,${safeQrData}^FS
^PQ1,0,1,Y
^XZ
`;
}

async function printZplDirect(zpl, printerName) {
  if (!window.sortZoneDesktop || !window.sortZoneDesktop.rawZplPrint) {
    alert("Raw Zebra print bridge is not available. Rebuild the desktop app with the latest files.");
    return false;
  }

  showPrintSent("Sending raw ZPL to printer...");
  const result = await window.sortZoneDesktop.rawZplPrint({ zpl, printerName });
  if (!result || !result.ok) {
    const toast = $("printSentToast");
    if (toast) toast.classList.add("hidden");
    alert("Raw ZPL print failed. Check printer name, Zebra driver, and printer language mode.\n\n" + (result?.error || "Unknown error"));
    return false;
  }
  showPrintSent("Label sent to printer");
  return true;
}


function isLikelyZebraPrinter(printerName) {
  return /zebra|zdesigner|zd\d+|zt\d+|gk\d+|gx\d+|lp\s*\d+|tlp\s*\d+/i.test(String(printerName || ""));
}

function buildHpLabelHtml(label, qrData, variant = "big") {
  const safeLabel = escapeHtml(label);
  const safeQr = buildQrUrl(qrData || label, variant === "big" ? 240 : 170);
  return `<div class="print-label ${variant === "big" ? "print-label-big" : "print-label-small"}">
    <div class="print-code">${safeLabel}</div>
    <img class="print-qr" src="${safeQr}" alt="QR">
  </div>`;
}

function buildHpLabelStyles() {
  return `
    @page { size: 100mm 25mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body { width: 100mm; height: 25mm; margin: 0; padding: 0; background: #fff; overflow: hidden; }
    body { font-family: Arial, Helvetica, sans-serif; }
    .print-label { width: 100mm; height: 25mm; display: flex; align-items: center; justify-content: space-between; padding: 1.5mm 4mm 1.5mm 5mm; }
    .print-code { flex: 1; text-align: center; font-weight: 900; color: #111; white-space: nowrap; overflow: hidden; text-overflow: clip; letter-spacing: -0.7mm; }
    .print-label-big .print-code { font-size: 14mm; line-height: 1; }
    .print-label-small .print-code { font-size: 12mm; line-height: 1; }
    .print-qr { width: 20mm; height: 20mm; object-fit: contain; margin-left: 4mm; image-rendering: pixelated; }
  `;
}

async function printOvOrBigLabel(code, printerName) {
  const qrData = qrDataForLabelLoose(code);
  const selectedPrinter = printerName || "";
  if (isLikelyZebraPrinter(selectedPrinter)) {
    const zpl = buildZpl100x25Label(code, qrData, { mode: "big", showArrows: false });
    return printZplDirect(zpl, selectedPrinter);
  }

  // HP/normal Windows printers do not understand ZPL, so use Windows HTML printing.
  return printHtmlDirect(
    "Sort Zone Big Label",
    buildHpLabelHtml(code, qrData, "big"),
    buildHpLabelStyles(),
    selectedPrinter
  );
}

async function printSortZones(items = lastSortZoneItems) {
  if (!items || !items.length) return alert("Generate labels first.");

  const zpl = items
    .map(item => buildZpl100x25Label(item.label, item.qrData, { mode: 'small', showArrows: !/^ENDCP[-.]/i.test(item.label) }))
    .join("\n");

  await printZplDirect(zpl, getSettings().szPrinter);
}

async function printOvForCode(code = lastOvCode) {
  if (!code) code = $("ovEntry").value.trim().toUpperCase().replace(/\s+/g, "");
  code = String(code || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!code) return alert("Enter OV / PS / STG / ENDCP label.");
  if (!OV_REGEX.test(code)) return alert("Invalid OV / PS / STG / ENDCP format: " + code);

  // OV / BIG / ENDCP labels must still print even if STEM lookup is missing.
  // When Resource Id is missing, the QR falls back to the label text instead of silently doing nothing.
  await printOvOrBigLabel(code, getSettings().ovPrinter || getSettings().szPrinter);
}

async function printEndcap(cluster, aisle, size) {
  const label = endcapLabelFor(cluster, aisle);
  const qrData = qrDataForLabelLoose(label);
  const printer = size === "big" ? (getSettings().ovPrinter || getSettings().szPrinter) : getSettings().szPrinter;
  if (size === "big") {
    await printOvOrBigLabel(label, printer);
    return;
  }
  const zpl = buildZpl100x25Label(label, qrData, { mode: "small", showArrows: false });
  await printZplDirect(zpl, printer);
}

function clearAll() {
  setupInputs();
  $("labelPreview").innerHTML = "";
  $("ovEntry").value = "";
  $("ovDisplay").textContent = "LOCATION ID";
  $("ovQr").removeAttribute("src");
  $("endcpRange").value = "";
  lastSortZoneItems = [];
  lastOvCode = "";
}

function populateEndcpDropdown() {
  const dd = $("endcpDropdown");
  if (!dd) return;
  const labels = Object.keys(stemMap || {})
    .filter(k => /^ENDCP[-.]/.test(k))
    .sort();

  dd.innerHTML = `<option value="">ENDCP labels</option>` + labels.map(x => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("");
}

function selectEndcp() {
  if (!requireStem()) return;
  const selected = $("endcpDropdown").value;
  const range = $("endcpRange").value.trim().toUpperCase();
  const labels = new Set();

  if (selected) labels.add(selected);

  if (range) {
    const parts = range.split(",").map(x => x.trim()).filter(Boolean);
    for (const part of parts) {
      const m = part.match(/^([A-Z]+)(\d+)-([A-Z]+)?(\d+)$/);
      if (m) {
        const prefix = m[1];
        const start = Number(m[2]);
        const end = Number(m[4]);
        for (let i = Math.min(start, end); i <= Math.max(start, end); i++) labels.add(`ENDCP.${prefix}${i}`);
      } else {
        labels.add(part.startsWith("ENDCP") ? part : `ENDCP.${part}`);
      }
    }
  }

  const items = [...labels].map(label => {
    const qrData = qrDataForLabel(label);
    if (!qrData) return null;
    return { label, qrData };
  }).filter(Boolean);

  if (!items.length) return alert("No matching ENDCP labels found.");
  lastSortZoneItems = items;
  renderSortZonePreview(items);
}

function renderQuickClusters() {
  const s = getSettings();
  const enabled = CLUSTERS.filter(k => s.clusters[k]);
  const stage = $("quickStage");
  stage.innerHTML = `<div class="quick-title">Please select the cluster</div><div class="cluster-grid"></div>`;
  const grid = stage.querySelector(".cluster-grid");

  for (const c of enabled.length ? enabled : ["A"]) {
    const tile = document.createElement("div");
    tile.className = "cluster-tile";
    tile.textContent = c;
    tile.onclick = () => renderQuickAisles(c);
    grid.appendChild(tile);
  }
}

function renderQuickAisles(cluster) {
  const s = getSettings();
  const fallbackEnd = Number(s.aislesPerCluster) || 56;
  const range = s.clusterRanges?.[cluster] || { start: 1, end: fallbackEnd };
  let start = Number(range.start) || 1;
  let end = Number(range.end) || fallbackEnd;
  if (start > end) [start, end] = [end, start];

  const stage = $("quickStage");
  stage.innerHTML = `<div class="quick-title">Cluster ${cluster}, select aisle</div><div class="aisle-grid"></div><div class="back-row"><button id="backClusters">Back</button></div>`;
  const grid = stage.querySelector(".aisle-grid");
  for (let i = start; i <= end; i++) {
    const tile = document.createElement("div");
    tile.className = "aisle-tile";
    tile.textContent = cluster + i;
    tile.onclick = () => renderQuickZones(cluster, i);
    grid.appendChild(tile);
  }
  $("backClusters").onclick = renderQuickClusters;
}

function labelFor(cluster, aisle, row, letter) {
  const s = getSettings();
  return s.labelFormat === "A-9.1A" ? `${cluster}-${aisle}.${row}${letter}` : `${cluster}${aisle}-${row}${letter}`;
}

function enabledZoneLetters(cluster) {
  const s = getSettings();
  const zones = s.clusterZones?.[cluster] || {};
  const enabled = ZONE_LETTERS.filter(z => zones[z] !== false);
  return enabled.length ? enabled : ZONE_LETTERS;
}

function renderQuickZones(cluster, aisle) {
  const stage = $("quickStage");
  stage.innerHTML = `
    <div class="quick-title">${cluster}${aisle}, select label</div>
    <div class="zone-grid"></div>
    <div class="big-grid" id="bigTop"></div>
    <div class="big-grid" id="bigBottom"></div>
    <div class="endcap-print-row">
      <button id="endcapSmallBtn" class="endcap-btn endcap-small">ENDCAP SMALL</button>
      <button id="endcapBigBtn" class="endcap-btn endcap-big">ENDCAP BIG LABEL</button>
    </div>
    <div class="back-row"><button id="backAisles">Back</button></div>
  `;

  const grid = stage.querySelector(".zone-grid");
  const letters = enabledZoneLetters(cluster);
  grid.style.gridTemplateColumns = `repeat(${letters.length}, minmax(76px, 1fr))`;

  for (let row = 4; row >= 1; row--) {
    for (const letter of letters) {
      const label = labelFor(cluster, aisle, row, letter);
      const tile = document.createElement("div");
      tile.className = "zone-tile";
      tile.textContent = label;
      tile.onclick = () => showQuickPopup(label, "sz");
      grid.appendChild(tile);
    }
  }

  for (const letter of BIG_TOP) addBigTile("bigTop", `${cluster}${aisle}-${letter}`);
  for (const letter of BIG_BOTTOM) addBigTile("bigBottom", `${cluster}${aisle}-${letter}`);

  $("endcapSmallBtn").onclick = () => printEndcap(cluster, aisle, "small");
  $("endcapBigBtn").onclick = () => printEndcap(cluster, aisle, "big");
  $("backAisles").onclick = () => renderQuickAisles(cluster);
}

function addBigTile(containerId, label) {
  const tile = document.createElement("div");
  tile.className = "big-tile";
  tile.textContent = label;
  tile.onclick = () => showQuickPopup(label, "ov");
  $(containerId).appendChild(tile);
}

function showQuickPopup(label, type) {
  if (type !== "ov" && !requireStem()) return;
  const qrData = type === "ov" ? qrDataForLabelLoose(label) : qrDataForLabel(label);
  if (!qrData) return alert("No Resource Id found in STEM data for label " + label + ".");

  const popup = $("quickPopup");
  $("popupCaption").textContent = "Tap label to print instantly";
  $("popupPrinter").textContent = type === "ov" ? (getSettings().ovPrinter || getSettings().szPrinter || "Windows default printer") : (getSettings().szPrinter || "Windows default printer");

  if (type === "ov") {
    $("popupLabel").innerHTML = `<div class="ov-title">${escapeHtml(label)}</div><div style="padding:20px"><img src="${buildQrUrl(qrData, 250)}" style="width:180px;height:180px"></div>`;
    $("popupLabel").onclick = () => { popup.classList.add("hidden"); printOvForCode(label); };
  } else {
    $("popupLabel").innerHTML = `<div class="label-row"><div class="label-arrow">⇩</div><div class="label-code">${escapeHtml(label)}</div><div><img src="${buildQrUrl(qrData, 110)}"></div><div class="label-arrow">⇩</div></div>`;
    $("popupLabel").onclick = () => { popup.classList.add("hidden"); printSortZones([{ label, qrData }]); };
  }

  popup.classList.remove("hidden");
}

async function loadPrintersIntoSelects() {
  const selects = [$("szPrinter"), $("ovPrinter")].filter(Boolean);
  const s = getSettings();
  let printers = [];

  try {
    printers = await window.sortZoneDesktop.listPrinters();
  } catch {
    printers = [];
  }

  for (const select of selects) {
    const savedValue = select.id === "szPrinter" ? s.szPrinter : s.ovPrinter;
    select.innerHTML = `<option value="">Windows default printer</option>`;

    for (const printer of printers) {
      const option = document.createElement("option");
      option.value = printer.name;
      option.textContent = printer.displayName + (printer.isDefault ? " (Default)" : "");
      select.appendChild(option);
    }

    if (savedValue && [...select.options].some(option => option.value === savedValue)) {
      select.value = savedValue;
    } else {
      select.value = "";
    }
  }
}

function updateClusterRangeState() {
  for (const c of CLUSTERS) {
    const checked = !!$("cluster_" + c)?.checked;
    const start = $("clusterStart_" + c);
    const end = $("clusterEnd_" + c);
    const zoneRow = $("zoneRow_" + c);
    if (start) start.disabled = !checked;
    if (end) end.disabled = !checked;
    if (zoneRow) zoneRow.classList.toggle("disabled", !checked);
    for (const z of ZONE_LETTERS) {
      const box = $("clusterZone_" + c + "_" + z);
      if (box) box.disabled = !checked;
    }
  }
}

async function setupSettingsUI() {
  const s = getSettings();
  $("stationCode").value = s.stationCode;
  $("labelFormat").value = s.labelFormat;

  await loadPrintersIntoSelects();

  const box = $("clusterSettings");
  box.innerHTML = "";
  for (const c of CLUSTERS) {
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" id="cluster_${c}" ${s.clusters[c] ? "checked" : ""}> ${c}`;
    box.appendChild(label);
  }

  const ranges = $("clusterRanges");
  ranges.innerHTML = "";
  for (const c of CLUSTERS) {
    const row = document.createElement("div");
    row.className = "cluster-range-row";
    const range = s.clusterRanges?.[c] || { start: 1, end: Number(s.aislesPerCluster) || 56 };
    row.innerHTML = `
      <strong>${c}</strong>
      <span>Start</span>
      <input id="clusterStart_${c}" type="number" min="1" max="999" value="${Number(range.start) || 1}">
      <span>End</span>
      <input id="clusterEnd_${c}" type="number" min="1" max="999" value="${Number(range.end) || 56}">
    `;
    ranges.appendChild(row);
  }

  const matrix = $("clusterZoneMatrix");
  matrix.innerHTML = "";
  for (const c of CLUSTERS) {
    const row = document.createElement("div");
    row.className = "cluster-zone-row";
    row.id = "zoneRow_" + c;
    const zoneSettings = s.clusterZones?.[c] || {};
    row.innerHTML = `
      <strong>${c}</strong>
      <div class="zone-checks">
        ${ZONE_LETTERS.map(z => `<label><input type="checkbox" id="clusterZone_${c}_${z}" ${zoneSettings[z] !== false ? "checked" : ""}>${z}</label>`).join("")}
      </div>
    `;
    matrix.appendChild(row);
  }

  for (const c of CLUSTERS) {
    $("cluster_" + c).addEventListener("change", updateClusterRangeState);
  }
  updateClusterRangeState();
}

function saveSettingsFromUI() {
  const s = getSettings();
  s.stationCode = getStationCode();
  s.szPrinter = $("szPrinter").value;
  s.ovPrinter = $("ovPrinter").value;
  s.labelFormat = $("labelFormat").value;
  s.aislesPerCluster = 56;

  for (const c of CLUSTERS) {
    s.clusters[c] = !!$("cluster_" + c)?.checked;
    const start = Number($("clusterStart_" + c)?.value) || 1;
    const end = Number($("clusterEnd_" + c)?.value) || 56;
    s.clusterRanges[c] = {
      start: Math.max(1, Math.min(start, end)),
      end: Math.max(1, Math.max(start, end))
    };
    s.clusterZones[c] = {};
    for (const z of ZONE_LETTERS) {
      s.clusterZones[c][z] = !!$("clusterZone_" + c + "_" + z)?.checked;
    }
  }

  saveSettingsObject(s);
  loadStem();
  renderQuickClusters();
  alert("Settings saved.");
}

function closeSidebar() {
  $("sidebar").classList.remove("open");
  $("sidebarShade").classList.add("hidden");
}

function toggleSidebar() {
  const sidebar = $("sidebar");
  const opening = !sidebar.classList.contains("open");
  sidebar.classList.toggle("open", opening);
  $("sidebarShade").classList.toggle("hidden", !opening);
}

function switchPage(pageId) {
  document.querySelectorAll(".page").forEach(page => page.classList.toggle("active", page.id === pageId));
  document.querySelectorAll(".nav-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.page === pageId));
  if (pageId === "quickPrintPage") renderQuickClusters();
  if (pageId === "labelsPage") setTimeout(() => document.querySelector(".sz-input")?.focus(), 50);
  if (pageId === "settingsPage") setupSettingsUI();
  closeSidebar();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[ch]));
}

function bindEvents() {
  document.querySelectorAll(".nav-btn").forEach(btn => btn.onclick = () => switchPage(btn.dataset.page));
  $("toggleSidebar").onclick = toggleSidebar;
  $("sidebarShade").onclick = closeSidebar;
  $("railLabels").onclick = () => switchPage("labelsPage");
  $("railQuick").onclick = () => switchPage("quickPrintPage");
  $("railSetup").onclick = () => switchPage("settingsPage");
  $("railKeyboard").onclick = async () => {
    if (window.sortZoneDesktop && window.sortZoneDesktop.openKeyboard) {
      const result = await window.sortZoneDesktop.openKeyboard();
      if (!result || !result.ok) alert(result?.error || "Could not open Windows on-screen keyboard.");
    }
  };
  $("stationCode").addEventListener("change", () => {
    const s = getSettings();
    s.stationCode = getStationCode();
    saveSettingsObject(s);
    loadStem();
  });
  $("stemFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const map = file.name.toLowerCase().endsWith(".json") ? JSON.parse(text) : parseStemCsv(text);
    if (!map || !Object.keys(map).length) return alert("No usable rows found.");
    saveStem(map);
    alert("STEM data imported for station " + getStationCode() + ".");
    e.target.value = "";
  });
  $("addRow").onclick = () => { const input = makeInput(); $("sortZoneInputs").appendChild(input); input.focus(); };
  $("pasteMultiple").onclick = pasteMultiple;
  $("generateSortZones").onclick = generateSortZones;
  $("printSortZones").onclick = () => printSortZones();
  $("generateOv").onclick = generateOv;
  $("printOv").onclick = () => printOvForCode();
  $("clearAll").onclick = clearAll;
  $("selectEndcp").onclick = selectEndcp;
  $("saveSettings").onclick = saveSettingsFromUI;
  $("popupCancel").onclick = () => $("quickPopup").classList.add("hidden");
}

setupInputs();
setupSettingsUI();
loadStem();
bindEvents();
switchPage("quickPrintPage");
