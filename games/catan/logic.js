/* games/catan/logic.js — Catan (full base rules) pure logic.
 * No DOM, no timers. Registers global.PARLOR['catan'].logic and a Node
 * module.exports guard. 19-hex board, 5 resources, roads, robber, dev cards,
 * 4:1 trade, longest road / largest army, 10-VP win.
 */
(function (global) {
  'use strict';

  /* ---------------- RNG (seeded by the host/test via Math.random) ---------------- */
  function randInt(n) { return Math.floor(Math.random() * n); }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = randInt(i + 1);
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function sumOf(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }

  /* ---------------- resources / costs / dev cards ---------------- */
  var RNAMES = ['wheat', 'lumber', 'brick', 'ore', 'sheep'];
  var RSHORT = ['W', 'L', 'B', 'O', 'S'];
  var RICON = ['\u{1F33E}', '\u{1F332}', '\u{1F9F1}', '\u{26F0}\u{FE0F}', '\u{1F411}'];
  var TERRAIN = ['wheat', 'lumber', 'brick', 'ore', 'sheep', 'desert']; // index 0..5
  var TERRAIN_ICON = ['\u{1F33E}', '\u{1F332}', '\u{1F9F1}', '\u{26F0}\u{FE0F}', '\u{1F411}', '\u{1F42E}'];
  // resource index per terrain index (desert -> -1)
  var TERRAIN_RES = [0, 1, 2, 3, 4, -1];

  var ROAD = [0, 1, 1, 0, 0];
  var SETTLE = [1, 1, 1, 0, 1];
  var CITY = [3, 0, 0, 2, 0];
  var DEV = [1, 0, 0, 1, 1];
  var BUILD_COST = { ROAD: ROAD, SETTLE: SETTLE, CITY: CITY, DEV: DEV };

  var DEV_NAMES = ['Knight', 'Longest Road', 'Year of Plenty', 'Road Block', 'Victory Point'];
  var DEV_IDX = { knight: 0, road: 1, plenty: 2, monopoly: 3, vp: 4 };

  var WIN_VP = 10;
  var MAX_SETTLE = 20;
  var MAX_ROAD = 25;
  var LONGEST_MIN = 5;
  var ARMY_MIN = 3;
  var RES_CAP = 8;
  var NUMS = [5, 5, 4, 4, 3, 3, 3, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1]; // 6,6,5,5,4,4,3,3,3,2,2,2,10,10,9,9,12
  // (reordered below for clarity)
  // 18 number tokens for the 18 non-desert hexes, weighted by 2d6 probability:
  // 2(1/36)x2, 3(2/36)x3, 4(3/36)x2, 5(4/36)x2, 6(5/36)x2, 8(5/36)x2, 9(4/36)x2,
  // 10(3/36)x2, 12(1/36)x1.
  var TOKENS = [2, 2, 3, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 12];

  /* ---------------- geometry (deterministic, computed once) ---------------- */
  var SQ3 = Math.sqrt(3);
  var S = 40; // hex circumradius (view units)
  function rk(v) { var x = Math.round(v * 1000) / 1000; return x === 0 ? 0 : x; }
  function vkey(x, y) { return rk(x).toFixed(3) + ',' + rk(y).toFixed(3); }
  function ekey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }

  var HEX_AXIAL = [];
  (function () {
    for (var r = -2; r <= 2; r++)
      for (var q = -2; q <= 2; q++)
        if (Math.abs(q + r) <= 2) HEX_AXIAL.push([q, r]);
  })();
  var NH = HEX_AXIAL.length; // 19

  var CORNER_OFF = [];
  (function () {
    for (var k = 0; k < 6; k++) {
      var ang = (60 * k - 90) * Math.PI / 180;
      CORNER_OFF.push([Math.cos(ang), Math.sin(ang)]);
    }
  })();

  var HEX_POS = [], HEX_CORNERS = [];
  (function () {
    for (var hi = 0; hi < NH; hi++) {
      var ax = HEX_AXIAL[hi][0], ay = HEX_AXIAL[hi][1];
      var cx = SQ3 * (ax + ay / 2) * S;
      var cy = 1.5 * ay * S;
      HEX_POS[hi] = [cx, cy];
      var c = [];
      for (var k = 0; k < 6; k++) c.push([cx + S * CORNER_OFF[k][0], cy + S * CORNER_OFF[k][1]]);
      HEX_CORNERS[hi] = c;
    }
  })();

  var vMap = {}, VERTEX = [], VERTEX_HEXES = [];
  (function () {
    for (var hi = 0; hi < NH; hi++) {
      var cs = HEX_CORNERS[hi];
      for (var k = 0; k < 6; k++) {
        var key = vkey(cs[k][0], cs[k][1]);
        if (!(key in vMap)) { vMap[key] = VERTEX.length; VERTEX.push([cs[k][0], cs[k][1]]); VERTEX_HEXES.push([]); }
        var vi = vMap[key];
        if (VERTEX_HEXES[vi].indexOf(hi) < 0) VERTEX_HEXES[vi].push(hi);
      }
    }
  })();
  var NV = VERTEX.length; // 54

  var eMap = {}, EDGE = [], EDGE_HEXES = [], VADJ = [];
  (function () {
    for (var vi = 0; vi < NV; vi++) VADJ.push([]);
    for (var hi = 0; hi < NH; hi++) {
      var cs = HEX_CORNERS[hi];
      for (var k = 0; k < 6; k++) {
        var a = vMap[vkey(cs[k][0], cs[k][1])];
        var b = vMap[vkey(cs[(k + 1) % 6][0], cs[(k + 1) % 6][1])];
        var ek = ekey(a, b);
        if (!(ek in eMap)) {
          eMap[ek] = EDGE.length; EDGE.push([a, b]); EDGE_HEXES.push([]);
          VADJ[a].push(b); VADJ[b].push(a);
        }
        var ei = eMap[ek];
        if (EDGE_HEXES[ei].indexOf(hi) < 0) EDGE_HEXES[ei].push(hi);
      }
    }
  })();
  var NE = EDGE.length; // 72

  var EDGE_MID = [], EDGE_ANGLE = [];
  (function () {
    for (var ei = 0; ei < NE; ei++) {
      var a = VERTEX[EDGE[ei][0]], b = VERTEX[EDGE[ei][1]];
      EDGE_MID[ei] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      EDGE_ANGLE[ei] = Math.atan2(b[1] - a[0 + 1], b[0] - a[0]) * 180 / Math.PI; // placeholder fixed below
    }
  })();
  (function () {
    for (var ei = 0; ei < NE; ei++) {
      var a = VERTEX[EDGE[ei][0]], b = VERTEX[EDGE[ei][1]];
      EDGE_ANGLE[ei] = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
    }
  })();

  var HEX_ADJ = [];
  (function () {
    for (var hi = 0; hi < NH; hi++) HEX_ADJ.push([]);
    for (var ei = 0; ei < NE; ei++) {
      var hxs = EDGE_HEXES[ei];
      if (hxs.length === 2) {
        if (HEX_ADJ[hxs[0]].indexOf(hxs[1]) < 0) HEX_ADJ[hxs[0]].push(hxs[1]);
        if (HEX_ADJ[hxs[1]].indexOf(hxs[0]) < 0) HEX_ADJ[hxs[1]].push(hxs[0]);
      }
    }
  })();

  /* ---------------- board generation ---------------- */
  function genBoard() {
    var terrain = [4, 3, 4, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 5]; // 4w 3l 4b 3o 4s ... desert placeholder
    // rebuild a clean multiset: 4 wheat, 3 lumber, 4 brick, 3 ore, 4 sheep, 1 desert
    terrain = [0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 4, 5];
    var desert = 5;
    var tries = 0;
    var desertIdx, numbers;
    while (true) {
      terrain = shuffle(terrain.slice());
      desertIdx = terrain.indexOf(5);
      numbers = [];
      var pool = shuffle(TOKENS.slice());
      var ok = true;
      for (var h = 0; h < NH; h++) {
        if (h === desertIdx) { numbers.push(0); continue; }
        var t = TERRAIN_RES[terrain[h]];
        var pick = -1;
        for (var p = 0; p < pool.length; p++) {
          var n = pool[p];
          if (t === 0 && (n === 6 || n === 8)) { // wheat: not 6/8
            // wheat is resource 0
          }
          // terrain-specific restrictions: wheat(0): no 6/8; sheep(4): no 6; ore(3): only 5/6
          if (t === 0 && (n === 6 || n === 8)) continue;
          if (t === 4 && n === 6) continue;
          if (t === 3 && n !== 5 && n !== 6) continue;
          pick = p; break;
        }
        if (pick < 0) { ok = false; break; }
        numbers.push(pool[pick]);
        pool.splice(pick, 1);
      }
      if (!ok) { if (++tries > 800) break; continue; }
      // no adjacent 6/8
      var bad = false;
      for (h = 0; h < NH; h++) {
        if (numbers[h] === 6 || numbers[h] === 8) {
          var nb = HEX_ADJ[h];
          for (var j = 0; j < nb.length; j++) if (numbers[nb[j]] === 6 || numbers[nb[j]] === 8) { bad = true; break; }
          if (bad) break;
        }
      }
      if (!bad) break;
      if (++tries > 800) break;
    }
    return { terrain: terrain, numbers: numbers, desert: desertIdx };
  }

  /* ---------------- state ---------------- */
  function newState() {
    var b = genBoard();
    var devDeck = shuffle(['knight', 'knight', 'knight', 'knight', 'road', 'road', 'road', 'road', 'road', 'plenty', 'plenty', 'plenty', 'plenty', 'plenty', 'monopoly', 'monopoly', 'monopoly', 'monopoly', 'monopoly', 'vp', 'vp', 'vp', 'vp']);
    var s = {
      phase: 'setup',
      turn: 0,
      over: null,
      setupPlaced: 0,
      terrain: b.terrain,
      numbers: b.numbers,
      desert: b.desert,
      robber: b.desert,
      sites: new Array(NV).fill(null),
      roads: new Array(NE).fill(null),
      res: [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]],
      dev: [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]],
      devDeck: devDeck,
      last: null,
      seq: 0,
      army: [0, 0]
    };
    // setup: deal 4 resource cards each
    var startCards = ['wheat', 'wheat', 'lumber', 'brick', 'ore', 'sheep', 'wheat', 'lumber'];
    // standard starting: 2 wheat, 1 lumber, 1 brick, 1 ore, 1 sheep? Use 4 cards: wheat, wheat, lumber, brick? 
    // Simplify: deal 4 random-ish cards: wheat, lumber, brick, ore (one each) — deterministic-ish.
    var give = [0, 1, 2, 3]; // wheat, lumber, brick, ore
    for (var p = 0; p < 2; p++) {
      for (var c = 0; c < 4; c++) s.res[p][give[c]]++;
    }
    return s;
  }

  /* ---------------- helpers ---------------- */
  function sideName(side) { return 'Player ' + (parseInt(side, 10) + 1); }
  function owned(s, p) { var n = 0; for (var v = 0; v < NV; v++) { var o = s.sites[v]; if (o && o.p === p) n++; } return n; }
  function cityCount(s, p) { var n = 0; for (var v = 0; v < NV; v++) { var o = s.sites[v]; if (o && o.p === p && o.city) n++; } return n; }
  function roadCount(s, p) { var n = 0; for (var e = 0; e < NE; e++) if (s.roads[e] === p) n++; return n; }

  function canAfford(res, cost) { for (var i = 0; i < 5; i++) if (res[i] < cost[i]) return false; return true; }
  function pay(res, cost) { for (var i = 0; i < 5; i++) res[i] -= cost[i]; }
  function gain(res, cost) { for (var i = 0; i < 5; i++) res[i] += cost[i]; }

  function vertexFree(s, v) {
    if (s.sites[v]) return false;
    var adj = VADJ[v];
    for (var i = 0; i < adj.length; i++) if (s.sites[adj[i]]) return false;
    return true;
  }

  function reached(s, p) {
    var r = {};
    for (var v = 0; v < NV; v++) { var o = s.sites[v]; if (o && o.p === p) r[v] = true; }
    for (var e = 0; e < NE; e++) if (s.roads[e] === p) { r[EDGE[e][0]] = true; r[EDGE[e][1]] = true; }
    return r;
  }
  function canBuildRoad(s, p, e, r) {
    if (s.roads[e] != null) return false;
    if (!r) r = reached(s, p);
    return !!(r[EDGE[e][0]] || r[EDGE[e][1]]);
  }

  /* ---------------- longest road (DFS, capped) ---------------- */
  function longestRoad(s, p) {
    if (roadCount(s, p) < LONGEST_MIN) return 0;
    var best = 0;
    var CAP = 200000;
    var visits = 0;
    var road = s.roads;
    var startVerts = {};
    for (var e = 0; e < NE; e++) if (road[e] === p) { startVerts[EDGE[e][0]] = true; startVerts[EDGE[e][1]] = true; }
    var keys = Object.keys(startVerts);
    for (var i = 0; i < keys.length; i++) {
      if (visits > CAP) break;
      var start = parseInt(keys[i], 10);
      var stack = [[start, null, 0]]; // vertex, prevEdge, length
      while (stack.length) {
        if (++visits > CAP) break;
        var fr = stack.pop();
        var v = fr[0], pe = fr[1], len = fr[2];
        if (len > best) best = len;
        var adj = VADJ[v];
        for (var a = 0; a < adj.length; a++) {
          var w = adj[a];
          // find edge index between v and w
          var ei = -1;
          for (var ee = 0; ee < NE; ee++) {
            if (road[ee] === p && ((EDGE[ee][0] === v && EDGE[ee][1] === w) || (EDGE[ee][0] === w && EDGE[ee][1] === v))) { ei = ee; break; }
          }
          if (ei < 0 || ei === pe) continue;
          stack.push([w, ei, len + 1]);
        }
      }
    }
    return best;
  }

  function longestBonus(s, p) {
    var lp = longestRoad(s, p);
    var q = 1 - p;
    var lq = longestRoad(s, q);
    if (lp >= LONGEST_MIN && lp > lq) return 2;
    return 0;
  }
  function armyBonus(s, p) {
    // knights played are tracked in s.army (dev[0] is knights HELD, and the
    // view nulls the opponent's dev, so we must not read dev here).
    var mine = s.army[p], other = s.army[1 - p];
    if (mine >= ARMY_MIN && mine > other) return 2;
    return 0;
  }

  function vp(s, p) {
    var set = 0, city = 0;
    for (var v = 0; v < NV; v++) { var o = s.sites[v]; if (o && o.p === p) { if (o.city) city++; else set++; } }
    var dvp = s.dev[p] ? s.dev[p][4] : 0;
    return set + 2 * city + dvp + longestBonus(s, p) + armyBonus(s, p);
  }

  function checkWin(s, p) {
    if (s.over !== null) return;
    if (vp(s, p) >= WIN_VP) s.over = p;
  }

  /* ---------------- robber / steal (auto on 7 and on knight) ---------------- */
  function hexExposure(s, p, h) {
    // how many of player p's settlements/cities border hex h (settlement=1, city=2)
    var n = 0;
    var cs = HEX_CORNERS[h];
    for (var k = 0; k < 6; k++) {
      var vi = vMap[vkey(cs[k][0], cs[k][1])];
      var o = s.sites[vi];
      if (o && o.p === p) n += o.city ? 2 : 1;
    }
    return n;
  }
  function bestBlock(s, me) {
    // hex that, if robbed, denies the opponent the most
    var opp = 1 - me;
    var best = -1, bestVal = -1, cand = [];
    for (var h = 0; h < NH; h++) {
      if (h === s.desert) continue;
      var exp = hexExposure(s, opp, h);
      if (exp > bestVal) { bestVal = exp; best = h; cand = [h]; }
      else if (exp === bestVal && exp > 0) { cand.push(h); }
    }
    if (best < 0 || bestVal <= 0) {
      // no opponent exposure: pick a random non-desert hex
      var pool = [];
      for (h = 0; h < NH; h++) if (h !== s.desert) pool.push(h);
      return pool[randInt(pool.length)];
    }
    return cand[randInt(cand.length)];
  }
  function stealOne(s, p) {
    var total = sumOf(s.res[p]);
    if (total <= 0) return;
    var pool = [];
    for (var i = 0; i < 5; i++) for (var c = 0; c < s.res[p][i]; c++) pool.push(i);
    var pick = pool[randInt(pool.length)];
    s.res[p][pick]--;
  }

  /* ---------------- production ---------------- */
  function produce(s, sum) {
    var made = [0, 0, 0, 0, 0];
    for (var h = 0; h < NH; h++) {
      if (s.numbers[h] !== sum || s.robber === h) continue;
      var t = TERRAIN_RES[s.terrain[h]];
      if (t < 0) continue;
      var cs = HEX_CORNERS[h];
      for (var k = 0; k < 6; k++) {
        var vi = vMap[vkey(cs[k][0], cs[k][1])];
        var o = s.sites[vi];
        if (!o) continue;
        var amt = o.city ? 2 : 1;
        s.res[o.p][t] += amt;
        made[t] += amt;
      }
    }
    return made;
  }

  function discardHalf(s, p) {
    var total = sumOf(s.res[p]);
    if (total <= RES_CAP) return;
    var toDiscard = Math.floor(total / 2);
    while (toDiscard > 0) {
      var pool = [];
      for (var i = 0; i < 5; i++) for (var c = 0; c < s.res[p][i]; c++) pool.push(i);
      if (!pool.length) break;
      s.res[p][pool[randInt(pool.length)]]--;
      toDiscard--;
    }
  }

  function doEnd(s) {
    var a = 1 + randInt(6), b = 1 + randInt(6), sum = a + b;
    var made;
    if (sum === 7) {
      made = [0, 0, 0, 0, 0];
      var me = s.turn;
      s.robber = bestBlock(s, me);
      stealOne(s, 1 - me);
    } else {
      made = produce(s, sum);
    }
    s.last = { a: a, b: b, made: made };
    discardHalf(s, s.turn);
    s.turn = 1 - s.turn;
  }

  /* ---------------- legal moves ---------------- */
  function legalMoves(s, side) {
    side = parseInt(side, 10);
    if (s.over !== null) return [];
    if (s.turn !== side) return [];
    var m = [];
    if (s.phase === 'setup') {
      for (var v = 0; v < NV; v++) if (vertexFree(s, v)) m.push({ type: 'setup', v: v });
      return m;
    }
    var r = s.res[side];
    var rc = reached(s, side);
    // roads
    for (var e = 0; e < NE; e++) {
      if (canBuildRoad(s, side, e, rc) && canAfford(r, ROAD) && roadCount(s, side) < MAX_ROAD) m.push({ type: 'road', e: e });
    }
    // settlements
    if (owned(s, side) < MAX_SETTLE && canAfford(r, SETTLE)) {
      for (var v = 0; v < NV; v++) if (vertexFree(s, v)) m.push({ type: 'settle', v: v });
    }
    // cities
    for (var v2 = 0; v2 < NV; v2++) {
      var o = s.sites[v2];
      if (o && o.p === side && !o.city && canAfford(r, CITY)) m.push({ type: 'city', v: v2 });
    }
    // trades
    for (var g = 0; g < 5; g++) if (r[g] >= 4) for (var t = 0; t < 5; t++) if (t !== g) m.push({ type: 'trade', give: g, get: t });
    // dev buy
    if (s.devDeck.length > 0 && canAfford(r, DEV)) m.push({ type: 'dev' });
    // play dev cards
    if (s.dev[side][0] >= 1) m.push({ type: 'play-knight' });
    if (s.dev[side][1] >= 1) {
      for (var e2 = 0; e2 < NE; e2++) if (canBuildRoad(s, side, e2, rc)) m.push({ type: 'play-road', e: e2 });
    }
    if (s.dev[side][2] >= 1) { for (var rp = 0; rp < 5; rp++) m.push({ type: 'play-plenty', r: rp }); }
    if (s.dev[side][3] >= 1) { m.push({ type: 'play-monopoly', r: 0 }); m.push({ type: 'play-monopoly', r: 1 }); }
    // end
    m.push({ type: 'end' });
    return m;
  }

  function isLegal(s, side, mv) {
    side = parseInt(side, 10);
    var ls = legalMoves(s, side);
    var key = JSON.stringify(mv);
    for (var i = 0; i < ls.length; i++) if (JSON.stringify(ls[i]) === key) return true;
    return false;
  }

  /* ---------------- apply move ---------------- */
  function applyMove(s, mv) {
    s.seq = (s.seq || 0) + 1; // monotonic move counter: guarantees the projection advances after any applied move
    var p = s.turn;
    switch (mv.type) {
      case 'setup': {
        var v = mv.v;
        s.sites[v] = { p: p, city: false };
        // auto-assign a free fronting road
        var adj = VADJ[v];
        var pick = -1;
        for (var i = 0; i < adj.length; i++) {
          var e = -1;
          for (var ee = 0; ee < NE; ee++) if ((EDGE[ee][0] === v && EDGE[ee][1] === adj[i]) || (EDGE[ee][0] === adj[i] && EDGE[ee][1] === v)) { e = ee; break; }
          if (e >= 0 && s.roads[e] == null) { pick = e; break; }
        }
        if (pick >= 0) s.roads[pick] = p;
        s.setupPlaced++;
        if (s.setupPlaced >= 4) { s.phase = 'play'; s.turn = 0; }
        else s.turn = 1 - s.turn;
        break;
      }
      case 'road': {
        s.roads[mv.e] = p;
        pay(s.res[p], ROAD);
        break;
      }
      case 'settle': {
        s.sites[mv.v] = { p: p, city: false };
        pay(s.res[p], SETTLE);
        checkWin(s, p);
        break;
      }
      case 'city': {
        s.sites[mv.v].city = true;
        pay(s.res[p], CITY);
        checkWin(s, p);
        break;
      }
      case 'trade': {
        s.res[p][mv.give] -= 4;
        s.res[p][mv.get] += 1;
        break;
      }
      case 'dev': {
        pay(s.res[p], DEV);
        var card = s.devDeck.pop();
        s.dev[p][DEV_IDX[card]]++;
        if (card === 'vp') checkWin(s, p);
        break;
      }
      case 'play-knight': {
        s.dev[p][0]--;
        s.army[p]++;
        s.robber = bestBlock(s, p);
        stealOne(s, 1 - p);
        checkWin(s, p);
        break;
      }
      case 'play-road': {
        s.dev[p][1]--;
        s.roads[mv.e] = p;
        break;
      }
      case 'play-plenty': {
        s.dev[p][2]--;
        s.res[p][mv.r] += 2;
        break;
      }
      case 'play-monopoly': {
        s.dev[p][3]--;
        var r = mv.r;
        for (var q = 0; q < 2; q++) { s.res[p][r] += s.res[q][r]; s.res[q][r] = 0; }
        break;
      }
      case 'end': {
        doEnd(s);
        break;
      }
      default:
        throw new Error('catan: unknown move ' + mv.type);
    }
  }

  /* ---------------- outcome / view ---------------- */
  function outcome(s) {
    if (s.over !== null) return { over: true, text: sideName(s.over) + ' wins \u2014 ' + WIN_VP + ' VP', winner: String(s.over) };
    return { over: false };
  }
  function currentSide(s) {
    if (s.over !== null) return null;
    return String(s.turn);
  }
  function viewFor(s, side) {
    side = parseInt(side, 10);
    var c = JSON.parse(JSON.stringify(s));
    if (c.dev && c.dev[1 - side] != null) c.dev[1 - side] = null;
    return c;
  }

  /* ---------------- describe ---------------- */
  function describeMove(s, mv) {
    var p = s.turn;
    var name = sideName(p);
    switch (mv.type) {
      case 'setup': return name + ' placed a settlement (setup).';
      case 'road': return name + ' built a road.';
      case 'settle': return name + ' built a settlement.';
      case 'city': return name + ' upgraded to a city.';
      case 'trade': return name + ' traded 4 ' + RNAMES[mv.give] + ' for 1 ' + RNAMES[mv.get] + '.';
      case 'dev': return name + ' bought a development card.';
      case 'play-knight': return name + ' played a Knight.';
      case 'play-road': return name + ' used a Longest Road card.';
      case 'play-plenty': return name + ' used Year of Plenty (' + RNAMES[mv.r] + ').';
      case 'play-monopoly': return name + ' used Road Block (' + RNAMES[mv.r] + ').';
      case 'end':
        if (s.last) {
          var sum = s.last.a + s.last.b;
          if (sum === 7) return name + ' rolled 7 \u2014 the robber moves.';
          var parts = [];
          for (var i = 0; i < 5; i++) if (s.last.made[i]) parts.push('+' + s.last.made[i] + ' ' + RNAMES[i]);
          return name + ' rolled ' + s.last.a + '+' + s.last.b + '=' + sum + (parts.length ? ' \u2192 ' + parts.join(', ') : ' \u2192 nothing');
        }
        return name + ' ended the turn.';
    }
    return name + ' moved.';
  }

  /* ---------------- AI ---------------- */
  var PIP = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
  function pipValue(s, h) { var n = s.numbers[h]; return n ? (PIP[n] || 0) : 0; }

  function hexPipsAt(s, v) {
    var hs = VERTEX_HEXES[v], tot = 0;
    for (var i = 0; i < hs.length; i++) tot += pipValue(s, hs[i]);
    return tot;
  }

  function aiMove(s, side) {
    side = parseInt(side, 10);
    if (s.over !== null || s.turn !== side) return null;
    if (s.phase === 'setup') return aiSetup(s, side);
    var best = null, bestScore = -1e9;
    function consider(mv, score) { if (score > bestScore) { bestScore = score; best = mv; } }

    var r = s.res[side];
    var rc = reached(s, side);
    var own = owned(s, side);
    // resources short for a SETTLE (r[i] < SETTLE[i])
    function settleLacks(res) { var a = []; for (var i = 0; i < 5; i++) if (res[i] < SETTLE[i]) a.push(i); return a; }
    // set of resource indices produced by the hexes around vertex v
    function hexResSet(v) {
      var set = {}, hs = VERTEX_HEXES[v];
      for (var i = 0; i < hs.length; i++) { var rr = TERRAIN_RES[s.terrain[hs[i]]]; if (rr >= 0) set[rr] = true; }
      return set;
    }
    // union of resources the player's sites currently produce (diversity tracker)
    var prod = {};
    for (var pv = 0; pv < NV; pv++) {
      var po = s.sites[pv];
      if (po && po.p === side) { var pset = hexResSet(pv); for (var pk in pset) prod[pk] = true; }
    }
    var prodKinds = 0; for (var pk2 in prod) prodKinds++;
    var myVP = vp(s, side);

    // settle: build out the production base first; favor hexes that supply what is missing
    if (own < MAX_SETTLE && canAfford(r, SETTLE)) {
      var lacks = settleLacks(r);
      for (var v = 0; v < NV; v++) if (vertexFree(s, v)) {
        var sc = 50 + hexPipsAt(s, v) * 10;
        var rs = hexResSet(v);
        for (var li = 0; li < lacks.length; li++) if (rs[lacks[li]]) sc += 15; // diversify
        var newRes = 0; for (var nrk in rs) if (!prod[nrk]) newRes++;
        sc += newRes * 25; // big bonus for adding resources the player does not produce
        if (own < 4) sc += 20; else if (own < 6) sc += 10; // build out before upgrading
        consider({ type: 'settle', v: v }, sc);
      }
    }
    // city: only once the production base is built out (>=4 sites)
    if (own >= 4) {
      for (var v2 = 0; v2 < NV; v2++) {
        var o = s.sites[v2];
        if (o && o.p === side && !o.city && canAfford(r, CITY)) {
          var csc = 60 + hexPipsAt(s, v2) * 2;
          if (prodKinds < 3 && myVP < 7) csc -= 40; // diversify production before doubling it
          consider({ type: 'city', v: v2 }, csc);
        }
      }
    }
    // road: only in expansion mode (a settlement is affordable) and only toward a
    // free, productive future settlement site — a stuck player saves/trades instead
    if (canAfford(r, ROAD) && canAfford(r, SETTLE) && roadCount(s, side) < MAX_ROAD) {
      for (var e = 0; e < NE; e++) {
        if (!canBuildRoad(s, side, e, rc)) continue;
        var a = EDGE[e][0], b = EDGE[e][1], cand = -1;
        if (!rc[a] && vertexFree(s, a)) { var pa = hexPipsAt(s, a); if (pa >= 2) cand = pa; }
        if (!rc[b] && vertexFree(s, b)) { var pb = hexPipsAt(s, b); if (pb >= 2 && pb > cand) cand = pb; }
        if (cand < 0) continue; // leads nowhere buildable/productive
        var rsc = 12 + cand * 2;
        if (own >= 4 && roadCount(s, side) >= LONGEST_MIN - 1) rsc += 12; // chase the bonus once built out
        consider({ type: 'road', e: e }, rsc);
      }
    }
    // dev
    if (s.devDeck.length > 0 && canAfford(r, DEV)) consider({ type: 'dev' }, 15);
    // play dev cards (useful ones)
    if (s.dev[side][0] >= 1) consider({ type: 'play-knight' }, s.army[side] === ARMY_MIN - 1 ? 55 : 10);
    if (s.dev[side][1] >= 1) {
      for (var e2 = 0; e2 < NE; e2++) if (canBuildRoad(s, side, e2, rc)) consider({ type: 'play-road', e: e2 }, 25);
    }
    if (s.dev[side][2] >= 1) {
      for (var rp = 0; rp < 5; rp++) consider({ type: 'play-plenty', r: rp }, 12 + (r[rp] < 2 ? 20 : 0));
    }
    if (s.dev[side][3] >= 1) {
      for (var mm = 0; mm < 2; mm++) consider({ type: 'play-monopoly', r: mm }, s.res[1 - side][mm] >= 4 ? 40 : 8);
    }
    // 4:1 trade — relief from holding 8+, and (when no settle is affordable) a
    // strategic buy of a missing settlement resource to fund the next build.
    var lacks2 = settleLacks(r);
    var canSettleNow = own < MAX_SETTLE && canAfford(r, SETTLE);
    for (var g = 0; g < 5; g++) {
      if (r[g] < 4) continue;
      for (var t = 0; t < 5; t++) {
        if (t === g) continue;
        var tsc = 30;
        if (!canSettleNow && lacks2.indexOf(t) >= 0) tsc = 28; // just under relief, still beats end
        consider({ type: 'trade', give: g, get: t }, tsc);
      }
    }
    // end
    consider({ type: 'end' }, 5);

    if (!best) best = { type: 'end' };
    return best;
  }

  function aiSetup(s, side) {
    var cands = legalMoves(s, side);
    if (!cands.length) return { type: 'setup', v: 0 };
    var best = null, bestScore = -1e9;
    for (var i = 0; i < cands.length; i++) {
      var v = cands[i].v;
      var sc = hexPipsAt(s, v);
      // prefer not adjacent to opponent (already guaranteed free), slight random tiebreak
      sc += Math.random() * 2;
      if (sc > bestScore) { bestScore = sc; best = cands[i]; }
    }
    return best;
  }

  /* ---------------- exports ---------------- */
  var logic = {
    newState: newState,
    currentSide: currentSide,
    legalMoves: legalMoves,
    applyMove: applyMove,
    outcome: outcome,
    viewFor: viewFor,
    aiMove: aiMove,
    describeMove: describeMove,
    // helpers + geometry + constants for the view
    sideName: sideName,
    owned: owned,
    cityCount: cityCount,
    roadCount: roadCount,
    longestBonus: longestBonus,
    armyBonus: armyBonus,
    canAfford: canAfford,
    vp: vp,
    RNAMES: RNAMES,
    RSHORT: RSHORT,
    RICON: RICON,
    TERRAIN: TERRAIN,
    TERRAIN_ICON: TERRAIN_ICON,
    TERRAIN_RES: TERRAIN_RES,
    BUILD_COST: BUILD_COST,
    DEV_NAMES: DEV_NAMES,
    DEV_IDX: DEV_IDX,
    WIN_VP: WIN_VP,
    HEX_POS: HEX_POS,
    HEX_CORNERS: HEX_CORNERS,
    HEX_AXIAL: HEX_AXIAL,
    HEX_ADJ: HEX_ADJ,
    VERTEX: VERTEX,
    VERTEX_HEXES: VERTEX_HEXES,
    EDGE: EDGE,
    EDGE_HEXES: EDGE_HEXES,
    EDGE_MID: EDGE_MID,
    EDGE_ANGLE: EDGE_ANGLE,
    VADJ: VADJ,
    NV: NV,
    NE: NE,
    NH: NH,
    S: S,
    SQ3: SQ3
  };

  global.PARLOR = global.PARLOR || {};
  global.PARLOR['catan'] = global.PARLOR['catan'] || {};
  global.PARLOR['catan'].logic = logic;
  if (typeof module !== 'undefined' && module.exports) module.exports = logic;
})(typeof window !== 'undefined' ? window : globalThis);
