/* games/catan/view.js \u2014 Catan render layer (DOM only).
 * Loaded after games/catan/logic.js. Logic symbols arrive on
 * global.PARLOR['catan'].logic as L. No top-level DOM access.
 *
 * The full 19-hex board is drawn with absolutely-positioned divs:
 *  - 19 hex tiles (clip-path pointy-top) with terrain + number token
 *  - one road bar per owned edge, rotated to its edge angle
 *  - one <button class="cat-site"> at every vertex (54) \u2014 empty /
 *    settlement / city, plus the buildable affordances (.can / .city-can)
 *  - a robber marker, a dice readout, and an action bar (20 four-for-one
 *    trades + end turn)
 * Clickable affordances are taken straight from L.legalMoves so the DOM can
 * never offer a move the logic would reject.
 */
(function (global) {
  'use strict';

  var L = global.PARLOR['catan'].logic;

  var NH = L.NH, NV = L.NV, NE = L.NE;
  var S = L.S;
  var HW = L.SQ3 * S;   // hex width (flat-to-flat)
  var HH = 2 * S;       // hex height (point-to-point)
  var CW = 380, CH = 360;
  var CX = CW / 2, CY = CH / 2;

  function at(x, y) { return [x + CX, y + CY]; }
  // safe inline-style setter: the click-test DOM stub has no .style object,
  // the browser does. Creating one when absent is harmless for the stub.
  function sty(el, k, v) { if (!el.style) el.style = {}; el.style[k] = v; }

  function render(view, el, opts) {
    var s = view;
    var interactive = !!(opts && opts.interactive);
    var me = (opts && opts.mySide != null) ? String(opts.mySide) : '0';
    el.innerHTML = '';

    /* which of the human's legal moves are buildable, by vertex */
    var siteMove = {}, tradeMove = {}, canEnd = false;
    if (interactive && s.over === null) {
      var moves = L.legalMoves(s, me);
      for (var i = 0; i < moves.length; i++) {
        var mv = moves[i];
        if (mv.type === 'setup' || mv.type === 'settle' || mv.type === 'city') siteMove[mv.type + ':' + mv.v] = mv;
        else if (mv.type === 'trade') tradeMove[mv.give + ':' + mv.get] = mv;
        else if (mv.type === 'end') canEnd = true;
      }
    }

    var board = document.createElement('div');
    board.className = 'cat-board';

    var island = document.createElement('div');
    island.className = 'cat-island';
    island.setAttribute('aria-hidden', 'true');
    board.appendChild(island);

    /* hexes */
    var h;
    for (h = 0; h < NH; h++) {
      var ter = s.terrain[h];
      var hex = document.createElement('div');
      hex.className = 'cat-hex h' + h + ' t-' + L.TERRAIN[ter];
      var hp = at(L.HEX_POS[h][0], L.HEX_POS[h][1]);
      sty(hex, 'left', hp[0] + 'px');
      sty(hex, 'top', hp[1] + 'px');
      sty(hex, 'width', HW + 'px');
      sty(hex, 'height', HH + 'px');
      var icon = document.createElement('span');
      icon.className = 'cat-hicon';
      icon.textContent = L.TERRAIN_ICON[ter];
      hex.appendChild(icon);
      if (s.numbers[h]) {
        var tok = document.createElement('span');
        tok.className = 'cat-num';
        tok.textContent = String(s.numbers[h]);
        hex.appendChild(tok);
      }
      board.appendChild(hex);
    }

    /* roads */
    for (var e = 0; e < NE; e++) {
      if (s.roads[e] == null) continue;
      var road = document.createElement('div');
      road.className = 'cat-road p' + s.roads[e];
      var mid = at(L.EDGE_MID[e][0], L.EDGE_MID[e][1]);
      sty(road, 'left', mid[0] + 'px');
      sty(road, 'top', mid[1] + 'px');
      sty(road, 'transform', 'translate(-50%,-50%) rotate(' + L.EDGE_ANGLE[e] + 'deg)');
      board.appendChild(road);
    }

    /* sites (one button per vertex) */
    var siteEls = [];
    for (var v = 0; v < NV; v++) {
      var o = s.sites[v];
      var b = document.createElement('button');
      var cls = 'cat-site s' + v;
      var click = null;
      if (o) cls += ' p' + o.p + (o.city ? ' city' : '');
      if (interactive && s.over === null) {
        var cand = siteMove['setup:' + v] || siteMove['settle:' + v] || siteMove['city:' + v];
        if (cand) {
          cls += (cand.type === 'city') ? ' city-can' : ' can';
          click = cand;
        }
      }
      b.className = cls;
      b.type = 'button';
      var lab = 'Site ' + (v + 1) + ': ' +
        (o ? L.sideName(String(o.p)) + (o.city ? ' city' : ' settlement') : 'empty');
      b.setAttribute('aria-label', lab);
      var vp = at(L.VERTEX[v][0], L.VERTEX[v][1]);
      sty(b, 'left', vp[0] + 'px');
      sty(b, 'top', vp[1] + 'px');
      if (click) (function (m) { b.addEventListener('click', function () { opts.onMove(m); }); })(click);
      siteEls.push(b);
      board.appendChild(b);
    }

    /* robber marker (which hex it sits on) */
    if (s.robber != null) {
      var rp = at(L.HEX_POS[s.robber][0], L.HEX_POS[s.robber][1]);
      var rob = document.createElement('div');
      rob.className = 'cat-robber';
      sty(rob, 'left', rp[0] + 'px');
      sty(rob, 'top', rp[1] + 'px');
      rob.textContent = '\u{1F575}\u{FE0F}';
      board.appendChild(rob);
    }

    /* dice readout */
    var dice = document.createElement('div');
    dice.className = 'cat-dice';
    if (s.last) {
      if (el.__prev && el.__prev.turn !== s.turn) dice.className += ' roll';
      var d1 = document.createElement('span'); d1.className = 'cat-die'; d1.setAttribute('data-n', String(s.last.a));
      var d2 = document.createElement('span'); d2.className = 'cat-die'; d2.setAttribute('data-n', String(s.last.b));
      var dsum = document.createElement('span'); dsum.className = 'cat-dsum'; dsum.textContent = String(s.last.a + s.last.b);
      dice.appendChild(d1); dice.appendChild(d2); dice.appendChild(dsum);
      dice.setAttribute('aria-label', 'Last roll ' + s.last.a + ' plus ' + s.last.b + ' = ' + (s.last.a + s.last.b));
    } else {
      dice.textContent = '?';
      dice.setAttribute('aria-label', 'No roll yet');
    }
    board.appendChild(dice);
    el.appendChild(board);

    /* action bar */
    var bar = document.createElement('div');
    bar.className = 'cat-bar';
    for (var g = 0; g < 5; g++) {
      for (var t = 0; t < 5; t++) {
        if (t === g) continue;
        (function (g, t) {
          var tb = document.createElement('button');
          var can = interactive && s.over === null && !!tradeMove[g + ':' + t];
          tb.className = 'cat-trade' + (can ? ' can' : '');
          tb.textContent = '4' + L.RSHORT[g] + '\u2192' + '1' + L.RSHORT[t];
          tb.setAttribute('aria-label', 'Trade 4 ' + L.RNAMES[g] + ' for 1 ' + L.RNAMES[t]);
          tb.type = 'button';
          if (can) {
            var m2 = tradeMove[g + ':' + t];
            tb.addEventListener('click', function () { opts.onMove(m2); });
          }
          bar.appendChild(tb);
        })(g, t);
      }
    }
    var end = document.createElement('button');
    end.className = 'cat-end' + (interactive && s.over === null && canEnd ? ' can' : '');
    end.textContent = 'End turn';
    end.setAttribute('aria-label', 'End turn, roll the dice and collect production');
    end.type = 'button';
    if (interactive && s.over === null && canEnd) end.addEventListener('click', function () { opts.onMove({ type: 'end' }); });
    bar.appendChild(end);
    el.appendChild(bar);

    /* FX: derive a one-shot event from the diff against the previous render. */
    var curSites = [];
    for (var c = 0; c < NV; c++) { var o2 = s.sites[c]; curSites.push(o2 ? (o2.p === 0 ? '0' : '1') + (o2.city ? 'C' : 'S') : ''); }
    var curRoads = [];
    for (var c2 = 0; c2 < NE; c2++) curRoads.push(s.roads[c2] == null ? '' : String(s.roads[c2]));
    var resJson = JSON.stringify(s.res);
    var fx = [];
    var prev = el.__prev;
    if (prev) {
      var siteChanged = false, roadChanged = false;
      for (var c3 = 0; c3 < NV; c3++) if (prev.sites[c3] !== curSites[c3]) siteChanged = true;
      for (var c4 = 0; c4 < NE; c4++) if (prev.roads[c4] !== curRoads[c4]) roadChanged = true;
      if (siteChanged) fx.push({ t: 'move', el: siteEls[0] });
      else if (roadChanged) fx.push({ t: 'move' });
      else if (prev.turn !== s.turn) fx.push({ t: 'phase' });
      else if (prev.resJson !== resJson) fx.push({ t: 'deal' });
    }
    UI.events(el, fx); // fresh array every render; consumed once by pumpEvents
    el.__prev = s.over === null ? { sites: curSites, roads: curRoads, turn: s.turn, resJson: resJson } : null;
  }

  function renderInfo(view, el, opts) {
    el.innerHTML = '';
    var me = (opts && opts.mySide != null) ? String(opts.mySide) : '0';
    for (var p = 0; p < 2; p++) {
      var row = document.createElement('div');
      row.className = 'player-row' + (view.over === null && view.turn === p ? ' active' : '');
      var nm = document.createElement('span');
      nm.className = 'pr-name' + (String(p) === me ? ' me' : '');
      nm.textContent = (String(p) === me ? 'You \u2014 ' : '') + L.sideName(String(p));
      row.appendChild(nm);
      var r = view.res[p];
      var meta = document.createElement('span');
      meta.className = 'pr-meta';
      var rs = [];
      for (var i = 0; i < 5; i++) rs.push(L.RICON[i] + r[i]);
      meta.textContent = rs.join(' ') + ' \u00B7 ' + L.vp(view, p) + ' VP \u00B7 ' + L.cityCount(view, p) + ' cities \u00B7 ' + L.roadCount(view, p) + ' roads';
      row.appendChild(meta);
      el.appendChild(row);
    }
    if (view.last) {
      var last = document.createElement('div');
      last.className = 'cat-last';
      var parts = [];
      for (var i2 = 0; i2 < 5; i2++) if (view.last.made[i2]) parts.push('+' + view.last.made[i2] + ' ' + L.RNAMES[i2]);
      last.textContent = 'Roll ' + view.last.a + '+' + view.last.b + '=' + (view.last.a + view.last.b) +
        (parts.length ? ' \u2192 ' + parts.join(', ') : ' \u2192 nothing');
      el.appendChild(last);
    }
    if (view.over !== null) {
      var win = document.createElement('div');
      win.className = 'cat-win';
      win.textContent = L.sideName(String(view.over)) + ' wins!';
      el.appendChild(win);
    }
  }

  global.PARLOR = global.PARLOR || {};
  global.PARLOR['catan'] = global.PARLOR['catan'] || {};
  global.PARLOR['catan'].view = { render: render, renderInfo: renderInfo };
})(typeof window !== 'undefined' ? window : globalThis);
