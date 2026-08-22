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
  var CITY = [2, 0, 0, 1, 0];
  var DEV = [1, 0, 0, 1, 1];
  var BUILD_COST = { ROAD: ROAD, SETTLE: SETTLE, CITY: CITY, DEV: DEV };

  var DEV_NAMES = ['Knight', 'Road', 'Year of Plenty', 'Monopoly', 'Victory Point'];
  var DEV_IDX = { knight: 0, road: 1, plenty: 2, monopoly: 3, vp: 4 };

  var WIN_VP = 10;
  var MAX_SETTLE = 5;
  var MAX_ROAD = 15;
  var LONGEST_MIN = 5;
  var ARMY_MIN = 3;
  var RES_CAP = 8;
  // 18 number tokens for the 18 non-desert hexes, weighted by 2d6 probability:
  // 2(1/36)x1, 3(2/36)x2, 4(3/36)x2, 5(4/36)x2, 6(5/36)x2, 8(5/36)x2, 9(4/36)x2,
  // 10(3/36)x2, 11(2/36)x2, 12(1/36)x1.
  var TOKENS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

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
    // 33 development cards (standard): 14 knight, 5 road, 5 plenty, 4 monopoly, 5 vp
    var devDeck = [];
    var _dc = [['knight', 14], ['road', 5], ['plenty', 5], ['monopoly', 4], ['vp', 5]];
    for (var _di = 0; _di < _dc.length; _di++)
      for (var _dj = 0; _dj < _dc[_di][1]; _dj++) devDeck.push(_dc[_di][0]);
    shuffle(devDeck);
    // one-die roll: higher roll goes first (a tie is re-rolled)
    var f0 = 1 + randInt(6), f1 = 1 + randInt(6);
    while (f0 === f1) f1 = 1 + randInt(6);
    var s = {
      phase: 'setup',
      turn: f0 > f1 ? 0 : 1,
      over: null,
      setupPlaced: 0,
      secondSite: [null, null],
      terrain: b.terrain,
      numbers: b.numbers,
      desert: b.desert,
      robber: b.desert,
      sites: new Array(NV).fill(null),
      roads: new Array(NE).fill(null),
      res: [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]],
      bank: [19, 19, 19, 19, 19], // 19 of each resource: 95 total, a closed system
      dev: [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]],
      devDeck: devDeck,
      last: null,
      seq: 0,
      army: [0, 0],
      first: f0 > f1 ? 0 : 1,
      firstRoll: [f0, f1],
      lastMover: 0,
      tradeCooldown: null, // {p, seq} — offerer who was just declined
      pending: null,        // null | 'robber' — a 7 (or knight) awaiting robber placement
      devUsed: null,        // side that already played a dev card this turn (max 1/turn)
      devBought: null,      // side that already bought a dev card this turn (max 1/turn)
      pendingTrade: null,   // null | { from, give:[5], want:[5] } — a standing player trade
      lastSteal: null       // null | { p, r } — resource stolen by the last robber move
    };
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
  // during setup, a road must sit on an edge touching one of your own settlements
  function setupRoads(s, p) {
    var out = [];
    for (var e = 0; e < NE; e++) {
      if (s.roads[e] != null) continue;
      var a = EDGE[e][0], b = EDGE[e][1];
      var oa = s.sites[a], ob = s.sites[b];
      if ((oa && oa.p === p) || (ob && ob.p === p)) out.push(e);
    }
    return out;
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
    // s.army[p] is the CUMULATIVE count of knights player p has played (official rule: 2 VPs
    // to whoever has played the most knights — it never resets; only play-knight increments it).
    // dev[0] is knights HELD, and the view nulls the opponent's dev, so we must not read dev here.
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
  /* ---------------- production (from the bank — the 95-card supply) ---------------- */
  function produce(s, sum) {
    // tally demand per resource from the hexes that rolled
    var need = [0, 0, 0, 0, 0];
    for (var h = 0; h < NH; h++) {
      if (s.numbers[h] !== sum || s.robber === h) continue;
      var t = TERRAIN_RES[s.terrain[h]];
      if (t < 0) continue;
      var cs = HEX_CORNERS[h];
      for (var k = 0; k < 6; k++) {
        var vi = vMap[vkey(cs[k][0], cs[k][1])];
        var o = s.sites[vi];
        if (o) need[t] += o.city ? 2 : 1;
      }
    }
    // the bank is the source of every card: only what it holds can be produced,
    // and only into hands that have room (8 per resource). Unmet demand and
    // capped-out hands leave the cards in the bank.
    var made = [0, 0, 0, 0, 0];
    for (var h2 = 0; h2 < NH; h2++) {
      if (s.numbers[h2] !== sum || s.robber === h2) continue;
      var tr = TERRAIN_RES[s.terrain[h2]];
      if (tr < 0) continue;
      var cs2 = HEX_CORNERS[h2];
      for (var k2 = 0; k2 < 6; k2++) {
        if (need[tr] <= 0) break; // all demand for this type is met
        var vi2 = vMap[vkey(cs2[k2][0], cs2[k2][1])];
        var o2 = s.sites[vi2];
        if (!o2) continue;
        var give = Math.min(o2.city ? 2 : 1, s.bank[tr], RES_CAP - s.res[o2.p][tr]);
        if (give <= 0) continue;
        s.res[o2.p][tr] += give;
        s.bank[tr] -= give;
        need[tr] -= give;
        made[tr] += give;
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
      var di = pool[randInt(pool.length)];
      s.res[p][di]--;
      s.bank[di]++; // discards go back to the bank (closed 95-card system)
      toDiscard--;
    }
  }

  function doEnd(s) {
    var a = 1 + randInt(6), b = 1 + randInt(6), sum = a + b;
    var made;
    if (sum === 7) {
      // 7: every player holding more than 8 discards down to half, then the
      // roller personally moves the robber (no auto placement, no auto steal)
      made = [0, 0, 0, 0, 0];
      for (var p = 0; p < 2; p++) discardHalf(s, p);
      s.last = { a: a, b: b, made: made };
      s.pending = 'robber';
      s.devUsed = null;
      s.devBought = null;
      return; // the turn does not pass until the robber is placed
    }
    made = produce(s, sum);
    s.last = { a: a, b: b, made: made };
    s.turn = 1 - s.turn;
    s.devUsed = null;
    s.devBought = null;
  }

  /* ---------------- legal moves ---------------- */
  function legalMoves(s, side) {
    side = parseInt(side, 10);
    if (s.over !== null) return [];
    if (s.turn !== side) return [];
    var m = [];
    if (s.phase === 'setup') {
      // placement order S,S,R,R,S,S,R,R — within each 4-placement cycle the
      // first two are settlements and the last two are roads
      var step = s.setupPlaced % 4;
      if (step < 2) {
        for (var v = 0; v < NV; v++) if (vertexFree(s, v)) m.push({ type: 'setup', v: v });
      } else {
        var eds = setupRoads(s, side);
        for (var e = 0; e < eds.length; e++) m.push({ type: 'setup-road', e: eds[e] });
      }
      return m;
    }
    if (s.pending === 'robber') {
      // the roller (or knight's player) must place the robber before anything
      // else: any hex except the one the robber currently sits on
      for (var h = 0; h < NH; h++) if (h !== s.robber) m.push({ type: 'robber', h: h });
      return m;
    }
    var r = s.res[side];
    var rc = reached(s, side);
    // roads
    for (var e = 0; e < NE; e++) {
      if (canBuildRoad(s, side, e, rc) && canAfford(r, ROAD) && roadCount(s, side) < MAX_ROAD) m.push({ type: 'road', e: e });
    }
    // settlements: any empty vertex not adjacent to a settlement (yours or the
    // opponent's) is legal — the network-connectivity rule is NOT part of Catan.
    if (owned(s, side) < MAX_SETTLE && canAfford(r, SETTLE)) {
      for (var v = 0; v < NV; v++) if (vertexFree(s, v)) m.push({ type: 'settle', v: v });
    }
    // cities
    for (var v2 = 0; v2 < NV; v2++) {
      var o = s.sites[v2];
      if (o && o.p === side && !o.city && canAfford(r, CITY)) m.push({ type: 'city', v: v2 });
    }
    // trades (bank, 4:1 — only if the bank still holds the wanted resource)
    for (var g = 0; g < 5; g++) if (r[g] >= 4) for (var t = 0; t < 5; t++) if (t !== g && s.bank[t] >= 1) m.push({ type: 'trade', give: g, get: t });
    // dev buy (max one per turn, officially)
    if (s.devDeck.length > 0 && canAfford(r, DEV) && s.devBought !== side) m.push({ type: 'dev' });
    // play dev cards (at most one per turn, officially)
    if (s.devUsed === null) {
      if (s.dev[side][0] >= 1) m.push({ type: 'play-knight' });
      if (s.dev[side][1] >= 1) {
        for (var e2 = 0; e2 < NE; e2++) if (canBuildRoad(s, side, e2, rc)) m.push({ type: 'play-road', e: e2 });
      }
      if (s.dev[side][2] >= 1) { for (var rp = 0; rp < 5; rp++) if (s.bank[rp] >= 2) m.push({ type: 'play-plenty', r: rp }); }
      if (s.dev[side][3] >= 1) { for (var mr = 0; mr < 5; mr++) m.push({ type: 'play-monopoly', r: mr }); }
    }
    // player-to-player trade offers: enumerate the full (give, want) space so the
    // host's legalMoves membership check accepts a real offer from the composer
    // (give[i] in [0, res[i]], want[i] in [0,4], each total 1..4 — see tradeOfferLegal)
    if (s.pending === null && !s.pendingTrade) {
      var gOpts = tradeResourceOptions(r);
      var wOpts = tradeResourceOptions([4, 4, 4, 4, 4]);
      for (var go = 0; go < gOpts.length; go++)
        for (var wo = 0; wo < wOpts.length; wo++)
          m.push({ type: 'trade-offer', give: gOpts[go].slice(), want: wOpts[wo].slice() });
    }
    // respond to a standing player trade (the recipient answers)
    if (s.pendingTrade && s.pendingTrade.from !== side) {
      if (canAfford(r, s.pendingTrade.want)) m.push({ type: 'trade-accept' });
      m.push({ type: 'trade-decline' });
    }
    // end
    m.push({ type: 'end' });
    return m;
  }

  function tradeOfferLegal(s, side, mv) {
    if (s.phase !== 'play' || s.over !== null || s.turn !== side) return false;
    if (s.pending !== null || s.pendingTrade) return false;
    var r = s.res[side];
    var give = mv.give || [], want = mv.want || [];
    var gsum = 0, wsum = 0;
    for (var i = 0; i < 5; i++) {
      if (give[i] < 0 || want[i] < 0 || r[i] < give[i]) return false;
      gsum += give[i]; wsum += want[i];
    }
    return gsum >= 1 && wsum >= 1 && gsum <= 4 && wsum <= 4;
  }

  // every resource vector with element[i] in [0, cap[i]] and total in [1, 4]:
  // the space a trade offer's give or want side can occupy
  function tradeResourceOptions(caps) {
    var out = [], arr = [0, 0, 0, 0, 0];
    (function rec(i, sum) {
      if (i === 5) { if (sum >= 1 && sum <= 4) out.push(arr.slice()); return; }
      var lim = caps[i] > 4 ? 4 : caps[i];
      for (var v = 0; v <= lim; v++) {
        if (sum + v > 4) break;
        arr[i] = v;
        rec(i + 1, sum + v);
      }
      arr[i] = 0;
    })(0, 0);
    return out;
  }

  function isLegal(s, side, mv) {
    side = parseInt(side, 10);
    if (mv.type === 'trade-offer') return tradeOfferLegal(s, side, mv);
    var ls = legalMoves(s, side);
    var key = JSON.stringify(mv);
    for (var i = 0; i < ls.length; i++) if (JSON.stringify(ls[i]) === key) return true;
    return false;
  }

  function finishSetup(s) {
    // setup complete: each player draws 1 card per productive hex adjacent to
    // their SECOND settlement (the bank is the source)
    for (var pp = 0; pp < 2; pp++) {
      var hs = VERTEX_HEXES[s.secondSite[pp]];
      for (var hi = 0; hi < hs.length; hi++) {
        var tr = TERRAIN_RES[s.terrain[hs[hi]]];
        if (tr >= 0) { s.res[pp][tr]++; s.bank[tr]--; }
      }
    }
    s.phase = 'play';
    s.turn = s.first;
  }

  /* ---------------- apply move ---------------- */
  function applyMove(s, mv) {
    s.seq = (s.seq || 0) + 1; // monotonic move counter: guarantees the projection advances after any applied move
    var p = s.turn;
    s.lastMover = p; // describeMove runs after the mutation (and the turn may have switched)
    switch (mv.type) {
      case 'setup': {
        var v = mv.v;
        s.sites[v] = { p: p, city: false };
        if (owned(s, p) === 2) s.secondSite[p] = v;
        s.setupPlaced++;
        if (s.setupPlaced >= 8) finishSetup(s); else s.turn = 1 - s.turn;
        break;
      }
      case 'setup-road': {
        s.roads[mv.e] = p;
        s.setupPlaced++;
        if (s.setupPlaced >= 8) finishSetup(s); else s.turn = 1 - s.turn;
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
        s.bank[mv.give] += 4; // the four given cards return to the supply (official rule)
        s.res[p][mv.get] += 1;
        s.bank[mv.get]--; // the received card is drawn from the supply
        break;
      }
      case 'robber': {
        // the roller (or knight's player) places the robber and steals when the
        // victim holds at least two cards
        s.robber = mv.h;
        s.lastSteal = null;
        var victim = 1 - p;
        if (sumOf(s.res[victim]) >= 2) {
          var pool = [];
          for (var i = 0; i < 5; i++) for (var c = 0; c < s.res[victim][i]; c++) pool.push(i);
          var pick = pool[randInt(pool.length)];
          s.res[victim][pick]--;
          s.res[p][pick]++;
          s.lastSteal = { p: victim, r: pick };
        }
        s.pending = null;
        s.devUsed = null;
        s.devBought = null;
        s.turn = 1 - s.turn; // a 7 or a knight consumes the turn
        break;
      }
      case 'dev': {
        pay(s.res[p], DEV);
        var card = s.devDeck.pop();
        s.dev[p][DEV_IDX[card]]++;
        s.devBought = p;
        if (card === 'vp') checkWin(s, p);
        break;
      }
      case 'play-knight': {
        s.dev[p][0]--;
        s.army[p]++;
        checkWin(s, p);
        s.devUsed = p;
        s.pending = 'robber'; // the player must place the robber themselves
        break;
      }
      case 'play-road': {
        s.dev[p][1]--;
        s.roads[mv.e] = p;
        s.devUsed = p;
        break;
      }
      case 'play-plenty': {
        s.dev[p][2]--;
        s.res[p][mv.r] += 2;
        s.bank[mv.r] -= 2; // plenty draws from the 95-card supply
        s.devUsed = p;
        break;
      }
      case 'play-monopoly': {
        s.dev[p][3]--;
        var r = mv.r;
        var opp = 1 - p;
        var stolen = s.res[opp][r]; // official text: every other player hands over ALL of that type
        s.res[p][r] += stolen;
        s.res[opp][r] = 0;
        s.devUsed = p;
        break;
      }
      case 'trade-offer': {
        for (var ti = 0; ti < 5; ti++) s.res[p][ti] -= mv.give[ti];
        s.pendingTrade = { from: p, give: mv.give.slice(), want: mv.want.slice() };
        s.turn = 1 - s.turn; // the recipient answers on their own turn
        break;
      }
      case 'trade-accept': {
        var pt = s.pendingTrade;
        var of = pt.from, rf = 1 - of;
        // recipient pays the 'want'; the already-deducted 'give' now moves offerer -> recipient
        for (var ai = 0; ai < 5; ai++) s.res[rf][ai] -= pt.want[ai];
        for (var oi = 0; oi < 5; oi++) s.res[rf][oi] += pt.give[oi];
        for (var wi = 0; wi < 5; wi++) s.res[of][wi] += pt.want[wi];
        s.pendingTrade = null;
        s.turn = 1 - s.turn;
        break;
      }
      case 'trade-decline': {
        var pd = s.pendingTrade;
        for (var di = 0; di < 5; di++) s.res[pd.from][di] += pd.give[di];
        s.tradeCooldown = { p: pd.from, seq: s.seq }; // no immediate re-offer of the same deal
        s.pendingTrade = null;
        s.turn = 1 - s.turn;
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
    var p = s.lastMover != null ? s.lastMover : s.turn;
    var name = sideName(p);
    switch (mv.type) {
      case 'setup': return name + (s.secondSite && s.secondSite[p] === mv.v ? ' placed their second settlement (setup).' : ' placed a settlement (setup).');
      case 'setup-road': return name + ' built a setup road.';
      case 'road': return name + ' built a road.';
      case 'settle': return name + ' built a settlement.';
      case 'city': return name + ' upgraded to a city.';
      case 'trade': return name + ' traded 4 ' + RNAMES[mv.give] + ' for 1 ' + RNAMES[mv.get] + ' (bank).';
      case 'dev': return name + ' bought a development card.';
      case 'play-knight': return name + ' played a Knight (placing the robber).';
      case 'play-road': return name + ' used a Road card.';
      case 'play-plenty': return name + ' used Year of Plenty (' + RNAMES[mv.r] + ').';
      case 'play-monopoly': return name + ' used Monopoly (' + RNAMES[mv.r] + ').';
      case 'robber':
        if (s.lastSteal) return name + ' moved the robber and stole a ' + RNAMES[s.lastSteal.r] + ' from ' + sideName(s.lastSteal.p) + '.';
        return name + ' moved the robber.';
      case 'trade-offer': {
        var gl = [], wl = [];
        for (var gi = 0; gi < 5; gi++) {
          if (mv.give[gi]) gl.push(mv.give[gi] + ' ' + RNAMES[gi]);
          if (mv.want[gi]) wl.push(mv.want[gi] + ' ' + RNAMES[gi]);
        }
        return name + ' offered ' + gl.join(', ') + ' for ' + wl.join(', ') + '.';
      }
      case 'trade-accept': return name + ' accepted the trade.';
      case 'trade-decline': return name + ' declined the trade.';
      case 'end':
        if (s.last) {
          var sum = s.last.a + s.last.b;
          if (sum === 7) return name + ' rolled 7 \u2014 discards, then the robber moves.';
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

  function aiRobber(s, side) {
    // block the opponent's most productive hex the robber does not already sit on
    var q = 1 - side;
    var best = null, bestScore = -1e9;
    for (var h = 0; h < NH; h++) {
      if (h === s.robber) continue;
      var sc = 0, cs = HEX_CORNERS[h];
      for (var k = 0; k < 6; k++) {
        var vi = vMap[vkey(cs[k][0], cs[k][1])];
        var o = s.sites[vi];
        if (o && o.p === q) sc += pipValue(s, h) * (o.city ? 2 : 1);
      }
      sc += Math.random() * 1.5;
      if (sc > bestScore) { bestScore = sc; best = { type: 'robber', h: h }; }
    }
    return best;
  }

  function aiMove(s, side) {
    side = parseInt(side, 10);
    if (s.over !== null || s.turn !== side) return null;
    if (s.phase === 'setup') return aiSetup(s, side);
    if (s.pending === 'robber') return aiRobber(s, side);
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

    // settle: build out the production base first; favor hexes that supply what is missing.
    // (any vertexFree vertex is legal — no network-connectivity rule in Catan)
    if (own < MAX_SETTLE && canAfford(r, SETTLE)) {
      var lacks = settleLacks(r);
      for (var v = 0; v < NV; v++) {
        if (!vertexFree(s, v)) continue;
        var sc = 50 + hexPipsAt(s, v) * 10;
        var rs = hexResSet(v);
        for (var li = 0; li < lacks.length; li++) if (rs[lacks[li]]) sc += 15; // diversify
        var newRes = 0; for (var nrk in rs) if (!prod[nrk]) newRes++;
        sc += newRes * 30; // big bonus for adding resources the player does not produce
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
    // road: expansion toward a free, productive future settlement site. Deliberately
    // NOT gated on settle affordability — reaching new hexes is the only way out of a
    // resource drought, so a stuck player keeps building roads.
    if (canAfford(r, ROAD) && roadCount(s, side) < MAX_ROAD) {
      var lacksR = settleLacks(r);
      for (var e = 0; e < NE; e++) {
        if (!canBuildRoad(s, side, e, rc)) continue;
        var a = EDGE[e][0], b = EDGE[e][1];
        var cand = -1;
        var ends = [a, b];
        for (var ei = 0; ei < 2; ei++) {
          var vv = ends[ei];
          if (rc[vv] || !vertexFree(s, vv)) continue;
          var rs2 = hexResSet(vv);
          var d = 0;
          for (var lk = 0; lk < lacksR.length; lk++) if (rs2[lacksR[lk]]) d++;
          var nres = 0; for (var nrk2 in rs2) if (!prod[nrk2]) nres++;
          var esc = hexPipsAt(s, vv) * 2 + d * 10 + nres * 15;
          if (esc > cand) cand = esc;
        }
        if (cand < 2) continue; // leads nowhere buildable/productive
        var rsc = 8 + cand;
        if (own >= 4 && roadCount(s, side) >= LONGEST_MIN - 1) rsc += 12; // chase the bonus once built out
        consider({ type: 'road', e: e }, rsc);
      }
    }
    // dev: only on a clear surplus hand, so resources are saved toward a 4:1
    // trade (the bootstrap out of a thin production profile) rather than spent
    if (s.devDeck.length > 0 && canAfford(r, DEV)) {
      var handTotal = r[0] + r[1] + r[2] + r[3] + r[4];
      if (handTotal >= 8) consider({ type: 'dev' }, 10); // endgame-only: save resources toward settlements
    }
    // play dev cards (at most one per turn, officially)
    if (s.devUsed === null) {
      if (s.dev[side][0] >= 1) consider({ type: 'play-knight' }, s.army[side] === ARMY_MIN - 1 ? 55 : 10);
      if (s.dev[side][1] >= 1) {
        for (var e2 = 0; e2 < NE; e2++) if (canBuildRoad(s, side, e2, rc)) consider({ type: 'play-road', e: e2 }, 25);
      }
      if (s.dev[side][2] >= 1) {
        for (var rp = 0; rp < 5; rp++) if (s.bank[rp] >= 2) consider({ type: 'play-plenty', r: rp }, 12 + (r[rp] < 2 ? 20 : 0));
      }
      if (s.dev[side][3] >= 1) {
        // Monopoly steals ALL of one resource from the opponent: play it when they hold a fat pile
        for (var mm = 0; mm < 5; mm++) {
          var mheld = s.res[1 - side][mm];
          if (mheld >= 1) consider({ type: 'play-monopoly', r: mm }, mheld >= 3 ? 40 : 15 + mheld * 5);
        }
      }
    }
    // 4:1 trade — relief from holding 8+, and (when no settle is affordable) a
    // strategic buy of a missing settlement resource to fund the next build.
    var lacks2 = settleLacks(r);
    var canSettleNow = own < MAX_SETTLE && canAfford(r, SETTLE);
    for (var g = 0; g < 5; g++) {
      if (r[g] < 4) continue;
      for (var t = 0; t < 5; t++) {
        if (t === g) continue;
        if (s.bank[t] < 1) continue;
        var tsc = 25;
        if (!canSettleNow && lacks2.indexOf(t) >= 0) tsc = 45; // convert surplus toward the missing build resource
        consider({ type: 'trade', give: g, get: t }, tsc);
      }
    }
    // offer a player trade: a surplus card for a settlement resource I am missing
    // (cooldown after a declined offer so the AI cannot loop offer/decline)
    var cooling = s.tradeCooldown && s.tradeCooldown.p === side && s.seq - s.tradeCooldown.seq < 4;
    if (!s.pendingTrade && !cooling) {
      // Simulate the recipient's own acceptance test against their REAL hand so the
      // offerer only proposes swaps the recipient will actually take (kills the
      // offer/decline loop). The bot runs with full state, so this is safe.
      var oppSide = 1 - side, orr = s.res[oppSide], oppLacks = settleLacks(orr);
      var lacks3 = settleLacks(r);
      for (var g3 = 0; g3 < 5; g3++) {
        if (r[g3] < 2) continue; // offer only a card I can spare (keep one in hand)
        for (var t3 = 0; t3 < 5; t3++) {
          if (t3 === g3 || lacks3.indexOf(t3) < 0) continue; // only want a missing build res
          // recipient's view: value of the card they receive, pain of what they pay
          var gainVal2 = oppLacks.indexOf(g3) >= 0 ? 14 : (orr[g3] < 2 ? 8 : 0);
          var costPain2 = orr[t3] < 2 ? 10 : (orr[t3] >= 4 ? -4 : 0);
          if (gainVal2 - costPain2 < 6) continue; // they would decline -> don't bother
          var give = [0, 0, 0, 0, 0], want = [0, 0, 0, 0, 0];
          give[g3] = 1; want[t3] = 1;
          var osc = 16 + (r[t3] < 1 ? 10 : 0) + Math.random() * 3;
          consider({ type: 'trade-offer', give: give, want: want }, osc);
        }
      }
    }
    // answer a standing trade from the opponent
    if (s.pendingTrade && s.pendingTrade.from !== side) {
      var pt = s.pendingTrade;
      var gainIdx = -1, costIdx = -1, net = 0;
      for (var ni = 0; ni < 5; ni++) {
        net += pt.give[ni] - pt.want[ni];
        if (pt.give[ni] && gainIdx < 0) gainIdx = ni;
        if (pt.want[ni] && costIdx < 0) costIdx = ni;
      }
      // value of what I receive
      var gainVal = 0;
      if (gainIdx >= 0) gainVal = lacks2.indexOf(gainIdx) >= 0 ? 14 : (r[gainIdx] < 2 ? 8 : 0);
      // pain of what I must pay out
      var costPain = 0;
      if (costIdx >= 0) costPain = r[costIdx] < 2 ? 10 : (r[costIdx] >= 4 ? -4 : 0);
      var ascr = net * 8 + gainVal - costPain;
      if (!canAfford(r, pt.want)) {
        consider({ type: 'trade-decline' }, 30);
      } else if (ascr >= 6) {
        consider({ type: 'trade-accept' }, ascr);
      } else {
        consider({ type: 'trade-decline' }, 24);
      }
    }
    // end
    consider({ type: 'end' }, 5);

    if (!best) best = { type: 'end' };
    return best;
  }

  function aiSetup(s, side) {
    var cands = legalMoves(s, side);
    if (!cands.length) return null;
    var best = null, bestScore = -1e9;
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      var sc;
      if (c.type === 'setup') {
        sc = hexPipsAt(s, c.v);
        // prioritize a diverse production base: bonus per distinct resource this
        // settlement adds (avoids the narrow 2-resource profile that deadlocks 2P)
        function resAt(vv) { var set = {}, hs = VERTEX_HEXES[vv]; for (var ii = 0; ii < hs.length; ii++) { var t = TERRAIN_RES[s.terrain[hs[ii]]]; if (t >= 0) set[t] = true; } return set; }
        var have = {};
        for (var v0 = 0; v0 < NV; v0++) {
          var o0 = s.sites[v0];
          if (o0 && o0.p === side) { var ps0 = resAt(v0); for (var k0 in ps0) have[k0] = true; }
        }
        var rs0 = resAt(c.v), newKinds = 0;
        for (var nk in rs0) if (!have[nk]) newKinds++;
        sc += newKinds * 8; // strong diversity push to avoid narrow 2-resource deadlocks
        // keep clear of the opponent's settlements
        for (var v2 = 0; v2 < NV; v2++) {
          var o = s.sites[v2];
          if (o && o.p !== side && VADJ[c.v].indexOf(v2) >= 0) sc -= 4;
        }
      } else {
        // setup road: score by the pips of the hexes the edge touches
        var hs = EDGE_HEXES[c.e], tot = 0;
        for (var hi = 0; hi < hs.length; hi++) tot += pipValue(s, hs[hi]);
        sc = tot;
      }
      sc += Math.random() * 2;
      if (sc > bestScore) { bestScore = sc; best = c; }
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
