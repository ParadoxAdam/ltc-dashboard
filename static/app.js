/* Shared utilities and state management */

// Global app state
window.App = {
  live: {
    ltc: null, ltc24h: 0, btc: null, btc24h: 0,
    weekly: null, btcWeekly: null,
    source: null, lastFetch: null, error: null
  },
  state: null,
  callbacks: { onLiveUpdate: [], onStateUpdate: [] }
};

// Formatters
window.fmt$ = v => v == null ? '—' : '$' + Number(v).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
window.fmt$round = v => v == null ? '—' : '$' + Math.round(Number(v)).toLocaleString();
window.fmtGBP = v => '£' + Math.round(v || 0).toLocaleString();
window.fmtGBPs = v => (v >= 0 ? '+' : '') + '£' + Math.round(v || 0).toLocaleString();
window.fmtGBPk = v => {
  const abs = Math.abs(v);
  if (abs >= 100000) return '£' + (v / 1000).toFixed(0) + 'k';
  if (abs >= 1000) return '£' + (v / 1000).toFixed(1) + 'k';
  return '£' + Math.round(v);
};
window.fmtPct = v => (v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%';

// API helpers
window.api = {
  async fetchPrices() {
    const r = await fetch('/api/prices');
    if (!r.ok) throw new Error('Prices API: ' + r.status);
    return await r.json();
  },
  async fetchWeekly() {
    const r = await fetch('/api/weekly');
    if (!r.ok) throw new Error('Weekly API: ' + r.status);
    return await r.json();
  },
  async fetchState() {
    const r = await fetch('/api/state');
    if (!r.ok) throw new Error('State API: ' + r.status);
    return await r.json();
  },
  async saveState(state) {
    const r = await fetch('/api/state', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(state)
    });
    if (!r.ok) throw new Error('Save state: ' + r.status);
    return await r.json();
  }
};

// State management with debounced save
let _saveTimer = null;
window.saveState = function() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    try {
      await window.api.saveState(window.App.state);
    } catch (e) {
      console.error('Save failed:', e);
    }
  }, 500);
};

// Live data refresh
window.refreshPrices = async function(silent = false) {
  if (!silent) {
    const dot = document.getElementById('live-dot');
    if (dot) dot.style.background = 'var(--warning)';
  }
  try {
    const prices = await window.api.fetchPrices();
    window.App.live.ltc = prices.ltc;
    window.App.live.ltc24h = prices.ltc24h;
    window.App.live.ltcHigh24h = prices.ltcHigh24h;
    window.App.live.ltcLow24h = prices.ltcLow24h;
    window.App.live.btc = prices.btc;
    window.App.live.btc24h = prices.btc24h;
    window.App.live.source = prices.source;
    window.App.live.lastFetch = new Date();
    window.App.live.error = null;
    updateLiveBanner();
    window.App.callbacks.onLiveUpdate.forEach(cb => { try { cb(); } catch(e) { console.error(e); } });
  } catch (e) {
    window.App.live.error = e.message;
    updateLiveBanner();
  }
};

window.refreshWeekly = async function() {
  try {
    const w = await window.api.fetchWeekly();
    window.App.live.weekly = w.ltc;
    window.App.live.btcWeekly = w.btc;
    window.App.callbacks.onLiveUpdate.forEach(cb => { try { cb(); } catch(e) { console.error(e); } });
  } catch (e) {
    console.error('Weekly fetch failed:', e);
  }
};

function updateLiveBanner() {
  const live = window.App.live;
  const banner = document.getElementById('status-banner');
  if (!banner) return;
  if (live.error) {
    banner.innerHTML = `<span style="color: var(--danger);">⚠ ${live.error}</span>`;
    return;
  }
  const time = live.lastFetch ? live.lastFetch.toLocaleTimeString() : '—';
  const ltcChgColor = live.ltc24h >= 0 ? 'var(--success)' : 'var(--danger)';
  const btcChgColor = live.btc24h >= 0 ? 'var(--success)' : 'var(--danger)';
  banner.innerHTML = `
    <span><span class="live-dot" id="live-dot"></span><strong>${fmt$(live.ltc)}</strong> LTC <span style="color: ${ltcChgColor};">${live.ltc24h>=0?'+':''}${live.ltc24h.toFixed(2)}%</span></span>
    <span><strong>${fmt$round(live.btc)}</strong> BTC <span style="color: ${btcChgColor};">${live.btc24h>=0?'+':''}${live.btc24h.toFixed(2)}%</span></span>
    <span>via ${live.source} · ${time}</span>
  `;
}

