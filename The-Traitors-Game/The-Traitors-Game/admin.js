// The Traitors - Host Control Center Logic with Mystery Soundboard
let currentGameState = null;
let searchQuery = '';

const adminAuthWall = document.getElementById('adminAuthWall');
const adminDashboard = document.getElementById('adminDashboard');
const adminPinForm = document.getElementById('adminPinForm');
const adminPinInput = document.getElementById('adminPinInput');
const soundToggleBtn = document.getElementById('soundToggleBtn');
const soundIconOn = document.getElementById('soundIconOn');
const soundIconOff = document.getElementById('soundIconOff');

if (sessionStorage.getItem('traitors_admin_auth') === 'true') {
  showDashboard();
}

// Sound toggle
if (soundToggleBtn) {
  soundToggleBtn.addEventListener('click', () => {
    if (window.soundEngine) {
      const isMuted = window.soundEngine.toggleMute();
      soundIconOn.style.display = isMuted ? 'none' : 'block';
      soundIconOff.style.display = isMuted ? 'block' : 'none';
    }
  });

  if (window.soundEngine && window.soundEngine.muted) {
    soundIconOn.style.display = 'none';
    soundIconOff.style.display = 'block';
  }
}

if (adminPinForm) {
  adminPinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = adminPinInput.value.trim();

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      const data = await res.json();
      if (data.success) {
        sessionStorage.setItem('traitors_admin_auth', 'true');
        showDashboard();
        if (window.soundEngine) {
          window.soundEngine.playGong();
        }
      } else {
        alert('Invalid Host PIN. Access Denied.');
      }
    } catch(err) {
      alert('Authentication error: ' + err.message);
    }
  });
}

function showDashboard() {
  if (adminAuthWall) adminAuthWall.style.display = 'none';
  if (adminDashboard) adminDashboard.style.display = 'block';

  const joinUrl = `${window.location.protocol}//${window.location.host}/`;
  const joinUrlEl = document.getElementById('playerJoinUrl');
  if (joinUrlEl) joinUrlEl.textContent = joinUrl;

  initSSE();
}

const copyBtn = document.getElementById('copyJoinLinkBtn');
if (copyBtn) {
  copyBtn.addEventListener('click', () => {
    const joinUrl = `${window.location.protocol}//${window.location.host}/`;
    navigator.clipboard.writeText(joinUrl);
    copyBtn.textContent = 'Copied';
    setTimeout(() => { copyBtn.textContent = 'Copy Link'; }, 2000);
  });
}

async function callAdminApi(endpoint, body = null) {
  try {
    const opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(endpoint, opts);
    const data = await res.json();
    if (data && data.state) {
      renderAdmin(data.state);
    }
    return data;
  } catch (err) {
    console.error(`Admin action ${endpoint} failed:`, err);
  }
}

let evtSource = null;
function initSSE() {
  if (evtSource) evtSource.close();
  evtSource = new EventSource('/api/events');

  evtSource.onmessage = (event) => {
    try {
      const state = JSON.parse(event.data);
      renderAdmin(state);
    } catch(err) {
      console.error('Error parsing SSE in admin:', err);
    }
  };

  // Smart Polling fallback with Cold Lambda Healing
  setInterval(async () => {
    try {
      const r = await fetch('/api/state');
      const st = await r.json();
      if (!st) return;

      if (currentGameState && currentGameState.players && currentGameState.players.length > 0) {
        if (!st.players || st.players.length < currentGameState.players.length || (st.version && st.version < currentGameState.version)) {
          // Cold lambda detected! Re-seed the server with our authoritative state!
          await fetch('/api/admin/sync-state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: currentGameState })
          });
          return;
        }
      }
      renderAdmin(st);
    } catch (e) {}
  }, 1400);
}

