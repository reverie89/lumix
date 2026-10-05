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
// Check icon (icons.svg sprite) flashed inside the copy button on success
const CHECK_ICON =
  '<svg class="icon" aria-hidden="true"><use href="/icons.svg#check"></use></svg>';

function copyUrl() {
  const manifestUrl = document.getElementById("manifestUrl").textContent;
  const btn = document.getElementById("copyManifestBtn");
  let flashTimer;
  const restore = () => {
    btn.style.minWidth = "";
    btn.removeAttribute("aria-label");
    btn.textContent = t("copy");
  };
  // Success swaps the label for the check icon; the aria-label keeps it
  // announcing "Copied" and the frozen width keeps the wrapped manifest URL
  // from reflowing during the swap
  const flashCheck = () => {
    clearTimeout(flashTimer);
    btn.style.minWidth = `${btn.offsetWidth}px`;
    btn.setAttribute("aria-label", t("copied"));
    btn.innerHTML = CHECK_ICON;
    flashTimer = setTimeout(restore, 2000);
  };
  const flashText = (text) => {
    clearTimeout(flashTimer);
    btn.textContent = text;
    flashTimer = setTimeout(restore, 2000);
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
    if (copied) flashCheck();
    else flashText(t("copyUnavailable"));
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(manifestUrl).then(flashCheck, legacyCopy);
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

// ---- Language (English / 中文) ----
// Everything user-visible renders through this table: static page text via
// data-i18n attributes, aria-labels via data-i18n-aria, JS-built strings via
// t() below. Chip text for tier options comes from OPTION_LABELS(_ZH).
let language = "en";
const STRINGS = {
  en: {
    tagline: "Stremio addon for dramas, series & movies.",
    language: "Language",
    languageHint: "Applies to this page and your Stremio catalogs",
    provider: "Provider",
    providerOrderHint:
      "Sections below follow this order — it's the catalog order in Stremio",
    addProvider: "Add provider · tap to add",
    mirrors: "Mirrors",
    apiHosts: "API hosts",
    mirrorsHint:
      "At least one required · tried top to bottom · failed mirrors are retried after 10 min",
    hostsHint:
      "At least one required · tried top to bottom · failed hosts are retried after 10 min",
    moreMirrors: "More mirrors · tap to add as a fallback",
    moreHosts: "More hosts · tap to add as a fallback",
    more: "More · tap to add",
    paste: "Paste",
    add: "Add",
    type: "Type",
    region: "Region",
    status: "Status",
    sort: "Sort",
    tierHintType:
      "At least one tier must have picks · rows appear in Stremio in this order",
    tierHintRegion:
      "At least one tier must have picks · each region adds a series and a movies catalog · rows appear in Stremio in this order",
    tierHintStatus:
      "At least one tier must have picks · applies to series · rows appear in Stremio in this order",
    tierHintSort:
      "At least one tier must have picks · sort order of the selected catalogs · rows appear in Stremio in this order",
    installApp: "Install Stremio",
    installWeb: "Install Web",
    copy: "Copy",
    copied: "Copied",
    copyUnavailable: "Copy unavailable — use an Install button",
    noClipboard: "No clipboard access",
    invalidMirror: "Not a valid mirror host",
    mirrorExists: "Mirror already added",
    enableOne: "Add at least one provider",
    all: "All",
    allAria: "Add every remaining option",
    clear: "Clear",
    clearAria: "Clear every picked option",
    mirrorInputAria: "Add a custom mirror URL",
    hostInputAria: "Add a custom API host URL",
    moveUpType: "Move the Type group up",
    moveDownType: "Move the Type group down",
    moveUpRegion: "Move the Region group up",
    moveDownRegion: "Move the Region group down",
    moveUpStatus: "Move the Status group up",
    moveDownStatus: "Move the Status group down",
    moveUpSort: "Move the Sort group up",
    moveDownSort: "Move the Sort group down",
    moveUp: (label) => `Move ${label} up`,
    moveDown: (label) => `Move ${label} down`,
    remove: (label) => `Remove ${label}`,
    addFallback: (url) => `Add ${url} as a fallback mirror`,
    addOption: (label) => `Add ${label}`,
  },
  zh: {
    tagline: "在 Stremio 上观看剧集、电影、综艺与动漫。",
    language: "语言",
    languageHint: "应用于本页面及 Stremio 中的目录",
    provider: "内容源",
    providerOrderHint: "下方分区按此顺序排列 — 也是 Stremio 中的目录顺序",
    addProvider: "添加内容源 · 点按添加",
    mirrors: "镜像",
    apiHosts: "API 域名",
    mirrorsHint:
      "至少填写一个 · 从上到下依次尝试 · 失败的镜像 10 分钟后自动重试",
    hostsHint:
      "至少填写一个 · 从上到下依次尝试 · 失败的域名 10 分钟后自动重试",
    moreMirrors: "更多镜像 · 点按添加为备用",
    moreHosts: "更多域名 · 点按添加为备用",
    more: "更多 · 点按添加",
    paste: "粘贴",
    add: "添加",
    type: "类型",
    region: "地区",
    status: "状态",
    sort: "排序",
    tierHintType:
      "至少在一个分组中选择选项 · 目录行按此顺序显示在 Stremio 中",
    tierHintRegion:
      "至少在一个分组中选择选项 · 每个地区会添加剧集和电影两个目录 · 目录行按此顺序显示在 Stremio 中",
    tierHintStatus:
      "至少在一个分组中选择选项 · 仅作用于剧集 · 目录行按此顺序显示在 Stremio 中",
    tierHintSort:
      "至少在一个分组中选择选项 · 所选目录的排列方式 · 目录行按此顺序显示在 Stremio 中",
    installApp: "安装 Stremio",
    installWeb: "安装网页版",
    copy: "复制",
    copied: "已复制",
    copyUnavailable: "复制不可用 — 请使用安装按钮",
    noClipboard: "无法访问剪贴板",
    invalidMirror: "不是有效的镜像地址",
    mirrorExists: "镜像已添加",
    enableOne: "请至少添加一个内容源",
    all: "全部",
    allAria: "添加其余全部选项",
    clear: "清空",
    clearAria: "清空已选选项",
    mirrorInputAria: "添加自定义镜像 URL",
    hostInputAria: "添加自定义 API 域名",
    moveUpType: "上移类型分组",
    moveDownType: "下移类型分组",
    moveUpRegion: "上移地区分组",
    moveDownRegion: "下移地区分组",
    moveUpStatus: "上移状态分组",
    moveDownStatus: "下移状态分组",
    moveUpSort: "上移排序分组",
    moveDownSort: "下移排序分组",
    moveUp: (label) => `上移 ${label}`,
    moveDown: (label) => `下移 ${label}`,
    remove: (label) => `移除 ${label}`,
    addFallback: (url) => `将 ${url} 添加为备用镜像`,
    addOption: (label) => `添加 ${label}`,
  },
};
const t = (key) => STRINGS[language][key];

// The tagline's TMDB credit is conditional on the deployment's env, so the
// server injects both languages' credit text and the tagline composes it
const TMDB_CREDIT = JSON.parse(
  document.getElementById("tmdbCredit").textContent,
);

// Swap every static string, aria-label and rendered widget to `language`.
// Called at boot (the markup's English text is the pre-JS default) and on
// every language radio change.
function applyLanguage() {
  document.documentElement.lang = language;
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const text = STRINGS[language][node.dataset.i18n];
    if (text) node.textContent = text;
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((node) => {
    const text = STRINGS[language][node.dataset.i18nAria];
    if (text) node.setAttribute("aria-label", text);
  });
  document.getElementById("tagline").textContent =
    t("tagline") + (TMDB_CREDIT[language] ?? "");
  // Ordered rows and add-chips carry labels and aria-labels of their own
  providerOrder.render();
  renderProviderMore();
  for (const provider of PROVIDERS) {
    mirrorWidgets[provider].render();
    for (const tier of PROVIDER_TIERS[provider]) {
      tierWidgets[provider][tier].render();
    }
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
      btn.textContent = t("noClipboard");
      setTimeout(() => {
        btn.textContent = originalText;
      }, 2000);
    }
  });
});

