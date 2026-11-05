// Voice and video with the group (docs/multiplayer.md, lane 5; Aaron, 2026-11-04: "lets move the audio toggle up into the
// row with video and microphone ... If the user is in a world with no other users, video and microphone should
// disappear."). One object multiplayer.js makes on sign-in; it owns the row's microphone and camera toggles (index.html
// #micBtn, #camBtn, beside the sound toggle in #ctlRow), the self-view (#selfView), and a WebRTC peer connection to each
// group member in the same tile's room: a mesh, fine to about six.
//   - Who is here: a group member whose `pos` the hub relayed within PRESENT_MS (the hub relays positions only to group
//     members in the same room: the same world). The mic and camera toggles show while anyone is here and go when the
//     player is alone again (and then the mic and camera are turned off, the devices let go); joining or leaving
//     changes the row live. Both are off at first; the browser's prompt comes only with the first press. A refusal
//     shows on the button (`denied`, the reason in its title), not as an error; a press tries again.
//   - Signalling: the hub's `rtc` {to, tc, k: 'sdp' | 'ice' | 'state' | 'bye'}, relayed to the member's connection in the
//     same room only (hub.py m_rtc), carrying the sender's connection id `fc` (a member with two tabs talks to one).
//     The offer and answer follow the "perfect negotiation" pattern: the lower user id is the polite one and yields on
//     a collision. `state` {mic, cam} tells the others what is on. Nothing here is logged or kept: the media goes
//     peer to peer (ICE servers from the hub's welcome: public STUN, TURN when the hub has it), never through the hub,
//     never recorded. Peers see each other's IP addresses through ICE (docs/multiplayer.md says so).
//   - Voices: each member's audio is played through Web Audio (an HRTF PannerNode with distance falloff) on the
//     Soundscape's talk bus (sound.js talkBus: under its volume and mute), the panner kept at the member's wisp or body
//     (players.js posOf), so a voice comes from where they are. A muted <audio> element holds each remote stream too:
//     Chrome feeds a remote WebRTC stream to Web Audio only while a media element plays it.
//   - Speaking: an analyser per voice (and one on the player's own mic, for the mic button's glow); over SPEAK_RMS for a
//     moment is speaking, held SPEAK_HOLD_MS. players.js draws it on the member's name and edge avatar.
//   - Video: 320x240 at 15 fps, kept modest (VIDEO_BPS). The stream goes to players.js (media), which draws it as a small
//     rounded tile over the member in the world, scaled with distance, or in their avatar at the screen's edge when off
//     screen. The player's own camera is the self-view at the row's end.
// Debugging on window.__weVoice: peers, present, local, toggle('mic' | 'cam').

const PRESENT_MS = 6000;        // a member with no `pos` for this long has left this world (positions come at 5 Hz)
const TICK_MS = 50;             // the panners and the speaking analysers, 20 Hz (positions change at 5 Hz)
const SPEAK_RMS = 0.018, SPEAK_HOLD_MS = 350;
const VIDEO = { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15, max: 15 } };
const AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
const VIDEO_BPS = 300000;
const TALK_GAIN = 1.6;          // a voice into the talk bus (WebRTC's gain control leaves speech near -20 dBFS)
const PAN = { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 6, maxDistance: 10000, rolloffFactor: 1 };
const DEFAULT_ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
const WHY = {   // a refused device: the button's title
  NotAllowedError: 'blocked: allow it for this site in the browser, then press again',
  NotFoundError: 'none found on this device',
  NotReadableError: 'in use by another app',
  OverconstrainedError: 'not usable here',
};

export class Voice {
  // hub: hub.js Hub; row: {mic, cam, self} elements (index.html); onRow(): the row changed width (multiplayer.js layout).
  constructor({ hub, row, onRow = null }) {
    this.hub = hub; this.row = row; this.onRow = onRow;
    this.present = new Map();     // user id -> the time of their last pos here
    this.peers = new Map();       // user id -> peer
    this.states = new Map();      // user id -> {mic, cam}: what the member says is on (their `state`)
    this.local = { mic: null, cam: null, stream: new MediaStream() };   // the player's own tracks while on
    this.want = { mic: false, cam: false };
    this.busy = { mic: false, cam: false };
    this.denied = { mic: null, cam: null };   // the reason a device was refused (the button's state)
    this.players = null; this.sound = null;   // the world's (players.js RemotePlayers; () => sound.js Soundscape)
    this.together = false; this.speaking = false; this.speakT = 0; this.micTap = null;
    this.offs = [hub.on('rtc', d => this.got(d)), hub.on('close', () => this.closeAll()), hub.on('open', () => this.sync())];
    row.mic.onclick = () => this.toggle('mic');
    row.cam.onclick = () => this.toggle('cam');
    this.tick = setInterval(() => this.frame(), TICK_MS);
    this.ui();
    window.__weVoice = this;   // debugging handle
  }
  get me() { return this.hub.you?.id || ''; }

