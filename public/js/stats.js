(() => {
    "use strict";

    // Summary + recent rows arrive injected server-side (no fetches), the
    // live feed rides EventSource. Refresh reloads everything.
    const data = JSON.parse(document.getElementById("visitData").textContent);

    const el = (tag, className) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        return node;
    };
    const setText = (id, value) => {
        const node = document.getElementById(id);
        if (node) node.textContent = String(value);
    };
    const cssVar = (name) =>
        getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const pad2 = (n) => String(n).padStart(2, "0");
    const timeOf = (ts) => {
        const d = new Date(ts);
        return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    };

    // Cards
    setText("stat-manifest-today", data.today.manifest);
    setText("stat-manifest-week", `7 days: ${data.week.manifest}`);
    setText("stat-landing-today", data.today.landing);
    setText("stat-landing-week", `7 days: ${data.week.landing}`);
    setText("stat-unique", data.uniqueToday);
    setText("stat-installs", data.installsToday);

    // 14-day manifest trend; colors come from the page's own tokens so the
    // chart inherits the theme
    const canvas = document.getElementById("dailyChart");
    if (canvas && window.Chart) {
        new Chart(canvas, {
            type: "bar",
            data: {
                labels: data.daily.map((d) => d.day.slice(5)),
                datasets: [{
                    data: data.daily.map((d) => d.count),
                    backgroundColor: cssVar("--accent") || "#8ab4f8",
                    borderRadius: 4,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { color: cssVar("--secondary-foreground") } },
                    y: {
                        beginAtZero: true,
                        grid: { color: cssVar("--border") },
                        ticks: { color: cssVar("--secondary-foreground"), precision: 0 },
                    },
                },
            },
        });
    }

    // Recent table
    const body = document.getElementById("recentBody");
    const MAX_ROWS = 50;

    const appendRow = (v, atTop) => {
        const tr = el("tr");
        const time = el("td", "visit-time");
        time.textContent = timeOf(v.ts);
        const kind = el("td");
        kind.textContent = v.kind;
        const provider = el("td");
        if (v.provider) {
            provider.textContent = v.provider;
            provider.classList.add("provider-tag", v.provider);
        } else {
            provider.textContent = "–";
        }
        const client = el("td");
        client.textContent = v.client ?? "–";
        const status = el("td");
        status.textContent = String(v.status);
        if (v.status >= 400) status.classList.add("visit-error");
        const duration = el("td");
        duration.textContent = String(v.durationMs);
        tr.append(time, kind, provider, client, status, duration);
        if (atTop && body.firstChild) {
            body.insertBefore(tr, body.firstChild);
        } else {
            body.append(tr);
        }
        while (body.children.length > MAX_ROWS) body.lastChild.remove();
    };

    for (const visit of data.recent) appendRow(visit, false);

    // Live feed: rows land on top as they happen and the pure-count cards
    // tick up; the distinct-count cards resync on Refresh
    const dot = document.getElementById("liveDot");
    const source = new EventSource("/events");
    source.onopen = () => dot.classList.add("on");
    source.onerror = () => dot.classList.remove("on");
    source.addEventListener("visit", (ev) => {
        let visit;
        try {
            visit = JSON.parse(ev.data);
        } catch {
            return; // a malformed event is skipped; Refresh resyncs everything
        }
        appendRow(visit, true);
        if (visit.kind === "manifest" || visit.kind === "landing") {
            const id = `stat-${visit.kind}-today`;
            setText(id, Number(document.getElementById(id).textContent) + 1);
        }
    });

    document.getElementById("refreshBtn").addEventListener("click", () => location.reload());
})();
