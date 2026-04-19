// server/ws/roundSync.js
const { WebSocketServer, WebSocket } = require("ws");
const jwt = require("jsonwebtoken");
const url  = require("url");

// Map of roundId -> Set of WebSocket clients
const rooms = new Map();

function getRoomClients(roundId) {
  if (!rooms.has(roundId)) rooms.set(roundId, new Set());
  return rooms.get(roundId);
}

function broadcast(roundId, senderId, message) {
  const clients = getRoomClients(roundId);
  const payload = JSON.stringify(message);
  for (const client of clients) {
    // Send to all clients in the room (including sender for confirmation)
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function cleanupClient(roundId, ws) {
  const clients = getRoomClients(roundId);
  clients.delete(ws);
  if (clients.size === 0) rooms.delete(roundId);
}

/**
 * Attach WebSocket server to an existing HTTP server.
 * URL format: ws://host/ws?roundId=123&token=JWT
 */
function attachWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws, req) => {
    const params  = new URLSearchParams(url.parse(req.url).query);
    const roundId = params.get("roundId");
    const token   = params.get("token");

    // Authenticate
    let user = null;
    try {
      user = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      ws.close(4001, "Unauthorized");
      return;
    }

    if (!roundId) {
      ws.close(4002, "roundId required");
      return;
    }

    // Join room
    ws.userId  = user.id;
    ws.roundId = roundId;
    getRoomClients(roundId).add(ws);

    console.log(`WS: user ${user.id} joined round ${roundId} (${getRoomClients(roundId).size} in room)`);

    // Announce presence
    broadcast(roundId, ws.userId, {
      type:   "USER_JOINED",
      userId: user.id,
      name:   user.name,
    });

    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      // All messages are broadcast to the room — the server is just a relay.
      // Clients trust the DB as source of truth and re-fetch on events.
      switch (msg.type) {
        case "SPECIAL_LOGGED":
          broadcast(roundId, ws.userId, { ...msg, fromUserId: ws.userId });
          // Push notify other players in the round
          notifyRound(roundId, ws.userId, {
            title: `⛳ ${msg.playerName || "Someone"} got a ${msg.gameType || "special"}!`,
            body:  `Hole ${msg.holeNumber}`,
            tag:   `special-${roundId}`,
            url:   `/round?id=${roundId}`,
          });
          break;
        case "SPECIAL_REMOVED":
        case "SCORE_SAVED":
          broadcast(roundId, ws.userId, { ...msg, fromUserId: ws.userId });
          break;
        case "ROUND_FINISHED":
          broadcast(roundId, ws.userId, { ...msg, fromUserId: ws.userId });
          notifyRound(roundId, ws.userId, {
            title: "🏁 Round finished!",
            body:  "Check the final settlement.",
            tag:   `finished-${roundId}`,
            url:   `/settlement?id=${roundId}`,
          });
          break;
        case "PING":
          ws.send(JSON.stringify({ type: "PONG" }));
          break;
        default:
          console.warn("WS: unknown message type", msg.type);
      }
    });

    ws.on("close", () => {
      cleanupClient(roundId, ws);
      broadcast(roundId, ws.userId, {
        type:   "USER_LEFT",
        userId: ws.userId,
      });
      console.log(`WS: user ${ws.userId} left round ${roundId}`);
    });

    ws.on("error", (err) => {
      console.error("WS error:", err.message);
      cleanupClient(roundId, ws);
    });
  });

  return wss;
}

module.exports = { attachWebSocketServer, broadcast };