  // ---- who is here ------------------------------------------------------------------------------------------------------
  // The world's room was entered (room: {players, sound}) or left (null): out of a room no one is here.
  setRoom(room) {
    this.players = room?.players || null; this.sound = room?.sound || null;
    if (this.players) this.players.media ||= new Map();
    if (!room) { this.present.clear(); this.states.clear(); this.closeAll(); this.update(); }
  }
  // A group member's position came (multiplayer.js gotPos): they are here.
  seen(id) {
    if (!id || id === this.me || id.startsWith('fake-')) return;
    const fresh = !this.present.has(id);
    this.present.set(id, performance.now());
    if (fresh) this.update();
  }
  // A member gone (offline, another tile, a bye): not here.
  gone(id) {
    this.close(id); this.states.delete(id);
    if (this.present.delete(id)) this.update();
  }
  update() {
    const together = this.present.size > 0;
    if (together !== this.together) {
      this.together = together;
      if (!together) { this.set('mic', false); this.set('cam', false); this.closeAll(); }   // alone: off, and the devices let go
    }
    this.sync();
    this.ui();
  }
  // Every member here gets a peer while the player sends anything, and is told what is on.
  sync() {
    if (!this.hub.connected) return;
    const sending = !!(this.local.mic || this.local.cam);
    for (const id of this.present.keys()) {
      let p = this.peers.get(id);
      if (!p && sending) p = this.peer(id);
      if (p) this.attach(p);
      this.send(id, { k: 'state', mic: !!this.local.mic, cam: !!this.local.cam });
    }
  }

  // ---- the toggles ------------------------------------------------------------------------------------------------------
  toggle(kind) { return this.set(kind, !this.want[kind]); }
  async set(kind, on) {
    this.want[kind] = on;
    if (!on) {
      const t = this.local[kind]; this.local[kind] = null;
      if (t) { t.stop(); this.local.stream.removeTrack(t); }
      if (kind === 'mic') this.tapMic(null);
      for (const p of this.peers.values()) this.attach(p);
      this.sync(); this.ui();
      return false;
    }
    if (this.local[kind] || this.busy[kind] || !this.together) { this.ui(); return !!this.local[kind]; }
    this.busy[kind] = true; this.ui();
    let track = null;
    try {
      const s = await navigator.mediaDevices.getUserMedia(kind === 'mic' ? { audio: AUDIO } : { video: VIDEO });
      track = (kind === 'mic' ? s.getAudioTracks() : s.getVideoTracks())[0] || null;
      this.denied[kind] = track ? null : 'none found on this device';
    } catch (e) {
      this.denied[kind] = WHY[e?.name] || 'could not be started';
    }
    this.busy[kind] = false;
    if (track && (!this.want[kind] || !this.together)) { track.stop(); track = null; }   // turned off, or alone, while asking
    if (!track) { this.want[kind] = false; this.ui(); return false; }
    track.onended = () => { if (this.local[kind] === track) this.set(kind, false); };   // the device went away
    this.local[kind] = track; this.local.stream.addTrack(track);
    if (kind === 'mic') this.tapMic(track);
    this.sync(); this.ui();
    return true;
  }
  // the player's own speaking, for the mic button's glow
  tapMic(track) {
    if (this.micTap) { try { this.micTap.src.disconnect(); } catch (e) { /* gone */ } this.micTap = null; }
    const ctx = this.ctx(); if (!track || !ctx) return;
    const src = ctx.createMediaStreamSource(new MediaStream([track])), an = new AnalyserNode(ctx, { fftSize: 512 });
    src.connect(an);
    this.micTap = { src, an, buf: new Float32Array(an.fftSize), track };
  }
  ui() {
    const { mic, cam, self } = this.row;
    mic.hidden = cam.hidden = !this.together;
    for (const [kind, el, what] of [['mic', mic, 'microphone'], ['cam', cam, 'camera']]) {
      const on = !!this.local[kind], denied = !on && this.denied[kind];
      el.classList.toggle('on', on); el.classList.toggle('denied', !!denied); el.classList.toggle('wait', this.busy[kind]);
      el.setAttribute('aria-pressed', String(on));
      el.title = this.busy[kind] ? `${what}: asking the browser…` : denied ? `${what} ${denied}` : on ? `${what} on: the group here hears${kind === 'cam' ? ' and sees' : ''} you; press to turn it off` : `${what} off: press to talk with the group here`;
    }
    if (!this.local.mic) mic.classList.remove('speaking');
    const v = this.local.cam;
    if (v && self.srcObject?.getVideoTracks()[0] !== v) { self.srcObject = new MediaStream([v]); self.play?.().catch(() => {}); }
    if (!v && self.srcObject) self.srcObject = null;
    self.hidden = !v;
    this.onRow?.();
  }

