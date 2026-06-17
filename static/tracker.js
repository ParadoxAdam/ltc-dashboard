/* Tracker widget - 50-lot pyramid tracker with DYNAMIC tranches
   - Tranche prices anchored to live structural levels (P1) and % of ATH (P2/P3)
   - Lot sizes auto-scale with start equity (£5k = 50 lots peak)
   - Phase 1 sizing weighted by live conviction (6-condition score)
   - Filled tranches lock their size/price at fill time; pending ones stay dynamic
*/

(function() {
  // Last computed structures, so handleClick reads the same values render drew
  let CURRENT_PHASES = [];
  let CURRENT_EXITS = [];

  const r1 = x => Math.round(x * 10) / 10;
  const r2 = x => Math.round(x * 100) / 100;
  const sumLots = arr => arr.reduce((s, t) => s + (t.lots || 0), 0);

  // ---- Dynamic tranche computation ----------------------------------------
  function computeTranches(price, levels, equity, conviction) {
    // Auto-scale: £5,000 -> 50 lots peak, linear with equity
    const totalLots = 50 * (equity / 5000);
    const p1Budget = totalLots * 0.20;   // 10 lots @ £5k
    const p2Budget = totalLots * 0.40;   // 20 lots @ £5k
    const p3Budget = totalLots * 0.40;   // 20 lots @ £5k

    // Structural levels with sane fallbacks if weekly not yet loaded
    const sl  = levels ? levels.absoluteLow : price * 0.85;
    const rh  = levels ? levels.rangeHigh   : price * 1.10;
    const m6  = levels ? levels.mid6moHigh  : price * 1.60;
    const yh  = levels ? levels.yearHigh    : price * 2.50;
    const ath = levels ? levels.ath         : price * 7.70;

    // Phase 1 — structural weights (sum = 1.0), modified by conviction.
    // T3 is heaviest: entry at the proven floor = best risk/reward.
    const p1defs = [
      {id:'t1', label:'T1 Starter',     wt:0.15, zone:[price*0.985, price*1.015], target:price,   trig:'Buy at market \u00b11.5%'},
      {id:'t2', label:'T2 Pullback',    wt:0.15, zone:[sl*1.04,  sl*1.08],        target:sl*1.06,  trig:'Wick to floor +4\u20138%'},
      {id:'t3', label:'T3 Floor',       wt:0.20, zone:[sl*0.985, sl*1.015],       target:sl,       trig:'At proven low \u00b11.5% (heaviest)'},
      {id:'t4', label:'T4 Range break', wt:0.15, zone:[rh*1.02,  rh*1.06],        target:rh*1.04,  trig:'Wkly close > 12-wk high'},
      {id:'t5', label:'T5 Trend',       wt:0.15, zone:[m6*1.00,  m6*1.04],        target:m6*1.02,  trig:'Daily close > 26-wk high'},
      {id:'t6', label:'T6 Year-high',   wt:0.15, zone:[yh*1.00,  yh*1.06],        target:yh*1.03,  trig:'Monthly close > 52-wk high'},
      {id:'t7', label:'T7 P2 bridge',   wt:0.05, zone:[ath*0.48, ath*0.52],       target:ath*0.50, trig:'50% of ATH \u2014 initiate pyramid'}
    ];
    const p1 = p1defs.map(t => ({
      id: t.id, label: t.label, trig: t.trig,
      zone: [r2(t.zone[0]), r2(t.zone[1])],
      target: r2(t.target),
      lots: r1(p1Budget * t.wt * conviction)
    }));

    // Phase 2 — ATH-anchored 60/65/70/75%, even split of P2 budget
    const p2pct = [0.60, 0.65, 0.70, 0.75];
    const p2 = p2pct.map((pct, i) => ({
      id: 't' + (8 + i),
      label: 'T' + (8 + i) + ' P2 add',
      trig: Math.round(pct * 100) + '% of ATH',
      zone: [r2(ath * (pct - 0.01)), r2(ath * (pct + 0.01))],
      target: r2(ath * pct),
      lots: r1(p2Budget / 4)
    }));

    // Phase 3 — ATH-anchored 80/85/90/95%, even split of P3 budget
    const p3pct = [0.80, 0.85, 0.90, 0.95];
    const p3 = p3pct.map((pct, i) => ({
      id: 't' + (12 + i),
      label: 'T' + (12 + i) + ' P3 add',
      trig: Math.round(pct * 100) + '% of ATH',
      zone: [r2(ath * (pct - 0.01)), r2(ath * (pct + 0.01))],
      target: r2(ath * pct),
      lots: r1(p3Budget / 4)
    }));

    return [
      {id:'p1', label:`P1 \u00b7 Build (${sumLots(p1).toFixed(1)} lots, structural)`, tranches:p1},
      {id:'p2', label:`P2 \u00b7 Pyramid (${sumLots(p2).toFixed(1)} lots, 60\u201375% ATH)`, tranches:p2},
      {id:'p3', label:`P3 \u00b7 Scale (${sumLots(p3).toFixed(1)} lots, 80\u201395% ATH)`, tranches:p3}
    ];
  }

  function computeExits(levels, equity, price) {
    const ath = levels ? levels.ath : price * 7.70;
    const totalLots = 50 * (equity / 5000);
    return [
      {id:'e1', label:'E1', lots:r1(totalLots*0.50), target:r2(ath),       note:'Sell 50% at ATH'},
      {id:'e2', label:'E2', lots:r1(totalLots*0.30), target:r2(ath*1.15),  note:'Sell 30% at +15% overshoot'},
      {id:'e3', label:'E3', lots:r1(totalLots*0.20), target:r2(ath*1.33),  note:'Trail final 20% to mania'}
    ];
  }

  // ---- Cost / position math ----------------------------------------------
  function calcSwap(t, cur, cfg, daysOverride) {
    if (!t.fillDate) return 0;
    const ov = parseFloat(daysOverride);
    const days = (!isNaN(ov) && ov > 0)
      ? ov
      : Math.max(0, (Date.now() - t.fillDate) / (1000*60*60*24));
    const lots = parseFloat(t.lots)||0, entry = parseFloat(t.price)||0;
    const avgP = (entry + cur) / 2;
    return (lots * avgP * 100 * (cfg.swapRate/100) / 360 * days) / cfg.fxRate;
  }

  function calcPos(state, cur) {
    const cfg = state.cfg;
    let totLots = 0, totCost = 0, swap = 0;
    CURRENT_PHASES.forEach(p => p.tranches.forEach(t => {
      const f = state.tranches[t.id];
      if (f && f.filled) {
        const l = parseFloat(f.lots)||0, p2 = parseFloat(f.price)||0;
        totLots += l; totCost += l * p2;
        swap += calcSwap(f, cur, cfg, state.daysOverride);
      }
    }));
    const avg = totLots > 0 ? totCost / totLots : 0;
    let exitLots = 0, realised = 0;
    CURRENT_EXITS.forEach(e => {
      const f = state.exits[e.id];
      if (f && f.filled) {
        const l = parseFloat(f.lots)||0, p2 = parseFloat(f.price)||0;
        exitLots += l;
        realised += l * (p2 - avg) * cfg.perLotPerDollar;
      }
    });
    return {totLots, openLots: Math.max(0, totLots - exitLots), avg, realised, swap};
  }

  // ---- Render -------------------------------------------------------------
  function render() {
    const container = document.getElementById('panel-tracker');
    if (!container) return;

    const ts = window.App.state.tracker = window.App.state.tracker || {
      ltc: 53.61, startEq: 5000, projDays: 365, daysOverride: '',
      tranches: {}, exits: {},
      cfg: {swapRate:25, perLotPerDollar:75, marginPerLot:90, spreadLot:8, commLot:0, fxRate:1.33}
    };

    const cur = window.App.live.ltc || ts.ltc;
    ts.ltc = cur;

    // Structural levels + conviction score
    const weekly = window.App.live.weekly;
    const btcWeekly = window.App.live.btcWeekly;
    const levels = weekly ? window.computeLevels(weekly, cur) : null;
    const btcLevels = btcWeekly ? window.computeLevels(btcWeekly, window.App.live.btc) : null;
    const dashState = window.App.state.dashboard || {};
    const cs = window.computeConditionScore(cur, levels, btcLevels, window.App.live.btc, dashState);

    // Compute dynamic structures
    CURRENT_PHASES = computeTranches(cur, levels, ts.startEq, cs.conviction);
    CURRENT_EXITS = computeExits(levels, ts.startEq, cur);

    const pos = calcPos(ts, cur);
    const upnl = pos.openLots * (cur - pos.avg) * ts.cfg.perLotPerDollar;
    let trCost = 0;
    CURRENT_PHASES.forEach(p => p.tranches.forEach(t => {
      const f = ts.tranches[t.id];
      if (f && f.filled) trCost += (parseFloat(f.lots)||0) * (ts.cfg.spreadLot + ts.cfg.commLot);
    }));
    const margin = pos.openLots * ts.cfg.marginPerLot;
    const tot = ts.startEq + pos.realised + upnl - pos.swap - trCost;
    const mult = tot / ts.startEq;
    const freeEq = tot - margin;
    const liqDist = pos.openLots > 0 ? freeEq / (pos.openLots * ts.cfg.perLotPerDollar) : 0;
    const liqP = pos.openLots > 0 ? cur - liqDist : null;

    const totalTarget = 50 * (ts.startEq / 5000);
    const convLabel = {0.70:'cautious', 0.85:'building', 1.0:'baseline', 1.15:'high'}[cs.conviction] || 'baseline';

    container.innerHTML = `
      <div class="card-grid" style="grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));">
        <div class="card"><div class="metric-label">LTC live</div><div class="metric-value">${fmt$(cur)}</div></div>
        <div class="card"><div class="metric-label">Lots open</div><div class="metric-value">${pos.openLots.toFixed(1)}</div></div>
        <div class="card"><div class="metric-label">Blended avg</div><div class="metric-value">${pos.avg > 0 ? fmt$(pos.avg) : '\u2014'}</div></div>
        <div class="card"><div class="metric-label">Net equity</div><div class="metric-value">${fmtGBP(tot)}</div></div>
        <div class="card"><div class="metric-label">Multiple</div><div class="metric-value" style="color:${mult>1.1?'var(--success)':mult<0.9?'var(--danger)':''};">${mult.toFixed(2)}x</div></div>
        <div class="card"><div class="metric-label">Unrealised</div><div class="metric-value" style="color:${pos.openLots>0?(upnl>=0?'var(--success)':'var(--danger)'):''};">${fmtGBPs(upnl)}</div></div>
        <div class="card"><div class="metric-label">Realised</div><div class="metric-value" style="color:${pos.realised>0?'var(--success)':pos.realised<0?'var(--danger)':''};">${fmtGBPs(pos.realised)}</div></div>
        <div class="card"><div class="metric-label">Swap accrued</div><div class="metric-value text-warning">\u2212${fmtGBP(pos.swap)}</div></div>
        <div class="card"><div class="metric-label">Liquidation</div><div class="metric-value" style="color:${liqP&&liqP>cur*0.85?'var(--danger)':'var(--success)'};">${liqP ? fmt$(liqP) : '\u2014'}</div></div>
      </div>

      <div class="item-row" style="background:var(--info-bg);border-left:3px solid var(--info);font-size:12px;">
        <div style="flex:1;">
          <div style="font-weight:500;margin-bottom:2px;">Dynamic sizing active</div>
          <div style="color:var(--text-secondary);">
            Target peak <strong>${totalTarget.toFixed(1)} lots</strong> (scaled from \u00a3${ts.startEq.toLocaleString()}) \u00b7
            Conviction <strong>${cs.conviction.toFixed(2)}x ${convLabel}</strong> (score ${cs.score}/12) \u00b7
            P1 flexes with conviction, P2/P3 fixed by equity \u00b7
            ATH anchor <strong>${levels ? fmt$(levels.ath) : '\u2014'}</strong>
          </div>
        </div>
      </div>

      <details>
        <summary>\u2699 Tracker settings (start equity, costs)</summary>
        <div class="input-grid">
          <label>Start equity (\u00a3) \u2014 scales lot sizes<input type="number" id="tr-startEq" value="${ts.startEq}" step="500" /></label>
          <label>Projection days<input type="number" id="tr-projDays" value="${ts.projDays}" step="30" /></label>
          <label>Days override (blank = auto)<input type="number" id="tr-daysOverride" value="${ts.daysOverride||''}" placeholder="auto" /></label>
          <label>Annual swap %<input type="number" id="tr-cfg-swapRate" value="${ts.cfg.swapRate}" step="0.5" /></label>
          <label>\u00a3/$/lot P&L<input type="number" id="tr-cfg-perLotPerDollar" value="${ts.cfg.perLotPerDollar}" step="1" /></label>
          <label>\u00a3/lot margin<input type="number" id="tr-cfg-marginPerLot" value="${ts.cfg.marginPerLot}" step="5" /></label>
          <label>\u00a3/lot spread RT<input type="number" id="tr-cfg-spreadLot" value="${ts.cfg.spreadLot}" step="0.5" /></label>
          <label>\u00a3/lot commission RT<input type="number" id="tr-cfg-commLot" value="${ts.cfg.commLot}" step="0.5" /></label>
          <label>GBP/USD<input type="number" id="tr-cfg-fxRate" value="${ts.cfg.fxRate}" step="0.01" /></label>
        </div>
      </details>

      <div id="tr-phases"></div>

      <div class="section-title">Exit ladder \u00b7 ATH-anchored</div>
      <div id="tr-exits"></div>

      <div class="footnote" id="tr-projection"></div>
    `;

    // Phases
    const phasesEl = document.getElementById('tr-phases');
    CURRENT_PHASES.forEach(ph => {
      const filled = ph.tranches.filter(t => ts.tranches[t.id]?.filled).length;
      const lots = ph.tranches.filter(t => ts.tranches[t.id]?.filled).reduce((s, t) => s + (parseFloat(ts.tranches[t.id].lots)||0), 0);
      const sec = document.createElement('div');
      sec.className = 'phase-section';
      sec.innerHTML = `
        <div class="phase-header">
          <span>${ph.label}</span>
          <span class="meta">${filled}/${ph.tranches.length} filled \u00b7 ${lots.toFixed(1)} lots in</span>
        </div>
        <div id="tr-ph-${ph.id}"></div>
      `;
      phasesEl.appendChild(sec);
      const list = document.getElementById('tr-ph-' + ph.id);
      ph.tranches.forEach(t => {
        const f = ts.tranches[t.id] || {};
        const fl = !!f.filled;
        const cur2 = cur;
        let zoneTag;
        if (!fl) {
          if (cur2 >= t.zone[0] && cur2 <= t.zone[1]) zoneTag = '<span class="badge success">in zone</span>';
          else if (cur2 > t.zone[1]) zoneTag = '<span class="badge info">passed</span>';
          else zoneTag = '<span class="badge muted">pending</span>';
        } else {
          zoneTag = '<span class="badge success">filled</span>';
        }
        let pnlHtml = '<span style="min-width:130px;"></span>';
        let dateInput = '';
        if (fl) {
          const gross = (cur2 - parseFloat(f.price)) * (parseFloat(f.lots)||0) * ts.cfg.perLotPerDollar;
          const sw = calcSwap(f, cur2, ts.cfg, ts.daysOverride);
          const net = gross - sw;
          const c = net >= 0 ? 'var(--success)' : 'var(--danger)';
          const ov = parseFloat(ts.daysOverride);
          const days = (!isNaN(ov) && ov > 0)
            ? ov
            : (f.fillDate ? Math.floor((Date.now() - f.fillDate) / (1000*60*60*24)) : 0);
          const daysLabel = days === 0 ? 'today' : days + 'd';
          pnlHtml = `<span style="font-size:11px;color:${c};min-width:130px;text-align:right;">${fmtGBPs(net)} <span style="color:var(--text-tertiary);font-size:10px;">(${daysLabel} \u00b7 sw \u00a3${Math.round(sw)})</span></span>`;
          if (f.fillDate) {
            const d = new Date(f.fillDate);
            const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            dateInput = `<input type="date" data-tid="${t.id}" data-field="fillDate" value="${dateStr}" title="Edit fill date (for backdating)" style="font-size:10px;padding:2px 4px;width:auto;" />`;
          }
        } else {
          const dist = ((t.target - cur2) / cur2 * 100);
          pnlHtml = `<span style="font-size:11px;color:var(--text-secondary);min-width:130px;text-align:right;">zone $${t.zone[0].toFixed(2)}\u2013$${t.zone[1].toFixed(2)} <span style="color:${dist>0?'var(--success)':'var(--danger)'};font-size:10px;">(${dist>=0?'+':''}${dist.toFixed(0)}%)</span></span>`;
        }
        const row = document.createElement('div');
        row.className = 'item-row';
        if (fl) row.classList.add('item-status-filled');
        else if (cur2 >= t.zone[0] && cur2 <= t.zone[1]) row.classList.add('item-status-zone');
        row.innerHTML = `
          <div class="label">${t.label} ${zoneTag}<div class="sub">${t.trig}</div></div>
          ${pnlHtml}
          <input type="number" data-tid="${t.id}" data-field="lots" value="${f.lots||''}" placeholder="${t.lots}" step="0.1" />
          <span style="font-size:10px;color:var(--text-tertiary);">@$</span>
          <input type="number" data-tid="${t.id}" data-field="price" value="${f.price||''}" placeholder="${t.target}" step="0.01" />
          ${dateInput}
          <button data-tid="${t.id}" data-action="${fl?'unfill':'fill'}">${fl?'undo':'fill'}</button>
        `;
        list.appendChild(row);
      });
    });

    // Exits
    const exitsEl = document.getElementById('tr-exits');
    CURRENT_EXITS.forEach(e => {
      const f = ts.exits[e.id] || {};
      const fl = !!f.filled;
      const reached = cur >= e.target;
      let projHtml = '<span style="min-width:90px;"></span>';
      if (!fl && pos.avg > 0) {
        projHtml = `<span style="font-size:11px;color:var(--text-secondary);min-width:90px;text-align:right;">proj ${fmtGBPk((e.target - pos.avg) * e.lots * ts.cfg.perLotPerDollar)}</span>`;
      } else if (fl) {
        const rr = (parseFloat(f.price) - pos.avg) * (parseFloat(f.lots)||0) * ts.cfg.perLotPerDollar;
        projHtml = `<span style="font-size:11px;color:${rr>=0?'var(--success)':'var(--danger)'};min-width:90px;text-align:right;">${fmtGBPs(rr)}</span>`;
      }
      const status = fl ? '<span class="badge success">sold</span>' : (reached ? '<span class="badge warning">target hit</span>' : '<span class="badge muted">pending</span>');
      const row = document.createElement('div');
      row.className = 'item-row';
      if (fl) row.classList.add('item-status-filled');
      row.innerHTML = `
        <div class="label">${e.label} \u00b7 ${e.lots} lots @ $${e.target} ${status}<div class="sub">${e.note}</div></div>
        ${projHtml}
        <input type="number" data-eid="${e.id}" data-field="lots" value="${f.lots||''}" placeholder="${e.lots}" step="0.1" />
        <span style="font-size:10px;color:var(--text-tertiary);">@$</span>
        <input type="number" data-eid="${e.id}" data-field="price" value="${f.price||''}" placeholder="${e.target}" step="0.01" />
        <button data-eid="${e.id}" data-action="${fl?'unsell':'sell'}">${fl?'undo':'sell'}</button>
      `;
      exitsEl.appendChild(row);
    });

    // Projection (dynamic ATH target & scaled lots)
    const pd = ts.projDays;
    const athTarget = levels ? levels.ath : cur * 7.70;
    const blendApprox = levels
      ? (levels.absoluteLow*0.3 + cur*0.25 + levels.rangeHigh*2*0.25 + levels.ath*0.6*0.2)
      : 140;
    const projSwap = (totalTarget*0.5 * (athTarget*0.5) * 100 * (ts.cfg.swapRate/100) / 360 * pd) / ts.cfg.fxRate;
    const projSpread = totalTarget * (ts.cfg.spreadLot + ts.cfg.commLot);
    const gross = totalTarget * (athTarget - blendApprox) * ts.cfg.perLotPerDollar;
    const net = gross - projSwap - projSpread;
    document.getElementById('tr-projection').innerHTML = `
      <div style="font-weight:500;margin-bottom:6px;color:var(--text);">Full-campaign projection (${totalTarget.toFixed(0)} lots, avg ~$${Math.round(blendApprox)} \u2192 ATH $${Math.round(athTarget)}, ${pd}d)</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;">
        <div><div style="font-size:10px;">Gross at ATH</div><div style="font-weight:500;color:var(--success);">+${fmtGBPk(gross)}</div></div>
        <div><div style="font-size:10px;">Proj swap</div><div style="font-weight:500;color:var(--warning);">\u2212${fmtGBPk(projSwap)}</div></div>
        <div><div style="font-size:10px;">Proj costs</div><div style="font-weight:500;color:var(--warning);">\u2212${fmtGBP(projSpread)}</div></div>
        <div><div style="font-size:10px;">Net</div><div style="font-weight:500;font-size:14px;color:var(--success);">+${fmtGBPk(net)}</div></div>
        <div><div style="font-size:10px;">Multiple on \u00a3${ts.startEq.toLocaleString()}</div><div style="font-weight:500;font-size:14px;">${(net/ts.startEq).toFixed(0)}x</div></div>
      </div>
    `;

    container.addEventListener('input', handleInput);
    container.addEventListener('click', handleClick);
  }

  function handleInput(e) {
    const ts = window.App.state.tracker;
    if (!ts) return;
    const id = e.target.id;
    if (id === 'tr-startEq') { ts.startEq = parseFloat(e.target.value) || 5000; window.saveState(); render(); return; }
    if (id === 'tr-projDays') { ts.projDays = parseFloat(e.target.value) || 365; window.saveState(); render(); return; }
    if (id === 'tr-daysOverride') { ts.daysOverride = e.target.value; window.saveState(); render(); return; }
    if (id && id.startsWith('tr-cfg-')) {
      const key = id.slice(7);
      if (ts.cfg.hasOwnProperty(key)) { ts.cfg[key] = parseFloat(e.target.value) || 0; window.saveState(); render(); return; }
    }
    const tid = e.target.dataset.tid, eid = e.target.dataset.eid, field = e.target.dataset.field;
    if (tid && field) {
      ts.tranches[tid] = ts.tranches[tid] || {};
      if (field === 'fillDate') {
        if (e.target.value) ts.tranches[tid].fillDate = new Date(e.target.value + 'T00:00:00').getTime();
      } else {
        ts.tranches[tid][field] = e.target.value;
      }
      window.saveState(); render();
    } else if (eid && field) {
      ts.exits[eid] = ts.exits[eid] || {};
      ts.exits[eid][field] = e.target.value;
      window.saveState(); render();
    }
  }

  function handleClick(e) {
    const ts = window.App.state.tracker;
    if (!ts) return;
    const tid = e.target.dataset.tid, eid = e.target.dataset.eid, act = e.target.dataset.action;
    const cur = window.App.live.ltc || ts.ltc;
    if (tid && act) {
      ts.tranches[tid] = ts.tranches[tid] || {};
      const all = CURRENT_PHASES.flatMap(p => p.tranches);
      const t = all.find(x => x.id === tid);
      if (act === 'fill') {
        if (!ts.tranches[tid].lots) ts.tranches[tid].lots = t ? t.lots : '';
        if (!ts.tranches[tid].price) ts.tranches[tid].price = cur.toFixed(2);
        ts.tranches[tid].filled = true;
        if (!ts.tranches[tid].fillDate) ts.tranches[tid].fillDate = Date.now();
      } else {
        ts.tranches[tid].filled = false;
      }
      window.saveState(); render();
    } else if (eid && act) {
      ts.exits[eid] = ts.exits[eid] || {};
      const ex = CURRENT_EXITS.find(x => x.id === eid);
      if (act === 'sell') {
        if (!ts.exits[eid].lots) ts.exits[eid].lots = ex ? ex.lots : '';
        if (!ts.exits[eid].price) ts.exits[eid].price = ex ? ex.target.toFixed(2) : cur.toFixed(2);
        ts.exits[eid].filled = true;
      } else {
        ts.exits[eid].filled = false;
      }
      window.saveState(); render();
    }
  }

  window.App.callbacks.onLiveUpdate.push(render);
  document.addEventListener('DOMContentLoaded', () => { render(); });
})();
