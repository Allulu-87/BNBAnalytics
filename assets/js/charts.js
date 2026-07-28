/* BNB Analytics — SVG charts, no libraries.
   Mark specs per the data-viz reference: bars capped at 24px with a 4px
   rounded data-end square at the baseline, a 2px surface gap between
   adjacent bars, hairline solid gridlines, text in ink tokens (never the
   series color), a legend whenever there are 2+ series, and a table-view
   twin for every chart. */
window.App = window.App || {};

(function (App) {
  'use strict';

  var U = App.U;
  var C = {};

  var BAR_MAX = 24;      // never fill the band — leftover is air
  var BAR_GAP = 2;       // the surface gap does the separating
  var RADIUS = 4;        // rounded data-end
  var NS = 'http://www.w3.org/2000/svg';

  /* ── shared tooltip ───────────────────────────────────────────────────── */

  var tip = null;
  function tipEl() {
    if (!tip) {
      tip = U.el('div', { class: 'viz-tip', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(tip);
    }
    return tip;
  }

  function showTip(html, evt) {
    var t = tipEl();
    t.innerHTML = html;
    t.dataset.show = '1';
    var pad = 12;
    var r = t.getBoundingClientRect();
    var x = evt.clientX + pad, y = evt.clientY + pad;
    if (x + r.width > window.innerWidth - 4) x = evt.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 4) y = evt.clientY - r.height - pad;
    t.style.left = Math.max(4, x) + 'px';
    t.style.top = Math.max(4, y) + 'px';
  }

  function hideTip() { if (tip) tip.dataset.show = '0'; }
  document.addEventListener('scroll', hideTip, true);

  /* ── scales ───────────────────────────────────────────────────────────── */

  function niceStep(range, count) {
    if (!(range > 0)) return 1;
    var raw = range / Math.max(1, count);
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
    return step * mag;
  }

  /** Rounded domain that always includes zero, plus clean ticks. */
  function axis(min, max, count) {
    min = Math.min(0, min || 0);
    max = Math.max(0, max || 0);
    if (min === 0 && max === 0) max = 1;
    var step = niceStep(max - min, count || 4);
    var lo = Math.floor(min / step) * step;
    var hi = Math.ceil(max / step) * step;
    if (hi === lo) hi = lo + step;
    var ticks = [];
    for (var v = lo; v <= hi + step / 1000; v += step) ticks.push(U.round(v, 6));
    return { lo: lo, hi: hi, ticks: ticks };
  }

  /* ── mark geometry ────────────────────────────────────────────────────── */

  /** Column: rounded at the data-end, square where it meets the baseline. */
  function colPath(x, w, yTop, yBase) {
    var h = Math.abs(yBase - yTop);
    var r = Math.min(RADIUS, w / 2, h);
    if (h < 0.7) return '';                        // nothing to draw
    if (yTop <= yBase) {                           // grows up
      return 'M' + x + ',' + yBase +
        'L' + x + ',' + (yTop + r) +
        'Q' + x + ',' + yTop + ' ' + (x + r) + ',' + yTop +
        'L' + (x + w - r) + ',' + yTop +
        'Q' + (x + w) + ',' + yTop + ' ' + (x + w) + ',' + (yTop + r) +
        'L' + (x + w) + ',' + yBase + 'Z';
    }
    var yb = yTop;                                 // grows down (negative)
    return 'M' + x + ',' + yBase +
      'L' + x + ',' + (yb - r) +
      'Q' + x + ',' + yb + ' ' + (x + r) + ',' + yb +
      'L' + (x + w - r) + ',' + yb +
      'Q' + (x + w) + ',' + yb + ' ' + (x + w) + ',' + (yb - r) +
      'L' + (x + w) + ',' + yBase + 'Z';
  }

  /** Horizontal bar: rounded at the right data-end, square at the baseline. */
  function rowPath(y, h, xBase, xEnd) {
    var w = Math.abs(xEnd - xBase);
    var r = Math.min(RADIUS, h / 2, w);
    if (w < 0.7) return '';
    if (xEnd >= xBase) {
      return 'M' + xBase + ',' + y +
        'L' + (xEnd - r) + ',' + y +
        'Q' + xEnd + ',' + y + ' ' + xEnd + ',' + (y + r) +
        'L' + xEnd + ',' + (y + h - r) +
        'Q' + xEnd + ',' + (y + h) + ' ' + (xEnd - r) + ',' + (y + h) +
        'L' + xBase + ',' + (y + h) + 'Z';
    }
    return 'M' + xBase + ',' + y +
      'L' + (xEnd + r) + ',' + y +
      'Q' + xEnd + ',' + y + ' ' + xEnd + ',' + (y + r) +
      'L' + xEnd + ',' + (y + h - r) +
      'Q' + xEnd + ',' + (y + h) + ' ' + (xEnd + r) + ',' + (y + h) +
      'L' + xBase + ',' + (y + h) + 'Z';
  }

  function add(parent, tag, attrs) {
    var n = document.createElementNS(NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    parent.appendChild(n);
    return n;
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /* ── legend (identity is never color-alone) ───────────────────────────── */

  C.legend = function (series) {
    var wrap = U.el('div', { class: 'legend' });
    series.forEach(function (s) {
      wrap.appendChild(U.el('span', { class: 'legend-item' }, [
        U.el('span', { class: 'legend-swatch', style: 'background:' + s.color }),
        s.label
      ]));
    });
    return wrap;
  };

  /* ── grouped columns ──────────────────────────────────────────────────── */

  /**
   * @param {HTMLElement} host
   * @param {{labels:string[], tipLabels?:string[], series:Array<{label,color,values:number[]}>}} data
   */
  C.groupedColumns = function (host, data) {
    U.clear(host);
    var labels = data.labels || [];
    var series = data.series || [];
    if (!labels.length) {
      host.appendChild(U.el('div', { class: 'empty', text: 'No data in this range.' }));
      return;
    }

    var padL = 62, padR = 14, padT = 10, axisBand = 30;
    var plotH = 230;

    var nS = series.length;
    var avail = Math.max(320, host.clientWidth || host.parentNode.clientWidth || 720) - padL - padR;

    /* Size bars from the per-band budget, then cap the band itself: without the
       cap a two-month chart flings its groups to opposite edges; with it the
       plot stays compact and gets centred below. */
    var bandBudget = avail / labels.length;
    var barW = Math.max(4, Math.min(BAR_MAX, Math.floor((bandBudget - 10) / nS) - BAR_GAP));
    var groupW = nS * barW + (nS - 1) * BAR_GAP;
    var bandW = Math.floor(Math.min(Math.max(groupW + 10, bandBudget), groupW + 56));
    var plotW = bandW * labels.length;
    var W = padL + plotW + padR;
    var H = padT + plotH + axisBand;

    var min = 0, max = 0;
    series.forEach(function (s) {
      s.values.forEach(function (v) {
        if (v < min) min = v;
        if (v > max) max = v;
      });
    });
    // 5 target ticks, not 4 — 4 lands on coarse steps that leave the plot
    // with a third of its height empty above the tallest bar.
    var ax = axis(min, max, 5);
    var y = function (v) { return padT + plotH - ((v - ax.lo) / (ax.hi - ax.lo)) * plotH; };
    var yZero = y(0);

    var svg = add(host, 'svg', {
      width: W, height: H, viewBox: '0 0 ' + W + ' ' + H,
      role: 'img', 'aria-label': data.ariaLabel || 'Monthly chart'
    });
    svg.style.width = W + 'px';
    svg.style.height = H + 'px';
    svg.style.margin = '0 auto';   // centres a compact plot; no effect once it scrolls

    // gridlines — hairline, solid, recessive
    var grid = cssVar('--gridline'), baseline = cssVar('--baseline'), muted = cssVar('--text-muted');
    ax.ticks.forEach(function (t) {
      var yy = y(t);
      add(svg, 'line', {
        x1: padL, x2: padL + plotW, y1: yy, y2: yy,
        stroke: t === 0 ? baseline : grid, 'stroke-width': 1, 'shape-rendering': 'crispEdges'
      });
      add(svg, 'text', {
        x: padL - 8, y: yy + 3.5, 'text-anchor': 'end',
        fill: muted, 'font-size': 10.5, 'font-variant-numeric': 'tabular-nums'
      }).textContent = U.fmtNum(t, 0);
    });

    // marks
    labels.forEach(function (lab, i) {
      var bandX = padL + i * bandW;
      var gx = bandX + (bandW - groupW) / 2;

      series.forEach(function (s, si) {
        var v = s.values[i] || 0;
        var x = gx + si * (barW + BAR_GAP);
        var d = colPath(x, barW, y(v), yZero);
        if (d) add(svg, 'path', { d: d, fill: s.color });
      });

      // x-axis label; thin out when bands get tight
      var showEvery = bandW < 34 ? 3 : bandW < 46 ? 2 : 1;
      if (i % showEvery === 0 || i === labels.length - 1) {
        add(svg, 'text', {
          x: bandX + bandW / 2, y: padT + plotH + 15, 'text-anchor': 'middle',
          fill: muted, 'font-size': 10.5
        }).textContent = lab;
      }

      // one hover target per group — comfortably bigger than the marks
      var hit = add(svg, 'rect', {
        class: 'hit', x: bandX, y: padT, width: bandW, height: plotH + axisBand - 6,
        tabindex: 0, role: 'button',
        'aria-label': (data.tipLabels ? data.tipLabels[i] : lab)
      });
      var html = '<div class="tip-title">' + U.esc(data.tipLabels ? data.tipLabels[i] : lab) + '</div>' +
        series.map(function (s) {
          return '<div class="tip-row"><span class="k">' +
            '<span class="legend-swatch" style="background:' + s.color + '"></span>' +
            U.esc(s.label) + '</span><span class="v">' +
            U.fmtNum(s.values[i] || 0, 2) + '</span></div>';
        }).join('');
      hit.addEventListener('mouseenter', function (e) { showTip(html, e); });
      hit.addEventListener('mousemove', function (e) { showTip(html, e); });
      hit.addEventListener('mouseleave', hideTip);
      hit.addEventListener('focus', function (e) {
        var r = hit.getBoundingClientRect();
        showTip(html, { clientX: r.left + r.width / 2, clientY: r.top });
      });
      hit.addEventListener('blur', hideTip);
    });

    // baseline
    add(svg, 'line', {
      x1: padL, x2: padL + plotW, y1: yZero, y2: yZero,
      stroke: baseline, 'stroke-width': 1, 'shape-rendering': 'crispEdges'
    });
  };

  /* ── stacked columns ─────────────────────────────────────────────────────
     Composition of one total over time. Segments are separated by a 2px gap in
     the surface colour — never a stroke — and only the topmost segment carries
     the rounded data-end, so the stack still reads as one bar off the baseline. */

  /** One segment of a stack. Square unless it is the top of the stack. */
  function segPath(x, w, yTop, yBottom, roundTop) {
    var h = yBottom - yTop;
    if (h < 0.7) return '';
    var r = roundTop ? Math.min(RADIUS, w / 2, h) : 0;
    if (!r) {
      return 'M' + x + ',' + yTop + 'H' + (x + w) + 'V' + yBottom + 'H' + x + 'Z';
    }
    return 'M' + x + ',' + yBottom +
      'L' + x + ',' + (yTop + r) +
      'Q' + x + ',' + yTop + ' ' + (x + r) + ',' + yTop +
      'L' + (x + w - r) + ',' + yTop +
      'Q' + (x + w) + ',' + yTop + ' ' + (x + w) + ',' + (yTop + r) +
      'L' + (x + w) + ',' + yBottom + 'Z';
  }

  /**
   * @param {{labels:string[], tipLabels?:string[],
   *          series:Array<{label,color,values:number[]}>}} data
   */
  C.stackedColumns = function (host, data) {
    U.clear(host);
    var labels = data.labels || [];
    var series = data.series || [];
    if (!labels.length) {
      host.appendChild(U.el('div', { class: 'empty', text: 'Nothing recorded in this range.' }));
      return;
    }

    var padL = 62, padR = 14, padT = 10, axisBand = 30;
    var plotH = 240;

    var avail = Math.max(320, host.clientWidth || host.parentNode.clientWidth || 720) - padL - padR;
    var bandBudget = avail / labels.length;
    var barW = Math.max(3, Math.min(BAR_MAX, Math.floor(bandBudget - 8)));
    var bandW = Math.floor(Math.min(Math.max(barW + 8, bandBudget), barW + 44));
    var plotW = bandW * labels.length;
    var W = padL + plotW + padR;
    var H = padT + plotH + axisBand;

    var totals = labels.map(function (_, i) {
      return series.reduce(function (a, s) { return a + Math.max(0, s.values[i] || 0); }, 0);
    });
    var max = totals.reduce(function (a, v) { return v > a ? v : a; }, 0);
    var ax = axis(0, max, 5);
    var y = function (v) { return padT + plotH - ((v - ax.lo) / (ax.hi - ax.lo)) * plotH; };
    var yZero = y(0);

    var svg = add(host, 'svg', {
      width: W, height: H, viewBox: '0 0 ' + W + ' ' + H,
      role: 'img', 'aria-label': data.ariaLabel || 'Stacked chart'
    });
    svg.style.width = W + 'px';
    svg.style.height = H + 'px';
    svg.style.margin = '0 auto';

    var grid = cssVar('--gridline'), baseline = cssVar('--baseline'), muted = cssVar('--text-muted');
    ax.ticks.forEach(function (t) {
      var yy = y(t);
      add(svg, 'line', {
        x1: padL, x2: padL + plotW, y1: yy, y2: yy,
        stroke: t === 0 ? baseline : grid, 'stroke-width': 1, 'shape-rendering': 'crispEdges'
      });
      add(svg, 'text', {
        x: padL - 8, y: yy + 3.5, 'text-anchor': 'end',
        fill: muted, 'font-size': 10.5, 'font-variant-numeric': 'tabular-nums'
      }).textContent = U.fmtNum(t, 0);
    });

    var showEvery = Math.max(1, Math.ceil(40 / bandW));

    labels.forEach(function (lab, i) {
      var bandX = padL + i * bandW;
      var x = bandX + (bandW - barW) / 2;

      // which segments actually have a value — the last one gets the round top
      var drawn = [];
      series.forEach(function (s, si) {
        var v = Math.max(0, s.values[i] || 0);
        if (v > 0) drawn.push({ si: si, v: v, color: s.color });
      });

      var cum = 0;
      drawn.forEach(function (seg, di) {
        var isTop = di === drawn.length - 1;
        var yBottom = y(cum);
        var yTop = y(cum + seg.v);
        // 2px of surface between neighbours; the data end keeps its full height
        if (!isTop) yTop += BAR_GAP;
        var d = segPath(x, barW, yTop, yBottom, isTop);
        if (d) add(svg, 'path', { d: d, fill: seg.color });
        cum += seg.v;
      });

      if (i % showEvery === 0 || i === labels.length - 1) {
        add(svg, 'text', {
          x: bandX + bandW / 2, y: padT + plotH + 15, 'text-anchor': 'middle',
          fill: muted, 'font-size': 10.5
        }).textContent = lab;
      }

      var hit = add(svg, 'rect', {
        class: 'hit', x: bandX, y: padT, width: bandW, height: plotH + axisBand - 6,
        tabindex: 0, role: 'button',
        'aria-label': (data.tipLabels ? data.tipLabels[i] : lab) + ': ' + U.fmtMoney(totals[i], 2)
      });
      var html = '<div class="tip-title">' + U.esc(data.tipLabels ? data.tipLabels[i] : lab) + '</div>' +
        series.map(function (s) {
          var v = s.values[i] || 0;
          if (!v) return '';
          return '<div class="tip-row"><span class="k">' +
            '<span class="legend-swatch" style="background:' + s.color + '"></span>' +
            U.esc(s.label) + '</span><span class="v">' + U.fmtNum(v, 2) + '</span></div>';
        }).join('') +
        '<div class="tip-row" style="margin-top:.3rem;border-top:1px solid var(--gridline);padding-top:.3rem">' +
        '<span class="k">Total</span><span class="v">' + U.fmtNum(totals[i], 2) + '</span></div>';
      hit.addEventListener('mouseenter', function (e) { showTip(html, e); });
      hit.addEventListener('mousemove', function (e) { showTip(html, e); });
      hit.addEventListener('mouseleave', hideTip);
      hit.addEventListener('focus', function () {
        var r = hit.getBoundingClientRect();
        showTip(html, { clientX: r.left + r.width / 2, clientY: r.top });
      });
      hit.addEventListener('blur', hideTip);
    });

    add(svg, 'line', {
      x1: padL, x2: padL + plotW, y1: yZero, y2: yZero,
      stroke: baseline, 'stroke-width': 1, 'shape-rendering': 'crispEdges'
    });
  };

  /* ── ranked horizontal bars (single series) ───────────────────────────── */

  /**
   * One series → one color for every bar (never a value-ramp on categories).
   * Value labelled at the tip, which is the point of the chart.
   * @param {{items:Array<{label:string,value:number,sub?:string}>}} data
   */
  C.rankedBars = function (host, data) {
    U.clear(host);
    var items = (data.items || []).filter(function (i) { return i.value; });
    if (!items.length) {
      host.appendChild(U.el('div', { class: 'empty', text: 'Nothing recorded in this range.' }));
      return;
    }

    var color = data.color || cssVar('--series-1');
    var muted = cssVar('--text-muted'), grid = cssVar('--gridline'), ink = cssVar('--text-secondary');

    var rowH = 26, barH = Math.min(BAR_MAX, 16);
    var padT = 6, padB = 6;
    var labelW = 150, valueW = 92, padR = 8;
    var W = Math.max(320, host.clientWidth || host.parentNode.clientWidth || 640);
    var plotW = Math.max(80, W - labelW - valueW - padR);
    var H = padT + items.length * rowH + padB;

    var max = 0;
    items.forEach(function (i) { max = Math.max(max, Math.abs(i.value)); });
    var x = function (v) { return labelW + (max ? (v / max) * plotW : 0); };

    var svg = add(host, 'svg', {
      width: W, height: H, viewBox: '0 0 ' + W + ' ' + H,
      role: 'img', 'aria-label': data.ariaLabel || 'Breakdown chart'
    });
    svg.style.width = '100%';
    svg.style.maxWidth = W + 'px';
    svg.style.height = H + 'px';

    add(svg, 'line', {
      x1: labelW, x2: labelW, y1: padT, y2: padT + items.length * rowH,
      stroke: grid, 'stroke-width': 1, 'shape-rendering': 'crispEdges'
    });

    items.forEach(function (it, i) {
      var yTop = padT + i * rowH;
      var by = yTop + (rowH - barH) / 2;

      // category label — ink token, never the series color
      var t = add(svg, 'text', {
        x: labelW - 10, y: by + barH / 2 + 3.7, 'text-anchor': 'end',
        fill: ink, 'font-size': 11.5
      });
      t.textContent = it.label.length > 24 ? it.label.slice(0, 23) + '…' : it.label;

      var d = rowPath(by, barH, labelW, x(it.value));
      if (d) add(svg, 'path', { d: d, fill: color });

      // value at the tip
      add(svg, 'text', {
        x: Math.min(x(it.value) + 8, W - padR), y: by + barH / 2 + 3.7,
        fill: muted, 'font-size': 11, 'font-variant-numeric': 'tabular-nums'
      }).textContent = U.fmtNum(it.value, 2);

      var hit = add(svg, 'rect', {
        class: 'hit', x: 0, y: yTop, width: W, height: rowH,
        tabindex: 0, role: 'button', 'aria-label': it.label + ': ' + U.fmtMoney(it.value)
      });
      var html = '<div class="tip-title">' + U.esc(it.label) + '</div>' +
        '<div class="tip-row"><span class="k">Amount</span><span class="v">' +
        U.fmtMoney(it.value, 2) + '</span></div>' +
        (it.sub ? '<div class="tip-row"><span class="k">' + U.esc(it.sub) + '</span></div>' : '');
      hit.addEventListener('mouseenter', function (e) { showTip(html, e); });
      hit.addEventListener('mousemove', function (e) { showTip(html, e); });
      hit.addEventListener('mouseleave', hideTip);
      hit.addEventListener('focus', function () {
        var r = hit.getBoundingClientRect();
        showTip(html, { clientX: r.left + Math.min(r.width, 240), clientY: r.top });
      });
      hit.addEventListener('blur', hideTip);
    });
  };

  /** Build the table-view twin every chart is required to have. */
  C.table = function (head, rows, foot) {
    var t = U.el('table', { class: 'data' });
    var thead = U.el('thead');
    thead.appendChild(U.el('tr', null, head.map(function (h, i) {
      return U.el('th', { class: i ? 'num' : '', text: h });
    })));
    t.appendChild(thead);
    var tb = U.el('tbody');
    rows.forEach(function (r) {
      tb.appendChild(U.el('tr', null, r.map(function (c, i) {
        return U.el('td', { class: i ? 'num' : '', text: c });
      })));
    });
    t.appendChild(tb);
    if (foot) {
      var tf = U.el('tfoot');
      tf.appendChild(U.el('tr', null, foot.map(function (c, i) {
        return U.el('td', { class: i ? 'num' : '', text: c });
      })));
      t.appendChild(tf);
    }
    return U.el('div', { class: 'table-scroll' }, [t]);
  };

  C.colors = function () {
    return {
      s1: cssVar('--series-1'),
      s2: cssVar('--series-2'),
      s3: cssVar('--series-3'),
      s4: cssVar('--series-4')
    };
  };

  App.Charts = C;
})(window.App);
