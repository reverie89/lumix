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

// UTF-8-safe, URL-safe base64: btoa alone throws on non-Latin-1 characters
// (a custom mirror path can carry them), and standard base64's "+" and "/"
// would split the manifest path into extra segments — the server decodes
// base64url, so emit that instead
function encodeConfig(configJson) {
  const bytes = new TextEncoder().encode(configJson);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Accepts both standard and URL-safe base64 (older links carry standard)
function decodeConfig(configBase64) {
  const binary = atob(
    configBase64.replace(/-/g, "+").replace(/_/g, "/"),
  );
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
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

// One provider entry: its panel, tier fieldsets, default mirrors, and its
// own mirror widget state. A new provider adds a PROVIDERS entry + panel.
// Tier keys and option values align with kisskh's vocabulary (ole's
// "update" tier is kisskh's Update tier — both are catalog sort orders).
const PROVIDERS = ["kisskh", "ole"];
const PROVIDER_TIERS = {
  kisskh: ["type", "region", "status", "update"],
  ole: ["type", "region", "update"],
};
const DEFAULT_MIRRORS = {
  kisskh: JSON.parse(document.getElementById("defaultMirrors").textContent),
  ole: JSON.parse(
    document.getElementById("oleDefaultMirrors").textContent,
  ),
};
// 欧乐 is opt-in: a fresh visitor's manifest stays kisskh-only until the
// 欧乐 toggle is turned on
const FRESH_ENABLED = { kisskh: true, ole: false };

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

// Mirrors: an ordered fallback list. The first mirror is tried first; the
// rest take over while a mirror above them has a recent failure.

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

// One mirror widget per provider, bound to that provider's panel elements
function createMirrorWidget(provider) {
  let orderedMirrors = [];

  const els = {
    order: document.getElementById(`${provider}-mirror-order`),
    moreLabel: document.getElementById(`${provider}-mirror-more-label`),
    more: document.getElementById(`${provider}-mirror-more`),
    input: document.getElementById(`${provider}-mirror-input`),
    error: document.getElementById(`${provider}-mirror-error`),
    addBtn: document.getElementById(`${provider}-mirror-add-btn`),
  };

  function mirrorError(message) {
    els.error.textContent = message;
    els.error.hidden = !message;
  }

  function renderMirrors() {
    els.order.replaceChildren(
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

    // Defaults not picked live in the "More mirrors" grid; custom mirrors
    // only exist while they are part of the order (re-addable via the input)
    const more = DEFAULT_MIRRORS[provider].filter(
      (url) => !orderedMirrors.includes(url),
    );
    els.moreLabel.hidden = more.length === 0;
    els.more.hidden = more.length === 0;
    els.more.replaceChildren(
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

  function addCustomMirror() {
    const input = els.input;
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

  els.order.addEventListener("click", (e) => {
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
  els.more.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    orderedMirrors.push(chip.dataset.url);
    renderMirrors();
    updateManifestUrl();
  });

  els.addBtn.addEventListener("click", addCustomMirror);
  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addCustomMirror();
    }
  });
  els.input.addEventListener("input", () => {
    mirrorError(null);
  });

  return {
    render: renderMirrors,
    get mirrors() {
      return [...orderedMirrors];
    },
    setMirrors(mirrors) {
      orderedMirrors = [...mirrors];
    },
  };
}

const mirrorWidgets = Object.fromEntries(
  PROVIDERS.map((provider) => [provider, createMirrorWidget(provider)]),
);

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

function getTierValues(provider, tier) {
  const group = document.querySelector(
    `.tab-panel[data-provider="${provider}"] .config-group[data-tier="${tier}"]`,
  );
  return [...group.querySelectorAll("input[type='checkbox']:checked")]
    .map((cb) => cb.value)
    .filter((value) => value !== "__all__");
}

function setTierValues(provider, valuesByTier) {
  for (const tier of PROVIDER_TIERS[provider]) {
    const group = document.querySelector(
      `.tab-panel[data-provider="${provider}"] .config-group[data-tier="${tier}"]`,
    );
    const values = Array.isArray(valuesByTier?.[tier])
      ? valuesByTier[tier]
      : [];
    const expandAll = values.includes("__all__");
    group.querySelectorAll("input[type='checkbox']").forEach((cb) => {
      cb.checked =
        cb.value === "__all__"
          ? false
          : expandAll || values.includes(cb.value);
    });
  }
}

const isEnabled = (provider) =>
  document.getElementById(`${provider}-enabled`).checked;

// A disabled provider's fieldsets are muted (native disabled semantics work
// on TV D-pads) and left out of the config entirely
function setEnabled(provider, enabled) {
  document.getElementById(`${provider}-enabled`).checked = enabled;
  document
    .querySelectorAll(`.tab-panel[data-provider="${provider}"] fieldset:not(.provider-enable-group)`)
    .forEach((fieldset) => {
      fieldset.disabled = !enabled;
    });
}

// Turning a provider on starts from the same full selection a fresh page
// shows: default mirrors and every tier option ticked, ready to trim
function seedProviderDefaults(provider) {
  const widget = mirrorWidgets[provider];
  if (widget.mirrors.length === 0) {
    widget.setMirrors(DEFAULT_MIRRORS[provider]);
    widget.render();
  }
  for (const tier of PROVIDER_TIERS[provider]) {
    if (getTierValues(provider, tier).length > 0) continue;
    document
      .querySelector(
        `.tab-panel[data-provider="${provider}"] .config-group[data-tier="${tier}"]`,
      )
      .querySelectorAll("input[type='checkbox']")
      .forEach((cb) => {
        cb.checked = cb.value !== "__all__";
      });
  }
}

// Per-provider toggle wiring (the form-level change listener only refreshes
// the manifest url; seeding must run before it)
document.querySelectorAll(".provider-toggle").forEach((toggle) => {
  toggle.addEventListener("change", () => {
    const provider = toggle.id.replace(/-enabled$/, "");
    if (toggle.checked) seedProviderDefaults(provider);
    setEnabled(provider, toggle.checked);
  });
});

const defaultConfig = JSON.parse(
  document.getElementById("defaultConfig").textContent,
);

// Configure
form.addEventListener("change", function () {
  updateManifestUrl();
});

function collectProvider(provider) {
  const settings = { mirrors: mirrorWidgets[provider].mirrors };
  for (const tier of PROVIDER_TIERS[provider]) {
    settings[tier] = getTierValues(provider, tier);
  }
  return settings;
}

function validationError(provider, settings) {
  if (settings.mirrors.length === 0) {
    return `${provider}: select at least one mirror`;
  }
  for (const tier of PROVIDER_TIERS[provider]) {
    if (settings[tier].length === 0) {
      return `${provider}: select at least one ${tier}`;
    }
  }
  return null;
}

function updateManifestUrl() {
  const providers = {};
  let error = null;
  for (const provider of PROVIDERS) {
    if (!isEnabled(provider)) continue;
    const settings = collectProvider(provider);
    error = error || validationError(provider, settings);
    providers[provider] = settings;
  }
  if (!error && Object.keys(providers).length === 0) {
    error = "Enable at least one provider";
  }

  const hint = document.getElementById("config-hint");
  if (error) {
    hint.textContent = error;
    hint.style.display = "block";
    setInstallUrl(window.location.origin + "/manifest.json");
    return;
  }
  hint.style.display = "none";

  const configJson = JSON.stringify({ providers });
  const configBase64 = encodeConfig(configJson);
  const manifestUrl =
    window.location.origin + "/" + configBase64 + "/manifest.json";
  setInstallUrl(manifestUrl);
}

// Update config redirect from stremio (/config64/configure). Fresh visitors
// get every provider's default mirrors pre-selected in fallback order; a
// restored config reinstates its own order, including custom mirrors, and
// enables exactly the providers it carries.
document.addEventListener("DOMContentLoaded", () => {
  const path = window.location.pathname;
  const match = path.match(/\/(.+)\/configure/);
  const hasConfig = match && match[1];
  let config;
  try {
    config = hasConfig ? JSON.parse(decodeConfig(match[1])) : defaultConfig;
  } catch (error) {
    console.error("Failed to decode configuration:", error);
    config = defaultConfig;
  }
  try {
    for (const provider of PROVIDERS) {
      const settings = config.providers?.[provider];
      const enabled = hasConfig ? !!settings : FRESH_ENABLED[provider];
      setEnabled(provider, enabled);
      mirrorWidgets[provider].setMirrors(
        enabled
          ? (hasConfig
              ? Array.isArray(settings?.mirrors)
                ? settings.mirrors
                : []
              : DEFAULT_MIRRORS[provider])
          : [],
      );
      if (enabled) {
        // Fresh pages tick every option of every tier (the "__all__"
        // semantics of the server's default config) so enabling a provider
        // instantly passes validation
        const freshTiers = Object.fromEntries(
          PROVIDER_TIERS[provider].map((tier) => [tier, ["__all__"]]),
        );
        setTierValues(provider, hasConfig ? settings : freshTiers);
      }
      mirrorWidgets[provider].render();
    }
    // After applying saved config, update the install links
    updateManifestUrl();
  } catch (error) {
    console.error("Failed to decode configuration:", error);
  }
});
