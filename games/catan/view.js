/* games/catan/view.js — Catan render layer (DOM only).
 * Loaded after games/catan/logic.js. Logic symbols arrive on
 * global.PARLOR['catan'].logic as L. No top-level DOM access.
 *
 * The full 19-hex board is drawn with absolutely-positioned divs:
 *  - 19 hex tiles (clip-path pointy-top) with terrain + number token;
 *    hexes that produced on the last roll gain a one-shot .produced glow
 *  - one road bar per owned edge, rotated to its edge angle
 *  - one transparent edge button per edge — the road / road-card
 *    affordance (pulses .can when a road can be built there)
 *  - one <button class="cat-site"> at every vertex (54) — empty /
 *    settlement / city, plus the buildable affordances (.can / .city-can)
 *  - a robber marker and a dice readout
 * Below the board: a turn banner, a build-cost legend, and an action bar
 * (dev-card buy + dev-card plays + 20 four-for-one trades + end turn).
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
  // CSS custom property setter (edge rotation lives in --ea so a CSS hover
  // transform can scale it; the DOM stub stores it as a plain key).
  function setVar(el, k, v) { if (!el.style) el.style = {}; if (el.style.setProperty) el.style.setProperty(k, v); else el.style[k] = v; }
  function cost(c) {
    var out = [];
    for (var i = 0; i < 5; i++) if (c[i]) out.push(c[i] + L.RICON[i]);
    return out.join(' ');
  }

  function render(view, el, opts) {
    var s = view;
    var interactive = !!(opts && opts.interactive);
    var me = (opts && opts.mySide != null) ? String(opts.mySide) : '0';
    var mine = interactive && s.over === null;
    el.innerHTML = '';
    // self re-render hook for the trade composer (draft-only state changes do
    // not pass through the session, so the composer re-invokes this render)
    el.__selfRender = render; el.__selfView = view; el.__selfOpts = opts;

    /* which of the human's legal moves are available, by type */
    var siteMove = {}, tradeMove = {}, roadByEdge = {};
    var canEnd = false, canDev = false, canKnight = false, canAccept = false, canDecline = false;
    var canPlenty = [false, false, false, false, false];
    var canMonopoly = [false, false, false, false, false];
    if (mine) {
      var moves = L.legalMoves(s, me);
      for (var i = 0; i < moves.length; i++) {
        var mv = moves[i];
        if (mv.type === 'setup' || mv.type === 'settle' || mv.type === 'city') siteMove[mv.type + ':' + mv.v] = mv;
        else if (mv.type === 'trade') tradeMove[mv.give + ':' + mv.get] = mv;
        else if (mv.type === 'end') canEnd = true;
        else if (mv.type === 'dev') canDev = true;
        else if (mv.type === 'play-knight') canKnight = true;
        else if (mv.type === 'play-plenty') canPlenty[mv.r] = true;
        else if (mv.type === 'play-monopoly') canMonopoly[mv.r] = true;
        else if (mv.type === 'road' || mv.type === 'setup-road') roadByEdge[mv.e] = mv;
        else if (mv.type === 'play-road' && !roadByEdge[mv.e]) roadByEdge[mv.e] = mv;
        else if (mv.type === 'trade-accept') canAccept = true;
        else if (mv.type === 'trade-decline') canDecline = true;
      }
    }

    /* turn / phase banner */
    var banner = document.createElement('div');
    banner.className = 'cat-turn';
    if (s.phase === 'setup') {
      var step = s.setupPlaced % 4;
      banner.textContent = 'Setup ' + (s.setupPlaced + 1) + ' of 8 — ' + (step < 2 ? 'place a settlement' : 'place a road') + ' on the board';
    } else if (s.pending === 'robber') {
      banner.textContent = 'Move the robber — click a hex' + (String(s.turn) === me ? ' (you)' : '');
    } else if (s.pendingTrade && s.pendingTrade.from !== parseInt(me, 10)) {
      banner.textContent = 'You have a trade offer to answer';
    } else if (s.over !== null) {
      banner.textContent = 'Game over — ' + L.sideName(String(s.over)) + ' wins';
    } else if (String(s.turn) === me) {
      banner.textContent = 'Your turn — build, trade, then End turn';
    } else {
      banner.textContent = L.sideName(String(1 - s.turn)) + ' is thinking…';
    }
    el.appendChild(banner);

    var board = document.createElement('div');
    board.className = 'cat-board';

    var island = document.createElement('div');
    island.className = 'cat-island';
    island.setAttribute('aria-hidden', 'true');
    board.appendChild(island);

    /* hexes that produced on the last roll (glow on the turn-change render) */
    var produced = {};
    if (s.last && el.__prev && el.__prev.turn !== s.turn) {
      var sum = s.last.a + s.last.b;
      if (sum !== 7) {
        for (var pv = 0; pv < NV; pv++) {
          if (!s.sites[pv]) continue;
          var ph = L.VERTEX_HEXES[pv];
          for (var pj = 0; pj < ph.length; pj++) if (s.numbers[ph[pj]] === sum) produced[ph[pj]] = true;
        }
      }
    }

    /* hexes */
    var robberPending = mine && s.pending === 'robber';
    var h;
    for (h = 0; h < NH; h++) {
      var ter = s.terrain[h];
      var hex = document.createElement('div');
      var robCan = robberPending && h !== s.robber;
      hex.className = 'cat-hex h' + h + ' t-' + L.TERRAIN[ter] + (produced[h] ? ' produced' : '') + (robCan ? ' robber-can' : '');
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
      if (robCan) {
        hex.setAttribute('role', 'button');
        hex.setAttribute('aria-label', 'Move the robber here');
        (function (hh) { hex.addEventListener('click', function () { opts.onMove({ type: 'robber', h: hh }); }); })(h);
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

    /* edge buttons — one per edge; the road / road-card affordance */
    for (var ee = 0; ee < NE; ee++) {
      var eb = document.createElement('button');
      eb.type = 'button';
      var emid = at(L.EDGE_MID[ee][0], L.EDGE_MID[ee][1]);
      sty(eb, 'left', emid[0] + 'px');
      sty(eb, 'top', emid[1] + 'px');
      setVar(eb, '--ea', L.EDGE_ANGLE[ee] + 'deg');
      eb.className = 'cat-edge e' + ee;
      if (mine && roadByEdge[ee]) {
        eb.className += ' can';
        eb.setAttribute('aria-label', roadByEdge[ee].type === 'road' ? 'Build a road here' : 'Play your road card here');
        (function (m) { eb.addEventListener('click', function () { opts.onMove(m); }); })(roadByEdge[ee]);
      }
      board.appendChild(eb);
    }

    /* sites (one button per vertex) */
    var siteEls = [];
    for (var v = 0; v < NV; v++) {
      var o = s.sites[v];
      var b = document.createElement('button');
      var cls = 'cat-site s' + v;
      var click = null;
      if (o) cls += ' p' + o.p + (o.city ? ' city' : '');
      if (mine) {
        var cand = siteMove['setup:' + v] || siteMove['settle:' + v];
        if (cand) { cls += ' can'; click = cand; }
        var up = siteMove['city:' + v];
        if (up) { cls += ' city-can'; if (!click) click = up; }
      }
      b.className = cls;
      b.type = 'button';
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

    /* player-to-player trade: answer a standing offer from the opponent */
    var meInt = parseInt(me, 10);
    if (s.pendingTrade && s.pendingTrade.from !== meInt) {
      var pt = s.pendingTrade;
      var ppanel = document.createElement('div');
      ppanel.className = 'cat-pto';
      var phead = document.createElement('div');
      phead.className = 'cat-pto-head';
      phead.textContent = L.sideName(String(pt.from)) + ' offers you: ' + cost(pt.give) + '  \u2192  ' + cost(pt.want);
      ppanel.appendChild(phead);
      var pbtns = document.createElement('div');
      pbtns.className = 'cat-pto-btns';
      var pa = document.createElement('button');
      pa.className = 'cat-pto-accept' + (canAccept ? ' can' : '');
      pa.textContent = 'Accept';
      pa.type = 'button';
      if (canAccept) pa.addEventListener('click', function () { opts.onMove({ type: 'trade-accept' }); });
      var pd = document.createElement('button');
      pd.className = 'cat-pto-decline' + (canDecline ? ' can' : '');
      pd.textContent = 'Decline';
      pd.type = 'button';
      if (canDecline) pd.addEventListener('click', function () { opts.onMove({ type: 'trade-decline' }); });
      pbtns.appendChild(pa);
      pbtns.appendChild(pd);
      ppanel.appendChild(pbtns);
      el.appendChild(ppanel);
    }

    /* cost legend + action bar (hidden during setup and after game over) */
    if (s.phase !== 'setup' && s.over === null) {
      var legend = document.createElement('div');
      legend.className = 'cat-costs';
      legend.textContent = 'Settlement ' + cost(L.BUILD_COST.SETTLE) + '  ·  City ' + cost(L.BUILD_COST.CITY) + '  ·  Road ' + cost(L.BUILD_COST.ROAD) + '  ·  Dev card ' + cost(L.BUILD_COST.DEV);
      el.appendChild(legend);

      var bar = document.createElement('div');
      bar.className = 'cat-bar';

      var db = document.createElement('button');
      db.className = 'cat-dev' + (mine && canDev ? ' can' : '');
      db.textContent = 'Dev card ' + cost(L.BUILD_COST.DEV);
      db.type = 'button';
      if (mine && canDev) db.addEventListener('click', function () { opts.onMove({ type: 'dev' }); });
      bar.appendChild(db);

      if (mine) {
        var kb = document.createElement('button');
        kb.className = 'cat-knight' + (canKnight ? ' can' : '');
        kb.textContent = 'Knight — move the robber';
        kb.type = 'button';
        if (canKnight) kb.addEventListener('click', function () { opts.onMove({ type: 'play-knight' }); });
        bar.appendChild(kb);

        for (var pr = 0; pr < 5; pr++) {
          (function (r) {
            var pb = document.createElement('button');
            pb.className = 'cat-plenty' + (canPlenty[r] ? ' can' : '');
            pb.textContent = 'Plenty +2 ' + L.RICON[r];
            pb.type = 'button';
            if (canPlenty[r]) pb.addEventListener('click', function () { opts.onMove({ type: 'play-plenty', r: r }); });
            bar.appendChild(pb);
          })(pr);
        }
        for (var mr = 0; mr < 5; mr++) {
          (function (r) {
            var mb = document.createElement('button');
            mb.className = 'cat-monopoly' + (canMonopoly[r] ? ' can' : '');
            mb.textContent = 'Road Block ' + L.RICON[r];
            mb.type = 'button';
            if (canMonopoly[r]) mb.addEventListener('click', function () { opts.onMove({ type: 'play-monopoly', r: r }); });
            bar.appendChild(mb);
          })(mr);
        }
      }

      for (var g = 0; g < 5; g++) {
        for (var t = 0; t < 5; t++) {
          if (t === g) continue;
          (function (g, t) {
            var tb = document.createElement('button');
            var can = mine && !!tradeMove[g + ':' + t];
            tb.className = 'cat-trade' + (can ? ' can' : '');
            tb.textContent = '4' + L.RICON[g] + ' \u2192 1' + L.RICON[t];
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
      /* player-to-player trade composer toggle */
      var to = document.createElement('button');
      to.className = 'cat-pto-open' + (el.__tradeOpen ? ' open' : '');
      to.textContent = el.__tradeOpen ? 'Close trade' : 'Trade with ' + L.sideName(String(1 - meInt));
      to.type = 'button';
      to.setAttribute('aria-label', 'Open the player-to-player trade composer');
      if (mine && canEnd && !s.pending && !s.pendingTrade) {
        to.addEventListener('click', function () { el.__tradeOpen = !el.__tradeOpen; if (el.__selfRender) el.__selfRender(el.__selfView, el, el.__selfOpts); });
      }
      bar.appendChild(to);

      var end = document.createElement('button');
      end.className = 'cat-end' + (mine && canEnd ? ' can' : '');
      end.textContent = 'End turn';
      end.setAttribute('aria-label', 'End turn, roll the dice and collect production');
      end.type = 'button';
      if (mine && canEnd) end.addEventListener('click', function () { opts.onMove({ type: 'end' }); });
      bar.appendChild(end);
      el.appendChild(bar);

      /* trade composer: the give/want pickers, shown when toggled open */
      if (el.__tradeOpen && mine && !s.pending && !s.pendingTrade) {
        if (!el.__tradeDraft || !el.__tradeDraft.give) el.__tradeDraft = { give: [0,0,0,0,0], want: [0,0,0,0,0] };
        var tdlg = document.createElement('div');
        tdlg.className = 'cat-tdlg';
        var ttitle = document.createElement('div');
        ttitle.className = 'cat-tdlg-title';
        ttitle.textContent = 'Offer ' + L.sideName(String(1 - meInt)) + ' — up to 4 resources each way';
        tdlg.appendChild(ttitle);
        var mkRow = function (which, label) {
          var row = document.createElement('div');
          row.className = 'cat-tdlg-row';
          var lab = document.createElement('span');
          lab.className = 'cat-tdlg-lab';
          lab.textContent = label;
          row.appendChild(lab);
          for (var tr = 0; tr < 5; tr++) {
            (function (r) {
              var b = document.createElement('button');
              b.type = 'button';
              var cur = el.__tradeDraft[which][r];
              b.className = 'cat-tdlg-btn ' + which + (cur > 0 ? ' on' : '');
              b.textContent = L.RICON[r] + ' ' + cur;
              b.setAttribute('aria-label', label + ' ' + L.RNAMES[r]);
              b.addEventListener('click', function () {
                var d = el.__tradeDraft;
                var sum = 0; for (var i = 0; i < 5; i++) sum += d[which][i];
                if (which === 'give' && d.give[r] >= s.res[meInt][r]) return;
                if (sum >= 4) return;
                d[which][r]++;
                if (el.__selfRender) el.__selfRender(el.__selfView, el, el.__selfOpts);
              });
              row.appendChild(b);
            })(tr);
          }
          tdlg.appendChild(row);
        };
        mkRow('give', 'You give');
        mkRow('want', 'You want');
        var tbtns = document.createElement('div');
        tbtns.className = 'cat-tdlg-btns';
        var tclear = document.createElement('button');
        tclear.className = 'cat-tdlg-clear';
        tclear.textContent = 'Clear';
        tclear.type = 'button';
        tclear.addEventListener('click', function () { el.__tradeDraft = { give: [0,0,0,0,0], want: [0,0,0,0,0] }; if (el.__selfRender) el.__selfRender(el.__selfView, el, el.__selfOpts); });
        var toffer = document.createElement('button');
        toffer.type = 'button';
        toffer.textContent = 'Offer';
        var gs = 0, ws = 0;
        for (var gi = 0; gi < 5; gi++) { gs += el.__tradeDraft.give[gi]; ws += el.__tradeDraft.want[gi]; }
        var offerOk = gs >= 1 && ws >= 1;
        toffer.className = 'cat-pto-offer' + (offerOk ? ' can' : '');
        if (offerOk) {
          toffer.addEventListener('click', function () {
            var d = el.__tradeDraft;
            opts.onMove({ type: 'trade-offer', give: d.give.slice(), want: d.want.slice() });
            el.__tradeDraft = { give: [0,0,0,0,0], want: [0,0,0,0,0] };
            el.__tradeOpen = false;
          });
        }
        tbtns.appendChild(tclear);
        tbtns.appendChild(toffer);
        tdlg.appendChild(tbtns);
        el.appendChild(tdlg);
      }
    }

    /* FX: derive a one-shot event from the diff against the previous render. */
    var curSites = [];
    for (var c = 0; c < NV; c++) { var o2 = s.sites[c]; curSites.push(o2 ? (o2.p === 0 ? '0' : '1') + (o2.city ? 'C' : 'S') : ''); }
    var curRoads = [];
    for (var c2 = 0; c2 < NE; c2++) curRoads.push(s.roads[c2] == null ? '' : String(s.roads[c2]));
    var resJson = JSON.stringify(s.res);
    var devJson = JSON.stringify([s.dev, s.devDeck.length]);
    var fx = [];
    var prev = el.__prev;
    if (prev) {
      var siteChanged = false, roadChanged = false;
      for (var c3 = 0; c3 < NV; c3++) if (prev.sites[c3] !== curSites[c3]) siteChanged = true;
      for (var c4 = 0; c4 < NE; c4++) if (prev.roads[c4] !== curRoads[c4]) roadChanged = true;
      if (siteChanged) fx.push({ t: 'build', el: siteEls[0] });
      else if (roadChanged) fx.push({ t: 'road' });
      else if (prev.robber !== s.robber) {
        fx.push({ t: 'robber' });
        if (prev.resJson !== resJson) fx.push({ t: 'steal' });
      }
      else if (prev.devJson !== devJson) fx.push({ t: 'card' });
      else if (prev.turn !== s.turn) fx.push({ t: 'turn' });
      else if (prev.resJson !== resJson) fx.push({ t: 'trade' });
    }
    UI.events(el, fx); // fresh array every render; consumed once by pumpEvents
    el.__prev = s.over === null ? { sites: curSites, roads: curRoads, turn: s.turn, robber: s.robber, devJson: devJson, resJson: resJson } : null;
  }

  function renderInfo(view, el, opts) {
    el.innerHTML = '';
    var me = (opts && opts.mySide != null) ? String(opts.mySide) : '0';
    for (var p = 0; p < 2; p++) {
      var row = document.createElement('div');
      row.className = 'player-row' + (view.over === null && view.turn === p ? ' active' : '');
      var nm = document.createElement('span');
      nm.className = 'pr-name' + (String(p) === me ? ' me' : '');
      nm.textContent = (String(p) === me ? 'You — ' : '') + L.sideName(String(p));
      row.appendChild(nm);
      var r = view.res[p];
      var meta = document.createElement('span');
      meta.className = 'pr-meta';
      for (var i = 0; i < 5; i++) {
        var rspan = document.createElement('span');
        rspan.className = 'pr-res' + (r[i] >= 8 ? ' cap' : '');
        rspan.textContent = L.RICON[i] + r[i];
        meta.appendChild(rspan);
      }
      var extra = [];
      if (L.longestBonus(view, p)) extra.push('longest-road +2');
      if (L.armyBonus(view, p)) extra.push('army +2');
      var tail = document.createElement('span');
      tail.textContent = ' · ' + L.cityCount(view, p) + ' cities · ' + L.roadCount(view, p) + ' roads' + (extra.length ? ' · ' + extra.join(' · ') : '');
      meta.appendChild(tail);
      row.appendChild(meta);
      /* VP bar */
      var vpb = document.createElement('span');
      vpb.className = 'pr-vpbar';
      vpb.setAttribute('aria-label', L.vp(view, p) + ' of ' + L.WIN_VP + ' victory points');
      var vpf = document.createElement('span');
      vpf.className = 'pr-vpfill';
      sty(vpf, 'width', Math.min(100, L.vp(view, p) * 100 / L.WIN_VP) + '%');
      vpb.appendChild(vpf);
      var vpl = document.createElement('span');
      vpl.className = 'pr-vplabel';
      vpl.textContent = L.vp(view, p) + '/' + L.WIN_VP;
      row.appendChild(vpb);
      row.appendChild(vpl);
      /* dev hand — hidden cards stay hidden: only the holder sees their hand */
      if (view.dev[p] !== null) {
        var dv = document.createElement('span');
        dv.className = 'pr-dev';
        var parts = [];
        for (var d = 0; d < 5; d++) if (view.dev[p][d] > 0) parts.push(view.dev[p][d] + ' ' + L.DEV_NAMES[d]);
        dv.textContent = (parts.length ? parts.join(', ') : 'No dev cards') + ' · ' + view.devDeck.length + ' left';
        row.appendChild(dv);
      }
      el.appendChild(row);
    }
    /* bank — how many of each resource remain (production draws from here, so 0 = that tile goes silent) */
    var bank = document.createElement('div');
    bank.className = 'cat-bank';
    var bankTotal = 0;
    for (var bi = 0; bi < 5; bi++) bankTotal += view.bank[bi];
    var bankLab = document.createElement('span');
    bankLab.className = 'cat-bank-lab';
    bankLab.textContent = 'Bank (' + bankTotal + ')';
    bank.appendChild(bankLab);
    for (var bj = 0; bj < 5; bj++) {
      var bspan = document.createElement('span');
      bspan.className = 'cat-bank-res' + (view.bank[bj] === 0 ? ' empty' : '');
      bspan.textContent = L.RICON[bj] + view.bank[bj];
      bank.appendChild(bspan);
    }
    el.appendChild(bank);
    if (view.last) {
      var last = document.createElement('div');
      last.className = 'cat-last';
      var parts2 = [];
      for (var i2 = 0; i2 < 5; i2++) if (view.last.made[i2]) parts2.push('+' + view.last.made[i2] + ' ' + L.RNAMES[i2]);
      last.textContent = 'Roll ' + view.last.a + '+' + view.last.b + '=' + (view.last.a + view.last.b) +
        (parts2.length ? ' \u2192 ' + parts2.join(', ') : ' \u2192 nothing');
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