function renderAdmin(state) {
  if (!state) return;

  // Stale state guards for Vercel Serverless
  if (currentGameState && currentGameState.players && currentGameState.players.length > 0) {
    if (!state.players || state.players.length === 0) {
      return; // Reject empty response from cold lambda
    }
  }

  if (currentGameState && currentGameState.version && state.version) {
    if (state.version < currentGameState.version) {
      return; // Reject older stale state
    }
  }

  currentGameState = state;

  const total = state.players.length;
  const alive = state.players.filter(p => p.status === 'Alive');
  const eliminated = state.players.filter(p => p.status === 'Eliminated');
  const traitors = alive.filter(p => p.role === 'Traitor');
  const faithful = alive.filter(p => p.role !== 'Traitor');

  document.getElementById('statTotal').textContent = total;
  document.getElementById('statAlive').textContent = alive.length;
  document.getElementById('statEliminated').textContent = eliminated.length;
  document.getElementById('statTraitors').textContent = traitors.length;
  document.getElementById('statInnocents').textContent = faithful.length;

  document.getElementById('aliveCountText').textContent = alive.length;
  document.getElementById('eliminatedCountText').textContent = eliminated.length;

  const roundNames = {
    '0': 'Lobby / Waiting Room',
    'trial': 'The Relic Trial (Prelude)',
    '1': 'Round 1 (Role Reveal)',
    '2': 'Round 2 (Groups of 15)',
    '3': 'Round 3 (Trust / Betray Dilemma)',
    '4': 'Round 4 (Final Showdown / Imposter)'
  };
  document.getElementById('currentRoundLabel').textContent = roundNames[state.currentRound] || `Round ${state.currentRound}`;
  document.getElementById('currentPhaseLabel').textContent = state.phase.toUpperCase();

  const timerDisplay = document.getElementById('adminTimerDisplay');
  if (state.timer && state.timer.active && state.timer.remaining > 0) {
    const m = Math.floor(state.timer.remaining / 60);
    const s = state.timer.remaining % 60;
    timerDisplay.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} (${state.timer.label || 'Timer'})`;
  } else {
    timerDisplay.textContent = 'Inactive';
  }

  renderVotingControls(state, alive);
  renderNightControls(state, alive);
  renderCluesAndSquads(state, alive);
  renderPlayerLists(state);
}

function renderVotingControls(state, alive) {
  const openBtn = document.getElementById('openVotingBtn');
  const revealBtn = document.getElementById('revealVotesBtn');
  const executeBtn = document.getElementById('executeBanishmentBtn');
  const closeBtn = document.getElementById('closeVotingBtn');
  const statusEl = document.getElementById('votingLiveStatus');

  const votes = state.voting.votes || {};
  const voteCount = Object.keys(votes).length;

  if (state.phase === 'voting') {
    openBtn.style.display = 'none';
    revealBtn.style.display = 'block';
    executeBtn.style.display = 'none';
    closeBtn.style.display = 'block';
    statusEl.textContent = `Voting Active: ${voteCount} of ${alive.length} players have voted.`;
  } else if (state.phase === 'voting_revealed') {
    openBtn.style.display = 'none';
    revealBtn.style.display = 'none';
    executeBtn.style.display = 'block';
    closeBtn.style.display = 'block';

    const banished = state.players.find(p => p.id === state.voting.banishedId);
    if (banished) {
      statusEl.innerHTML = `<strong>${banished.name}</strong> received the most votes (${state.voting.tally[banished.id] || 0} votes). Confirm banishment to eliminate.`;
      executeBtn.textContent = `Confirm Banishment of ${banished.name}`;
    } else {
      statusEl.textContent = `No votes were cast or a tie occurred.`;
    }
  } else {
    openBtn.style.display = 'block';
    revealBtn.style.display = 'none';
    executeBtn.style.display = 'none';
    closeBtn.style.display = 'none';
    statusEl.textContent = 'Voting currently inactive.';
  }
}

function renderNightControls(state, alive) {
  const startBtn = document.getElementById('startNightBtn');
  const executeBtn = document.getElementById('executeNightBtn');
  const cancelBtn = document.getElementById('cancelNightBtn');
  const statusEl = document.getElementById('nightLiveStatus');

  if (state.phase === 'night') {
    startBtn.style.display = 'none';
    executeBtn.style.display = 'block';
    cancelBtn.style.display = 'block';

    const target = state.players.find(p => p.id === state.night.murderTarget);
    if (target) {
      statusEl.innerHTML = `Target Chosen: <strong>${target.name}</strong> ${target.hasShield ? '(SHIELDED)' : ''}`;
      executeBtn.textContent = `Execute Murder of ${target.name}`;
    } else {
      statusEl.textContent = `Traitors are conferring in the secret turret...`;
      executeBtn.textContent = `Execute Night Murder`;
    }
  } else {
    startBtn.style.display = 'block';
    executeBtn.style.display = 'none';
    cancelBtn.style.display = 'none';
    statusEl.textContent = 'Night phase currently inactive.';
  }
}

function renderCluesAndSquads(state, alive) {
  const container = document.getElementById('cluesListContainer');
  container.innerHTML = '';

  const r = state.currentRound;
  const getGrp = p => r === "2" ? p.round2_group : r === "3" ? p.round3_group : r === "4" ? p.round4_group : p.round1_group;

  const groupsMap = {};
  alive.forEach(p => {
    const g = getGrp(p) || 'Unassigned';
    if (!groupsMap[g]) groupsMap[g] = [];
    groupsMap[g].push(p);
  });

  const allGroups = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', ...Object.keys(groupsMap).filter(k => !['1','2','3','4','5','6','7','8','9','10','Unassigned'].includes(k))];

  allGroups.forEach(grpNum => {
    const members = groupsMap[grpNum] || [];
    members.sort((a, b) => (parseInt(a.number, 10) || 0) - (parseInt(b.number, 10) || 0));

    const card = document.createElement('div');
    card.className = 'mystery-scroll';

    const isFull = members.length === 10;
    const countColor = isFull ? 'var(--accent-green)' : (members.length > 10 ? '#ff6666' : 'var(--accent-gold)');

    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <strong style="color: var(--accent-gold); font-family: 'Cinzel', serif; font-size: 1.05rem;">Group ${grpNum}</strong>
        <span style="color: ${countColor}; font-size: 0.8rem; font-weight: 700; letter-spacing: 0.5px;">
          ${members.length} / 10 players
        </span>
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 6px; min-height: 48px; align-content: flex-start; padding: 6px; background: rgba(0,0,0,0.3); border-radius: 4px;">
        ${members.length > 0 
          ? members.map(m => `<span style="font-size: 0.8rem; padding: 3px 8px; background: rgba(255,255,255,0.08); border-radius: 4px; color: ${m.role === 'Traitor' ? '#ff6666' : 'var(--fg)'}; border-left: 2px solid ${m.role === 'Traitor' ? '#ff4444' : 'var(--accent-gold)'};">${m.name}</span>`).join('') 
          : '<span style="font-size: 0.8rem; color: var(--text-muted); font-style: italic; padding: 4px;">No players assigned</span>'
        }
      </div>
    `;
    container.appendChild(card);
  });
}

