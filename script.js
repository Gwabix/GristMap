(function () {
    "use strict";

    let map = null;
    let markersLayer = null;

    let colName = null;
    let colLat = null;
    let colLng = null;
    let colsPrimary = [];
    let colsSecondary = [];

    let allRows = [];
    let activePrimary = new Set();
    let activeSecondary = new Set();
    let showHidden = false;
    let showHiddenOnly = false;

    function toArray(value) {
        if (Array.isArray(value)) {
            return value.filter((v) => typeof v === "string" && v.length > 0);
        }
        if (typeof value === "string" && value.length > 0) {
            return [value];
        }
        return [];
    }

    function arraysEqual(a, b) {
        if (a.length !== b.length) {
            return false;
        }
        return a.every((value, index) => value === b[index]);
    }

    function showNoConfigMessage(message) {
        const panel = document.getElementById("no-config");
        const text = panel.querySelector("span");
        if (text) {
            text.textContent = message;
        }
        panel.classList.remove("hidden");
    }

    function ensureMap() {
        if (map) {
            return true;
        }
        if (typeof L === "undefined") {
            showNoConfigMessage("La bibliotheque de carte (Leaflet) ne s'est pas chargee. Verifiez le reseau/CSP puis rechargez le widget.");
            return false;
        }
        map = L.map("map").setView([46.8, 2.3], 6);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map);
        markersLayer = L.layerGroup().addTo(map);
        setTimeout(() => map.invalidateSize(), 0);
        return true;
    }

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
        const primaryCols = [...activePrimary];
        const secondaryCols = [...activeSecondary];

        if (primaryCols.length === 0 || secondaryCols.length === 0) {
            return false;
        }

        const hasPrimary = primaryCols.some((col) => isNonEmpty(row[col]));
        const hasSecondary = secondaryCols.some((col) => isNumericNonZero(row[col]));

        return hasPrimary && hasSecondary;
    }

    function rowIsVisible(row) {
        if (rowMatchesFilters(row)) {
            return true;
        }
        return showHidden;
    }

    function colorForCount(count, min, max) {
        if (max === min) return "#1a73e8";
        const t = (count - min) / (max - min);
        // t=0 → jaune rgb(255,200,0) | t=0.5 → vert rgb(0,180,0) | t=1 → bleu rgb(26,115,232)
        let r, g, b;
        if (t <= 0.5) {
            const s = t * 2;
            r = Math.round(255 * (1 - s));
            g = Math.round(200 - 20 * s);
            b = 0;
        } else {
            const s = (t - 0.5) * 2;
            r = Math.round(26 * s);
            g = Math.round(180 * (1 - s) + 115 * s);
            b = Math.round(232 * s);
        }
        return `rgb(${r},${g},${b})`;
    }

    function buildPopupHtml(groupRows, singleDomain) {
        const name = escapeHtml(groupRows[0][colName] ?? "");
        let html = `<h3>${name}</h3>`;

        const domainsToShow = [...activePrimary];

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
                    const secondaryCols = [...activeSecondary];
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
        if (!markersLayer) {
            return;
        }
        markersLayer.clearLayers();

        const filtered = allRows.filter(rowIsVisible);

        const groups = new Map();
        for (const row of filtered) {
            const lat = parseFloat(row[colLat]);
            const lng = parseFloat(row[colLng]);
            if (isNaN(lat) || isNaN(lng)) continue;
            const key = `${lat},${lng}`;
            if (!groups.has(key)) groups.set(key, { lat, lng, rows: [] });
            groups.get(key).rows.push(row);
        }

        const visibleGroups = [...groups.values()].filter(({ rows }) => {
            if (!showHiddenOnly) {
                return true;
            }

            return rows.every((row) => !rowMatchesFilters(row));
        });

        const matchCounts = visibleGroups.map((g) => g.rows.filter(rowMatchesFilters).length).filter((n) => n > 0);
        const minCount = matchCounts.length > 0 ? Math.min(...matchCounts) : 0;
        const maxCount = matchCounts.length > 0 ? Math.max(...matchCounts) : 0;

        const singleDomain = activePrimary.size === 1;
        const bounds = L.latLngBounds();

        for (const { lat, lng, rows } of visibleGroups) {
            const matchCount = rows.filter(rowMatchesFilters).length;
            const count = matchCount;
            const countBadge = count > 0
                ? `<span style="
          background:rgba(40,40,40,0.55);border-radius:50%;
          width:16px;height:16px;
          display:flex;align-items:center;justify-content:center;
          color:#fff;font-weight:700;font-size:11px;line-height:1;
        ">${count}</span>`
                : "";
            const color = matchCount > 0
                ? colorForCount(matchCount, minCount, maxCount)
                : "#9ca3af";

            const icon = L.divIcon({
                className: "",
                html: `<div style="
          width:28px;height:28px;border-radius:50%;
          background:${color};border:2px solid #fff;
          box-shadow:0 1px 4px rgba(0,0,0,.4);
          display:flex;align-items:center;justify-content:center;
                ">${countBadge}</div>`,
                iconSize: [28, 28],
                iconAnchor: [14, 14],
                popupAnchor: [0, -16],
            });

            const popup = L.popup({ maxWidth: 320 }).setContent(buildPopupHtml(rows, singleDomain));
            L.marker([lat, lng], { icon }).bindPopup(popup).addTo(markersLayer);
            bounds.extend([lat, lng]);
        }

        if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
        }
    }

    function buildFilterList(containerId, cols, activeSet, onChange) {
        const container = document.getElementById(containerId);
        container.innerHTML = "";

        activeSet.clear();
        for (const col of cols) {
            activeSet.add(col);
        }

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

        for (let index = 0; index < cols.length; index += 1) {
            const col = cols[index];
            const id = `${containerId}-${index}`;
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
                    activeSet.add(col);
                } else {
                    activeSet.delete(col);
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
                    activeSet.add(cb.dataset.col);
                } else {
                    activeSet.delete(cb.dataset.col);
                }
            }
            onChange();
        });
    }

    function buildFilters() {
        buildFilterList("filter-primary", colsPrimary, activePrimary, () => {
            renderMap();
        });
        buildFilterList("filter-secondary", colsSecondary, activeSecondary, () => {
            renderMap();
        });
    }

    function applyMappings(mappings) {
        const nextColName = typeof mappings?.Name === "string" ? mappings.Name : null;
        const nextColLat = typeof mappings?.Latitude === "string" ? mappings.Latitude : null;
        const nextColLng = typeof mappings?.Longitude === "string" ? mappings.Longitude : null;
        const nextColsPrimary = toArray(mappings?.Primary);
        const nextColsSecondary = toArray(mappings?.Secondary);

        const mappingChanged =
            colName !== nextColName ||
            colLat !== nextColLat ||
            colLng !== nextColLng ||
            !arraysEqual(colsPrimary, nextColsPrimary) ||
            !arraysEqual(colsSecondary, nextColsSecondary);

        colName = nextColName;
        colLat = nextColLat;
        colLng = nextColLng;
        colsPrimary = nextColsPrimary;
        colsSecondary = nextColsSecondary;

        const ready = Boolean(colName && colLat && colLng && colsPrimary.length > 0 && colsSecondary.length > 0);
        document.getElementById("no-config").classList.toggle("hidden", ready);

        if (ready) {
            if (mappingChanged) {
                buildFilters();
            }
            renderMap();
        } else if (markersLayer) {
            markersLayer.clearLayers();
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
                { name: "Name", title: "Nom", type: "Text" },
                { name: "Latitude", title: "Latitude", type: "Numeric" },
                { name: "Longitude", title: "Longitude", type: "Numeric" },
                { name: "Primary", title: "Domaines", type: "Text", allowMultiple: true },
                { name: "Secondary", title: "Niveaux", type: "Int", allowMultiple: true },
            ],
        });

        grist.onRecords((records, mappings) => {
            const mapReady = ensureMap();
            allRows = Array.isArray(records) ? records : [];
            applyMappings(mappings ?? null);
            if (mapReady && map) {
                setTimeout(() => map.invalidateSize(), 0);
            }
        });

        ensureMap();
        window.addEventListener("resize", () => {
            if (map) {
                map.invalidateSize();
            }
        });

        const toggleBtn = document.getElementById("toggle-hidden");
        const hiddenOnlyBtn = document.getElementById("toggle-hidden-only");
        if (toggleBtn) {
            const updateToggleUi = () => {
                toggleBtn.setAttribute("aria-pressed", String(showHidden));
                document.getElementById("icon-eye-open").style.display = showHidden ? "" : "none";
                document.getElementById("icon-eye-closed").style.display = showHidden ? "none" : "";

                if (hiddenOnlyBtn) {
                    hiddenOnlyBtn.classList.toggle("hidden", !showHidden);
                    hiddenOnlyBtn.setAttribute("aria-pressed", String(showHiddenOnly));
                }
            };

            updateToggleUi();
            toggleBtn.addEventListener("click", () => {
                showHidden = !showHidden;
                if (!showHidden) {
                    showHiddenOnly = false;
                }
                updateToggleUi();
                renderMap();
            });

            if (hiddenOnlyBtn) {
                hiddenOnlyBtn.addEventListener("click", () => {
                    if (!showHidden) {
                        return;
                    }
                    showHiddenOnly = !showHiddenOnly;
                    updateToggleUi();
                    renderMap();
                });
            }
        }
    }

    document.addEventListener("DOMContentLoaded", init);
})();
