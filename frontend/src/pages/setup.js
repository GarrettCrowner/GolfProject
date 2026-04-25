// client/src/pages/setup.js
import { api } from "../api/client.js";
import { el } from "../utils/helpers.js";
import { searchCourses, getCourseTees } from "../utils/courseApi.js";
import { COURSE_PRESETS } from "../utils/coursePresets.js";

const GAME_DEFAULTS = [
  { game_type: "sandy",       label: "Sandy",       point_value: 1, emoji: "🏖️" },
  { game_type: "poley",       label: "Poley",       point_value: 1, emoji: "🚩" },
  { game_type: "barkie",      label: "Barkie",      point_value: 1, emoji: "🌲" },
  { game_type: "greenie",     label: "Greenie",     point_value: 1, emoji: "🟢" },
  { game_type: "splashy",     label: "Splashy",     point_value: 1, emoji: "💧" },
  { game_type: "birdie",      label: "Birdie",      point_value: 2, emoji: "🐦" },
  { game_type: "eagle",       label: "Eagle",       point_value: 5, emoji: "🦅" },
  { game_type: "stroke_play", label: "Skins", point_value: 1, emoji: "🎯", unit: "/ skin" },
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
  let selectedCourse    = null;  // { id, course_name, city, state }
  let availableTees     = [];    // tee options from API
  let selectedTee       = null;  // { tee_name, slope_rating, course_rating, par_total }
  let courseSearchTimer = null;
  let roundHoles = 18; // 9 or 18
  let me = null;

  try {
    [friends, me] = await Promise.all([
      api.get("/friends"),
      api.get("/auth/me"),
    ]);
    // Pre-add the round creator as first player
    if (me && !players.some(p => p.user_id === me.id)) {
      players.push({
        tempId: Date.now(),
        name: me.name,
        user_id: me.id,
        handicap_index: null,
        color: PLAYER_COLORS[0],
      });
    }
  } catch {}

  function render() {
    app.innerHTML = "";
    const wrap = el("div", { className: "page" });
    wrap.appendChild(el("h1", {}, "⛳ New Round"));

    if (error) wrap.appendChild(el("div", { className: "card text-red" }, error));

    // Quick course presets
    const presetCard = el("div", { className: "card" });
    presetCard.appendChild(el("h2", {}, "Quick Select Course"));
    const presetGrid = el("div", { style: "display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.5rem" });
    COURSE_PRESETS.forEach(preset => {
      const btn = el("button", {
        className: "btn-outline btn-sm",
        style: "font-size:0.8rem;text-align:left;line-height:1.3"
      }, `${preset.name.split(' ').slice(0, 2).join(' ')}
${preset.city}`);
      btn.style.whiteSpace = "pre-line";
      btn.style.fontWeight = "normal";
      btn.addEventListener("click", () => {
        // Apply preset
        courseName = preset.name;
        selectedCourse = { course_name: preset.name, city: preset.city, state: preset.state };
        // Load tees from preset
        if (preset.tees && preset.tees.length) {
          availableTees = preset.tees.map((t, i) => ({
            id: `preset-${i}`,
            tee_name: t.tee_name,
            tee_color: t.tee_name.toLowerCase(),
            slope_rating: t.slope_rating,
            course_rating: t.course_rating,
            par_total: t.par_total,
            gender: "Male",
          }));
          // Auto-select White tee if available, otherwise first tee
          selectedTee = availableTees.find(t => t.tee_name.toLowerCase() === 'white') || availableTees[0];
        } else {
          availableTees = [];
          selectedTee = { slope_rating: preset.slope_rating, course_rating: preset.course_rating, par_total: preset.par_total };
        }
        customStrokeIndexes = preset.holes.map(h => ({
          hole_number: h.hole_number,
          par: h.par,
          stroke_index: h.stroke_index,
        }));
        roundHoles = preset.holes.length; // auto-set 9 or 18 from preset
        // Always update round name to preset + today's date
        const today = new Date();
        const dateStr = `${today.getMonth()+1}/${today.getDate()}/${String(today.getFullYear()).slice(-2)}`;
        roundName = `${preset.name} - ${dateStr}`;
        render();
      });
      presetGrid.appendChild(btn);
    });
    presetCard.appendChild(presetGrid);
    wrap.appendChild(presetCard);

    // Round details
    const detailsCard = el("div", { className: "card" });
    detailsCard.appendChild(el("h2", {}, "Round Details"));
    const nameInput = el("input", { type: "text", placeholder: "Round name (e.g. Saturday at Applebrook)", value: roundName });
    nameInput.addEventListener("input", e => { roundName = e.target.value; });
    detailsCard.appendChild(nameInput);

    // 9 or 18 hole toggle
    const holesRow = el("div", { style: "display:flex;gap:0.5rem;margin-top:0.5rem;align-items:center" });
    holesRow.appendChild(el("span", { className: "text-muted text-sm", style: "flex-shrink:0" }, "Holes:"));
    [9, 18].forEach(n => {
      const btn = el("button", {
        className: roundHoles === n ? "btn-primary btn-sm" : "btn-outline btn-sm",
        style: "min-width:3rem"
      }, String(n));
      btn.addEventListener("click", () => {
        roundHoles = n;
        // Trim or expand customStrokeIndexes to match
        if (customStrokeIndexes) {
          if (n === 9) {
            customStrokeIndexes = customStrokeIndexes.slice(0, 9);
          } else if (customStrokeIndexes.length === 9) {
            const DEFAULT_PARS = [4,4,3,5,4,4,3,5,4];
            const DEFAULT_SI   = [8,10,16,4,2,14,18,6,12];
            for (let i = 9; i < 18; i++) {
              customStrokeIndexes.push({
                hole_number: i + 1,
                par: DEFAULT_PARS[i - 9],
                stroke_index: DEFAULT_SI[i - 9],
              });
            }
          }
        }
        render();
      });
      holesRow.appendChild(btn);
    });
    detailsCard.appendChild(holesRow);

    // Course search
    const courseSearchWrap = el("div", { style: "position:relative;margin-top:0.5rem" });
    const courseInput = el("input", {
      type: "text",
      placeholder: "Search course name...",
      value: selectedCourse ? `${selectedCourse.course_name} — ${selectedCourse.city}, ${selectedCourse.state}` : courseName,
      autocomplete: "off"
    });

    const dropdown = el("div", {
      style: "position:absolute;top:100%;left:0;right:0;background:var(--surface);border:2px solid var(--green);border-top:none;border-radius:0 0 var(--radius) var(--radius);z-index:100;max-height:200px;overflow-y:auto;display:none"
    });

    courseInput.addEventListener("input", e => {
      const q = e.target.value;
      courseName = q;
      selectedCourse = null;
      selectedTee = null;
      availableTees = [];
      clearTimeout(courseSearchTimer);
      if (q.length < 2) { dropdown.style.display = "none"; return; }
      courseSearchTimer = setTimeout(async () => {
        const results = await searchCourses(q);
        dropdown.innerHTML = "";
        if (!results.length) {
          const none = el("div", { style: "padding:0.6rem 0.875rem;color:var(--text-muted);font-size:0.875rem" }, "No courses found");
          dropdown.appendChild(none);
        } else {
          results.slice(0, 8).forEach(course => {
            const item = el("div", {
              style: "padding:0.6rem 0.875rem;cursor:pointer;font-size:0.9rem;border-bottom:1px solid var(--border)"
            });
            item.innerHTML = `<strong>${course.course_name}</strong><br><span style="color:var(--text-muted);font-size:0.8rem">${course.city}, ${course.state} · Par ${course.par_total || '?'}</span>`;
            item.addEventListener("mousedown", async (e) => {
              e.preventDefault();
              selectedCourse = course;
              courseName = course.course_name;
              courseInput.value = `${course.course_name} — ${course.city}, ${course.state}`;
              dropdown.style.display = "none";
              // Auto-fill round name if empty
              if (!roundName) {
                roundName = course.course_name;
                nameInput.value = roundName;
              }
              // Fetch tees
              availableTees = await getCourseTees(course.id);
              selectedTee = null;
              renderTeeSelector();
            });
            dropdown.appendChild(item);
          });
        }
        dropdown.style.display = "block";
      }, 350);
    });

    courseInput.addEventListener("blur", () => {
      setTimeout(() => { dropdown.style.display = "none"; }, 150);
    });
    courseInput.addEventListener("focus", () => {
      if (dropdown.children.length) dropdown.style.display = "block";
    });

    courseSearchWrap.appendChild(courseInput);
    courseSearchWrap.appendChild(dropdown);
    detailsCard.appendChild(courseSearchWrap);

    // Tee selector — shown after course selected
    const teeSelectorWrap = el("div", { style: "margin-top:0.5rem" });

    function renderTeeSelector() {
      teeSelectorWrap.innerHTML = "";
      if (!availableTees.length) return;

      // Filter to unique male tees by name
      const maleTees = availableTees.filter(t => t.gender === "Male" || !t.gender);
      if (!maleTees.length) return;

      const label = el("p", { className: "text-muted text-sm", style: "margin-bottom:0.4rem" }, "Select tee:");
      teeSelectorWrap.appendChild(label);

      const teeRow = el("div", { className: "flex gap-sm", style: "flex-wrap:wrap" });
      maleTees.forEach(tee => {
        const isSelected = selectedTee?.id === tee.id;
        const btn = el("button", {
          className: isSelected ? "btn-primary btn-sm" : "btn-outline btn-sm",
          style: (() => {
            const color = (tee.tee_color || "").toLowerCase();
            const isLight = ["white","#fff","#ffffff","yellow","#ffff00","silver","#c0c0c0","cream","beige","#f5f5f5","#fafafa"].some(lc => color.includes(lc));
            if (isSelected) return "";
            const bg = tee.tee_color || "transparent";
            const border = isLight ? "#999" : (tee.tee_color || "var(--green)");
            const textColor = isLight ? "#1a1a1a" : "#fff";
            const textShadow = isLight ? "none" : "0 1px 2px rgba(0,0,0,0.4)";
            return `background:${bg};border:2px solid ${border};color:${textColor};text-shadow:${textShadow}`;
          })()
        }, `${tee.tee_name} (${tee.slope_rating}/${tee.course_rating})`);
        btn.addEventListener("click", () => {
          selectedTee = tee;
          renderTeeSelector();
        });
        teeRow.appendChild(btn);
      });
      teeSelectorWrap.appendChild(teeRow);

      if (selectedTee) {
        const info = el("p", { className: "text-muted text-sm", style: "margin-top:0.4rem" },
          `Slope: ${selectedTee.slope_rating} · Rating: ${selectedTee.course_rating} · Par: ${selectedTee.par_total}`
        );
        teeSelectorWrap.appendChild(info);
      }
    }

    renderTeeSelector();
    detailsCard.appendChild(teeSelectorWrap);
    wrap.appendChild(detailsCard);

    // Players
    const playersCard = el("div", { className: "card" });
    playersCard.appendChild(el("h2", {}, "Players"));

    players.forEach((p, i) => {
      const row = el("div", { className: "player-card mt-sm", style: "margin-bottom:0.5rem" });
      const avatar = el("div", { className: "player-avatar", style: `background:${p.color}` }, p.name[0]?.toUpperCase() || "?");
      const info = el("div", { style: "flex:1" });
      info.appendChild(el("div", {}, p.name));
      // Handicap mode toggle per player
      const hcapRow = el("div", { style: "display:flex;gap:0.4rem;align-items:center;margin-top:0.25rem;flex-wrap:wrap" });
      const useStrokes = p.useStrokes || false;
      const modeBtn = el("button", {
        className: "btn-outline",
        style: "font-size:0.7rem;padding:0.15rem 0.4rem;white-space:nowrap"
      }, useStrokes ? "Strokes" : "HCP Index");
      modeBtn.addEventListener("click", () => {
        players[i].useStrokes = !players[i].useStrokes;
        players[i].handicap_index = null;
        players[i].strokes = null;
        render();
      });
      hcapRow.appendChild(modeBtn);
      if (useStrokes) {
        const strokeInput = el("input", { type: "number", placeholder: "# of strokes", value: p.strokes ?? "", step: "1", min: "0", max: "36", style: "width:7rem;font-size:0.8rem" });
        strokeInput.addEventListener("input", e => {
          const val = parseInt(e.target.value) || null;
          players[i].strokes = val;
          // Store as negative value to signal "direct strokes" mode to round.js
          players[i].handicap_index = val != null ? -(val) : null;
          players[i].useStrokes = true;
        });
        hcapRow.appendChild(strokeInput);
      } else {
        const hcap = el("input", { type: "number", placeholder: "Handicap index", value: p.handicap_index ?? "", step: "0.1", min: "0", max: "54", style: "width:7rem;font-size:0.8rem" });
        hcap.addEventListener("input", e => { players[i].handicap_index = parseFloat(e.target.value) || null; });
        hcapRow.appendChild(hcap);
      }
      info.appendChild(hcapRow);
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
      if (g.unit) right.appendChild(el("span", { className: "text-muted text-sm", style: "white-space:nowrap" }, g.unit));
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

    // Build hole grid (9 or 18 depending on roundHoles)
    const DEFAULT_PARS = [4,4,3,5,4,4,3,5,4,4,4,3,5,4,4,3,5,4];
    const DEFAULT_SI   = [7,11,15,3,1,13,17,5,9,8,10,16,4,2,14,18,6,12];
    if (!customStrokeIndexes) {
      customStrokeIndexes = DEFAULT_PARS.slice(0, roundHoles).map((par, i) => ({
        hole_number: i + 1,
        par,
        stroke_index: DEFAULT_SI[i],
      }));
    }
    // Trim to current roundHoles if needed
    if (customStrokeIndexes.length !== roundHoles) {
      customStrokeIndexes = customStrokeIndexes.slice(0, roundHoles);
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
      const round = await api.post("/rounds", {
        name: roundName,
        course_name: courseName,
        holes: roundHoles,
        slope_rating: selectedTee?.slope_rating || null,
        course_rating: selectedTee?.course_rating || null,
        par_total: selectedTee?.par_total || null,
        tee_name: selectedTee?.tee_name || null,
      });
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
