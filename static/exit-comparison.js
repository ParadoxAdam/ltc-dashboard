/* Exit comparison widget - 4 strategies, what-if matrix */

(function() {
  const STRATEGIES = [
    {key:'A', label:'Hold + ride overshoot', color:'#1D9E75', desc:'50% @ $400, 30% @ $475, 20% @ $550',
     exits:[{price:400, lotsPct:0.50},{price:475, lotsPct:0.30},{price:550, lotsPct:0.20}]},
    {key:'B', label:'De-risk halfway', color:'#185FA5', desc:'50% @ $300, 50% @ $400',
     exits:[{price:300, lotsPct:0.50},{price:400, lotsPct:0.50}]},
    {key:'C', label:'Aggressive ladder', color:'#7C3AC4', desc:'30% @ $300, 30% @ $350, 40% @ $400',
     exits:[{price:300, lotsPct:0.30},{price:350, lotsPct:0.30},{price:400, lotsPct:0.40}]},
    {key:'D', label:'Conservative scale-out', color:'#BA7517', desc:'20% @ $200, $250, $300, $350, $400',
     exits:[{price:200, lotsPct:0.20},{price:250, lotsPct:0.20},{price:300, lotsPct:0.20},{price:350, lotsPct:0.20},{price:400, lotsPct:0.20}]}
  ];

  function adapt(state, livePrice) {
    const buildEndPrice = state.rangeHigh * 4;
    const buildPriceMid = (livePrice + buildEndPrice) / 2;
    const blendedAvg = state.structLow * 0.3 + livePrice * 0.25 + (state.rangeHigh * 2) * 0.25 + buildEndPrice * 0.2;
    return {
      bDays: 240,
      bLots: 25,
      bPrice: Math.round(buildPriceMid),
      peakLots: 50,
      avgEntry: Math.round(blendedAvg),
      latePace: 20
    };
  }

  function getCfg(state, livePrice) {
    const cfg = {
      swapRate: state.swapRate, fxRate: state.fxRate, spread: state.spread, startEq: state.startEq, peak: state.peakPrice
    };
    if (state.autoAdapt === 'yes') {
      Object.assign(cfg, adapt(state, livePrice));
    } else {
      cfg.bDays = state.bDays; cfg.bLots = state.bLots; cfg.bPrice = state.bPrice;
      cfg.peakLots = state.peakLots; cfg.avgEntry = state.avgEntry; cfg.latePace = state.latePace;
    }
    return cfg;
  }

  function segSwap(lots, p1, p2, days, cfg) {
    const avg = (p1+p2)/2;
    return (lots * avg * 100 * (cfg.swapRate/100) / 360 * days) / cfg.fxRate;
  }
  function daysFor(p1, p2, cfg) { return Math.abs(p2-p1)/50 * cfg.latePace; }

  function evaluate(strat, cfg, state) {
    const peak = cfg.peak;
    const startP = Math.max(state.rangeHigh * 4, 280);
    const exits = strat.exits.map(e => ({...e})).sort((a,b) => a.price - b.price);
    const buildSwap = cfg.bLots * cfg.bPrice * 100 * (cfg.swapRate/100) / 360 * cfg.bDays / cfg.fxRate;
    let lateSwap = 0, realised = 0, lotsHeld = cfg.peakLots, curP = startP;
    for (const ex of exits) {
      if (ex.price > peak) break;
      if (ex.price > curP) {
        lateSwap += segSwap(lotsHeld, curP, ex.price, daysFor(curP, ex.price, cfg), cfg);
      }
      const lts = Math.min(ex.lotsPct * cfg.peakLots, lotsHeld);
      realised += lts * (ex.price - cfg.avgEntry) * 75;
      lotsHeld -= lts;
      curP = Math.max(curP, ex.price);
    }
    let remainingValue = lotsHeld > 0 ? lotsHeld * (peak - cfg.avgEntry) * 75 : 0;
    if (curP < peak && lotsHeld > 0) {
      lateSwap += segSwap(lotsHeld, curP, peak, daysFor(curP, peak, cfg), cfg);
    }
    const trCost = cfg.peakLots * cfg.spread;
    const tot = realised + remainingValue;
    const net = tot - buildSwap - lateSwap - trCost;
    return {realised, remainingValue, gross:tot, swap: buildSwap+lateSwap, trCost, net, mult: net/cfg.startEq, exitsFired: exits.filter(e => e.price <= peak).length, exitsTotal: exits.length, lotsHeld};
  }

  function render() {
    const container = document.getElementById('panel-exit');
    if (!container) return;

    const livePrice = window.App.live.ltc;
    if (!livePrice) {
      container.innerHTML = '<div class="footnote">Loading live price…</div>';
      return;
    }

    const ec = window.App.state.exitComparison = window.App.state.exitComparison || {
      structLow: 45.11, rangeHigh: 59,
      autoAdapt: 'yes',
      peakPrice: 475,
      bDays: 240, bLots: 25, bPrice: 130,
      peakLots: 50, avgEntry: 140, latePace: 20,
      swapRate: 25, fxRate: 1.33, spread: 8, startEq: 5000
    };

    // Auto-update structural levels from weekly data if available
    const weekly = window.App.live.weekly;
    if (weekly && ec.autoAdapt === 'yes') {
      const levels = window.computeLevels(weekly, livePrice);
      if (levels) {
        ec.structLow = parseFloat(levels.absoluteLow.toFixed(2));
        ec.rangeHigh = parseFloat(levels.rangeHigh.toFixed(2));
      }
    }

    const cfg = getCfg(ec, livePrice);
    const adapted = adapt(ec, livePrice);
    const results = STRATEGIES.map(s => ({s, r: evaluate(s, cfg, ec)}));
    const maxNet = Math.max(...results.map(x => x.r.net));

    container.innerHTML = `
      <div class="card" style="margin-bottom:12px;">
        <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">Live LTC drives auto-adapted defaults</div>
        <div class="input-grid">
          <label>LTC live<input type="number" value="${livePrice.toFixed(2)}" disabled style="background:var(--bg-tertiary);" /></label>
          <label>Structural low ($)<input type="number" id="ec-structLow" value="${ec.structLow}" step="0.5" /></label>
          <label>Range high ($)<input type="number" id="ec-rangeHigh" value="${ec.rangeHigh}" step="0.5" /></label>
          <label>Auto-adapt?
            <select id="ec-autoAdapt">
              <option value="yes" ${ec.autoAdapt==='yes'?'selected':''}>Yes (recommended)</option>
              <option value="no" ${ec.autoAdapt==='no'?'selected':''}>No (manual)</option>
            </select>
          </label>
        </div>
      </div>

      ${ec.autoAdapt === 'yes' ? `
      <div class="item-row" style="background:var(--info-bg);border-left:3px solid var(--info);font-size:12px;">
        <div style="flex:1;">
          <div style="font-weight:500;margin-bottom:2px;">Auto-adapted from live $${livePrice.toFixed(2)}</div>
          <div style="color:var(--text-secondary);">Build avg: ~${adapted.bLots} lots @ $${adapted.bPrice} over ${adapted.bDays}d · Peak: ${adapted.peakLots} lots @ blended avg ~$${adapted.avgEntry}</div>
        </div>
      </div>` : ''}

      <details>
        <summary>⚙ Manual overrides (used if auto-adapt is off)</summary>
        <div class="input-grid">
          <label>Build days<input type="number" id="ec-bDays" value="${ec.bDays}" step="30" /></label>
          <label>Build avg lots<input type="number" id="ec-bLots" value="${ec.bLots}" step="1" /></label>
          <label>Build avg price<input type="number" id="ec-bPrice" value="${ec.bPrice}" step="10" /></label>
          <label>Peak lots<input type="number" id="ec-peakLots" value="${ec.peakLots}" step="1" /></label>
          <label>Blended avg<input type="number" id="ec-avgEntry" value="${ec.avgEntry}" step="5" /></label>
          <label>Days per $50<input type="number" id="ec-latePace" value="${ec.latePace}" step="5" /></label>
          <label>Swap %<input type="number" id="ec-swapRate" value="${ec.swapRate}" step="0.5" /></label>
          <label>GBP/USD<input type="number" id="ec-fxRate" value="${ec.fxRate}" step="0.01" /></label>
          <label>Spread £/lot<input type="number" id="ec-spread" value="${ec.spread}" step="0.5" /></label>
          <label>Start equity £<input type="number" id="ec-startEq" value="${ec.startEq}" step="500" /></label>
        </div>
      </details>

      <div class="card" style="margin-bottom:14px;">
        <label style="font-size:12px;">
          <span style="font-weight:500;">Actual peak price reached</span>
          <span style="color:var(--text-secondary);"> · drag to test outcomes $200 → $800</span>
          <div style="display:flex;align-items:center;gap:10px;margin-top:4px;">
            <input type="range" id="ec-peakPrice" min="200" max="800" step="10" value="${ec.peakPrice}" />
            <span id="ec-peakDisplay" style="font-size:15px;font-weight:500;min-width:70px;text-align:right;">$${ec.peakPrice}</span>
          </div>
        </label>
      </div>

      <div class="strategy-grid" id="ec-strategies"></div>

      <div class="section-title">What-if matrix · net £ across peak scenarios</div>
      <div style="overflow-x:auto;margin-bottom:14px;">
        <table id="ec-matrix"></table>
      </div>

      <div class="card" id="ec-recommendation"></div>
    `;

    // Strategy cards
    const sg = document.getElementById('ec-strategies');
    results.forEach(({s, r}) => {
      const isWin = r.net === maxNet;
      const c = document.createElement('div');
      c.className = 'strategy-card' + (isWin ? ' winner' : '');
      c.style.borderLeftColor = s.color;
      const exitsHtml = r.exitsFired === r.exitsTotal ? `<span class="text-success">all ${r.exitsTotal} exits fired</span>` : `<span class="text-warning">${r.exitsFired}/${r.exitsTotal} · ${r.lotsHeld.toFixed(0)} stuck</span>`;
      c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px;">
          <div style="font-size:12px;font-weight:500;color:${s.color};">${s.key} · ${s.label}</div>
          ${isWin?'<span class="badge success">winner</span>':''}
        </div>
        <div style="font-size:10px;color:var(--text-secondary);margin-bottom:6px;">${s.desc}</div>
        <div style="font-size:10px;color:var(--text-tertiary);margin-bottom:6px;">${exitsHtml}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:10px;margin-bottom:6px;">
          <div><div class="text-muted">Realised</div><div style="font-weight:500;">${fmtGBPk(r.realised)}</div></div>
          <div><div class="text-muted">Stuck</div><div style="font-weight:500;">${fmtGBPk(r.remainingValue)}</div></div>
          <div><div class="text-muted">Swap</div><div style="font-weight:500;color:var(--warning);">−${fmtGBPk(r.swap)}</div></div>
          <div><div class="text-muted">Costs</div><div style="font-weight:500;color:var(--warning);">−${fmtGBP(r.trCost)}</div></div>
        </div>
        <div style="padding-top:6px;border-top:0.5px solid var(--border);">
          <div class="text-muted" style="font-size:10px;">Net</div>
          <div style="font-size:17px;font-weight:500;color:${r.net>0?'var(--success)':'var(--danger)'};">${fmtGBPk(r.net)}</div>
          <div style="font-size:10px;color:var(--text-tertiary);">${r.mult.toFixed(0)}x</div>
        </div>
      `;
      sg.appendChild(c);
    });

    // What-if matrix
    const mt = document.getElementById('ec-matrix');
    const peaks = [250, 300, 350, 400, 475, 550];
    let h = '<thead><tr><th>Peak →</th>';
    peaks.forEach(p => h += `<th class="num">$${p}</th>`);
    h += '</tr></thead><tbody>';
    const peakResults = peaks.map(p => {
      const c = {...cfg, peak: p};
      return STRATEGIES.map(ss => evaluate(ss, c, ec).net);
    });
    STRATEGIES.forEach(s => {
      h += `<tr><td style="font-weight:500;color:${s.color};">${s.key}</td>`;
      peaks.forEach((p, pi) => {
        const c = {...cfg, peak: p};
        const r = evaluate(s, c, ec);
        const isBest = r.net === Math.max(...peakResults[pi]);
        h += `<td class="num" style="${isBest?'background:var(--success-bg);font-weight:500;':''}color:${r.net>0?(isBest?'var(--success)':''):'var(--danger)'};">${fmtGBPk(r.net)}</td>`;
      });
      h += '</tr>';
    });
    h += '</tbody>';
    mt.innerHTML = h;

    // Recommendation
    let rec;
    if (cfg.peak >= 475) rec = `<span class="text-success" style="font-weight:500;">Strategy A wins at $${cfg.peak}.</span> Hold for overshoot.`;
    else if (cfg.peak >= 380) rec = `<span class="text-info" style="font-weight:500;">Strategy B or C wins at $${cfg.peak}.</span> Take profit at $300, hold rest.`;
    else if (cfg.peak >= 280) rec = `<span style="color:var(--purple);font-weight:500;">Strategy C wins at $${cfg.peak}.</span> Scale out at $300.`;
    else if (cfg.peak >= 200) rec = `<span class="text-warning" style="font-weight:500;">Strategy D wins at $${cfg.peak}.</span> Aggressive scaling is the only path.`;
    else rec = `<span class="text-danger" style="font-weight:500;">All strategies underwater at $${cfg.peak}.</span>`;
    document.getElementById('ec-recommendation').innerHTML = `
      <div style="font-weight:500;margin-bottom:4px;">At your selected peak ($${cfg.peak}):</div>
      ${rec}
      <div class="text-muted" style="font-size:11px;margin-top:8px;">Adjust the slider above to stress-test different outcomes. The green cells in the matrix show the optimal strategy for each peak.</div>
    `;

    // Wire events
    container.addEventListener('input', handleInput);
  }

  function handleInput(e) {
    const ec = window.App.state.exitComparison;
    if (!ec) return;
    const id = e.target.id;
    if (id === 'ec-autoAdapt') { ec.autoAdapt = e.target.value; window.saveState(); render(); return; }
    if (id === 'ec-peakPrice') {
      ec.peakPrice = parseFloat(e.target.value) || 475;
      document.getElementById('ec-peakDisplay').textContent = '$' + ec.peakPrice;
      window.saveState(); render(); return;
    }
    const map = ['structLow','rangeHigh','bDays','bLots','bPrice','peakLots','avgEntry','latePace','swapRate','fxRate','spread','startEq'];
    map.forEach(k => {
      if (id === 'ec-' + k) {
        ec[k] = parseFloat(e.target.value) || 0;
        window.saveState();
        render();
      }
    });
  }

  window.App.callbacks.onLiveUpdate.push(render);
  document.addEventListener('DOMContentLoaded', () => { render(); });
})();
