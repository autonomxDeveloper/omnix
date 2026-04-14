/**
 * RPG Game State Manager
 * Tracks character stats, inventory, gold, XP, HP, and level.
 * Parses LLM responses for structured game updates and injects
 * current game state into the system prompt so the LLM enforces constraints.
 */

(function () {
    'use strict';

    // -----------------------------------------------------------------------
    // Default starting state
    // -----------------------------------------------------------------------
    const DEFAULT_GAME_STATE = {
        enabled: false,
        character: {
            name: 'Adventurer',
            class: 'Wanderer',
            level: 1,
            xp: 0,
            xp_to_next: 100,
            hp: 20,
            max_hp: 20,
            stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 }
        },
        gold: 10,
        inventory: ['Worn Shortsword', 'Leather Tunic', 'Torch', 'Bread Loaf'],
        log: []   // recent game events
    };

    let _state = structuredClone(DEFAULT_GAME_STATE);

    // -----------------------------------------------------------------------
    // Public helpers
    // -----------------------------------------------------------------------
    function getState() { return _state; }

    function isEnabled() { return _state.enabled; }

    function enable() {
        _state.enabled = true;
        renderPanel();
        showPanel();
    }

    function disable() {
        _state.enabled = false;
        hidePanel();
    }

    function resetState() {
        const wasEnabled = _state.enabled;
        _state = structuredClone(DEFAULT_GAME_STATE);
        _state.enabled = wasEnabled;
        renderPanel();
    }

    // -----------------------------------------------------------------------
    // State mutation
    // -----------------------------------------------------------------------
    function applyUpdate(update) {
        if (!update || typeof update !== 'object') return;

        const c = _state.character;

        // Gold
        if (typeof update.gold === 'number') {
            _state.gold = Math.max(0, update.gold);
        }
        if (typeof update.gold_change === 'number') {
            const prev = _state.gold;
            _state.gold = Math.max(0, _state.gold + update.gold_change);
            if (update.gold_change > 0) addLog(`+${update.gold_change} gold`);
            else if (update.gold_change < 0) addLog(`${update.gold_change} gold`);
        }

        // XP
        if (typeof update.xp_gain === 'number' && update.xp_gain > 0) {
            c.xp += update.xp_gain;
            addLog(`+${update.xp_gain} XP`);
            // Level up check
            while (c.xp >= c.xp_to_next) {
                c.xp -= c.xp_to_next;
                c.level += 1;
                c.xp_to_next = Math.floor(c.xp_to_next * 1.5);
                c.max_hp += 5;
                c.hp = c.max_hp;
                // Distribute stat points
                const statKeys = Object.keys(c.stats);
                const primary = statKeys[Math.floor(Math.random() * statKeys.length)];
                c.stats[primary] += 1;
                addLog(`Level up! Now level ${c.level}. +1 ${primary}`);
            }
        }

        // HP
        if (typeof update.hp_change === 'number') {
            c.hp = Math.max(0, Math.min(c.max_hp, c.hp + update.hp_change));
            if (update.hp_change > 0) addLog(`+${update.hp_change} HP`);
            else if (update.hp_change < 0) addLog(`${update.hp_change} HP`);
        }
        if (typeof update.hp === 'number') {
            c.hp = Math.max(0, Math.min(c.max_hp, update.hp));
        }

        // Stats overrides (direct set)
        if (update.stats && typeof update.stats === 'object') {
            for (const [k, v] of Object.entries(update.stats)) {
                const key = k.toUpperCase();
                if (key in c.stats && typeof v === 'number') {
                    c.stats[key] = v;
                }
            }
        }

        // Inventory adds
        if (Array.isArray(update.items_gained)) {
            for (const item of update.items_gained) {
                if (typeof item === 'string' && item.trim()) {
                    _state.inventory.push(item.trim());
                    addLog(`Gained: ${item.trim()}`);
                }
            }
        }

        // Inventory removes
        if (Array.isArray(update.items_lost)) {
            for (const item of update.items_lost) {
                const idx = _state.inventory.findIndex(i => i.toLowerCase() === item.toLowerCase());
                if (idx !== -1) {
                    _state.inventory.splice(idx, 1);
                    addLog(`Lost: ${item}`);
                }
            }
        }

        // Character name / class
        if (typeof update.name === 'string' && update.name.trim()) c.name = update.name.trim();
        if (typeof update.class === 'string' && update.class.trim()) c.class = update.class.trim();

        renderPanel();
    }

    function addLog(msg) {
        _state.log.push(msg);
        if (_state.log.length > 20) _state.log.shift();
    }

    // -----------------------------------------------------------------------
    // Parse AI response for game state JSON block
    // Format: ```game_state\n{...}\n```  or  [GAME_STATE]{...}[/GAME_STATE]
    // -----------------------------------------------------------------------
    function extractGameUpdate(text) {
        if (!text) return { cleanText: text, update: null };

        let update = null;
        let cleanText = text;

        // Try ```game_state ... ``` fenced block
        const fencedRe = /```game_state\s*\n([\s\S]*?)\n```/i;
        const fencedMatch = text.match(fencedRe);
        if (fencedMatch) {
            try {
                update = JSON.parse(fencedMatch[1].trim());
            } catch (e) { /* ignore parse errors */ }
            cleanText = text.replace(fencedRe, '').trim();
        }

        // Try [GAME_STATE]...[/GAME_STATE] block
        if (!update) {
            const tagRe = /\[GAME_STATE\]([\s\S]*?)\[\/GAME_STATE\]/i;
            const tagMatch = text.match(tagRe);
            if (tagMatch) {
                try {
                    update = JSON.parse(tagMatch[1].trim());
                } catch (e) { /* ignore parse errors */ }
                cleanText = text.replace(tagRe, '').trim();
            }
        }

        return { cleanText, update };
    }

    // -----------------------------------------------------------------------
    // Build context string to inject into system prompt
    // -----------------------------------------------------------------------
    function buildContextBlock() {
        if (!_state.enabled) return '';

        const c = _state.character;
        const statsStr = Object.entries(c.stats).map(([k, v]) => `${k}:${v}`).join(' ');
        const invStr = _state.inventory.length > 0 ? _state.inventory.join(', ') : '(empty)';

        return `

## CURRENT GAME STATE (authoritative — you MUST respect these values)
Character: ${c.name} (${c.class}), Level ${c.level}
HP: ${c.hp}/${c.max_hp} | XP: ${c.xp}/${c.xp_to_next}
Stats: ${statsStr}
Gold: ${_state.gold}
Inventory: ${invStr}

RULES:
- The player CANNOT spend more gold than they have. If they try, deny the action and tell them they don't have enough gold.
- The player CANNOT use items they don't have in their inventory. Check the inventory list above.
- When the player gains or loses items, gains XP, spends or receives gold, or takes HP damage/healing, you MUST include a game state update block.
- Character stats should influence outcomes: higher STR = better melee, higher DEX = better stealth/agility, higher INT = better magic, higher WIS = better perception, higher CHA = better persuasion, higher CON = more resilience.
- Format the update as a fenced code block: \`\`\`game_state\\n{JSON}\\n\`\`\`
- JSON fields (all optional): gold_change, xp_gain, hp_change, items_gained (array), items_lost (array), stats (object of overrides), name, class
- Example: \`\`\`game_state\\n{"gold_change": -5, "items_gained": ["Iron Key"], "xp_gain": 10}\\n\`\`\`
`;
    }

    // -----------------------------------------------------------------------
    // UI — Game panel (right-side overlay panel)
    // -----------------------------------------------------------------------
    function showPanel() {
        const panel = document.getElementById('gamePanel');
        if (panel) panel.classList.add('visible');
        document.body.classList.add('game-panel-open');
    }

    function hidePanel() {
        const panel = document.getElementById('gamePanel');
        if (panel) panel.classList.remove('visible');
        document.body.classList.remove('game-panel-open');
    }

    function renderPanel() {
        const panel = document.getElementById('gamePanel');
        if (!panel) return;

        const c = _state.character;
        const hpPct = c.max_hp > 0 ? Math.round((c.hp / c.max_hp) * 100) : 0;
        const xpPct = c.xp_to_next > 0 ? Math.round((c.xp / c.xp_to_next) * 100) : 0;

        let hpColor = '#22c55e'; // green
        if (hpPct <= 25) hpColor = '#ef4444';      // red
        else if (hpPct <= 50) hpColor = '#f59e0b';  // amber

        const statsHtml = Object.entries(c.stats).map(([k, v]) =>
            `<div class="game-stat"><span class="game-stat-label">${k}</span><span class="game-stat-value">${v}</span></div>`
        ).join('');

        const invHtml = _state.inventory.length > 0
            ? _state.inventory.map(item => `<div class="game-inv-item">• ${escapeHtml(item)}</div>`).join('')
            : '<div class="game-inv-empty">Empty</div>';

        const logHtml = _state.log.slice(-6).map(l => `<div class="game-log-entry">${escapeHtml(l)}</div>`).join('');

        panel.querySelector('.game-panel-body').innerHTML = `
            <div class="game-section game-character">
                <div class="game-char-name">${escapeHtml(c.name)}</div>
                <div class="game-char-class">${escapeHtml(c.class)} · Level ${c.level}</div>
            </div>

            <div class="game-section">
                <div class="game-bar-label">HP ${c.hp}/${c.max_hp}</div>
                <div class="game-bar"><div class="game-bar-fill" style="width:${hpPct}%;background:${hpColor}"></div></div>
            </div>

            <div class="game-section">
                <div class="game-bar-label">XP ${c.xp}/${c.xp_to_next}</div>
                <div class="game-bar"><div class="game-bar-fill game-bar-xp" style="width:${xpPct}%"></div></div>
            </div>

            <div class="game-section">
                <div class="game-section-title">⚔️ Stats</div>
                <div class="game-stats-grid">${statsHtml}</div>
            </div>

            <div class="game-section">
                <div class="game-section-title">💰 Gold: <span class="game-gold-value">${_state.gold}</span></div>
            </div>

            <div class="game-section">
                <div class="game-section-title">🎒 Inventory (${_state.inventory.length})</div>
                <div class="game-inv-list">${invHtml}</div>
            </div>

            ${logHtml ? `<div class="game-section"><div class="game-section-title">📜 Log</div><div class="game-log">${logHtml}</div></div>` : ''}
        `;
    }

    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    // -----------------------------------------------------------------------
    // Serialization (for session save / load)
    // -----------------------------------------------------------------------
    function serialize() {
        return structuredClone(_state);
    }

    function load(saved) {
        if (!saved || typeof saved !== 'object') return;
        const defaults = structuredClone(DEFAULT_GAME_STATE);
        _state = { ...defaults, ...saved };
        // Ensure nested objects are merged properly
        if (saved.character) {
            _state.character = { ...defaults.character, ...saved.character };
            if (saved.character.stats) {
                _state.character.stats = { ...defaults.character.stats, ...saved.character.stats };
            }
        }
        if (saved.inventory) _state.inventory = [...saved.inventory];
        if (saved.log) _state.log = [...saved.log];
        if (_state.enabled) {
            renderPanel();
            showPanel();
        }
    }

    // -----------------------------------------------------------------------
    // Export
    // -----------------------------------------------------------------------
    window.GameState = {
        getState,
        isEnabled,
        enable,
        disable,
        resetState,
        applyUpdate,
        extractGameUpdate,
        buildContextBlock,
        serialize,
        load,
        renderPanel,
        showPanel,
        hidePanel
    };
})();
