(function () {
    "use strict";

    const map = L.map("map").setView([46.8, 2.3], 6);

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    let markersLayer = L.layerGroup().addTo(map);

    let colName = null;
    let colLat = null;
    let colLng = null;
    let colsPrimary = [];
    let colsSecondary = [];

    let allRows = [];
    let activePrimary = new Set();
    let activeSecondary = new Set();

    function escapeHtml(str) {
        return String(str ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function isNonEmpty(val) {
        return val !== null && val !== undefined && val !== "" && val !== 0 && val !== "0";
    }

    function isNumericNonZero(val) {
        const n = Number(val);
        return !isNaN(n) && n > 0;
    }

    function rowMatchesFilters(row) {
        const primaryCols = activePrimary.size > 0 ? [...activePrimary] : colsPrimary;
        const secondaryCols = activeSecondary.size > 0 ? [...activeSecondary] : colsSecondary;

        const hasPrimary = primaryCols.some((col) => isNonEmpty(row[col]));
        const hasSecondary = secondaryCols.some((col) => isNumericNonZero(row[col]));

        return hasPrimary && hasSecondary;
    }

    function colorForCount(count, min, max) {
        if (max === min) return "#1a73e8";
        const t = (count - min) / (max - min);
        const r = Math.round(255 * (1 - t) + 26 * t);
        const g = Math.round(200 * (1 - t) * (1 - Math.abs(t - 0.5) * 2) + 115 * t + 180 * Math.min(t, 1 - t));
        const b = Math.round(0 * (1 - t) + 232 * t);
        return `rgb(${r},${Math.min(255, Math.max(0, g))},${b})`;
    }

    function buildPopupHtml(groupRows, singleDomain) {
        const name = escapeHtml(groupRows[0][colName] ?? "");
        let html = `<h3>${name}</h3>`;

        const domainsToShow = activePrimary.size > 0 ? [...activePrimary] : colsPrimary;

        for (const domCol of domainsToShow) {
            const projects = groupRows.filter((r) => isNonEmpty(r[domCol]) && rowMatchesFilters(r));
            if (projects.length === 0) continue;

            html += `<h4>${escapeHtml(domCol)}</h4><ul>`;

            for (const proj of projects) {
                const projName = escapeHtml(proj[domCol]);

                if (singleDomain) {
                    const levelParts = colsSecondary
                        .filter((lc) => isNumericNonZero(proj[lc]))
                        .map((lc) => `${escapeHtml(String(proj[lc]))} ${escapeHtml(lc)}`);
                    const levelStr = levelParts.length > 0 ? ` (${levelParts.join(", ")})` : "";
                    html += `<li>${projName}${escapeHtml(levelStr)}</li>`;
                } else {
                    const secondaryCols = activeSecondary.size > 0 ? [...activeSecondary] : colsSecondary;
                    const levelParts = secondaryCols
                        .filter((lc) => isNumericNonZero(proj[lc]))
                        .map((lc) => escapeHtml(lc));
                    const levelStr = levelParts.length > 0 ? ` (${levelParts.join(", ")})` : "";
                    html += `<li>${projName}${escapeHtml(levelStr)}</li>`;
                }
            }

            html += `</ul>`;
        }

        return html;
    }

    function renderMap() {
        markersLayer.clearLayers();

        const filtered = allRows.filter(rowMatchesFilters);

        const groups = new Map();
        for (const row of filtered) {
            const lat = parseFloat(row[colLat]);
            const lng = parseFloat(row[colLng]);
            if (isNaN(lat) || isNaN(lng)) continue;
            const key = `${lat},${lng}`;
            if (!groups.has(key)) groups.set(key, { lat, lng, rows: [] });
            groups.get(key).rows.push(row);
        }

        const counts = [...groups.values()].map((g) => g.rows.length);
        const minCount = Math.min(...counts);
        const maxCount = Math.max(...counts);

        const singleDomain = activePrimary.size === 1;

        for (const { lat, lng, rows } of groups.values()) {
            const count = rows.length;
            const color = colorForCount(count, minCount, maxCount);

            const icon = L.divIcon({
                className: "",
                html: `<div style="
          width:28px;height:28px;border-radius:50%;
          background:${color};border:2px solid #fff;
          box-shadow:0 1px 4px rgba(0,0,0,.4);
          display:flex;align-items:center;justify-content:center;
          color:#fff;font-weight:700;font-size:12px;
        ">${count > 1 ? count : ""}</div>`,
                iconSize: [28, 28],
                iconAnchor: [14, 14],
                popupAnchor: [0, -16],
            });

            const popup = L.popup({ maxWidth: 320 }).setContent(buildPopupHtml(rows, singleDomain));
            L.marker([lat, lng], { icon }).bindPopup(popup).addTo(markersLayer);
        }
    }

    function buildFilterList(containerId, cols, activeSet, onChange) {
        const container = document.getElementById(containerId);
        container.innerHTML = "";

        const allId = `${containerId}-all`;
        const allItem = document.createElement("div");
        allItem.className = "filter-item select-all";
        const allCb = document.createElement("input");
        allCb.type = "checkbox";
        allCb.id = allId;
        allCb.checked = true;
        const allLabel = document.createElement("label");
        allLabel.htmlFor = allId;
        allLabel.textContent = "Tout sélectionner";
        allItem.append(allCb, allLabel);
        container.appendChild(allItem);

        const itemCheckboxes = [];

        for (const col of cols) {
            const id = `${containerId}-${col}`;
            const item = document.createElement("div");
            item.className = "filter-item";
            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.id = id;
            cb.checked = true;
            cb.dataset.col = col;
            const label = document.createElement("label");
            label.htmlFor = id;
            label.textContent = col;
            item.append(cb, label);
            container.appendChild(item);
            itemCheckboxes.push(cb);

            cb.addEventListener("change", () => {
                if (cb.checked) {
                    activeSet.delete(col);
                } else {
                    activeSet.add(col);
                }
                const allChecked = itemCheckboxes.every((c) => c.checked);
                allCb.checked = allChecked;
                onChange();
            });
        }

        allCb.addEventListener("change", () => {
            for (const cb of itemCheckboxes) {
                cb.checked = allCb.checked;
                if (allCb.checked) {
                    activeSet.delete(cb.dataset.col);
                } else {
                    activeSet.add(cb.dataset.col);
                }
            }
            onChange();
        });
    }

    function buildFilters() {
        activePrimary.clear();
        activeSecondary.clear();
        buildFilterList("filter-primary", colsPrimary, activePrimary, () => {
            activePrimary = new Set(
                colsPrimary.filter((c) => {
                    const cb = document.querySelector(`#filter-primary-${CSS.escape(c)}`);
                    return cb && !cb.checked;
                })
            );
            renderMap();
        });
        buildFilterList("filter-secondary", colsSecondary, activeSecondary, () => {
            activeSecondary = new Set(
                colsSecondary.filter((c) => {
                    const cb = document.querySelector(`#filter-secondary-${CSS.escape(c)}`);
                    return cb && !cb.checked;
                })
            );
            renderMap();
        });
    }

    function applyConfig(options) {
        const mappings = options.mappings ?? {};
        colName = mappings.Name ?? null;
        colLat = mappings.Latitude ?? null;
        colLng = mappings.Longitude ?? null;
        colsPrimary = mappings.Primary ?? [];
        colsSecondary = mappings.Secondary ?? [];

        if (typeof colsPrimary === "string") colsPrimary = [colsPrimary];
        if (typeof colsSecondary === "string") colsSecondary = [colsSecondary];

        const ready = colName && colLat && colLng && colsPrimary.length > 0 && colsSecondary.length > 0;
        document.getElementById("no-config").classList.toggle("hidden", ready);

        if (ready) {
            buildFilters();
            renderMap();
        }
    }

    function init() {
        if (typeof grist === "undefined") {
            document.getElementById("no-config").querySelector("span").textContent =
                "Widget non chargé dans Grist.";
            return;
        }

        grist.ready({
            requiredAccess: "read table",
            columns: [
                { name: "Name", title: "Nom", type: "Text", strictType: true },
                { name: "Latitude", title: "Latitude", type: "Numeric", strictType: true },
                { name: "Longitude", title: "Longitude", type: "Numeric", strictType: true },
                { name: "Primary", title: "Domaines", type: "Text", allowMultiple: true },
                { name: "Secondary", title: "Niveaux", type: "Numeric", allowMultiple: true },
            ],
        });

        grist.onOptions((options) => {
            applyConfig(options ?? {});
        });

        grist.onRecords((records, mappings) => {
            allRows = grist.mapColumnNames(records, mappings) ?? [];
            renderMap();
        });
    }

    document.addEventListener("DOMContentLoaded", init);
})();
