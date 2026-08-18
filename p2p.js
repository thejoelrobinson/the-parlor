/* p2p.js — server-less WebRTC data channel with copy-and-paste signaling.
 *
 * The two browsers link directly (ICE via public STUN, so it also works across
 * the internet in most NAT situations). Signaling is manual: the host creates a
 * short "room code" (offer), the guest pastes it and generates an "answer code",
 * which the host pastes back. The codes can travel by Bluetooth, SMS, or any
 * messenger — no server is involved in the game traffic itself.
 */
(function (global) {
  'use strict';

  let pc = null, dc = null, role = null;
  let onOpenCb = null, onMessageCb = null, onFailCb = null;

  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.linuxfoundation.org:3478' },
      { urls: 'stun:stun.l.google.com:19302' }
    ]
  };

  const enc = (d) => btoa(unescape(encodeURIComponent(JSON.stringify(d))));
  const dec = (s) => JSON.parse(decodeURIComponent(escape(atob(s.trim()))));

  function fail(msg) { if (onFailCb) onFailCb(msg); }

  function wire() {
    dc.onopen = () => { if (onOpenCb) onOpenCb(); };
    dc.onmessage = (e) => {
      try { if (onMessageCb) onMessageCb(JSON.parse(e.data)); }
      catch (err) { /* ignore malformed messages */ }
    };
    dc.onclose = () => fail('Connection closed.');
    dc.onerror = () => fail('Connection error.');
  }

  function newPC() {
    pc = new RTCPeerConnection(rtcConfig);
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'failed') fail('Connection failed — check that both devices are online and try again.');
      else if (s === 'disconnected') fail('Connection lost.');
    };
    return pc;
  }

  /** Host: create the room. Returns a promise for the room (offer) code. */
  async function host() {
    close();
    role = 'host';
    newPC();
    dc = pc.createDataChannel('parlor', { ordered: true });
    wire();
    await pc.setLocalDescription(await pc.createOffer());
    return enc(pc.localDescription);
  }

  /** Host: paste the guest's answer code to complete the link. */
  async function acceptAnswer(answerCode) {
    if (!pc || role !== 'host') throw new Error('Create a room first.');
    await pc.setRemoteDescription(dec(answerCode));
  }

  /** Guest: paste the room code, returns a promise for the answer code. */
  async function join(offerCode) {
    close();
    role = 'guest';
    newPC();
    pc.ondatachannel = (e) => { dc = e.channel; wire(); };
    await pc.setRemoteDescription(dec(offerCode));
    await pc.setLocalDescription(await pc.createAnswer());
    return enc(pc.localDescription);
  }

  function send(obj) {
    if (dc && dc.readyState === 'open') dc.send(JSON.stringify(obj));
  }

  function close() {
    try { if (dc) dc.close(); } catch (e) { /* noop */ }
    try { if (pc) pc.close(); } catch (e) { /* noop */ }
    dc = null; pc = null;
  }

  global.P2P = {
    host, join, acceptAnswer, send, close,
    get role() { return role; },
    get open() { return !!(dc && dc.readyState === 'open'); },
    set onOpen(cb) { onOpenCb = cb; },
    set onMessage(cb) { onMessageCb = cb; },
    set onFail(cb) { onFailCb = cb; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
