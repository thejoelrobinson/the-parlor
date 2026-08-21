/* games/catan/view.js — Catan render layer (DOM only).
 * Loaded after games/catan/logic.js. Logic symbols arrive on
 * global.PARLOR['catan'].logic as L. No top-level DOM access.
 */
(function (global) {
  'use strict';

  var L = global.PARLOR['catan'].logic;

  function render(view, el, opts) {
    var s = view;
    var interactive = !!(opts && opts.interactive);
    el.innerHTML = '';

    var board = document.createElement('div');
    board.className = 'cat-board';

    var h;
    for (h = 0; h < 7; h++) {
      var hex = document.createElement('div');
      hex.className = 'cat-hex h' + h + ' t-' + (L.TERRAIN[h] || 'desert');
      var roll = document.createElement('span');
      roll.className = 'cat-roll';
      roll.textContent = L.ROLLS[h] ? String(L.ROLLS[h]) : '';
      hex.appendChild(roll);
      var tlab = document.createElement('span');
      tlab.className = 'cat-tlabel';
      tlab.textContent = L.TERRAIN[h] || 'desert';
      hex.appendChild(tlab);
      board.appendChild(hex);
    }

    var siteEls = [];
    for (var v = 0; v < 12; v++) {
      (function (v) {
        var b = document.createElement('button');
        var cls = 'cat-site s' + v;
        var o = s.sites[v];
        if (o) cls += o.p === 0 ? ' p0' : ' p1';
        if (o && o.city) cls += ' city';
        if (interactive) {
          var r = s.res[s.turn];
          var mine = o && o.p === s.turn;
          if (!o && L.owned(s, s.turn) < 3 && L.canAfford(r, L.BUILD_COST)) {
            cls += ' can';
            b.addEventListener('click', function () { opts.onMove({ type: 'build', v: v }); });
          } else if (mine && !o.city && r[0] >= 2 && r[3] >= 2) {
            cls += ' city-can';
            b.addEventListener('click', function () { opts.onMove({ type: 'city', v: v }); });
          }
        }
        b.className = cls;
        b.setAttribute('data-v', String(v));
        b.type = 'button';
        siteEls.push(b);
        board.appendChild(b);
      })(v);
    }
    el.appendChild(board);

    var bar = document.createElement('div');
    bar.className = 'cat-bar';
    for (var gv = 0; gv < 4; gv++) {
      for (var tv = 0; tv < 4; tv++) {
        if (tv === gv) continue;
        (function (gv, tv) {
          var tb = document.createElement('button');
          var can = interactive && s.res[s.turn][gv] >= 3;
          tb.className = 'cat-trade' + (can ? ' can' : '');
          tb.textContent = '3' + L.RSHORT[gv] + '→1' + L.RSHORT[tv];
          tb.type = 'button';
          if (can) tb.addEventListener('click', function () { opts.onMove({ type: 'trade', give: gv, get: tv }); });
          bar.appendChild(tb);
        })(gv, tv);
      }
    }
    var end = document.createElement('button');
    end.className = 'cat-end' + (interactive ? ' can' : '');
    end.textContent = 'End turn';
    end.type = 'button';
    if (interactive) end.addEventListener('click', function () { opts.onMove({ type: 'end' }); });
    bar.appendChild(end);
    el.appendChild(bar);

    /* FX: derive a one-shot event from the diff against the previous render. */
    var curSites = [];
    for (var c = 0; c < 12; c++) {
      var o2 = s.sites[c];
      curSites.push(o2 ? (o2.p === 0 ? '0' : '1') + (o2.city ? 'C' : 'S') : '');
    }
    var resJson = JSON.stringify(s.res);
    var fx = [];
    var prev = el.__prev;
    if (prev) {
      var sitesChanged = false;
      for (c = 0; c < 12; c++) {
        if (prev.sites[c] !== curSites[c]) {
          sitesChanged = true;
          fx.push({ t: 'move', el: siteEls[c] });
        }
      }
      if (!sitesChanged && prev.turn !== s.turn) fx.push({ t: 'phase' });
      else if (!sitesChanged && prev.resJson !== resJson) fx.push({ t: 'deal' });
    }
    UI.events(el, fx); // fresh array every render; consumed once by pumpEvents
    el.__prev = s.over === null ? { sites: curSites, turn: s.turn, resJson: resJson } : null;
  }

  function renderInfo(view, el, opts) {
    el.innerHTML = '';
    for (var p = 0; p < 2; p++) {
      var row = document.createElement('div');
      row.className = 'player-row' + (view.over === null && view.turn === p ? ' active' : '');
      var nm = document.createElement('span');
      nm.className = 'pr-name';
      nm.textContent = (opts && String(opts.mySide) === String(p) ? 'You — ' : '') + L.sideName(p);
      row.appendChild(nm);
      var r = view.res[p];
      var meta = document.createElement('span');
      meta.className = 'pr-meta';
      meta.textContent = 'W' + r[0] + ' L' + r[1] + ' B' + r[2] + ' O' + r[3] + ' · ' + L.vp(view, p) + ' VP';
      row.appendChild(meta);
      el.appendChild(row);
    }
    if (view.last) {
      var last = document.createElement('div');
      last.className = 'cat-last';
      var parts = [];
      for (var i = 0; i < 4; i++) if (view.last.made[i]) parts.push('+' + view.last.made[i] + ' ' + L.RNAMES[i]);
      last.textContent = 'Roll ' + view.last.a + '+' + view.last.b + '=' + (view.last.a + view.last.b) +
        (parts.length ? ' → ' + parts.join(', ') : ' → nothing');
      el.appendChild(last);
    }
  }

  global.PARLOR = global.PARLOR || {};
  global.PARLOR['catan'] = global.PARLOR['catan'] || {};
  global.PARLOR['catan'].view = { render: render, renderInfo: renderInfo };
})(typeof window !== 'undefined' ? window : globalThis);