// One provider entry: its panel, tier fieldsets, default mirrors, and its
// own mirror widget state. A new provider adds a PROVIDERS entry + panel.
const PROVIDERS = ["kisskh", "ole"];
const PROVIDER_TIERS = {
  kisskh: ["type", "region", "status", "update"],
  ole: ["type", "region", "update"],
};

// Tier options in canonical order. Values are the server's option names (the
// option lists in src/source/*-catalogs.ts); labels are this page's chip
// text. A category change touches those lists and this table — nothing else.
const TIER_OPTIONS = {
  kisskh: {
    type: ["TVSeries", "Movies", "Anime", "Hollywood"],
    region: [
      "Korean",
      "Chinese",
      "Japanese",
      "Hongkong",
      "Thai",
      "Taiwanese",
      "Philippine",
      "Indonesian",
      "Singaporean",
      "Vietnamese",
      "Turkish",
      "Indian",
      "Malaysian",
      "US",
    ],
    status: ["Ongoing", "Completed"],
    update: ["Popular", "Last Update", "Release Date"],
  },
  ole: {
    type: ["TVSeries", "Movies", "Variety", "Anime", "ShortDrama"],
    region: [
      "Chinese",
      "Hongkong",
      "Taiwanese",
      "Japanese",
      "Korean",
      "US",
      "UK",
      "Thai",
      "French",
      "German",
      "Italian",
      "Spanish",
      "Canadian",
      "Russian",
      "Dutch",
      "Australian",
    ],
    update: ["Popular", "Last Update", "Score", "Release Date"],
  },
};
// Values whose chip text differs from the config value
const OPTION_LABELS = {
  TVSeries: "TV Series",
  US: "United States",
  UK: "United Kingdom",
  ShortDrama: "Short Drama",
};
// 中文 chip text, mirroring TIER_LABELS_ZH in src/utils/constant.ts (the
// same labels name the catalogs in Stremio) — a category change updates both
const OPTION_LABELS_ZH = {
  TVSeries: "剧集",
  Movies: "电影",
  Anime: "动漫",
  Hollywood: "好莱坞",
  Variety: "综艺",
  ShortDrama: "短剧",
  Korean: "韩国",
  Chinese: "大陆",
  Japanese: "日本",
  Hongkong: "香港",
  Thai: "泰国",
  Taiwanese: "台湾",
  Philippine: "菲律宾",
  Indonesian: "印度尼西亚",
  Singaporean: "新加坡",
  Vietnamese: "越南",
  Turkish: "土耳其",
  Indian: "印度",
  Malaysian: "马来西亚",
  US: "美国",
  UK: "英国",
  French: "法国",
  German: "德国",
  Italian: "意大利",
  Spanish: "西班牙",
  Canadian: "加拿大",
  Russian: "俄罗斯",
  Dutch: "荷兰",
  Australian: "澳大利亚",
  Ongoing: "连载中",
  Completed: "已完结",
  Popular: "热门",
  "Last Update": "最近更新",
  "Release Date": "最新上架",
  Score: "评分",
};
const optionLabel = (value) =>
  language === "zh"
    ? (OPTION_LABELS_ZH[value] ?? value)
    : (OPTION_LABELS[value] ?? value);
