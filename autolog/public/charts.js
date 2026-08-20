/*
 * AutoLog — grafici SVG generati a mano. Nessuna libreria, nessuna CDN.
 * Regole: mai doppio asse Y, colore mai unica portante dell'informazione,
 * etichette numeriche solo su primo/ultimo/massimo/minimo.
 */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  function el(name, attrs, text) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function fmt(n, d) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return Number(n).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  /* Tooltip HTML condiviso: funziona con mouse e con il dito. */
  var tip = null;
  function ensureTip() {
    if (tip) return tip;
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.setAttribute('role', 'status');
    tip.style.cssText = 'position:fixed;z-index:80;pointer-events:none;display:none;' +
      'background:var(--text);color:var(--surface);padding:.35rem .55rem;border-radius:8px;' +
      'font-size:.82rem;line-height:1.3;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.3)';
    document.body.appendChild(tip);
    document.addEventListener('pointerdown', function (e) {
      if (!e.target.closest || !e.target.closest('.chart')) hideTip();
    });
    window.addEventListener('scroll', hideTip, true);
    return tip;
  }
  function showTip(x, y, html) {
    var t = ensureTip();
    t.innerHTML = html;
    t.style.display = 'block';
    var r = t.getBoundingClientRect();
    var left = Math.min(Math.max(6, x - r.width / 2), window.innerWidth - r.width - 6);
    var top = y - r.height - 12;
    if (top < 6) top = y + 16;
    t.style.left = left + 'px';
    t.style.top = top + 'px';
  }
  function hideTip() { if (tip) tip.style.display = 'none'; }

  function bindTip(node, htmlFn) {
    function show(e) {
      var r = node.getBoundingClientRect();
      showTip(r.left + r.width / 2, r.top, htmlFn());
      e.stopPropagation();
    }
    node.addEventListener('pointerenter', show);
    node.addEventListener('pointerdown', show);
    node.addEventListener('pointerleave', hideTip);
    node.setAttribute('tabindex', '0');
    node.addEventListener('focus', show);
    node.addEventListener('blur', hideTip);
  }

  function emptyState(message) {
    var p = document.createElement('p');
    p.className = 'empty';
    p.textContent = message;
    return p;
  }

  function niceTicks(min, max, count) {
    if (min === max) { min -= 1; max += 1; }
    var span = max - min;
    var step = Math.pow(10, Math.floor(Math.log10(span / count)));
    var err = span / count / step;
    if (err >= 7.5) step *= 10; else if (err >= 3.5) step *= 5; else if (err >= 1.5) step *= 2;
    var start = Math.floor(min / step) * step;
    var ticks = [];
    for (var v = start; v <= max + step / 2; v += step) ticks.push(Math.round(v / step) * step);
    return ticks;
  }

  function shortDate(iso) {
    if (!iso) return '';
    var p = String(iso).split('-');
    return p.length >= 3 ? p[2] + '/' + p[1] + '/' + p[0].slice(2) : iso;
  }

  function shortMonth(m) {
    var names = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
    var p = String(m).split('-');
    if (p.length < 2) return m;
    return names[Number(p[1]) - 1] + ' ' + p[0].slice(2);
  }

  /* ---------- grafico a linea ---------- */

  /*
   * points: [{label, value, tip}]
   * opts: {unit, decimals, average, averageLabel, emptyMessage, seriesName}
   */
  function lineChart(container, points, opts) {
    opts = opts || {};
    container.textContent = '';
    if (!points || points.length < 2) {
      container.appendChild(emptyState(opts.emptyMessage || 'Dati insufficienti per il grafico.'));
      return;
    }
    var W = 640, HGT = 260;
    var m = { t: 16, r: 14, b: 34, l: 52 };
    var iw = W - m.l - m.r, ih = HGT - m.t - m.b;
    var dec = opts.decimals === undefined ? 2 : opts.decimals;

    var values = points.map(function (p) { return p.value; });
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    if (opts.average !== null && opts.average !== undefined) {
      min = Math.min(min, opts.average); max = Math.max(max, opts.average);
    }
    var pad = (max - min) * 0.12 || Math.abs(max) * 0.1 || 1;
    var lo = min - pad, hi = max + pad;
    var ticks = niceTicks(lo, hi, 4);
    lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);

    var svg = el('svg', {
      viewBox: '0 0 ' + W + ' ' + HGT, class: 'chart',
      role: 'img', 'aria-label': (opts.seriesName || 'Serie') + ': ' + points.length + ' valori'
    });
    svg.style.width = '100%';

    var X = function (i) { return m.l + (points.length === 1 ? iw / 2 : i * iw / (points.length - 1)); };
    var Y = function (v) { return m.t + ih - (v - lo) / (hi - lo) * ih; };

    ticks.forEach(function (t) {
      var y = Y(t);
      if (y < m.t - 1 || y > m.t + ih + 1) return;
      svg.appendChild(el('line', { x1: m.l, y1: y, x2: m.l + iw, y2: y, stroke: 'var(--grid)', 'stroke-width': 1 }));
      svg.appendChild(el('text', {
        x: m.l - 8, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--text-2)'
      }, fmt(t, dec >= 2 ? 1 : dec)));
    });

    if (opts.average !== null && opts.average !== undefined) {
      var ya = Y(opts.average);
      svg.appendChild(el('line', {
        x1: m.l, y1: ya, x2: m.l + iw, y2: ya,
        stroke: 'var(--text-2)', 'stroke-width': 1.5, 'stroke-dasharray': '6 4'
      }));
      /* L'etichetta della media va in legenda, fuori dall'area del grafico:
         dentro si scontrerebbe con i punti o con le etichette dei valori. */
    }

    var d = points.map(function (p, i) { return (i ? 'L' : 'M') + X(i) + ' ' + Y(p.value); }).join(' ');
    svg.appendChild(el('path', {
      d: d, fill: 'none', stroke: 'var(--serie1)', 'stroke-width': 2,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round'
    }));

    var iMax = values.indexOf(max), iMin = values.indexOf(min);
    points.forEach(function (p, i) {
      var cx = X(i), cy = Y(p.value);
      svg.appendChild(el('circle', { cx: cx, cy: cy, r: 3, fill: 'var(--serie1)' }));
      var hit = el('circle', { cx: cx, cy: cy, r: 11, fill: 'transparent', style: 'cursor:pointer' });
      hit.appendChild(el('title', {}, p.label + ': ' + fmt(p.value, dec) + ' ' + (opts.unit || '')));
      bindTip(hit, function () {
        return '<b>' + fmt(p.value, dec) + ' ' + (opts.unit || '') + '</b><br>' + (p.tip || p.label);
      });
      svg.appendChild(hit);

      var showLabel = (i === 0 || i === points.length - 1 || i === iMax || i === iMin);
      if (showLabel) {
        svg.appendChild(el('text', {
          x: cx, y: cy - 10, 'text-anchor': i === 0 ? 'start' : (i === points.length - 1 ? 'end' : 'middle'),
          'font-size': 11, fill: 'var(--text)', 'font-weight': 600
        }, fmt(p.value, dec)));
      }
    });

    /* asse X: prima, ultima e una intermedia */
    var xIdx = points.length > 4 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : [0, points.length - 1];
    xIdx.forEach(function (i, k) {
      svg.appendChild(el('text', {
        x: X(i), y: HGT - 10, 'font-size': 11, fill: 'var(--text-2)',
        'text-anchor': k === 0 ? 'start' : (k === xIdx.length - 1 ? 'end' : 'middle')
      }, points[i].label));
    });

    container.appendChild(svg);

    if (opts.average !== null && opts.average !== undefined) {
      var legend = document.createElement('div');
      legend.className = 'chart-legend';
      legend.innerHTML =
        '<span><i class="swatch" style="background:var(--serie1)"></i> ' +
        (opts.seriesName || 'Serie') + '</span>' +
        '<span><i class="swatch dashed"></i> ' + (opts.averageLabel || 'media') + ' ' +
        fmt(opts.average, dec) + ' ' + (opts.unit || '') + '</span>';
      container.appendChild(legend);
    }
  }

  /* ---------- barre orizzontali ---------- */

  function barsHorizontal(container, items, opts) {
    opts = opts || {};
    container.textContent = '';
    if (!items || !items.length) {
      container.appendChild(emptyState(opts.emptyMessage || 'Nessun dato da mostrare.'));
      return;
    }
    var rowH = 30, W = 640;
    var m = { t: 8, r: 70, b: 8, l: 130 };
    var HGT = m.t + m.b + items.length * rowH;
    var iw = W - m.l - m.r;
    var max = Math.max.apply(null, items.map(function (i) { return Math.abs(i.value); })) || 1;

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + HGT, class: 'chart', role: 'img',
      'aria-label': opts.ariaLabel || 'Barre orizzontali' });
    svg.style.width = '100%';

    items.forEach(function (it, i) {
      var y = m.t + i * rowH + 4;
      var h = rowH - 12;
      var w = Math.max(2, Math.abs(it.value) / max * iw);
      svg.appendChild(el('text', {
        x: m.l - 10, y: y + h / 2 + 4, 'text-anchor': 'end', 'font-size': 12, fill: 'var(--text)'
      }, it.label.length > 16 ? it.label.slice(0, 15) + '…' : it.label));
      var rect = el('rect', {
        x: m.l, y: y, width: w, height: h, rx: 4, fill: 'var(--serie1)', style: 'cursor:pointer'
      });
      rect.appendChild(el('title', {}, it.label + ': ' + fmt(it.value, 2) + ' ' + (opts.unit || '')));
      bindTip(rect, function () {
        return '<b>' + it.label + '</b><br>' + fmt(it.value, 2) + ' ' + (opts.unit || '');
      });
      svg.appendChild(rect);
      svg.appendChild(el('text', {
        x: m.l + w + 8, y: y + h / 2 + 4, 'font-size': 12, fill: 'var(--text-2)'
      }, fmt(it.value, 0) + ' ' + (opts.unit || '')));
    });

    container.appendChild(svg);
  }

  /* ---------- barre verticali impilate (2 serie) ---------- */

  function barsStacked(container, rows, opts) {
    opts = opts || {};
    container.textContent = '';
    if (!rows || !rows.length) {
      container.appendChild(emptyState(opts.emptyMessage || 'Nessun dato da mostrare.'));
      return;
    }
    var W = 640, HGT = 280;
    var m = { t: 16, r: 14, b: 40, l: 52 };
    var iw = W - m.l - m.r, ih = HGT - m.t - m.b;
    var max = Math.max.apply(null, rows.map(function (r) { return (r.a || 0) + (r.b || 0); })) || 1;
    var ticks = niceTicks(0, max, 4);
    var hi = Math.max(max, ticks[ticks.length - 1]);

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + HGT, class: 'chart', role: 'img',
      'aria-label': opts.ariaLabel || 'Costi mensili' });
    svg.style.width = '100%';

    var Y = function (v) { return m.t + ih - v / hi * ih; };
    ticks.forEach(function (t) {
      var y = Y(t);
      svg.appendChild(el('line', { x1: m.l, y1: y, x2: m.l + iw, y2: y, stroke: 'var(--grid)', 'stroke-width': 1 }));
      svg.appendChild(el('text', { x: m.l - 8, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--text-2)' }, fmt(t, 0)));
    });

    var slot = iw / rows.length;
    var bw = Math.max(6, Math.min(38, slot * 0.62));

    rows.forEach(function (r, i) {
      var cx = m.l + slot * i + slot / 2;
      var x = cx - bw / 2;
      var a = r.a || 0, b = r.b || 0;
      var ya = Y(a), yb = Y(a + b);
      var gap = b > 0 && a > 0 ? 2 : 0;

      if (a > 0) {
        var r1 = el('rect', { x: x, y: ya, width: bw, height: Math.max(1, m.t + ih - ya),
          rx: b > 0 ? 0 : 4, fill: 'var(--serie1)', style: 'cursor:pointer' });
        r1.appendChild(el('title', {}, shortMonth(r.label) + ' — Carburante: ' + fmt(a, 2) + ' €'));
        bindTip(r1, function () {
          return '<b>' + shortMonth(r.label) + '</b><br>Carburante: ' + fmt(a, 2) + ' €<br>Altre spese: ' + fmt(b, 2) + ' €';
        });
        svg.appendChild(r1);
      }
      if (b > 0) {
        var h2 = Math.max(1, ya - yb - gap);
        var r2 = el('rect', { x: x, y: yb, width: bw, height: h2, rx: 4, fill: 'var(--serie2)', style: 'cursor:pointer' });
        r2.appendChild(el('title', {}, shortMonth(r.label) + ' — Altre spese: ' + fmt(b, 2) + ' €'));
        bindTip(r2, function () {
          return '<b>' + shortMonth(r.label) + '</b><br>Carburante: ' + fmt(a, 2) + ' €<br>Altre spese: ' + fmt(b, 2) + ' €';
        });
        svg.appendChild(r2);
      }
    });

    var step = Math.max(1, Math.ceil(rows.length / 6));
    rows.forEach(function (r, i) {
      if (i % step !== 0 && i !== rows.length - 1) return;
      svg.appendChild(el('text', {
        x: m.l + slot * i + slot / 2, y: HGT - 14, 'text-anchor': 'middle',
        'font-size': 11, fill: 'var(--text-2)'
      }, shortMonth(r.label)));
    });

    container.appendChild(svg);

    var legend = document.createElement('div');
    legend.className = 'chart-legend';
    legend.innerHTML =
      '<span><i class="swatch" style="background:var(--serie1)"></i> Carburante</span>' +
      '<span><i class="swatch" style="background:var(--serie2)"></i> Altre spese</span>';
    container.appendChild(legend);
  }

  global.AutoLogCharts = {
    lineChart: lineChart,
    barsHorizontal: barsHorizontal,
    barsStacked: barsStacked,
    shortDate: shortDate,
    shortMonth: shortMonth,
    fmt: fmt,
    hideTip: hideTip
  };
})(typeof self !== 'undefined' ? self : this);