// Compute structural levels from weekly data
window.computeLevels = function(weekly, currentPrice) {
  if (!weekly || weekly.length < 20) return null;
  const recent60 = weekly.slice(-60);
  let lowest = recent60[0];
  recent60.forEach(w => { if (w.l < lowest.l) lowest = w; });
  const weeksSinceLow = (Date.now() - lowest.t) / (1000*60*60*24*7);

  const recent12 = weekly.slice(-12);
  const recent26 = weekly.slice(-26);
  const recent52 = weekly.slice(-52);

  const rangeLow = Math.min(...recent12.map(w => w.l));
  const rangeHigh = Math.max(...recent12.map(w => w.h));
  const mid6moHigh = Math.max(...recent26.map(w => w.h));
  const yearHigh = Math.max(...recent52.map(w => w.h));
  const ath = Math.max(...weekly.map(w => w.h));
  const absoluteLow = lowest.l;

  const recent4 = weekly.slice(-4);
  const avgRange = recent4.reduce((s, w) => s + (w.h - w.l), 0) / 4;
  const rangePct = (avgRange / currentPrice) * 100;

  // Weekly RSI (14)
  let rsi = null;
  if (weekly.length >= 15) {
    let gains = 0, losses = 0;
    for (let i = weekly.length - 14; i < weekly.length; i++) {
      const ch = weekly[i].c - weekly[i-1].c;
      if (ch > 0) gains += ch; else losses -= ch;
    }
    const avgGain = gains / 14;
    const avgLoss = losses / 14;
    rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  // Capitulation flush
  let capFlush = null;
  for (let i = 1; i < weekly.length; i++) {
    const w = weekly[i];
    const ph = weekly[i-1].h;
    const flushPct = (ph - w.l) / ph;
    const recovery = (w.c - w.l) / Math.max(w.h - w.l, 0.01);
    if (flushPct > 0.25 && recovery > 0.5) {
      capFlush = {date: w.t, low: w.l, flushPct, recovery};
    }
  }

  return {
    rangeLow, rangeHigh, mid6moHigh, yearHigh, ath, absoluteLow,
    weeksSinceLow, rangePct, rsi, capFlush
  };
};

// LTC/BTC ratio trend (4-week change)
window.computeRatioTrend = function(ltcWeekly, btcWeekly, currentRatio) {
  if (!ltcWeekly || !btcWeekly || ltcWeekly.length < 5 || btcWeekly.length < 5) {
    return {ratio: currentRatio, direction: 'unknown', change: 0};
  }
  // Align by index assuming same length and same intervals
  const minLen = Math.min(ltcWeekly.length, btcWeekly.length);
  const ltc = ltcWeekly.slice(-minLen);
  const btc = btcWeekly.slice(-minLen);
  if (ltc.length < 5) return {ratio: currentRatio, direction: 'unknown', change: 0};
  const ratioNow = currentRatio || (ltc[ltc.length-1].c / btc[btc.length-1].c);
  const ratio4 = ltc[ltc.length-5].c / btc[btc.length-5].c;
  const change = (ratioNow - ratio4) / ratio4;
  let direction = 'flat';
  if (change > 0.03) direction = 'rising';
  else if (change < -0.03) direction = 'falling';
  return {ratio: ratioNow, direction, change};
};

// Shared 6-condition score (0-12) and tier — used by dashboard AND tracker
window.computeConditionScore = function(price, levels, btcLevels, btc, dashState) {
  if (!levels) return {score: 0, tier: 1, conviction: 0.7};
  let score = 0;
  const ds = dashState || {};

  // 1. Base duration since structural low
  const weeks = Math.round(levels.weeksSinceLow);
  score += weeks >= 22 ? 2 : weeks >= 15 ? 1 : 0;

  // 2. Capitulation flush (auto-detect or manual override)
  const mc = ds.manualCapitulation || 'auto';
  if (mc === 'yes' || (mc === 'auto' && levels.capFlush)) score += 2;
  else if (mc === 'partial') score += 1;

  // 3. Range compression
  score += levels.rangePct < 7 ? 2 : levels.rangePct < 12 ? 1 : 0;

  // 4. BTC at/near ATH
  const btcAth = btcLevels ? btcLevels.ath : null;
  const btcOff = (btcAth && btc) ? ((btcAth - btc) / btcAth * 100) : null;
  score += btcOff == null ? 0 : btcOff < 5 ? 2 : btcOff < 15 ? 1 : 0;

  // 5. Recent weekly close > range high
  const weekly = window.App.live.weekly;
  const lastClose = weekly ? weekly[weekly.length - 1].c : null;
  score += lastClose == null ? 0 : lastClose > levels.rangeHigh ? 2 : lastClose > levels.rangeHigh * 0.97 ? 1 : 0;

  // 6. LTC/BTC ratio rising
  const ratio = window.computeRatioTrend(weekly, window.App.live.btcWeekly, (btc ? price / btc : null));
  score += ratio.direction === 'rising' ? 2 : ratio.direction === 'flat' ? 1 : 0;

  let tier = 1;
  if (score > 9) tier = 4;
  else if (score > 6) tier = 3;
  else if (score > 3) tier = 2;

  // Conviction multiplier for position sizing
  let conviction = 1.0;
  if (score <= 3) conviction = 0.70;
  else if (score <= 6) conviction = 0.85;
  else if (score <= 9) conviction = 1.0;
  else conviction = 1.15;

  return {score, tier, conviction};
};

// Tab switching
window.activateTab = function(tabId) {
  document.querySelectorAll('nav.tabs button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('section.tab-panel').forEach(s => {
    s.classList.toggle('active', s.id === 'panel-' + tabId);
  });
  localStorage.setItem('activeTab', tabId);
};

// Init
window.initApp = async function() {
  // Load state
  try {
    window.App.state = await window.api.fetchState();
  } catch (e) {
    console.error('State load failed:', e);
    window.App.state = {};
  }

  // Initial fetches
  await Promise.all([
    window.refreshPrices(),
    window.refreshWeekly()
  ]);

  // Auto-refresh prices every 30s
  setInterval(() => window.refreshPrices(true), 30000);
  // Auto-refresh weekly every 6 hours
  setInterval(() => window.refreshWeekly(), 6 * 3600 * 1000);

  // Restore active tab
  const tab = localStorage.getItem('activeTab') || 'dashboard';
  window.activateTab(tab);

  // Tab clicks
  document.querySelectorAll('nav.tabs button').forEach(btn => {
    btn.addEventListener('click', () => window.activateTab(btn.dataset.tab));
  });

  // Manual refresh
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = '⏳';
      await Promise.all([window.refreshPrices(), window.refreshWeekly()]);
      refreshBtn.disabled = false;
      refreshBtn.textContent = '↻';
    });
  }

  // Notify all widgets
  window.App.callbacks.onLiveUpdate.forEach(cb => { try { cb(); } catch(e) { console.error(e); } });
};
