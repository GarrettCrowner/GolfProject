// client/src/utils/roundSocket.js
//
// Manages a WebSocket connection to the live round sync server.
// The server acts as a relay — on any event, clients re-fetch from the REST API
// to stay in sync with the DB as the single source of truth.

// Use wss:// on HTTPS pages to avoid mixed content errors
const WS_BASE = import.meta.env.VITE_WS_URL ||
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;

const RECONNECT_DELAY_MS = 3000;
const PING_INTERVAL_MS   = 25000;

export class RoundSocket {
  constructor(roundId, { onEvent, onStatus } = {}) {
    this.roundId   = roundId;
    this.onEvent   = onEvent   || (() => {});
    this.onStatus  = onStatus  || (() => {});
    this.ws        = null;
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.closed    = false;
  }

  connect() {
    const token = localStorage.getItem("token");
    if (!token) return;

    const wsUrl = `${WS_BASE}?roundId=${this.roundId}&token=${token}`;
    this.ws = new WebSocket(wsUrl);
    this.onStatus("connecting");

    this.ws.onopen = () => {
      this.onStatus("connected");
      this._startPing();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "PONG") return;
        this.onEvent(msg);
      } catch {}
    };

    this.ws.onclose = () => {
      this._stopPing();
      if (!this.closed) {
        this.onStatus("reconnecting");
        this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
      } else {
        this.onStatus("disconnected");
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror — reconnect handled there
    };
  }

  send(type, payload = {}) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, ...payload }));
    }
  }

  disconnect() {
    this.closed = true;
    clearTimeout(this.reconnectTimer);
    this._stopPing();
    this.ws?.close();
  }

  _startPing() {
    this._stopPing();
    this.pingTimer = setInterval(() => {
      this.send("PING");
    }, PING_INTERVAL_MS);
  }

  _stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }
}
