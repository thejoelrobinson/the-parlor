/* games/catan/logic.js — Catan: island edition (2 players, fixed island, trimmed rules).
 *
 * A fixed island, no layout RNG: a central desert hex surrounded by wheat, wheat,
 * lumber, lumber, brick, ore. The 12 build sites are the shared vertices of the
 * six-hex ring. Both players start with 2 of each resource.
 *
 * On your turn you may repeat any number of these, then end the turn:
 *   build — pay 1 of each resource -> settlement  (+1 VP, produces 1 per matching roll)
 *   city  — pay 2 wheat + 2 ore   -> upgrade one of your settlements (+1 VP, produces 2)
 *   trade — 3 of any resource     -> 1 of any other resource
 *   end   — pass; the next player rolls 2d6 and gains production from all of their
 *           settlements/cities on hexes carrying that number.
 *
 * First to 5 VP wins. Deliberately trimmed: no roads, robber, development cards,
 * hand limit, or negotiation. State is ~200 bytes of fully public plain JSON.
 *
 * Pure logic only (no DOM, no timers) so it runs in Node. See CONTRACT.md.
 * Render layer: games/catan/view.js. Manifest: games/catan/index.js.
 */
(function (global) {
  'use strict';

  /* ---------- fixed board ---------- */

  var RNAMES = ['wheat', 'lumber', 'brick', 'ore'];
  var RSHORT = ['W', 'L', 'B', 'O'];
  var TIDX = { wheat: 0, lumber: 1, brick: 2, ore: 3 };
  var TERRAIN = [null, 'wheat', 'wheat', 'lumber', 'lumber', 'brick', 'ore']; // index = hex id; 0 = desert
  var ROLLS = { 1: 3, 2: 9, 3: 5, 4: 8, 5: 4, 6: 6 }; // 2/7/10/11 carry nothing (no robber)
  var WIN_VP = 5;
  var BUILD_COST = [1, 1, 1, 1];
  var CITY_COST = [2, 0, 0, 2];
  var SITES = [
    [0, 2, 3], [0, 1, 2], [0, 1, 6], [0, 5, 6],
    [0, 4, 5], [0, 3, 4], [1, 2], [1, 6],
    [2, 3], [3, 4], [4, 5], [5, 6]
  ]; // site id -> bordering hex ids (pointy-top ring; the 6 outer tips are not sites)

  /* ---------- state ----------
   * { res: [[w,l,b,o],[w,l,b,o]], sites: (null|{p:0|1,city:bool})[12],
   *   turn: 0|1, last: null|{a,b,made:[w,l,b,o]}, over: null|0|1 }
   */

  function canAfford(res, cost) {
    for (var i = 0; i < 4; i++) if (res[i] < cost[i]) return false;
    return true;
  }
  function pay(res, cost) {
    for (var i = 0; i < 4; i++) res[i] -= cost[i];
  }
  function vp(s, p) {
    var n = 0;
    for (var v = 0; v < 12; v++) {
      var o = s.sites[v];
      if (o && o.p === p) n += o.city ? 2 : 1;
    }
    return n;
  }
  function owned(s, p) {
    var n = 0;
    for (var v = 0; v < 12; v++) {
      var o = s.sites[v];
      if (o && o.p === p) n++;
    }
    return n;
  }
  function produce(s, p, roll) {
    var made = [0, 0, 0, 0];
    for (var v = 0; v < 12; v++) {
      var o = s.sites[v];
      if (!o || o.p !== p) continue;
      var hs = SITES[v];
      for (var k = 0; k < hs.length; k++) {
        var h = hs[k];
        if (TERRAIN[h] && ROLLS[h] === roll) made[TIDX[TERRAIN[h]]] += o.city ? 2 : 1;
      }
    }
    for (var r = 0; r < 4; r++) s.res[p][r] += made[r];
    return made;
  }
  function startTurn(s) {
    var a = 1 + Math.floor(Math.random() * 6);
    var b = 1 + Math.floor(Math.random() * 6);
    s.last = { a: a, b: b, made: produce(s, s.turn, a + b) };
  }
  function newState() {
    var s = {
      res: [[2, 2, 2, 2], [2, 2, 2, 2]],
      sites: [null, null, null, null, null, null, null, null, null, null, null, null],
      turn: 0,
      moves: 0, // total actions taken — keeps every turn visibly distinct in the public state
      last: null,
      over: null
    };
    startTurn(s); // player 1 (side 0) rolls first
    return s;
  }

  /* ---------- moves ----------
   * canonical: {type:'build',v} | {type:'city',v} | {type:'trade',give,get} | {type:'end'}
   */

  function legalMoves(s, side) {
    if (s.over !== null || String(s.turn) !== String(side)) return [];
    var p = s.turn, r = s.res[p], out = [];
    if (owned(s, p) < 3 && canAfford(r, BUILD_COST)) {
      for (var v = 0; v < 12; v++) if (!s.sites[v]) out.push({ type: 'build', v: v });
    }
    if (canAfford(r, CITY_COST)) {
      for (var u = 0; u < 12; u++) {
        var o = s.sites[u];
        if (o && o.p === p && !o.city) out.push({ type: 'city', v: u });
      }
    }
    for (var gv = 0; gv < 4; gv++) {
      if (r[gv] < 3) continue;
      for (var tv = 0; tv < 4; tv++) if (tv !== gv) out.push({ type: 'trade', give: gv, get: tv });
    }
    out.push({ type: 'end' });
    return out;
  }

  function applyMove(s, m) {
    if (s.over !== null) return;
    s.moves += 1;
    var p = s.turn;
    if (m.type === 'build') {
      pay(s.res[p], BUILD_COST);
      s.sites[m.v] = { p: p, city: false };
      if (vp(s, p) >= WIN_VP) s.over = p;
    } else if (m.type === 'city') {
      pay(s.res[p], CITY_COST);
      s.sites[m.v].city = true;
      if (vp(s, p) >= WIN_VP) s.over = p;
    } else if (m.type === 'trade') {
      s.res[p][m.give] -= 3;
      s.res[p][m.get] += 1;
    } else if (m.type === 'end') {
      s.turn = 1 - s.turn;
      startTurn(s);
    }
  }

  function currentSide(s) {
    return s.over === null ? String(s.turn) : null;
  }
  function sideName(side) {
    return 'Player ' + (parseInt(side, 10) + 1);
  }
  function outcome(s) {
    if (s.over === null) return { over: false };
    return { over: true, text: sideName(s.over) + ' wins — ' + WIN_VP + ' VP', winner: String(s.over) };
  }
  function viewFor(s) {
    return s; // fully public game
  }

  /* ---------- AI (greedy, O(1)) ----------
   * Every action either strictly decreases the resource total (build/city/trade)
   * or ends the turn, and VP only rises, so the game always reaches 5 VP.
   */

  function aiMove(s, side) {
    if (s.over !== null || String(s.turn) !== String(side)) return null;
    var p = s.turn, r = s.res[p], v, k, o;

    // 1. Upgrade to a city if we can afford it.
    if (r[0] >= 2 && r[3] >= 2) {
      for (v = 0; v < 12; v++) {
        o = s.sites[v];
        if (o && o.p === p && !o.city) return { type: 'city', v: v };
      }
    }

    // 2. Build a settlement if affordable (most productive empty site, tie -> lowest id).
    if (owned(s, p) < 3 && canAfford(r, BUILD_COST)) {
      var best = -1, bestScore = -1;
      for (v = 0; v < 12; v++) {
        if (s.sites[v]) continue;
        var score = 0;
        for (k = 0; k < SITES[v].length; k++) if (TERRAIN[SITES[v][k]]) score++;
        if (score > bestScore) { bestScore = score; best = v; }
      }
      if (best >= 0) return { type: 'build', v: best };
    }

    // 3. Trade 3:1 if it unlocks a build or a city upgrade on the next action.
    for (var gv = 0; gv < 4; gv++) {
      if (r[gv] < 3) continue;
      for (var tv = 0; tv < 4; tv++) {
        if (tv === gv) continue;
        var r2 = r.slice();
        r2[gv] -= 3; r2[tv] += 1;
        if (owned(s, p) < 3 && canAfford(r2, BUILD_COST)) return { type: 'trade', give: gv, get: tv };
        if (r2[0] >= 2 && r2[3] >= 2) {
          for (v = 0; v < 12; v++) {
            o = s.sites[v];
            if (o && o.p === p && !o.city) return { type: 'trade', give: gv, get: tv };
          }
        }
      }
    }

    // 4. Nothing else pays: roll and pass.
    return { type: 'end' };
  }

  function describeMove(s, m) {
    if (m.type === 'end') {
      var actor = 1 - s.turn; // turn already flipped by applyMove
      var parts = [];
      for (var i = 0; i < 4; i++) if (s.last.made[i]) parts.push('+' + s.last.made[i] + ' ' + RNAMES[i]);
      return sideName(actor) + ' ends turn; ' + sideName(s.turn) + ' rolls ' + s.last.a + '+' + s.last.b +
        '=' + (s.last.a + s.last.b) + (parts.length ? ', gains ' + parts.join(', ') : ', gains nothing');
    }
    var who = sideName(s.turn);
    if (m.type === 'build') return who + ' builds a settlement at V' + m.v;
    if (m.type === 'city') return who + ' upgrades V' + m.v + ' to a city';
    return who + ' trades 3 ' + RNAMES[m.give] + ' for 1 ' + RNAMES[m.get];
  }

  var logic = {
    RNAMES: RNAMES, RSHORT: RSHORT, TIDX: TIDX, TERRAIN: TERRAIN, ROLLS: ROLLS,
    WIN_VP: WIN_VP, BUILD_COST: BUILD_COST, CITY_COST: CITY_COST, SITES: SITES,
    canAfford: canAfford, pay: pay, vp: vp, owned: owned, produce: produce,
    startTurn: startTurn, newState: newState, legalMoves: legalMoves,
    applyMove: applyMove, currentSide: currentSide, sideName: sideName,
    outcome: outcome, viewFor: viewFor, aiMove: aiMove, describeMove: describeMove
  };

  global.PARLOR = global.PARLOR || {};
  global.PARLOR['catan'] = global.PARLOR['catan'] || {};
  global.PARLOR['catan'].logic = logic;
  if (typeof module !== 'undefined' && module.exports) module.exports = logic;
})(typeof window !== 'undefined' ? window : globalThis);