  // ---- the peers --------------------------------------------------------------------------------------------------------
  send(id, m) {
    const p = this.peers.get(id);
    return this.hub.rtc({ to: id, ...(p?.fc ? { tc: p.fc } : {}), ...m });
  }
  peer(id) {
    const pc = new RTCPeerConnection({ iceServers: this.hub.ice?.length ? this.hub.ice : DEFAULT_ICE });
    const p = { id, fc: null, pc, polite: this.me < id, making: false, ignore: false, senders: { mic: null, cam: null }, stream: null, el: null, src: null, an: null, pan: null, gain: null, buf: null, speakT: 0, speaking: false };
    pc.onnegotiationneeded = async () => {
      try {
        p.making = true;
        await pc.setLocalDescription();
        this.send(id, { k: 'sdp', sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      } catch (e) { /* a newer negotiation overtook this one */ } finally { p.making = false; }
    };
    pc.onicecandidate = e => this.send(id, { k: 'ice', ice: e.candidate ? e.candidate.toJSON() : null });
    pc.ontrack = e => this.gotTrack(p, e.track);
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'failed') pc.restartIce();
      if (s === 'connected') this.limitVideo(p);
    };
    this.peers.set(id, p);
    return p;
  }
  // the player's tracks onto the peer: a sender's track replaced (no new negotiation), or added the first time
  attach(p) {
    for (const kind of ['mic', 'cam']) {
      const t = this.local[kind], s = p.senders[kind];
      if (s) { if (s.track !== t) s.replaceTrack(t).catch(() => {}); }
      else if (t) p.senders[kind] = p.pc.addTrack(t, this.local.stream);
    }
    this.limitVideo(p);
  }
  limitVideo(p) {
    const s = p.senders.cam; if (!s) return;
    try {
      const prm = s.getParameters(); if (!prm.encodings?.length) return;
      if (prm.encodings[0].maxBitrate === VIDEO_BPS) return;
      prm.encodings[0].maxBitrate = VIDEO_BPS; prm.encodings[0].maxFramerate = 15;
      s.setParameters(prm).catch(() => {});
    } catch (e) { /* not yet negotiated */ }
  }
  async got(d) {
    const id = d.from; if (!id || id === this.me) return;
    if (d.k === 'bye') { this.gone(id); return; }   // they left the room (or closed): gone now, back with their next pos
    if (!this.present.has(id)) this.seen(id);   // signalling only comes from a member in this room
    let p = this.peers.get(id);
    if (p && p.fc && d.fc && p.fc !== d.fc) { this.close(id); p = null; }   // another tab of theirs: start again
    if (d.k === 'state') { this.states.set(id, { mic: !!d.mic, cam: !!d.cam }); if (p) p.fc ||= d.fc; this.media(id); return; }
    if (!p) p = this.peer(id);   // their offer first: the player's tracks go on after it (attach, below), into its m-lines
    p.fc = d.fc;
    const pc = p.pc;
    try {
      if (d.k === 'sdp' && d.sdp) {
        const offer = d.sdp.type === 'offer';
        const collision = offer && (p.making || pc.signalingState !== 'stable');
        p.ignore = !p.polite && collision;
        if (p.ignore) return;
        await pc.setRemoteDescription(d.sdp);
        if (offer) {
          this.attach(p);
          await pc.setLocalDescription();
          this.send(id, { k: 'sdp', sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
        }
      } else if (d.k === 'ice') {
        try { await pc.addIceCandidate(d.ice || null); } catch (e) { if (!p.ignore) throw e; }
      }
    } catch (e) {
      console.warn('voice: negotiation with a member failed', e?.name || e);
    }
  }
  gotTrack(p, track) {
    if (!p.stream) p.stream = new MediaStream();
    for (const t of p.stream.getTracks()) if (t.kind === track.kind && t !== track) p.stream.removeTrack(t);
    if (!p.stream.getTracks().includes(track)) p.stream.addTrack(track);
    if (track.kind === 'audio') { this.unhear(p); this.hear(p); }
    track.onunmute = () => this.media(p.id);
    this.media(p.id);
  }
  // the member's voice into Web Audio, panned (once the Soundscape's context exists; frame() retries until it does)
  hear(p) {
    const ctx = this.ctx(), bus = this.sound?.()?.talkBus?.(), tr = p.stream?.getAudioTracks()[0];
    if (!ctx || !bus || !tr || p.src) return;
    if (!p.el) { p.el = new Audio(); p.el.muted = true; p.el.autoplay = true; }
    p.el.srcObject = new MediaStream([tr]); p.el.play().catch(() => {});
    p.src = ctx.createMediaStreamSource(new MediaStream([tr]));
    p.an = new AnalyserNode(ctx, { fftSize: 512 }); p.buf = new Float32Array(p.an.fftSize);
    p.gain = new GainNode(ctx, { gain: TALK_GAIN });
    const cam = this.sound?.()?.camera?.position;
    p.pan = new PannerNode(ctx, { ...PAN, positionX: cam?.x || 0, positionY: cam?.y || 0, positionZ: cam?.z || 0 });
    p.src.connect(p.an); p.src.connect(p.gain).connect(p.pan).connect(bus);
  }
  unhear(p) {
    for (const n of [p.src, p.an, p.gain, p.pan]) { try { n?.disconnect(); } catch (e) { /* gone */ } }
    p.src = p.an = p.gain = p.pan = null;
  }
  // what players.js draws for the member: their video stream while their camera is on, and whether they are speaking
  media(id) {
    const M = this.players?.media; if (!M) return;
    const p = this.peers.get(id), v = p?.stream?.getVideoTracks()[0], st = this.states.get(id);
    if (!p) { M.delete(id); return; }
    M.set(id, { video: st?.cam && v && v.readyState === 'live' ? p.stream : null, speaking: p.speaking });
  }
  close(id) {
    const p = this.peers.get(id); if (!p) return;
    this.peers.delete(id);
    this.unhear(p);
    if (p.el) { p.el.srcObject = null; p.el = null; }
    try { p.pc.close(); } catch (e) { /* closed */ }
    this.players?.media?.delete(id);
  }
  closeAll() { for (const id of [...this.peers.keys()]) this.close(id); }
  ctx() { return this.sound?.()?.ctx || null; }

  // 20 Hz: who has gone quiet in the room, the panners at each member's wisp or body, the speaking levels
  frame() {
    const now = performance.now();
    let gone = false;
    for (const [id, t] of this.present) if (now - t > PRESENT_MS) { this.close(id); this.present.delete(id); gone = true; }
    if (gone) this.update();
    const ctx = this.ctx();
    let heard = false;
    for (const p of this.peers.values()) {
      if (!p.src && p.stream?.getAudioTracks().length) this.hear(p);   // the Soundscape started after the voice came
      if (!p.an || !ctx) continue;
      heard = true;
      const at = this.players?.posOf?.(p.id);
      if (at) { const P = p.pan, t = ctx.currentTime; P.positionX.setTargetAtTime(at.x, t, 0.08); P.positionY.setTargetAtTime(at.y, t, 0.08); P.positionZ.setTargetAtTime(at.z, t, 0.08); }
      const sp = this.states.get(p.id)?.mic && rms(p.an, p.buf) > SPEAK_RMS;
      if (sp) p.speakT = now;
      const speaking = now - p.speakT < SPEAK_HOLD_MS;
      if (speaking !== p.speaking) { p.speaking = speaking; this.media(p.id); }
    }
    this.sound?.()?.setTalking?.(heard);
    const m = this.micTap;
    if (m && m.track === this.local.mic) {
      if (rms(m.an, m.buf) > SPEAK_RMS) this.speakT = now;
      const speaking = now - this.speakT < SPEAK_HOLD_MS;
      if (speaking !== this.speaking) { this.speaking = speaking; this.row.mic.classList.toggle('speaking', speaking); }
    } else if (this.local.mic && ctx) this.tapMic(this.local.mic);   // the context came after the mic
  }

  dispose() {
    clearInterval(this.tick);
    for (const off of this.offs) off();
    this.set('mic', false); this.set('cam', false);
    this.closeAll(); this.present.clear(); this.states.clear(); this.together = false; this.ui();
    if (window.__weVoice === this) delete window.__weVoice;
  }
}

function rms(an, buf) {
  an.getFloatTimeDomainData(buf);
  let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}
