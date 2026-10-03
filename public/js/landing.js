// Install
function setInstallUrl(url) {
  const webLink = `https://web.stremio.com/#/addons?addon=${encodeURIComponent(url)}`;
  const stremioAppLink = url
    .replace("https://", "stremio://")
    .replace("http://", "stremio://");
  // Set up install links
  document.getElementById("installApp").href = stremioAppLink;
  document.getElementById("installWeb").href = webLink;
  document.getElementById("manifestUrl").textContent = url;
}

// Copy URL function. TV webviews often have neither the async clipboard API
// nor execCommand, in which case the user can still install via the buttons
// or scroll the manifest URL and read it out.
function copyUrl() {
  const manifestUrl = document.getElementById("manifestUrl").textContent;
  const btn = document.getElementById("copyManifestBtn");
  const flash = (text) => {
    btn.textContent = text;
    setTimeout(() => {
      btn.textContent = "Copy";
    }, 2000);
  };
  const legacyCopy = () => {
    const textArea = document.createElement("textarea");
    textArea.value = manifestUrl;
    document.body.appendChild(textArea);
    textArea.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    document.body.removeChild(textArea);
    flash(copied ? "Copied" : "Copy unavailable — use an Install button");
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(manifestUrl).then(() => {
      flash("Copied");
    }, legacyCopy);
  } else {
    legacyCopy();
  }
}

const form = document.getElementById("configureForm");

// Paste from the clipboard into the input field a .paste-btn targets via
// data-target. Hidden entirely where clipboard read access does not exist
// (TV webviews); a denied read flashes the button instead.
document.querySelectorAll(".paste-btn").forEach((btn) => {
  if (!navigator.clipboard?.readText) {
    btn.hidden = true;
    return;
  }
  btn.addEventListener("click", async () => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    try {
      input.value = (await navigator.clipboard.readText()).trim();
      input.dispatchEvent(new Event("input", { bubbles: true }));
    } catch {
      const originalText = btn.textContent;
      btn.textContent = "No clipboard access";
      setTimeout(() => {
        btn.textContent = originalText;
      }, 2000);
    }
  });
});

// Provider tabs: each provider owns its panel; a new provider adds a
// tab button + a .tab-panel, nothing else changes.
document.querySelectorAll("#provider-tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document
      .querySelectorAll("#provider-tabs .tab")
      .forEach((t) => t.classList.remove("active"));
    document
      .querySelectorAll(".tab-panel")
      .forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document
      .getElementById(`tab-${tab.dataset.tab}`)
      ?.classList.add("active");
  });
});

// Mirrors: an ordered fallback list. The first mirror is tried first; the
// rest take over while a mirror above them has a recent failure.
const DEFAULT_MIRRORS = JSON.parse(
  document.getElementById("defaultMirrors").textContent,
);
let orderedMirrors = [];

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

// A mirror is any host the user inputs: a scheme is added automatically
// (https unless the user typed one), paths and query strings are harmless.
function normalizeMirrorInput(value) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// Dotted hostname labels or an IP literal. Browsers may parse URLs whose
// host contains spaces instead of throwing (Node does throw), so the shape
// is checked explicitly.
const MIRROR_HOST_PATTERN =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$|^\[[a-z0-9:]+\]$/i;

function isMirrorInputValid(value) {
  try {
    const url = new URL(value);
    return MIRROR_HOST_PATTERN.test(url.hostname);
  } catch {
    return false;
  }
}

function mirrorError(message) {
  const errorEl = document.getElementById("mirror-error");
  errorEl.textContent = message;
  errorEl.hidden = !message;
}

function renderMirrors() {
  const orderEl = document.getElementById("mirror-order");
  orderEl.replaceChildren(
    ...orderedMirrors.map((url, index) => {
      const name = url.replace("https://", "");
      const row = el("li", "mirror-row");
      const badge = el("span", "mirror-index");
      badge.textContent = String(index + 1);
      const label = el("span", "mirror-name");
      label.textContent = name;
      label.title = url;
      const moveUp = el("button", "mirror-btn");
      moveUp.type = "button";
      moveUp.textContent = "‹";
      moveUp.setAttribute("aria-label", `Move ${name} up`);
      moveUp.disabled = index === 0;
      const moveDown = el("button", "mirror-btn");
      moveDown.type = "button";
      moveDown.textContent = "›";
      moveDown.setAttribute("aria-label", `Move ${name} down`);
      moveDown.disabled = index === orderedMirrors.length - 1;
      const remove = el("button", "mirror-btn");
      remove.type = "button";
      remove.textContent = "✕";
      remove.setAttribute("aria-label", `Remove ${name}`);
      for (const btn of [moveUp, moveDown, remove]) {
        btn.dataset.url = url;
      }
      moveUp.dataset.action = "up";
      moveDown.dataset.action = "down";
      remove.dataset.action = "remove";
      row.append(badge, label, moveUp, moveDown, remove);
      return row;
    }),
  );

  // Defaults not picked live in the "More mirrors" grid; custom mirrors only
  // exist while they are part of the order (re-addable via the input).
  const more = DEFAULT_MIRRORS.filter((url) => !orderedMirrors.includes(url));
  document.getElementById("mirror-more-label").hidden = more.length === 0;
  const moreEl = document.getElementById("mirror-more");
  moreEl.hidden = more.length === 0;
  moreEl.replaceChildren(
    ...more.map((url) => {
      const option = el("span", "chip-option");
      const chip = el("button", "chip");
      chip.type = "button";
      chip.textContent = url.replace("https://", "");
      chip.title = url;
      chip.setAttribute("aria-label", `Add ${url} as a fallback mirror`);
      chip.dataset.url = url;
      option.append(chip);
      return option;
    }),
  );
}