const PROVIDER_LABELS = { kisskh: "kisskh", ole: "欧乐" };

const DEFAULT_MIRRORS = {
  kisskh: JSON.parse(document.getElementById("defaultMirrors").textContent),
  ole: JSON.parse(
    document.getElementById("oleDefaultMirrors").textContent,
  ),
};
// Both providers start on a fresh page; the provider list's ✕ and the
// tap-to-add chips remove and re-add them
const FRESH_ENABLED = { kisskh: true, ole: true };

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

// Ordered value lists — mirrors, tier picks and the provider order all
// render through this. The values array is the single source of ordering
// truth; it is what the config carries (mirrors as fallback order, tiers
// and providers as the catalog order Stremio displays).
function createOrderedList({ listEl, labelOf, titleOf = null, canRemove = true, onChange }) {
  let values = [];

  function render() {
    listEl.replaceChildren(
      ...values.map((value, index) => {
        const label = labelOf(value);
        const row = el("li", "order-row");
        // CSS keys per-provider coloring off the row's value
        row.dataset.value = value;
        const badge = el("span", "order-index");
        badge.textContent = String(index + 1);
        const name = el("span", "order-name");
        name.textContent = label;
        if (titleOf) name.title = titleOf(value);
        const moveUp = el("button", "order-btn");
        moveUp.type = "button";
        moveUp.textContent = "‹";
        moveUp.setAttribute("aria-label", t("moveUp")(label));
        moveUp.disabled = index === 0;
        const moveDown = el("button", "order-btn");
        moveDown.type = "button";
        moveDown.textContent = "›";
        moveDown.setAttribute("aria-label", t("moveDown")(label));
        moveDown.disabled = index === values.length - 1;
        const buttons = [moveUp, moveDown];
        if (canRemove) {
          const remove = el("button", "order-btn");
          remove.type = "button";
          remove.textContent = "✕";
          remove.setAttribute("aria-label", t("remove")(label));
          remove.dataset.action = "remove";
          buttons.push(remove);
        }
        moveUp.dataset.action = "up";
        moveDown.dataset.action = "down";
        for (const btn of buttons) {
          btn.dataset.value = value;
        }
        row.append(badge, name, ...buttons);
        return row;
      }),
    );
  }

  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".order-btn");
    if (!btn) return;
    const index = values.indexOf(btn.dataset.value);
    if (index === -1) return;
    if (btn.dataset.action === "remove") {
      values.splice(index, 1);
    } else if (btn.dataset.action === "up" && index > 0) {
      [values[index - 1], values[index]] = [values[index], values[index - 1]];
    } else if (
      btn.dataset.action === "down" &&
      index < values.length - 1
    ) {
      [values[index + 1], values[index]] = [values[index], values[index + 1]];
    } else {
      return;
    }
    render();
    onChange();
  });

  return {
    render,
    get values() {
      return [...values];
    },
    setValues(next) {
      values = [...next];
    },
  };
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