function renderPlayerLists(state) {
  const aliveList = document.getElementById('alivePlayerList');
  const elimList = document.getElementById('eliminatedPlayerList');
  aliveList.innerHTML = '';
  elimList.innerHTML = '';

  const r = state.currentRound;
  const getGrp = p => r === "2" ? p.round2_group : r === "3" ? p.round3_group : r === "4" ? p.round4_group : p.round1_group;

  const filtered = state.players.filter(p => {
    if (!searchQuery) return true;
    return p.name.toLowerCase().includes(searchQuery.toLowerCase()) || (p.number && p.number.includes(searchQuery));
  });

  filtered.forEach(p => {
    const isAlive = p.status === 'Alive';
    const row = document.createElement('div');
    row.className = 'player-item';

    row.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
        <span class="status-dot ${isAlive ? 'alive' : 'eliminated'}"></span>
        <span style="font-weight: 700; ${isAlive ? '' : 'text-decoration: line-through; opacity: 0.6;'}">
          ${p.name}
        </span>
        <span class="role-badge ${p.role.toLowerCase()}" style="cursor: pointer;" title="Toggle role" onclick="toggleRole('${p.id}', '${p.role}')">
          ${p.role} ⇄
        </span>
        ${p.hasShield ? '<span class="shield-badge">SHIELD</span>' : ''}
        ${isAlive ? `<span style="font-size: 0.8rem; color: var(--accent-gold);">Group ${getGrp(p) || 'Unassigned'}</span>` : ''}
      </div>

      <div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center;">
        ${isAlive ? `
          <button class="btn btn-outline toolbar-btn" style="width: auto; padding: 4px 8px; font-size: 0.75rem; min-height: 32px;" onclick="toggleShield('${p.id}')">
            ${p.hasShield ? 'Drop Shield' : 'Shield'}
          </button>
          <button class="btn btn-outline toolbar-btn" style="width: auto; padding: 4px 8px; font-size: 0.75rem; min-height: 32px;" onclick="changeGroupPrompt('${p.id}', '${getGrp(p) || ''}')">
            Group
          </button>
          <button class="btn btn-danger toolbar-btn" style="width: auto; padding: 4px 8px; font-size: 0.75rem; min-height: 32px;" onclick="eliminatePlayer('${p.id}', '${p.name}')">
            Eliminate
          </button>
          ${r === '4' ? `
            <button class="btn btn-gold toolbar-btn" style="width: auto; padding: 4px 8px; font-size: 0.75rem; min-height: 32px;" onclick="declareWinner('${p.id}', '${p.name}')">
              Winner
            </button>
          ` : ''}
        ` : `
          <button class="btn btn-outline toolbar-btn" style="width: auto; padding: 4px 8px; font-size: 0.75rem; color: var(--accent-green); border-color: var(--accent-green); min-height: 32px;" onclick="revivePlayer('${p.id}', '${p.name}')">
            Revive
          </button>
        `}
        <button class="btn btn-outline toolbar-btn" style="width: auto; padding: 4px 6px; font-size: 0.7rem; color: var(--text-muted); min-height: 32px;" title="Remove player" onclick="removePlayer('${p.id}', '${p.name}')">
          Remove
        </button>
      </div>
    `;

    if (isAlive) {
      aliveList.appendChild(row);
    } else {
      elimList.appendChild(row);
    }
  });

  if (aliveList.children.length === 0) {
    aliveList.innerHTML = '<div style="padding: 14px; color: var(--text-muted); text-align: center;">No alive players found.</div>';
  }
  if (elimList.children.length === 0) {
    elimList.innerHTML = '<div style="padding: 14px; color: var(--text-muted); text-align: center;">No eliminated players.</div>';
  }
}

window.toggleRole = async (id, currentRole) => {
  const next = currentRole === 'Traitor' ? 'Faithful' : 'Traitor';
  if (confirm(`Change this player's role to ${next.toUpperCase()}?`)) {
    await callAdminApi('/api/admin/set-role', { id, role: next });
  }
};

window.toggleShield = async (id) => {
  await callAdminApi('/api/admin/toggle-shield', { id });
};

window.changeGroupPrompt = async (id, currentGrp) => {
  const grp = prompt(`Enter group number for this player:`, currentGrp);
  if (grp !== null) {
    await callAdminApi('/api/admin/set-player-group', { id, group: grp.trim() });
  }
};

window.eliminatePlayer = async (id, name) => {
  if (confirm(`Confirm elimination of ${name}?`)) {
    await callAdminApi('/api/admin/eliminate', { id });
  }
};

window.revivePlayer = async (id, name) => {
  if (confirm(`Revive ${name}?`)) {
    await callAdminApi('/api/admin/revive', { id });
  }
};

window.removePlayer = async (id, name) => {
  if (confirm(`Remove ${name} completely from this game?`)) {
    await callAdminApi('/api/admin/remove-player', { id });
  }
};

window.declareWinner = async (id, name) => {
  if (confirm(`Declare ${name} as the WINNER of The Traitors?`)) {
    await callAdminApi('/api/admin/set-winner', { id });
  }
};

const searchInput = document.getElementById('playerSearchInput');
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    if (currentGameState) renderPlayerLists(currentGameState);
  });
}

