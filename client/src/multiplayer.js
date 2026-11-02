import { Hub } from './hub.js';
import { AccountModal } from './account.js';
import { Social } from './social.js';
import { Chat } from './chat.js';

// The social screen's hookup (docs/multiplayer.md, lane 3): one object main.js makes beside the title screen. It owns
// the page's Hub (hub.js) for the page's life, gives the title screen the hub to ask for config, me and the counts
// (title.js takes anything with config(), me(), watch(on), on('counts', fn) and close()), puts the sign-in modal
// (account.js) at the title's gate, and on sign-in connects the socket and mounts the friends row and list (social.js),
// the chat (chat.js) and the Video and Audio toggles (below; off, "soon" on hover, lane 5 makes them live). The same
// elements stand on the earth and in the world's HUD: layout() keeps them clear of the HUD's menu, its panels, the
// game box and the key line, whichever are showing.
//
// With ?hub=stub (the title screen's own verification) nothing here is mounted: the title makes the stub itself and
// signs in by itself. The dev paths (?skip=1, ?game=1, ?as=) never make this object.
//
// Privacy: the hub's tile room is joined with the tile's id when Begin is pressed (the tile chat needs it); nothing
// about where in the tile the player is leaves the page (the position relay is lane 4).

const html = document.documentElement;
const CAMERA_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="12" height="10" rx="2"/><path d="M15 11l5-3v8l-5-3"/><path class="bar" d="M3 3l18 18"/></svg>';
const MIC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/><path class="bar" d="M3 3l18 18"/></svg>';

export class Multiplayer {
  // hubParam: the URL's ?hub= ('stub' for the title screen's stub, else the real hub).
  constructor({ hubParam = null } = {}) {
    this.stub = hubParam === 'stub';
    this.hub = this.stub ? null : new Hub();
    this.titleHub = this.stub ? 'stub' : this.hub;   // what the title screen is given
    this.title = null; this.modal = null; this.social = null; this.chat = null; this.media = null;
    this.observer = null; this.layoutFn = () => this.layout();
    // the way back from Discord (hub.py sends the browser to /client/?signin=discord or ?signin=failed): remembered for
    // the modal and taken off the URL, signed in or not
    const u = new URL(location.href); this.back = u.searchParams.get('signin');
    if (this.back) { u.searchParams.delete('signin'); history.replaceState(null, '', u.search ? `${u.pathname}${u.search}` : u.pathname); }
    window.__weMp = this;   // debugging handle
  }

  // The title screen is made: the gate gets the modal, sign-in mounts the rest, Begin joins the tile's room.
  attach(title) {
    this.title = title;
    if (this.stub) return;
    title.onGate = t => { this.modal = new AccountModal({ title: t, back: this.back }); };
    title.onLit = user => this.signedIn(user);
    const onBegin = title.onBegin;
    title.onBegin = c => { this.entered(c?.tileId); onBegin?.(c); };
  }
  placeName(tileId) { return this.title?.byId?.[tileId]?.name || null; }

  // Signed in as `user` (null: exploring alone with no hub; nothing social then).
  signedIn(user) {
    if (!user || !this.hub || this.social) return;
    const placeName = id => this.placeName(id);
    this.social = new Social({ hub: this.hub, placeName, onSignOut: () => this.signOut() });
    this.chat = new Chat({ hub: this.hub, nameOf: id => this.social.nameOf(id), placeName });
    this.social.onLayout = this.layoutFn;
    this.mountMedia();
    this.hub.connect();
    addEventListener('resize', this.layoutFn);
    // the HUD's menu (html.menu), the game box and the opening class change under us: keep clear of them
    this.observer = new MutationObserver(this.layoutFn);
    this.observer.observe(html, { attributes: true, attributeFilter: ['class'] });
    const game = document.getElementById('game'); if (game) this.observer.observe(game, { attributes: true, attributeFilter: ['class', 'style'] });
    this.layout();
  }
  // Begin on the earth (or, later, a tile switch): the hub's room is the tile; the chat's picker follows.
  entered(tileId) {
    if (!this.hub || !tileId) return;
    this.hub.enter(tileId);
    this.chat?.setRoom();
  }
  async signOut() {
    try { await Hub.signout(); } catch (e) { /* the session may be gone already */ }
    this.hub?.close();
    location.reload();   // back to the title and the sign-in
  }

  // Video and Audio, top middle (docs item 7): two toggles, off, "soon" on hover, nothing behind them until lane 5.
  mountMedia() {
    const el = this.media = document.createElement('div'); el.id = 'media';
    el.innerHTML = `<button type="button" class="md-btn" aria-pressed="false" aria-disabled="true" data-soon="video: soon" title="video with your group: soon">${CAMERA_ICON}</button>
      <button type="button" class="md-btn" aria-pressed="false" aria-disabled="true" data-soon="audio: soon" title="voice with your group: soon">${MIC_ICON}</button>`;
    document.body.append(el);
  }

  // Keep the social list, the chat and the toggles clear of the HUD's panels when both are showing: the list right of
  // the HUD's readouts while the menu is open, the chat above the key line, the toggles under the game box.
  layout() {
    const inWorld = !html.classList.contains('opening'), menu = html.classList.contains('menu');
    const H = innerHeight;
    if (this.social) {
      const panel = this.social.panel; panel.style.left = '';
      if (inWorld && menu && this.social.open) {
        const hud = document.getElementById('hud')?.getBoundingClientRect();
        if (hud && hud.width) panel.style.left = `${Math.round(hud.right + 10 - this.social.el.getBoundingClientRect().left)}px`;
      }
    }
    if (this.chat) {
      const help = document.getElementById('help'), card = document.getElementById('speciesCard');
      const showing = el => el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';   // laid out and not hidden (the body's row replaces the key line: display none)
      let bottom = 12;
      if (inWorld && menu && showing(help)) bottom = Math.max(bottom, Math.round(H - help.getBoundingClientRect().top + 8));
      if (inWorld && showing(card)) bottom = Math.max(bottom, Math.round(H - card.getBoundingClientRect().top + 8));
      this.chat.el.style.bottom = `${bottom}px`;
    }
    if (this.media) {
      const game = document.getElementById('game'); let top = 12;
      if (inWorld && game && !game.classList.contains('hidden')) top = Math.round(game.getBoundingClientRect().bottom + 8);
      this.media.style.top = `${top}px`;
    }
  }

  dispose() {
    this.observer?.disconnect(); removeEventListener('resize', this.layoutFn);
    this.modal?.close(); this.social?.dispose(); this.chat?.dispose(); this.media?.remove();
    this.hub?.close();
    if (window.__weMp === this) delete window.__weMp;
  }
}
