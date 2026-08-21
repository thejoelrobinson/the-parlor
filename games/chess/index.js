/* games/chess/index.js — Chess: css + game manifest. Registers global.Games['chess']. */
(function (global) {
  'use strict';

  const L = global.PARLOR['chess'].logic;
  const V = global.PARLOR['chess'].view;
  const { newState, currentSide, legalMoves, applyMove, outcome, viewFor, aiMove, describeMove } = L;
  const { render, renderInfo } = V;

  const css = [
    '.chess-board{position:relative;display:grid;grid-template-columns:repeat(8,1fr);width:min(100%,540px);margin:0 auto;border:1px solid #d9d2c0;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(28,33,30,.14), 0 10px 30px rgba(28,33,30,.10)}',
    '.chess-sq{position:relative;aspect-ratio:1;touch-action:manipulation;display:flex;align-items:center;justify-content:center}',
    '.chess-sq.light{background:#f0e9d8}',
    '.chess-sq.dark{background:#5c7263}',
    '.chess-pc{font-size:clamp(20px,8.5vw,42px);line-height:1;user-select:none;pointer-events:none;transition:transform .14s var(--ease-spring)}',
    '.chess-pc .pc-glyph{display:inline-block;line-height:1}',
    '.chess-pc.white{color:#f7f2e5;text-shadow:-1px 0 0 rgba(28,33,30,.7),1px 0 0 rgba(28,33,30,.7),0 -1px 0 rgba(28,33,30,.7),0 1px 0 rgba(28,33,30,.7),0 2px 4px rgba(28,33,30,.4)}',
    '.chess-pc.black{color:#23282b;text-shadow:0 1px 2px rgba(255,255,255,.35)}',
    '.chess-pc.deal{animation:pc-deal .3s var(--ease-out) both}',
    '.chess-pc.land .pc-glyph{animation:pc-land .34s var(--ease-spring) .1s both}',
    '.chess-pc.ghost{position:absolute;display:flex;align-items:center;justify-content:center;opacity:.95}',
    '.chess-sq.own{cursor:pointer}',
    '.chess-sq.own:hover{box-shadow:inset 0 0 0 3px rgba(22,104,63,.45)}',
    '.chess-sq.own:hover .chess-pc{transform:translateY(-3px) scale(1.06)}',
    '.chess-sq.sel{outline:3px solid #16683f;outline-offset:-3px}',
    '.chess-sq.sel .chess-pc{transform:scale(1.12)}',
    '.chess-sq.check{animation:check-pulse 1.1s ease-in-out infinite}',
    '.chess-sq.tgt{cursor:pointer}',
    '.chess-sq.tgt::after{content:"";position:absolute;width:28%;height:28%;border-radius:50%;background:rgba(22,104,63,.9);box-shadow:0 1px 4px rgba(0,0,0,.3);pointer-events:none;animation:dot-in .16s var(--ease-spring) both}',
    '.chess-sq.tgt.occ::after{width:86%;height:86%;background:transparent;border:4px solid rgba(22,104,63,.9)}',
    '.chess-sq.lm{box-shadow:inset 0 0 0 3px rgba(194,147,48,.55)}',
    '.chess-sq.lm.lm-new{animation:chess-lm-flash .5s var(--ease-out) both}',
    '@keyframes chess-lm-flash{0%{box-shadow:inset 0 0 0 3px rgba(194,147,48,.55)}45%{box-shadow:inset 0 0 0 4px rgba(194,147,48,1)}100%{box-shadow:inset 0 0 0 3px rgba(194,147,48,.55)}}',
    '.chess-promo{display:flex;justify-content:center;gap:10px;margin-top:14px;animation:entry-in .24s var(--ease-out) both}',
    '.chess-promo .btn{width:52px;height:58px;padding:0;display:flex;align-items:center;justify-content:center;font-size:30px;line-height:1}',
    '.chess-promo .btn:last-child{width:auto;padding:0 16px;font-size:14px;font-weight:700;letter-spacing:.04em}',
    '.chess-last{width:min(100%,540px);margin:0 auto 8px;display:flex;align-items:center;justify-content:center;min-height:27px;padding:0 12px;font-size:15px;font-weight:700;letter-spacing:.04em;color:var(--ink);background:var(--surface);border:1px solid var(--hair-strong);border-radius:9px;box-shadow:var(--shadow-sm);animation:chess-last-in .3s var(--ease-out) both}',
    '.chess-last.still{animation:none}',
    '@keyframes chess-last-in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}',
    '.chess-over{position:absolute;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;pointer-events:none;background:rgba(245,243,237,.45)}',
    '.chess-overword{font-family:var(--font-display);font-weight:700;font-size:clamp(26px,7vw,44px);letter-spacing:.04em;color:var(--gold);text-shadow:0 2px 12px rgba(28,33,30,.28);animation:chess-stamp .55s var(--ease-spring) both}',
    '.chess-over.mate .chess-overword{color:var(--brick)}',
    '@keyframes chess-stamp{0%{opacity:0;transform:scale(1.7) rotate(-14deg)}60%{opacity:1;transform:scale(.96) rotate(-5deg)}100%{opacity:1;transform:scale(1) rotate(-7deg)}}'
  ].join('\n');

  const game = {
    id: 'chess',
    title: 'Chess',
    blurb: 'The classic. Full rules: castling, en passant, promotions, and every standard draw.',
    hint: 'Select a piece to see its legal moves, then click a highlighted square.',
    sideList: ['white', 'black'],
    pickSide: true,
    sideName(side) { return side === 'white' ? 'White' : 'Black'; },
    resultIcon: '<svg class="gicon-pawn" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true"><circle cx="32" cy="14" r="9.5"/><path d="M27 21.5h10v5H27z"/><rect x="19.5" y="26.5" width="25" height="6" rx="3"/><path d="M24.5 32.5 17.5 52h29L39.5 32.5z"/><rect x="12.5" y="54" width="39" height="8" rx="3.5"/></svg>',
    resultTone(text, mySide) { const mine = this.sideName(mySide); return text.indexOf(mine + ' wins') >= 0 ? 'win' : 'lose'; },
    css,
    newState,
    currentSide,
    legalMoves,
    applyMove,
    outcome,
    viewFor,
    aiMove,
    describeMove,
    render,
    renderInfo
  };

  global.Games = global.Games || {};
  global.Games['chess'] = game;
  if (typeof module !== 'undefined' && module.exports) module.exports = game;
})(typeof window !== 'undefined' ? window : globalThis);