// Mystery Soundboard Button Click Handlers
document.querySelectorAll('.soundboard-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const sound = btn.dataset.sound;
    // Play locally on Host machine
    if (window.soundEngine) {
      if (sound === 'bell') window.soundEngine.playBell();
      else if (sound === 'gong') window.soundEngine.playGong();
      else if (sound === 'thunder') window.soundEngine.playThunder();
      else if (sound === 'flame') window.soundEngine.playFlameWhoosh();
      else if (sound === 'dagger') window.soundEngine.playDagger();
      else if (sound === 'heartbeat') window.soundEngine.playHeartbeat();
      else if (sound === 'elimination') window.soundEngine.playElimination();
      else if (sound === 'fanfare') window.soundEngine.playFanfare();
    }
    // Broadcast live to all connected players
    await callAdminApi('/api/admin/sound-trigger', { sound });
  });
});

// Reset Game
document.getElementById('resetGameBtn').onclick = async () => {
  if (confirm('Reset the entire game state back to the lobby?')) {
    await callAdminApi('/api/admin/reset');
  }
};

// Round Controls
document.getElementById('startTrialBtn').onclick = async () => {
  if (confirm('Start Squad Gathering (10 Groups)? This assigns 10 groups sequentially and secret roles.')) {
    await callAdminApi('/api/admin/start-trial');
  }
};