// Duplicate picks collapse: the key ignores case and trailing slashes and
// the first occurrence wins. The server's normalizeConfig mirrors this rule,
// so a hand-crafted config cannot sneak duplicates past the page either.
const mirrorKey = (url) => normalizeMirrorInput(url).toLowerCase();

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
  const els = {
    order: document.getElementById(`${provider}-mirror-order`),
    moreLabel: document.getElementById(`${provider}-mirror-more-label`),
    more: document.getElementById(`${provider}-mirror-more`),
    input: document.getElementById(`${provider}-mirror-input`),
    error: document.getElementById(`${provider}-mirror-error`),
    addBtn: document.getElementById(`${provider}-mirror-add-btn`),
  };

  const list = createOrderedList({
    listEl: els.order,
    labelOf: (url) => url.replace("https://", ""),
    titleOf: (url) => url,
    // Row remove/reorder must refresh the "More mirrors" grid too (a removed
    // default returns there)
    onChange: () => {
      renderMirrors();
      updateManifestUrl();
    },
  });

  function mirrorError(message) {
    els.error.textContent = message;
    els.error.hidden = !message;
  }

  function renderMirrors() {
    list.render();
    // Defaults not picked live in the "More mirrors" grid; custom mirrors
    // only exist while they are part of the order (re-addable via the input)
    const pickedKeys = new Set(list.values.map(mirrorKey));
    const more = DEFAULT_MIRRORS[provider].filter(
      (url) => !pickedKeys.has(mirrorKey(url)),
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
        chip.setAttribute("aria-label", t("addFallback")(url));
        chip.dataset.value = url;
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
      mirrorError(t("invalidMirror"));
      return;
    }
    if (list.values.some((existing) => mirrorKey(existing) === mirrorKey(value))) {
      mirrorError(t("mirrorExists"));
      return;
    }
    mirrorError(null);
    input.value = "";
    list.setValues([...list.values, value]);
    renderMirrors();
    updateManifestUrl();
  }

  // Tapping a "More mirrors" chip appends it as the last fallback
  els.more.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip || !chip.dataset.value) return;
    list.setValues([...list.values, chip.dataset.value]);
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
      return list.values;
    },
    setMirrors(mirrors) {
      // Seeds, restored configs and hand-crafted links all arrive here, so
      // duplicates collapse on the way in (first occurrence keeps its place)
      const seen = new Set();
      list.setValues(
        mirrors.filter((mirror) => {
          const key = mirrorKey(mirror);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      );
    },
  };
}

const mirrorWidgets = Object.fromEntries(
  PROVIDERS.map((provider) => [provider, createMirrorWidget(provider)]),
);

