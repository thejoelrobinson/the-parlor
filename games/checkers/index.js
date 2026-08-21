/* games/checkers/index.js — Checkers: css + game manifest. Registers global.Games['checkers']. */
(function (global) {
  'use strict';

  const L = global.PARLOR['checkers'].logic;
  const V = global.PARLOR['checkers'].view;
  const { newState, currentSide, legalMoves, applyMove, outcome, viewFor, aiMove, describeMove } = L;
  const { render, renderInfo } = V;

  const css = [
    '.chk-board{position:relative;display:grid;grid-template-columns:repeat(8,1fr);width:min(100%,540px);margin:0 auto;border:1px solid #d9d2c0;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(28,33,30,.14), 0 10px 30px rgba(28,33,30,.10)}',
    '.chk-sq{position:relative;aspect-ratio:1;touch-action:manipulation;display:flex;align-items:center;justify-content:center}',
    '.chk-sq.light{background:#f0e9d8}',
    '.chk-sq.dark{background:#6d4f3d}',
    '.chk-wrap{width:74%;height:74%;position:relative;pointer-events:none;transition:transform .14s var(--ease-spring)}',
    '.chk-wrap.deal{animation:pc-deal .3s var(--ease-out) both}',
    '.chk-pc{width:100%;height:100%;border-radius:50%;position:relative;box-shadow:0 4px 8px rgba(0,0,0,.35), 0 8px 16px rgba(0,0,0,.18), inset 0 -6px 10px rgba(0,0,0,.34), inset 0 3px 6px rgba(255,255,255,.26), inset 0 0 0 1px rgba(0,0,0,.16);pointer-events:none}',
    '.chk-pc.land{animation:pc-land .34s var(--ease-spring) .1s both}',
    '.chk-pc.red{background:radial-gradient(circle at 35% 30%, #a34a38, #6e2118 74%)}',
    '.chk-pc.black{background:radial-gradient(circle at 35% 30%, #4a5866, #14191f 74%)}',
    '.chk-pc .crown{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#e8c15a;font-size:clamp(12px,3.2vw,24px);text-shadow:0 1px 3px rgba(0,0,0,.7), 0 0 9px rgba(232,193,90,.65)}',
    '.chk-pc.ck-crownrow{box-shadow:0 4px 8px rgba(0,0,0,.35), 0 8px 16px rgba(0,0,0,.18), inset 0 -6px 10px rgba(0,0,0,.34), inset 0 3px 6px rgba(255,255,255,.26), inset 0 0 0 2px rgba(232,193,90,.5), inset 0 0 9px rgba(232,193,90,.3)}',
    '.chk-pc.ghost{position:absolute;display:flex;align-items:center;justify-content:center;opacity:.95;box-shadow:0 1px 5px rgba(0,0,0,.4)}',
    '.chk-sq.own{cursor:pointer}',
    '.chk-sq.own:hover{box-shadow:inset 0 0 0 3px rgba(22,104,63,.45)}',
    '.chk-sq.own:hover .chk-wrap{transform:translateY(-3px) scale(1.04)}',
    '.chk-sq.sel{outline:3px solid #16683f;outline-offset:-3px}',
    '.chk-sq.sel .chk-wrap{transform:scale(1.08)}',
    '.chk-sq.tgt{cursor:pointer}',
    '.chk-sq.tgt::after{content:"";position:absolute;width:26%;height:26%;border-radius:50%;background:rgba(22,104,63,.9);box-shadow:0 1px 4px rgba(0,0,0,.3);pointer-events:none;animation:dot-in .16s var(--ease-spring) both}',
    '.chk-sq.must-jump{animation:ck-must 1.1s ease-in-out infinite}',
    '@keyframes ck-must{0%,100%{box-shadow:inset 0 0 0 2px rgba(232,193,90,.4), inset 0 0 10px rgba(232,193,90,.18)}50%{box-shadow:inset 0 0 0 5px rgba(232,193,90,.95), inset 0 0 20px rgba(232,193,90,.5)}}',
    '.ck-jumping .chk-sq.tgt{box-shadow:inset 0 0 12px rgba(232,193,90,.55)}',
    '.ck-jumping .chk-sq.tgt::after{background:rgba(216,160,54,.95);box-shadow:0 0 10px rgba(232,193,90,.8), 0 1px 4px rgba(0,0,0,.35)}',
    '.chk-sq.lm{box-shadow:inset 0 0 0 3px rgba(194,147,48,.55)}',
    '.chk-sq.lm.lm-new{animation:chk-lm-flash .5s var(--ease-out) both}',
    '@keyframes chk-lm-flash{0%{box-shadow:inset 0 0 0 3px rgba(194,147,48,.55)}45%{box-shadow:inset 0 0 0 4px rgba(194,147,48,1)}100%{box-shadow:inset 0 0 0 3px rgba(194,147,48,.55)}}',
    '.chk-pc.crowned .crown{animation:chk-crown .7s var(--ease-spring) .05s both}',
    '@keyframes chk-crown{0%{transform:scale(0) rotate(-30deg);opacity:0}60%{transform:scale(1.5) rotate(8deg);opacity:1}100%{transform:scale(1) rotate(0)}}',
    '.chk-last{width:min(100%,540px);margin:0 auto 8px;display:flex;align-items:center;justify-content:center;min-height:27px;padding:0 12px;font-size:15px;font-weight:700;letter-spacing:.04em;color:var(--ink);background:var(--surface);border:1px solid var(--hair-strong);border-radius:9px;box-shadow:var(--shadow-sm);animation:chk-last-in .3s var(--ease-out) both}',
    '.chk-last.still{animation:none}',
    '.chk-last.jump{border-color:var(--gold);animation:chk-last-in .3s var(--ease-out) both,chk-jump-pulse 1.4s ease-in-out .3s infinite}',
    '@keyframes chk-last-in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}',
    '@keyframes chk-jump-pulse{0%,100%{box-shadow:var(--shadow-sm)}50%{box-shadow:0 0 0 4px rgba(194,147,48,.30)}}',
    '.chk-over{position:absolute;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;pointer-events:none;background:rgba(245,243,237,.45)}',
    '.chk-overword{font-family:var(--font-display);font-weight:700;font-size:clamp(26px,7vw,44px);letter-spacing:.04em;color:var(--gold);text-shadow:0 2px 12px rgba(28,33,30,.28);animation:chk-stamp .55s var(--ease-spring) both}',
    '.chk-over.red .chk-overword{color:#a34433}',
    '.chk-over.black .chk-overword{color:#2e4d74}',
    '@keyframes chk-stamp{0%{opacity:0;transform:scale(1.7) rotate(-14deg)}60%{opacity:1;transform:scale(.96) rotate(-5deg)}100%{opacity:1;transform:scale(1) rotate(-7deg)}}'
  ].join('\n');

  const game = {
    id: 'checkers',
    title: 'Checkers',
    blurb: 'Mandatory captures, multi-jumps, crowning. Red moves first.',
    hint: 'Click a disc, then a highlighted square. Captures are forced.',
    sideList: ['red', 'black'],
    pickSide: true,
    sideName(side) { return side === 'red' ? 'Red' : 'Black'; },
    resultIcon: '<span class="gicon-discs"><i></i><i></i></span>',
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
  global.Games['checkers'] = game;
  if (typeof module !== 'undefined' && module.exports) module.exports = game;
})(typeof window !== 'undefined' ? window : globalThis);