document.getElementById('startRound1Btn').onclick = async () => {
  if (confirm('Start Round 1? This reveals secret roles to players.')) {
    await callAdminApi('/api/admin/start-round1');
  }
};

document.getElementById('startRound2Btn').onclick = async () => {
  if (confirm('Start Round 2? This organizes players into 10 squads.')) {
    await callAdminApi('/api/admin/start-round2');
  }
};

document.getElementById('startRound3Btn').onclick = async () => {
  if (confirm('Start Round 3? This arranges players into pairs for the Trust / Betray dilemma.')) {
    await callAdminApi('/api/admin/start-round3');
  }
};

document.getElementById('startRound4Btn').onclick = async () => {
  if (confirm('Start Round 4 (The Final Showdown)?')) {
    await callAdminApi('/api/admin/start-round4');
  }
};

// Voting Controls
document.getElementById('openVotingBtn').onclick = async () => {
  if (confirm('Open the Round Table Banishment Vote on all players phones?')) {
    await callAdminApi('/api/admin/start-voting');
  }
};

document.getElementById('revealVotesBtn').onclick = async () => {
  await callAdminApi('/api/admin/reveal-votes');
};

document.getElementById('executeBanishmentBtn').onclick = async () => {
  if (confirm('Execute banishment on the highest-voted player?')) {
    await callAdminApi('/api/admin/execute-banishment');
  }
};

document.getElementById('closeVotingBtn').onclick = async () => {
  await callAdminApi('/api/admin/close-voting');
};

// Night Controls
document.getElementById('startNightBtn').onclick = async () => {
  if (confirm('Initiate Night Phase? Faithful sleep and Traitors vote on murder.')) {
    await callAdminApi('/api/admin/start-night');
  }
};

document.getElementById('executeNightBtn').onclick = async () => {
  if (confirm('Confirm murder of the Traitors target?')) {
    await callAdminApi('/api/admin/execute-night');
  }
};

document.getElementById('cancelNightBtn').onclick = async () => {
  await callAdminApi('/api/admin/cancel-night');
};

const assignByNumBtn = document.getElementById('assignByNumberBtn');
if (assignByNumBtn) {
  assignByNumBtn.onclick = async () => {
    if (confirm('Assign players in order of player number (1-10 in Group 1, 11-20 in Group 2...)?')) {
      await callAdminApi('/api/admin/randomize-groups', { mode: 'sequential', groupSize: 10 });
    }
  };
}

const autoAssignBtn = document.getElementById('autoAssignGroupsBtn');
if (autoAssignBtn) {
  autoAssignBtn.onclick = async () => {
    if (confirm('Randomly shuffle all alive players into 10 groups (10 players per group)?')) {
      await callAdminApi('/api/admin/randomize-groups', { mode: 'random', groupSize: 10 });
    }
  };
}

// Timer Presets
document.querySelectorAll('.timer-preset-btn').forEach(btn => {
  btn.onclick = async () => {
    const sec = parseInt(btn.dataset.sec, 10);
    await callAdminApi('/api/admin/start-timer', { seconds: sec, label: `${sec / 60}m Timer` });
  };
});

document.getElementById('customTimerBtn').onclick = async () => {
  const m = prompt('Enter timer duration in minutes:');
  if (m && !isNaN(m) && Number(m) > 0) {
    await callAdminApi('/api/admin/start-timer', { seconds: Math.floor(Number(m) * 60), label: `${m}m Timer` });
  }
};

document.getElementById('stopTimerBtn').onclick = async () => {
  await callAdminApi('/api/admin/stop-timer');
};
