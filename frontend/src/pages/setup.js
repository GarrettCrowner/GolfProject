// client/src/pages/setup.js
import { api } from "../api/client.js";
import { el } from "../utils/helpers.js";

const GAME_DEFAULTS = [
  { game_type: "sandy",       label: "Sandy",       point_value: 1, emoji: "🏖️" },
  { game_type: "poley",       label: "Poley",       point_value: 1, emoji: "🚩" },
  { game_type: "barkie",      label: "Barkie",      point_value: 1, emoji: "🌲" },
  { game_type: "greenie",     label: "Greenie",     point_value: 1, emoji: "🟢" },
  { game_type: "splashy",     label: "Splashy",     point_value: 1, emoji: "💧" },
  { game_type: "birdie",      label: "Birdie",      point_value: 2, emoji: "🐦" },
  { game_type: "eagle",       label: "Eagle",       point_value: 5, emoji: "🦅" },
  { game_type: "stroke_play", label: "Stroke Play", point_value: 1, emoji: "💰" },
];

const PLAYER_COLORS = ["#2d6a4f","#f4a261","#e63946","#4361ee","#7209b7","#f72585"];

export async function renderSetup(app, navigate) {
  app.innerHTML = "";

  let roundName   = "";
  let courseName  = "";
  let players     = [];
  let activeGames = new Set(["sandy","poley","barkie","greenie","splashy","birdie","eagle"]);
  let gameValues  = Object.fromEntries(GAME_DEFAULTS.map(g => [g.game_type, g.point_value]));
  let friends          = [];
  let error            = "";
  let customStrokeIndexes = null; // null = use server defaults

  try { friends = await api.get("/friends"); } catch {}

  function render() {
    app.innerHTML = "";
    const wrap = el("div", { className: "page" });
    wrap.appendChild(el("h1", {}, "⛳ New Round"));

    if (error) wrap.appendChild(el("div", { className: "card text-red" }, error));

    // Round details
    const detailsCard = el("div", { className: "card" });
    detailsCard.appendChild(el("h2", {}, "Round Details"));
    const nameInput = el("input", { type: "text", placeholder: "Round name (e.g. Saturday at Applebrook)", value: roundName });
    nameInput.addEventListener("input", e => { roundName = e.target.value; });
    const courseInput = el("input", { type: "text", placeholder: "Course name", value: courseName, style: "margin-top:0.5rem" });
    courseInput.addEventListener("input", e => { courseName = e.target.value; });
    detailsCard.appendChild(nameInput);
    detailsCard.appendChild(courseInput);
    wrap.appendChild(detailsCard);

    // Players
    const playersCard = el("div", { className: "card" });
    playersCard.appendChild(el("h2", {}, "Players"));

    players.forEach((p, i) => {
      const row = el("div", { className: "player-card mt-sm", style: "margin-bottom:0.5rem" });
      const avatar = el("div", { className: "player-avatar", style: `background:${p.color}` }, p.name[0]?.toUpperCase() || "?");
      const info = el("div", { style: "flex:1" });
      info.appendChild(el("div", {}, p.name));
      const hcap = el("input", { type: "number", placeholder: "Handicap index", value: p.handicap_index ?? "", step: "0.1", min: "0", max: "54", style: "margin-top:0.25rem;font-size:0.8rem" });
      hcap.addEventListener("input", e => { players[i].handicap_index = parseFloat(e.target.value) || null; });
      info.appendChild(hcap);
      const removeBtn = el("button", { className: "btn-outline", style: "padding:0.25rem 0.65rem;font-size:0.8rem" }, "✕");
      removeBtn.addEventListener("click", () => { players.splice(i, 1); render(); });
      row.appendChild(avatar);
      row.appendChild(info);
      row.appendChild(removeBtn);
      playersCard.appendChild(row);
    });

    if (friends.length) {
      const friendSelect = el("select", { style: "margin-top:0.75rem" });
      friendSelect.appendChild(el("option", { value: "" }, "— Add a friend —"));
      friends.filter(f => !players.some(p => p.user_id === f.id))
        .forEach(f => friendSelect.appendChild(el("option", { value: f.id }, f.name)));
      friendSelect.addEventListener("change", e => {
        const friend = friends.find(f => f.id === parseInt(e.target.value));
        if (!friend) return;
        players.push({ tempId: Date.now(), name: friend.name, user_id: friend.id, handicap_index: null, color: PLAYER_COLORS[players.length % PLAYER_COLORS.length] });
        render();
      });
      playersCard.appendChild(friendSelect);
    }

    const guestRow = el("div", { className: "flex gap-sm", style: "margin-top:0.5rem" });
    const guestInput = el("input", { type: "text", placeholder: "Add guest by name" });
    const addGuestBtn = el("button", { className: "btn-outline" }, "+ Guest");
    addGuestBtn.addEventListener("click", () => {
      const name = guestInput.value.trim();
      if (!name) return;
      players.push({ tempId: Date.now(), name, user_id: null, handicap_index: null, color: PLAYER_COLORS[players.length % PLAYER_COLORS.length] });
      render();
    });
    guestRow.appendChild(guestInput);
    guestRow.appendChild(addGuestBtn);
    playersCard.appendChild(guestRow);
    wrap.appendChild(playersCard);

    // Games
    const gamesCard = el("div", { className: "card" });
    gamesCard.appendChild(el("h2", {}, "Games"));
    gamesCard.appendChild(el("p", { className: "text-muted", style: "margin-bottom:0.75rem" }, "Toggle games and set point values."));

    GAME_DEFAULTS.forEach(g => {
      let isActive = activeGames.has(g.game_type);

      const row = el("div", {
        className: "flex-between",
        style: "margin-bottom:0.75rem;align-items:center"
      });

      // Left: custom toggle pill + label
      const left = el("div", { className: "flex gap-sm", style: "align-items:center;cursor:pointer;flex:1" });

      // Custom toggle pill
      const pill = document.createElement("div");
      const updatePill = () => {
        pill.style.cssText = [
          "width:44px;height:26px;border-radius:999px;position:relative",
          "cursor:pointer;flex-shrink:0;transition:background 0.2s",
          `background:${isActive ? "var(--green)" : "#ccc"}`
        ].join(";");
        knob.style.cssText = [
          "width:20px;height:20px;border-radius:50%;background:#fff",
          "position:absolute;top:3px;transition:left 0.2s",
          `left:${isActive ? "21px" : "3px"}`
        ].join(";");
      };

      const knob = document.createElement("div");
      pill.appendChild(knob);

      const toggle = () => {
        isActive = !isActive;
        if (isActive) activeGames.add(g.game_type);
        else activeGames.delete(g.game_type);
        updatePill();
        row.style.opacity = isActive ? "1" : "0.5";
        valueInput.disabled = !isActive;
      };

      pill.addEventListener("click", toggle);
      updatePill();

      left.appendChild(pill);
      left.appendChild(el("span", { style: "font-size:0.95rem;font-weight:500" }, `${g.emoji} ${g.label}`));
      left.addEventListener("click", (e) => { if (e.target !== pill && e.target !== knob) toggle(); });
      row.appendChild(left);

      // Right: dollar value input
      const right = el("div", { className: "flex gap-sm", style: "align-items:center" });
      const valueInput = el("input", {
        type: "number", step: "0.5", min: "0.5",
        value: gameValues[g.game_type],
        style: "width:5rem;text-align:right",
      });
      if (!isActive) valueInput.disabled = true;
      if (!isActive) row.style.opacity = "0.5";
      valueInput.addEventListener("input", e => { gameValues[g.game_type] = parseFloat(e.target.value) || g.point_value; });
      right.appendChild(el("span", { className: "text-muted" }, "$"));
      right.appendChild(valueInput);
      row.appendChild(right);
      gamesCard.appendChild(row);
    });
    wrap.appendChild(gamesCard);

    // Stroke index card (collapsed by default)
    const siCard = el("div", { className: "card" });
    const siHeader = el("div", { className: "flex-between", style: "cursor:pointer" });
    siHeader.appendChild(el("h2", { style: "margin-bottom:0" }, "Hole Info (Optional)"));
    const siToggle = el("span", { className: "text-muted text-sm" }, "▼ Edit pars & stroke indexes");
    siHeader.appendChild(siToggle);
    const siBody = el("div", { style: "display:none;margin-top:0.875rem" });

    siHeader.addEventListener("click", () => {
      siBody.style.display = siBody.style.display === "none" ? "block" : "none";
      siToggle.textContent = siBody.style.display === "none" ? "▼ Edit pars & stroke indexes" : "▲ Hide";
    });

    // Build 18-hole grid
    const DEFAULT_PARS = [4,4,3,5,4,4,3,5,4,4,4,3,5,4,4,3,5,4];
    const DEFAULT_SI   = [7,11,15,3,1,13,17,5,9,8,10,16,4,2,14,18,6,12];
    if (!customStrokeIndexes) {
      customStrokeIndexes = DEFAULT_PARS.map((par, i) => ({
        hole_number: i + 1,
        par,
        stroke_index: DEFAULT_SI[i],
      }));
    }

    const siNote = el("p", { className: "text-muted text-sm", style: "margin-bottom:0.75rem" },
      "Par and stroke index per hole. Stroke index 1 = hardest (gets handicap strokes first).");
    siBody.appendChild(siNote);

    const siTable = el("table", { style: "width:100%;border-collapse:collapse;font-size:0.85rem" });
    const siThead = el("thead");
    const siHr = el("tr");
    ["Hole","Par","SI"].forEach(h => {
      const th = el("th", { style: "padding:0.3rem;text-align:center;color:var(--text-muted);font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em" }, h);
      siHr.appendChild(th);
    });
    siThead.appendChild(siHr);
    siTable.appendChild(siThead);

    const siTbody = el("tbody");
    customStrokeIndexes.forEach((hole, i) => {
      const row = el("tr");

      // Hole number
      row.appendChild(el("td", { style: "padding:0.25rem;text-align:center;font-weight:600" }, String(hole.hole_number)));

      // Par stepper
      const parTd = el("td", { style: "padding:0.25rem;text-align:center" });
      const parStepper = el("div", { className: "stepper", style: "max-width:100px;margin:0 auto" });
      const parMinus = el("button", { className: "stepper-btn", style: "font-size:1rem" }, "−");
      const parDisp  = el("span",  { className: "stepper-value" }, String(hole.par));
      const parPlus  = el("button", { className: "stepper-btn", style: "font-size:1rem" }, "+");
      parMinus.addEventListener("click", () => { if (customStrokeIndexes[i].par > 3) { customStrokeIndexes[i].par--; parDisp.textContent = customStrokeIndexes[i].par; } });
      parPlus.addEventListener("click",  () => { if (customStrokeIndexes[i].par < 5) { customStrokeIndexes[i].par++; parDisp.textContent = customStrokeIndexes[i].par; } });
      parStepper.append(parMinus, parDisp, parPlus);
      parTd.appendChild(parStepper);
      row.appendChild(parTd);

      // Stroke index input
      const siTd = el("td", { style: "padding:0.25rem;text-align:center" });
      const siStyle = "width:3.5rem;text-align:center;min-height:36px;font-size:0.9rem;margin:0 auto;display:block";
      const siInput = el("input", { type: "number", min: "1", max: "18", value: String(hole.stroke_index), style: siStyle });
      siInput.addEventListener("input", e => { customStrokeIndexes[i].stroke_index = parseInt(e.target.value) || hole.stroke_index; });
      siTd.appendChild(siInput);
      row.appendChild(siTd);

      siTbody.appendChild(row);
    });
    siTable.appendChild(siTbody);
    siBody.appendChild(siTable);
    siCard.appendChild(siHeader);
    siCard.appendChild(siBody);
    wrap.appendChild(siCard);

    const startBtn = el("button", { className: "btn-primary", style: "width:100%;padding:0.75rem;font-size:1rem;margin-top:0.5rem" }, "Start Round →");
    startBtn.addEventListener("click", handleStart);
    wrap.appendChild(startBtn);
    app.appendChild(wrap);
  }

  async function handleStart() {
    error = "";
    if (!roundName.trim()) { error = "Please enter a round name."; render(); return; }
    if (!players.length)   { error = "Add at least one player.";  render(); return; }
    try {
      const round = await api.post("/rounds", { name: roundName, course_name: courseName });
      for (const p of players) {
        const body = { color: p.color, handicap_index: p.handicap_index };
        if (p.user_id) body.user_id = p.user_id; else body.guest_name = p.name;
        await api.post(`/rounds/${round.id}/players`, body);
      }
      const games = GAME_DEFAULTS.filter(g => activeGames.has(g.game_type)).map(g => ({ game_type: g.game_type, point_value: gameValues[g.game_type] }));
      await api.put(`/rounds/${round.id}/games`, { games });
      // Save hole stroke indexes
      if (customStrokeIndexes) {
        await api.put(`/rounds/${round.id}/stroke-indexes`, { holes: customStrokeIndexes });
      }
      navigate(`/round?id=${round.id}`);
    } catch (err) { error = err.message; render(); }
  }

  render();
}
