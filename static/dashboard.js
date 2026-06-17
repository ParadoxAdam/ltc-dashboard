/* Dashboard widget - weekly check-in with adaptive triggers */

(function() {
  function computeTriggers(price, levels) {
    if (!levels) return [];
    return [
      {id:'T1', label:'Starter (market)', zone:[price*0.985, price*1.015], target:price, rationale:'Buy at market ±1.5%'},
      {id:'T2', label:'Support add', zone:[levels.absoluteLow*1.015, levels.absoluteLow*1.075], target:levels.absoluteLow*1.045, rationale:'1.5-7.5% above structural low'},
      {id:'T3', label:'Floor retest (heaviest)', zone:[levels.absoluteLow*0.985, levels.absoluteLow*1.015], target:levels.absoluteLow, rationale:'At proven low ±1.5%'},
      {id:'T4', label:'Range break', zone:[levels.rangeHigh*1.02, levels.rangeHigh*1.06], target:levels.rangeHigh*1.04, rationale:'Wkly close above 12-wk high'},
      {id:'T5', label:'Mid-resistance', zone:[levels.mid6moHigh*1.00, levels.mid6moHigh*1.04], target:levels.mid6moHigh*1.02, rationale:'Daily close above 26-wk high'},
      {id:'T6', label:'Year-high break', zone:[levels.yearHigh*1.00, levels.yearHigh*1.06], target:levels.yearHigh*1.03, rationale:'Monthly close above 52-wk high'},
      {id:'T7', label:'ATH approach', zone:[levels.ath*0.55, levels.ath*0.65], target:levels.ath*0.60, rationale:'Near 60% of ATH'}
    ].map(t => {
      let status = 'pending';
      if (price >= t.zone[0] && price <= t.zone[1]) status = 'in-zone';
      else if (price > t.zone[1]) status = 'passed';
      return {...t, status};
    });
  }

  function scoreConditions(price, levels, ratio, btcAth, btcPrice, dashboardState) {
    if (!levels) return null;
    const conditions = [];

    const weeks = Math.round(levels.weeksSinceLow);
    conditions.push({
      label: 'Base ≥ 22 weeks since structural low',
      score: weeks >= 22 ? 2 : weeks >= 15 ? 1 : 0,
      detail: `${weeks} weeks since $${levels.absoluteLow.toFixed(2)} low`
    });

    let capScore = 0, capDetail = 'Not detected';
    const mc = dashboardState.manualCapitulation || 'auto';
    if (mc === 'yes' || (mc === 'auto' && levels.capFlush)) {
      capScore = 2;
      capDetail = levels.capFlush
        ? `Auto-detected: ${(levels.capFlush.flushPct*100).toFixed(0)}% flush, ${(levels.capFlush.recovery*100).toFixed(0)}% recovery`
        : 'Manually confirmed';
    } else if (mc === 'partial') { capScore = 1; capDetail = 'Partial'; }
    else if (mc === 'no') { capScore = 0; capDetail = 'Not present'; }
    conditions.push({label: 'Capitulation flush', score: capScore, detail: capDetail});

    conditions.push({
      label: 'Range compression (4-wk avg)',
      score: levels.rangePct < 7 ? 2 : levels.rangePct < 12 ? 1 : 0,
      detail: `${levels.rangePct.toFixed(1)}% weekly range`
    });

    const btcOff = btcAth && btcPrice ? ((btcAth - btcPrice) / btcAth * 100) : null;
    conditions.push({
      label: 'BTC at/near ATH',
      score: btcOff == null ? 0 : btcOff < 5 ? 2 : btcOff < 15 ? 1 : 0,
      detail: btcOff != null ? `${btcOff.toFixed(1)}% from ATH $${(btcAth/1000).toFixed(0)}k` : 'BTC ATH unknown'
    });

    const weekly = window.App.live.weekly;
    const lastClose = weekly ? weekly[weekly.length-1].c : null;
    conditions.push({
      label: 'Recent weekly close > range high',
      score: lastClose == null ? 0 : lastClose > levels.rangeHigh ? 2 : lastClose > levels.rangeHigh*0.97 ? 1 : 0,
      detail: lastClose != null ? `$${lastClose.toFixed(2)} vs $${levels.rangeHigh.toFixed(2)}` : 'data not loaded'
    });

    conditions.push({
      label: 'LTC/BTC ratio rising 4+ wks',
      score: ratio.direction === 'rising' ? 2 : ratio.direction === 'flat' ? 1 : 0,
      detail: `${ratio.direction} (${(ratio.change*100).toFixed(1)}% / 4wk)`
    });

    return conditions;
  }

  function getTier(score) {
    if (score <= 3) return {tier:1, label:'Tier 1 · Early base', color:'#BA7517'};
    if (score <= 6) return {tier:2, label:'Tier 2 · Setup forming', color:'#185FA5'};
    if (score <= 9) return {tier:3, label:'Tier 3 · Trigger zone', color:'#7C3AC4'};
    return {tier:4, label:'Tier 4 · Parabolic active', color:'#1D9E75'};
  }

  function getAction(price, triggers, tier, levels, rsi) {
    const inZone = triggers.find(t => t.status === 'in-zone');
    if (inZone) return {
      headline: `FIRE ${inZone.id} — in trigger zone`,
      detail: `${inZone.label}: ${inZone.rationale}. Target ~$${inZone.target.toFixed(2)}.`
    };
    const approaching = triggers.find(t => {
      const dist = (t.zone[0] - price) / price;
      return dist > 0 && dist < 0.05;
    });
    if (approaching) return {
      headline: `WATCH ${approaching.id} — within 5%`,
      detail: `Zone $${approaching.zone[0].toFixed(2)}-$${approaching.zone[1].toFixed(2)}. Set alert.`
    };
    if (tier.tier >= 4 || (rsi && rsi >= 80)) return {
      headline: 'EXECUTE EXIT LADDER',
      detail: 'Parabolic conditions present. Take profits mechanically.'
    };
    if (levels && price < levels.absoluteLow * 0.95) return {
      headline: '⚠ BELOW STRUCTURAL LOW',
      detail: `Price below $${(levels.absoluteLow*0.95).toFixed(2)}. If monthly close confirms, exit.`
    };
    if (tier.tier === 1) return {
      headline: 'HOLD — base building',
      detail: 'No active triggers. Patience.'
    };
    return {
      headline: 'HOLD — between triggers',
      detail: 'Wait for next weekly candle close.'
    };
  }

  function getStrategy(tier, rsi) {
    if (tier.tier === 1) return {label:'Strategy C (balanced) — defer execution', focus:'Hold T1, wait for setup', reasoning:'Conditions not yet aligned.'};
    if (tier.tier === 2) return {label:'Strategy C (balanced ladder)', focus:'Fire T4-T5 on triggers', reasoning:'Setup forming. Balanced ladder hedges scenarios.'};
    if (tier.tier === 3) return {label:'Strategy A (hold + ride overshoot)', focus:'Fire T6-T7', reasoning:'Multiple conditions green. Parabolic likely.'};
    if (rsi && rsi >= 80) return {label:'Strategy A — watch for blow-off', focus:'Execute exits', reasoning:'RSI elevated.'};
    return {label:'Strategy A', focus:'Execute exit ladder', reasoning:'Parabolic active.'};
  }

  function getRiskFlags(price, levels, conditions, tier, rsi, dashboardState) {
    const flags = [];
    if (levels && price < levels.absoluteLow) flags.push({l:'critical', t:`Price $${price.toFixed(2)} below structural low $${levels.absoluteLow.toFixed(2)}`});
    if (rsi >= 90) flags.push({l:'critical', t:`Weekly RSI ${rsi.toFixed(0)} — historic top zone`});
    else if (rsi >= 85) flags.push({l:'warning', t:`Weekly RSI ${rsi.toFixed(0)} — exhaustion zone`});
    if (dashboardState.manualSentiment === 'euphoric') flags.push({l:'warning', t:'Sentiment euphoric — late-cycle indicator'});
    if (tier.tier >= 3 && conditions && conditions[3].score < 2) flags.push({l:'warning', t:'BTC weakness despite parabolic conditions'});
    const btcWeekly = window.App.live.btcWeekly;
    if (btcWeekly && btcWeekly.length > 60) {
      const btcLow60 = Math.min(...btcWeekly.slice(-60).map(w => w.l));
      if (window.App.live.btc < btcLow60 * 1.02) flags.push({l:'critical', t:'BTC near 60-week low — alt season cancelled'});
    }
    return flags;
  }

  function render() {
    const price = window.App.live.ltc;
    const weekly = window.App.live.weekly;
    const btcWeekly = window.App.live.btcWeekly;
    const btc = window.App.live.btc;
    const dashState = window.App.state.dashboard || {};

    const container = document.getElementById('panel-dashboard');
    if (!container) return;

    if (!price || !weekly) {
      container.innerHTML = '<div class="footnote">Loading live data…</div>';
      return;
    }

    const levels = window.computeLevels(weekly, price);
    const btcLevels = btcWeekly ? window.computeLevels(btcWeekly, btc) : null;
    const btcAth = btcLevels ? btcLevels.ath : null;
    const currentRatio = btc ? price / btc : null;
    const ratio = window.computeRatioTrend(weekly, btcWeekly, currentRatio);
    const conditions = scoreConditions(price, levels, ratio, btcAth, btc, dashState);
    const totalScore = conditions ? conditions.reduce((s, c) => s + c.score, 0) : 0;
    const tier = getTier(totalScore);
    const triggers = computeTriggers(price, levels);
    const rsi = levels?.rsi;
    const action = getAction(price, triggers, tier, levels, rsi);
    const strat = getStrategy(tier, rsi);
    const flags = getRiskFlags(price, levels, conditions, tier, rsi, dashState);

    container.innerHTML = `
      <div class="card-grid">
        <div class="card"><div class="metric-label">LTC/USD</div><div class="metric-value">${fmt$(price)}</div><div class="metric-sub" style="color: ${window.App.live.ltc24h>=0?'var(--success)':'var(--danger)'};">${window.App.live.ltc24h>=0?'+':''}${window.App.live.ltc24h.toFixed(2)}% 24h</div></div>
        <div class="card"><div class="metric-label">BTC/USD</div><div class="metric-value">${fmt$round(btc)}</div><div class="metric-sub" style="color: ${window.App.live.btc24h>=0?'var(--success)':'var(--danger)'};">${window.App.live.btc24h>=0?'+':''}${window.App.live.btc24h.toFixed(2)}% 24h</div></div>
        <div class="card"><div class="metric-label">LTC/BTC ratio</div><div class="metric-value">${currentRatio ? currentRatio.toFixed(6) : '—'}</div><div class="metric-sub" style="color: ${ratio.direction==='rising'?'var(--success)':ratio.direction==='falling'?'var(--danger)':'var(--warning)'};">${ratio.direction} · ${(ratio.change*100).toFixed(1)}% 4wk</div></div>
        <div class="card"><div class="metric-label">BTC from ATH</div><div class="metric-value">${btcAth ? ((btcAth-btc)/btcAth*100).toFixed(1) + '%' : '—'}</div><div class="metric-sub">ATH ${btcAth ? '$' + (btcAth/1000).toFixed(0) + 'k' : '—'}</div></div>
      </div>

      <div class="status-card" style="background: linear-gradient(135deg, ${tier.color}15 0%, ${tier.color}08 100%); border-left-color: ${tier.color};">
        <div style="display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 8px; margin-bottom: 6px;">
          <div style="font-size: 13px; font-weight: 500; color: ${tier.color};">${tier.label} · score ${totalScore}/12</div>
          <div style="font-size: 11px; color: var(--text-secondary);">Weekly RSI: ${rsi ? rsi.toFixed(1) : '—'}</div>
        </div>
        <div class="headline">${action.headline}</div>
        <div class="detail">${action.detail}</div>
      </div>

      <div class="section-title">Adaptive trigger zones <span class="hint">computed from live weekly structure</span></div>
      <div id="dash-triggers"></div>

      <div class="section-title">6-condition checklist <span class="hint">auto-scored</span></div>
      <div id="dash-conditions"></div>

      <details>
        <summary>Manual inputs (capitulation, sentiment)</summary>
        <div class="input-grid">
          <label>Capitulation flush
            <select id="dash-manualCapitulation">
              <option value="auto">Auto-detect</option>
              <option value="yes">Yes (override)</option>
              <option value="partial">Partial</option>
              <option value="no">No</option>
            </select>
          </label>
          <label>Sentiment
            <select id="dash-manualSentiment">
              <option value="dead">Dead</option>
              <option value="quiet">Quiet</option>
              <option value="rising">Rising</option>
              <option value="euphoric">Euphoric</option>
            </select>
          </label>
        </div>
      </details>

      <div class="section-title">Strategy recommendation</div>
      <div class="strategy-card">
        <div style="font-size: 13px; font-weight: 500; margin-bottom: 4px;">${strat.label}</div>
        <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">${strat.reasoning}</div>
        <div style="font-size: 11px; color: var(--text-tertiary); padding-top: 6px; border-top: 0.5px solid var(--border);">Focus: <strong style="color: var(--text);">${strat.focus}</strong></div>
      </div>

      <div class="section-title">Risk flags</div>
      <div id="dash-flags"></div>
    `;

    // Triggers
    const trList = document.getElementById('dash-triggers');
    triggers.forEach(t => {
      const sc = {'in-zone':'var(--success)','passed':'var(--info)','pending':'var(--text-tertiary)'};
      const labels = {'in-zone':'IN ZONE','passed':'passed','pending':'pending'};
      const dist = ((t.target - price) / price * 100);
      const row = document.createElement('div');
      row.className = 'item-row';
      if (t.status === 'in-zone') row.classList.add('item-status-zone');
      if (t.status === 'passed') row.classList.add('item-status-passed');
      row.innerHTML = `
        <div style="min-width:30px;font-weight:500;font-size:13px;">${t.id}</div>
        <div class="label">${t.label}<div class="sub">${t.rationale}</div></div>
        <div style="font-size:11px;text-align:right;">
          <div class="num">$${t.zone[0].toFixed(2)} – $${t.zone[1].toFixed(2)}</div>
          <div style="color:${dist>0?'var(--success)':'var(--danger)'};">${dist>=0?'+':''}${dist.toFixed(1)}%</div>
        </div>
        <div style="font-size:10px;color:${sc[t.status]};font-weight:500;min-width:80px;text-align:right;text-transform:uppercase;">${labels[t.status]}</div>
      `;
      trList.appendChild(row);
    });

    // Conditions
    const cList = document.getElementById('dash-conditions');
    if (conditions) conditions.forEach(c => {
      const labels = {2:'✓', 1:'⚠', 0:'✗'};
      const row = document.createElement('div');
      row.className = 'item-row item-score-' + c.score;
      row.innerHTML = `
        <span style="font-size:14px;font-weight:500;min-width:16px;color:${c.score===2?'var(--success)':c.score===1?'var(--warning)':'var(--danger)'};">${labels[c.score]}</span>
        <div class="label">${c.label}<div class="sub">${c.detail}</div></div>
        <span style="font-size:11px;color:var(--text-secondary);">${c.score}/2</span>
      `;
      cList.appendChild(row);
    });

    // Flags
    const fList = document.getElementById('dash-flags');
    if (flags.length === 0) {
      fList.innerHTML = '<div class="item-row" style="background: var(--success-bg); color: var(--text-secondary); font-size: 12px;">No active risk flags.</div>';
    } else {
      flags.forEach(f => {
        const row = document.createElement('div');
        row.className = 'item-row item-score-' + (f.l === 'critical' ? 0 : 1);
        row.style.fontSize = '12px';
        row.textContent = f.t;
        fList.appendChild(row);
      });
    }

    // Wire manual inputs
    const mc = document.getElementById('dash-manualCapitulation');
    const ms = document.getElementById('dash-manualSentiment');
    if (mc) mc.value = dashState.manualCapitulation || 'auto';
    if (ms) ms.value = dashState.manualSentiment || 'dead';

    if (mc) mc.addEventListener('change', () => {
      window.App.state.dashboard = window.App.state.dashboard || {};
      window.App.state.dashboard.manualCapitulation = mc.value;
      window.saveState();
      render();
    });
    if (ms) ms.addEventListener('change', () => {
      window.App.state.dashboard = window.App.state.dashboard || {};
      window.App.state.dashboard.manualSentiment = ms.value;
      window.saveState();
      render();
    });
  }

  window.App.callbacks.onLiveUpdate.push(render);
  document.addEventListener('DOMContentLoaded', () => { render(); });
})();