// One tier widget per provider tier: the ordered rows are that tier's
// catalog rows in Stremio order; unpicked options sit below as tap-to-add
// chips. "All" appends every remaining option and flips to "Clear" once
// everything is picked. setValues accepts "__all__" (fresh pages and the
// server's default config carry it) and drops unknown options.
function createTierWidget(provider, tier) {
  const options = TIER_OPTIONS[provider][tier];
  const moreLabel = document.getElementById(`${provider}-${tier}-more-label`);
  const more = document.getElementById(`${provider}-${tier}-more`);

  const list = createOrderedList({
    listEl: document.getElementById(`${provider}-${tier}-order`),
    labelOf: optionLabel,
    // Row remove/reorder must refresh the add-chip grid too (a removed pick
    // returns there)
    onChange: () => {
      render();
      updateManifestUrl();
    },
  });

  function addChip(text, ariaLabel, dataset) {
    const option = el("span", "chip-option");
    const chip = el("button", "chip");
    chip.type = "button";
    chip.textContent = text;
    chip.setAttribute("aria-label", ariaLabel);
    Object.assign(chip.dataset, dataset);
    option.append(chip);
    return option;
  }

  function render() {
    list.render();
    const picked = list.values;
    const remaining = options.filter((value) => !picked.includes(value));
    moreLabel.hidden = remaining.length === 0;
    more.replaceChildren(
      ...remaining.map((value) =>
        addChip(optionLabel(value), t("addOption")(optionLabel(value)), {
          value,
        }),
      ),
      remaining.length > 0
        ? addChip(t("all"), t("allAria"), { action: "all" })
        : addChip(t("clear"), t("clearAria"), { action: "clear" }),
    );
  }

  more.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const picked = list.values;
    if (chip.dataset.action === "all") {
      list.setValues([
        ...picked,
        ...options.filter((value) => !picked.includes(value)),
      ]);
    } else if (chip.dataset.action === "clear") {
      list.setValues([]);
    } else if (chip.dataset.value) {
      list.setValues([...picked, chip.dataset.value]);
    } else {
      return;
    }
    render();
    updateManifestUrl();
  });

  return {
    render,
    get values() {
      return list.values;
    },
    setValues(next) {
      list.setValues(
        next.includes("__all__")
          ? options
          : [...new Set(next)].filter((value) => options.includes(value)),
      );
    },
  };
}

const tierWidgets = Object.fromEntries(
  PROVIDERS.map((provider) => [
    provider,
    Object.fromEntries(
      PROVIDER_TIERS[provider].map((tier) => [
        tier,
        createTierWidget(provider, tier),
      ]),
    ),
  ]),
);

// Provider order: the added providers, top to bottom. A row's ✕ removes its
// provider from the page and the config; the chip grid under the list adds
// one back. The sections stack in this order and the config carries it as
// the catalog order Stremio displays.
const providerOrder = createOrderedList({
  listEl: document.getElementById("provider-order"),
  labelOf: (name) => PROVIDER_LABELS[name] ?? name,
  onChange: () => {
    syncProviderSections();
    updateManifestUrl();
  },
});

// Tier groups are reorderable within their provider section — the fieldset
// order is the tier order the config carries (‹ › in each tier legend move
// the group).
function getTierGroup(provider, tier) {
  return document.querySelector(
    `.provider-section[data-provider="${provider}"] .config-group[data-tier="${tier}"]`,
  );
}

function tierGroupsOf(provider) {
  return [
    ...document.querySelectorAll(
      `.provider-section[data-provider="${provider}"] .config-group[data-tier]`,
    ),
  ];
}

const tierOrderOf = (provider) =>
  tierGroupsOf(provider).map((group) => group.dataset.tier);

function moveTierGroup(group, direction) {
  const siblings = tierGroupsOf(
    group.closest(".provider-section").dataset.provider,
  );
  const index = siblings.indexOf(group);
  const swapWith =
    direction === "up" ? siblings[index - 1] : siblings[index + 1];
  if (!swapWith) return;
  if (direction === "up") {
    group.parentElement.insertBefore(group, swapWith);
  } else {
    group.parentElement.insertBefore(swapWith, group);
  }
}

// Reorder a provider's tier groups to `tiers` (unknown names dropped,
// missing tiers appended in their current order)
function setTierOrder(provider, tiers) {
  const panel = document.getElementById(`panel-${provider}`);
  const groups = tierGroupsOf(provider);
  const byTier = new Map(groups.map((group) => [group.dataset.tier, group]));
  const named = [...new Set(tiers)].filter((tier) => byTier.has(tier));
  // The tier groups sit at the end of their panel: re-appending in order
  // moves nothing else
  for (const tier of named) panel.append(byTier.get(tier));
  for (const group of groups) {
    if (!named.includes(group.dataset.tier)) panel.append(group);
  }
  renderTierMoves(provider);
}

