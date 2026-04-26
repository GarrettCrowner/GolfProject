// client/src/components/playerCard.js
import { el } from "../utils/helpers.js";

const PLAYER_COLORS = ["#1a7a4a","#e8960c","#e03131","#1971c2","#7209b7","#f72585"];

/**
 * @param {Object} player   - { name, color, handicap_index }
 * @param {Number} index    - for fallback color
 * @param {Function} onRemove - optional callback
 * @returns {HTMLElement}
 */
export function renderPlayerCard(player, index = 0, onRemove = null) {
  const color = player.color || PLAYER_COLORS[index % PLAYER_COLORS.length];
  const card  = el("div", { className: "player-card" });
  const avatar = el("div", { className: "player-avatar", style: `background:${color}` },
    (player.name || "?")[0].toUpperCase()
  );

  const info = el("div", { style: "flex:1;min-width:0" });
  info.appendChild(el("div", { className: "font-bold" }, player.name || "Unknown"));
  if (player.handicap_index != null) {
    const hcpDisplay = player.handicap_index < 0
      ? `${Math.abs(player.handicap_index)} strokes gained`
      : `HCP ${player.handicap_index}`;
    info.appendChild(el("div", { className: "text-muted text-sm" }, hcpDisplay));
  }

  card.appendChild(avatar);
  card.appendChild(info);

  if (onRemove) {
    const btn = el("button", { className: "btn-outline btn-sm" }, "✕");
    btn.addEventListener("click", onRemove);
    card.appendChild(btn);
  }

  return card;
}
