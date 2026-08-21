/* games/catan/index.js — Catan manifest: css + game literal.
 * Loads last of the three catan files; pulls logic (L) and view (V) off
 * global.PARLOR['catan'] and registers global.Games['catan'].
 */
(function (global) {
  'use strict';

  var L = global.PARLOR['catan'].logic;
  var V = global.PARLOR['catan'].view;

  var css = [
    '.cat-board{position:relative;width:min(100%,540px);aspect-ratio:1/1;margin:0 auto;',
    'background:linear-gradient(160deg,#efe8d6,#e3dac1);border:1px solid #d3cdbd;border-radius:18px;overflow:hidden;box-shadow:inset 0 1px 5px rgba(28,33,30,.1)}',
    '.cat-hex{position:absolute;width:33.334%;height:40%;transform:translate(-50%,-50%);pointer-events:none;',
    'clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px}',
    '.cat-hex.h0{left:50%;top:50%}.cat-hex.h1{left:83.334%;top:50%}.cat-hex.h2{left:66.667%;top:20%}',
    '.cat-hex.h3{left:33.333%;top:20%}.cat-hex.h4{left:16.667%;top:50%}.cat-hex.h5{left:33.333%;top:80%}.cat-hex.h6{left:66.667%;top:80%}',
    '.cat-hex.t-wheat{background:#d4a943}.cat-hex.t-lumber{background:#577f5f}.cat-hex.t-brick{background:#a3543a}',
    '.cat-hex.t-ore{background:#6f6b78}.cat-hex.t-desert{background:#d9c9a4}',
    '.cat-roll{width:32%;aspect-ratio:1/1;border-radius:50%;background:#fbf6e7;border:1px solid rgba(28,33,30,.3);',
    'color:#3a3126;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:clamp(10px,2.6vw,15px);line-height:1;box-shadow:0 1px 3px rgba(28,33,30,.3)}',
    '.cat-tlabel{color:rgba(255,253,244,.92);font-size:clamp(7px,1.7vw,10px);font-weight:600;letter-spacing:.08em;',
    'text-transform:uppercase;text-shadow:0 1px 2px rgba(28,33,30,.45)}',
    '.cat-site{position:absolute;width:8.5%;height:10.2%;transform:translate(-50%,-50%);border-radius:50%;',
    'border:2px solid rgba(28,33,30,.55);background:#faf9f5;padding:0;margin:0;cursor:default;box-shadow:0 1px 3px rgba(28,33,30,.25);transition:transform .12s,box-shadow .12s}',
    '.cat-site.s0{left:50%;top:30%}.cat-site.s1{left:66.667%;top:40%}.cat-site.s2{left:66.667%;top:60%}',
    '.cat-site.s3{left:50%;top:70%}.cat-site.s4{left:33.333%;top:60%}.cat-site.s5{left:33.333%;top:40%}',
    '.cat-site.s6{left:83.333%;top:30%}.cat-site.s7{left:83.333%;top:70%}.cat-site.s8{left:50%;top:10%}',
    '.cat-site.s9{left:16.667%;top:30%}.cat-site.s10{left:16.667%;top:70%}.cat-site.s11{left:50%;top:90%}',
    '.cat-site.p0{background:#1e6b47;border-color:#0d4a2b}.cat-site.p1{background:#2e4d74;border-color:#1d3350}',
    '.cat-site.city{border-radius:26%;box-shadow:0 0 0 2px #f2b632,0 0 0 4px rgba(242,182,50,.4),0 2px 6px rgba(28,33,30,.35)}',
    '.cat-site.can{cursor:pointer;animation:cat-pulse 1.2s ease-in-out infinite}',
    '.cat-site.can:hover,.cat-site.can:active{transform:translate(-50%,-50%) scale(1.2)}',
    '.cat-site.city-can{cursor:pointer;box-shadow:0 0 0 3px rgba(242,182,50,.9),0 0 0 5px rgba(242,182,50,.4),0 2px 6px rgba(28,33,30,.35)}',
    '.cat-site.city-can:hover,.cat-site.city-can:active{transform:translate(-50%,-50%) scale(1.18)}',
    '@keyframes cat-pulse{0%,100%{box-shadow:0 0 0 2px rgba(194,147,48,.3),0 1px 3px rgba(28,33,30,.25)}',
    '50%{box-shadow:0 0 0 6px rgba(194,147,48,.55),0 1px 3px rgba(28,33,30,.25)}}',
    '.cat-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:center;width:min(100%,540px);margin:12px auto 0}',
    '.cat-trade{background:#fbfaf7;border:1px solid #d3cdbd;color:#79817a;font:600 12px/1 Inter,system-ui,sans-serif;',
    'padding:7px 9px;border-radius:9px;cursor:default;transition:border-color .12s,color .12s,transform .12s}',
    '.cat-trade.can{border-color:#c29330;color:#7d611d;background:#faf3e2;cursor:pointer}',
    '.cat-trade.can:hover{transform:translateY(-1px);box-shadow:0 2px 6px rgba(28,33,30,.15)}',
    '.cat-end{margin-left:4px;background:#1c211e;border:1px solid #1c211e;color:#f5f3ed;font:700 13px/1 Inter,system-ui,sans-serif;',
    'padding:9px 15px;border-radius:999px;cursor:default}',
    '.cat-end.can{cursor:pointer}.cat-end.can:hover{background:#2a322d}',
    '.cat-last{width:min(100%,540px);margin:10px auto 0;font-size:12.5px;color:#79817a;text-align:center}',
    '@media (prefers-reduced-motion:reduce){.cat-site.can{animation:none}}'
  ].join('\n');

  var game = {
    id: 'catan',
    title: 'Catan',
    blurb: 'Settle the island. Roll the dice, gather wheat, lumber, brick and ore — first to 5 points wins.',
    hint: 'Build settlements (1 of each resource) and upgrade to cities (2 wheat + 2 ore). Trading 3 of a resource for 1 of another is always on offer. End your turn to roll the dice and collect.',
    sideList: ['0', '1'],
    pickSide: true,
    sideName: L.sideName,
    resultIcon: '<svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true"><path d="M32 6 54.5 19v26L32 58 9.5 45V19z" fill="none" stroke="currentColor" stroke-width="5"/><circle cx="32" cy="24" r="4.5"/><circle cx="32" cy="42" r="4.5"/></svg>',
    resultTone(text, mySide) { const mine = this.sideName(mySide); return text.indexOf(mine + ' wins') >= 0 ? 'win' : 'lose'; },
    css: css,
    newState: L.newState,
    currentSide: L.currentSide,
    legalMoves: L.legalMoves,
    applyMove: L.applyMove,
    outcome: L.outcome,
    viewFor: L.viewFor,
    aiMove: L.aiMove,
    describeMove: L.describeMove,
    render: V.render,
    renderInfo: V.renderInfo
  };

  global.Games = global.Games || {};
  global.Games['catan'] = game;
  if (typeof module !== 'undefined' && module.exports) module.exports = game;
})(typeof window !== 'undefined' ? window : globalThis);