// The ‹ › buttons disable at the group boundaries
function renderTierMoves(provider) {
  const groups = tierGroupsOf(provider);
  groups.forEach((group, index) => {
    group.querySelector('.tier-move[data-action="up"]').disabled = index === 0;
    group.querySelector('.tier-move[data-action="down"]').disabled =
      index === groups.length - 1;
  });
}

document.querySelectorAll(".provider-section").forEach((panel) => {
  panel.addEventListener("click", (e) => {
    const btn = e.target.closest(".tier-move");
    if (!btn) return;
    const group = btn.closest(".config-group[data-tier]");
    if (!group) return;
    moveTierGroup(group, btn.dataset.action);
    renderTierMoves(panel.dataset.provider);
    updateManifestUrl();
  });
});

// A provider is configured exactly when it sits in the provider-order list;
// anything not in the list is hidden and left out of the config entirely
const isEnabled = (provider) => providerOrder.values.includes(provider);

// A provider appears on the page exactly when it sits in the list:
// syncProviderSections hides the removed ones and stacks the added ones in
// list order (re-appending moves the sections physically, the same trick
// setTierOrder uses for tier groups)
function syncProviderSections() {
  const added = providerOrder.values;
  for (const provider of PROVIDERS) {
    document.getElementById(`panel-${provider}`).hidden = !added.includes(
      provider,
    );
  }
  const configure = document.querySelector("section.configure");
  for (const provider of added) {
    configure.append(document.getElementById(`panel-${provider}`));
  }
  renderProviderMore();
}

// Providers missing from the list sit below it as tap-to-add chips; the
// grid hides once every provider is added
function renderProviderMore() {
  const moreLabel = document.getElementById("provider-more-label");
  const more = document.getElementById("provider-more");
  const remaining = PROVIDERS.filter(
    (provider) => !providerOrder.values.includes(provider),
  );
  moreLabel.hidden = remaining.length === 0;
  more.hidden = remaining.length === 0;
  more.replaceChildren(
    ...remaining.map((provider) => {
      const label = PROVIDER_LABELS[provider] ?? provider;
      const option = el("span", "chip-option");
      const chip = el("button", "chip");
      chip.type = "button";
      chip.textContent = label;
      chip.setAttribute("aria-label", t("addOption")(label));
      chip.dataset.value = provider;
      option.append(chip);
      return option;
    }),
  );
}

// Adding a provider shows its section with the same selection a fresh page
// shows (default mirrors + the server's default tier picks) unless it still
// carries picks from an earlier add — removal keeps them
function addProvider(provider) {
  if (providerOrder.values.includes(provider)) return;
  seedProviderDefaults(provider);
  providerOrder.setValues([...providerOrder.values, provider]);
  providerOrder.render();
  syncProviderSections();
  updateManifestUrl();
}

// Add-chip wiring (seeding must run before the url refresh in addProvider)
document.getElementById("provider-more").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip || !chip.dataset.value) return;
  addProvider(chip.dataset.value);
});

// Adding a provider seeds only the empty widgets, so a re-add restores the
// picks it carried before removal
function seedProviderDefaults(provider) {
  const widget = mirrorWidgets[provider];
  if (widget.mirrors.length === 0) {
    widget.setMirrors(DEFAULT_MIRRORS[provider]);
    widget.render();
  }
  for (const tier of PROVIDER_TIERS[provider]) {
    const tierWidget = tierWidgets[provider][tier];
    const defaults = defaultConfig.providers?.[provider]?.[tier] ?? ["__all__"];
    // An empty default (an optional tier) seeds nothing — empty is its default
    if (tierWidget.values.length === 0 && defaults.length > 0) {
      tierWidget.setValues(defaults);
      tierWidget.render();
    }
  }
}

const defaultConfig = JSON.parse(
  document.getElementById("defaultConfig").textContent,
);

// Configure
form.addEventListener("change", function () {
  updateManifestUrl();
});

function collectProvider(provider) {
  const settings = {
    mirrors: mirrorWidgets[provider].mirrors,
    order: tierOrderOf(provider),
  };
  for (const tier of PROVIDER_TIERS[provider]) {
    settings[tier] = tierWidgets[provider][tier].values;
  }
  return settings;
}

function hasValidationError(provider, settings) {
  if (settings.mirrors.length === 0) return true;
  // Tiers are optional one by one — an empty tier adds no catalogs — so a
  // provider is only invalid when no tier has a pick at all
  return PROVIDER_TIERS[provider].every(
    (tier) => settings[tier].length === 0,
  );
}