document.getElementById("mirror-order").addEventListener("click", (e) => {
  const btn = e.target.closest(".mirror-btn");
  if (!btn) return;
  const url = btn.dataset.url;
  const index = orderedMirrors.indexOf(url);
  if (index === -1) return;
  if (btn.dataset.action === "remove") {
    orderedMirrors.splice(index, 1);
  } else if (btn.dataset.action === "up" && index > 0) {
    [orderedMirrors[index - 1], orderedMirrors[index]] = [
      orderedMirrors[index],
      orderedMirrors[index - 1],
    ];
  } else if (
    btn.dataset.action === "down" &&
    index < orderedMirrors.length - 1
  ) {
    [orderedMirrors[index + 1], orderedMirrors[index]] = [
      orderedMirrors[index],
      orderedMirrors[index + 1],
    ];
  }
  renderMirrors();
  updateManifestUrl();
});

// Tapping a "More mirrors" chip appends it as the last fallback
document.getElementById("mirror-more").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  orderedMirrors.push(chip.dataset.url);
  renderMirrors();
  updateManifestUrl();
});

function addCustomMirror() {
  const input = document.getElementById("mirror-input");
  const value = normalizeMirrorInput(input.value);
  if (!value) return;
  if (!isMirrorInputValid(value)) {
    mirrorError("Not a valid mirror host");
    return;
  }
  if (orderedMirrors.includes(value)) {
    mirrorError("Mirror already added");
    return;
  }
  mirrorError(null);
  input.value = "";
  orderedMirrors.push(value);
  renderMirrors();
  updateManifestUrl();
}

document.getElementById("mirror-add-btn").addEventListener("click", addCustomMirror);
document.getElementById("mirror-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addCustomMirror();
  }
});
document.getElementById("mirror-input").addEventListener("input", () => {
  mirrorError(null);
});

// Tiers: native checkboxes. "All" is a master toggle: it selects every
// option of its tier, or clears the tier when everything is already
// selected, and unticks itself either way. Picking any option unticks
// "All". __all__ never reaches the config (see getTierValues).
document.querySelectorAll(".config-group[data-tier]").forEach((group) => {
  group.addEventListener("change", (e) => {
    const all = group.querySelector('input[value="__all__"]');
    if (e.target === all && all.checked) {
      const options = group.querySelectorAll(
        'input[type="checkbox"]:not([value="__all__"])',
      );
      const everythingSelected = [...options].every((cb) => cb.checked);
      options.forEach((cb) => {
        cb.checked = !everythingSelected;
      });
    }
    all.checked = false;
  });
});

function getTierValues(tier) {
  const group = document.querySelector(`.config-group[data-tier="${tier}"]`);
  return [...group.querySelectorAll("input[type='checkbox']:checked")]
    .map((cb) => cb.value)
    .filter((value) => value !== "__all__");
}

const defaultConfig = JSON.parse(
  document.getElementById("defaultConfig").textContent,
);

// Configure
form.addEventListener("change", function () {
  updateManifestUrl();
});

function validationError(kisskh) {
  if (kisskh.mirrors.length === 0) return "Select at least one mirror";
  for (const [tier, label] of [
    ["type", "type"],
    ["region", "region"],
    ["status", "status"],
    ["update", "update"],
  ]) {
    if (kisskh[tier].length === 0) return `Select at least one ${label}`;
  }
  return null;
}

function updateManifestUrl() {
  const kisskh = {
    mirrors: [...orderedMirrors],
    type: getTierValues("type"),
    region: getTierValues("region"),
    status: getTierValues("status"),
    update: getTierValues("update"),
  };
  const config = {
    providers: { kisskh },
  };

  const hint = document.getElementById("config-hint");
  const error = validationError(kisskh);
  if (error) {
    hint.textContent = error;
    hint.style.display = "block";
    setInstallUrl(window.location.origin + "/manifest.json");
    return;
  }
  hint.style.display = "none";

  const configJson = JSON.stringify(config);
  const configBase64 = btoa(configJson);
  const manifestUrl =
    window.location.origin + "/" + configBase64 + "/manifest.json";
  setInstallUrl(manifestUrl);
}

// Update config redirect from stremio (/config64/configure). Fresh visitors
// get all default mirrors pre-selected in fallback order; a restored config
// reinstates its own order, including custom mirrors.
document.addEventListener("DOMContentLoaded", () => {
  const path = window.location.pathname;
  const match = path.match(/\/(.+)\/configure/);
  const hasConfig = match && match[1];
  let config;
  try {
    config = hasConfig ? JSON.parse(atob(match[1])) : defaultConfig;
  } catch (error) {
    console.error("Failed to decode configuration:", error);
    config = defaultConfig;
  }
  try {
    const kisskh = config.providers?.kisskh;
    orderedMirrors = hasConfig
      ? [...(Array.isArray(kisskh?.mirrors) ? kisskh.mirrors : [])]
      : [...DEFAULT_MIRRORS];
    for (const tier of ["type", "region", "status", "update"]) {
      const group = document.querySelector(`.config-group[data-tier="${tier}"]`);
      const values = Array.isArray(kisskh?.[tier]) ? kisskh[tier] : [];
      const expandAll = values.includes("__all__");
      group.querySelectorAll("input[type='checkbox']").forEach((cb) => {
        cb.checked =
          cb.value === "__all__"
            ? false
            : expandAll || values.includes(cb.value);
      });
    }
    // After applying saved config, update the install links
    renderMirrors();
    updateManifestUrl();
  } catch (error) {
    console.error("Failed to decode configuration:", error);
  }
});
