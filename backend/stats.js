// Numbers for the About page and per-profile health. Computed from the gallery record only:
// nothing is tracked beyond what Studio already keeps about its own outputs.

const dayKey = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const nextDay = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return dayKey(new Date(y, m - 1, d + 1));
};

export function galleryStats(items = [], now = new Date()) {
  // Earlier images shown from another folder (library.js) were not made here.
  const done = items.filter((item) => item?.status === "done" && !item.library);
  const days = new Map();
  const workflows = new Map();
  let renderMs = 0;
  let pixels = 0;
  let first = "";
  for (const item of done) {
    // A run's own time where it is known; older images only kept time since they were asked for.
    renderMs += Number(item.timing?.runMs || item.durationMs || item.elapsedMs) || 0;
    pixels += (Number(item.width) || 0) * (Number(item.height) || 0);
    const key = dayKey(item.createdAt);
    if (key) days.set(key, (days.get(key) || 0) + 1);
    if (item.createdAt && (!first || item.createdAt < first)) first = item.createdAt;
    const workflow = item.settings?.profileId || item.model || "";
    if (workflow) workflows.set(workflow, (workflows.get(workflow) || 0) + 1);
  }

  // Streaks count consecutive days with at least one finished output.
  const sorted = [...days.keys()].sort();
  let longest = 0;
  let run = 0;
  let previous = "";
  for (const key of sorted) {
    run = previous && nextDay(previous) === key ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = key;
  }
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  let current = 0;
  if (days.has(today) || days.has(yesterday)) {
    let cursor = days.has(today) ? today : yesterday;
    while (days.has(cursor)) {
      current += 1;
      const [y, m, d] = cursor.split("-").map(Number);
      cursor = dayKey(new Date(y, m - 1, d - 1));
    }
  }

  const [busiestDay = "", busiestCount = 0] =
    [...days.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  const [topWorkflow = "", topWorkflowCount = 0] =
    [...workflows.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  return {
    outputs: done.length,
    images: done.filter((item) => item.type !== "video").length,
    videos: done.filter((item) => item.type === "video").length,
    upscales: done.filter((item) => item.upscale?.url || item.upscale?.status === "done").length,
    renderMs,
    // As ComfyUI counts them, and the size menu: 1 MP is 1024 × 1024.
    megapixels: Math.round(pixels / (1024 * 1024)),
    firstAt: first,
    activeDays: days.size,
    currentStreak: current,
    longestStreak: longest,
    busiestDay,
    busiestCount,
    topWorkflow,
    topWorkflowCount,
  };
}

const dayMs = 86_400_000;

/**
 * Each profile's last 30 days: finished and failed runs (cancelled ones say nothing about the model),
 * how many finished ones were starred, the median run time, and `failing` when at least half of five
 * or more runs in the last week failed.
 */
export function profileStats(items = [], now = Date.now()) {
  const stats = new Map();
  for (const item of items) {
    const profile = item?.settings?.profileId;
    const at = Date.parse(item?.createdAt || "");
    if (!profile || item.library || !(now - at < 30 * dayMs)) continue;
    if (item.status !== "done" && item.status !== "failed") continue;
    const entry = stats.get(profile) || {
      runs: 0,
      failed: 0,
      starred: 0,
      times: [],
      week: 0,
      weekFailed: 0,
      lastAt: "",
    };
    entry.runs += 1;
    if (item.status === "failed") entry.failed += 1;
    else {
      if (item.favorite) entry.starred += 1;
      const ms = Number(item.timing?.runMs);
      if (ms > 0) entry.times.push(ms);
    }
    if (now - at < 7 * dayMs) {
      entry.week += 1;
      if (item.status === "failed") entry.weekFailed += 1;
    }
    if (item.createdAt > entry.lastAt) entry.lastAt = item.createdAt;
    stats.set(profile, entry);
  }
  return Object.fromEntries(
    [...stats].map(([profile, { times, week, weekFailed, ...entry }]) => {
      const sorted = times.sort((a, b) => a - b);
      return [
        profile,
        {
          ...entry,
          ...(sorted.length ? { medianRunMs: sorted[Math.floor(sorted.length / 2)] } : {}),
          failing: week >= 5 && weekFailed / week >= 0.5,
        },
      ];
    }),
  );
}