// An unmet requirement alerts on the offending group itself (red outline +
// hint, .required-alert in style.css); a provider with no tier picked flags
// every tier group, since no single one is at fault, and an empty provider
// list flags the list card itself — its red message sits right above the
// tap-to-add chips that resolve it
function updateRequiredAlerts(providers) {
  document
    .getElementById("provider-group")
    .classList.toggle(
      "required-alert",
      Object.keys(providers).length === 0,
    );
  for (const provider of PROVIDERS) {
    const settings = providers[provider];
    document
      .getElementById(`${provider}-mirrors-group`)
      .classList.toggle(
        "required-alert",
        !!settings && settings.mirrors.length === 0,
      );
    const noTierPicked =
      !!settings &&
      PROVIDER_TIERS[provider].every((tier) => settings[tier].length === 0);
    for (const tier of PROVIDER_TIERS[provider]) {
      getTierGroup(provider, tier).classList.toggle(
        "required-alert",
        noTierPicked,
      );
    }
  }
}

function updateManifestUrl() {
  const providers = {};
  let invalid = false;
  for (const provider of PROVIDERS) {
    if (!isEnabled(provider)) continue;
    const settings = collectProvider(provider);
    invalid = invalid || hasValidationError(provider, settings);
    providers[provider] = settings;
  }
  const noneEnabled = Object.keys(providers).length === 0;

  updateRequiredAlerts(providers);

  const hint = document.getElementById("config-hint");
  hint.textContent = noneEnabled ? t("enableOne") : "";
  hint.hidden = !noneEnabled;
  if (invalid || noneEnabled) {
    setInstallUrl(window.location.origin + "/manifest.json");
    return;
  }

  const configJson = JSON.stringify({
    language,
    order: providerOrder.values,
    providers,
  });
  const configBase64 = encodeConfig(configJson);
  const manifestUrl =
    window.location.origin + "/" + configBase64 + "/manifest.json";
  setInstallUrl(manifestUrl);
}

// Language radios: swap every string (the radio's own change event also
// bubbles to the form listener below, refreshing the manifest url — the
// config JSON carries the language)
document.querySelectorAll('input[name="language"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    language = radio.value;
    applyLanguage();
  });
});

// Update config redirect from stremio (/config64/configure). Fresh visitors
// start from the server's default selection (both providers added, default
// mirrors pre-selected in fallback order); a restored config reinstates its
// own language, provider list, tier order, pick order and mirrors.
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
    language = config.language === "zh" ? "zh" : "en";
    document.getElementById(`language-${language}`).checked = true;
    applyLanguage();

    // Provider list: a config adds exactly the providers it carries settings
    // for; a fresh page starts from FRESH_ENABLED. The saved order sequences
    // them (unknown names dropped, missing ones appended in canonical order)
    const savedOrder =
      hasConfig && Array.isArray(config.order) ? config.order : [];
    const enabledSet = new Set(
      hasConfig
        ? Object.keys(config.providers ?? {}).filter((name) =>
            PROVIDERS.includes(name),
          )
        : PROVIDERS.filter((name) => FRESH_ENABLED[name]),
    );
    const namedProviders = [
      ...new Set(savedOrder.filter((name) => enabledSet.has(name))),
    ];
    for (const name of PROVIDERS) {
      if (enabledSet.has(name) && !namedProviders.includes(name)) {
        namedProviders.push(name);
      }
    }
    providerOrder.setValues(namedProviders);
    providerOrder.render();
    syncProviderSections();

    for (const provider of PROVIDERS) {
      const settings = config.providers?.[provider];
      const enabled = enabledSet.has(provider);
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
        setTierOrder(
          provider,
          Array.isArray(settings?.order) ? settings.order : [],
        );
        for (const tier of PROVIDER_TIERS[provider]) {
          // A fresh page carries the server's defaultConfig, so its tiers
          // seed from the same default picks a restored config's own picks
          // reinstate (setValues expands "__all__")
          const values = Array.isArray(settings?.[tier])
            ? settings[tier]
            : [];
          const widget = tierWidgets[provider][tier];
          widget.setValues(values);
          widget.render();
        }
      }
      mirrorWidgets[provider].render();
    }
    // After applying saved config, update the install links
    updateManifestUrl();
  } catch (error) {
    console.error("Failed to decode configuration:", error);
  }
});
