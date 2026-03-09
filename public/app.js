const state = {
    currentInfoScript: null,
    infoInterval: null,
    confirmResolve: null,
    cpuChart: null,
    memChart: null,
    editingScript: null,
    scriptsInterval: null
};

const api = {
    async getScripts() {
        const res = await fetch('/api/scripts');
        if (res.status === 401) { showAuth(); return {}; }
        return res.json();
    },
    async startScript(id) { return fetch(`/api/scripts/${id}/start`, { method: 'POST' }); },
    async stopScript(id) { return fetch(`/api/scripts/${id}/stop`, { method: 'POST' }); },
    async deleteScript(id) { return fetch(`/api/scripts/${id}`, { method: 'DELETE' }); },
    async createScript(data) {
        return fetch('/api/scripts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    },
    async updateScript(id, data) {
        return fetch(`/api/scripts/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    },
    async getLogs(id) {
        const res = await fetch(`/api/scripts/${id}/logs`);
        if (res.status === 401) return [];
        return res.json();
    },
    async getResources(id) {
        const res = await fetch(`/api/scripts/${id}/resources`);
        if (res.status === 401) return [];
        return res.json();
    },
    async authStatus() {
        const res = await fetch('/api/auth/status');
        return res.json();
    },
    async login(password) {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        return res.json();
    },
    async register(password) {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        return res.json();
    },
    async logout() {
        return fetch('/api/auth/logout', { method: 'POST' });
    }
};

const ui = {
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    renderScriptCard(id, script) {
        const status = script.status || 'stopped';
        const statusClass = status === 'running' ? 'status-running' :
            status === 'exited' ? 'status-exited' : 'status-stopped';

        return `
            <div class="script-card">
                <div class="box-title">${this.escapeHtml(script.name)}</div>
                <div class="box-content">
                    <div class="script-info">path: ${this.escapeHtml(script.scriptPath)}</div>
                    <div class="script-info">dir: ${this.escapeHtml(script.workingDirectory)}</div>
                    <div class="script-info">auto-start: ${script.autoStart ? 'yes' : 'no'}</div>
                    <span class="script-status ${statusClass}">${status}</span>
                    <div class="script-actions">
                        ${status !== 'running' ? `<button class="btn btn-sm btn-success" onclick="startScript('${id}')">start</button>` : ''}
                        ${status === 'running' ? `<button class="btn btn-sm btn-danger" onclick="stopScript('${id}')">stop</button>` : ''}
                        <button class="btn btn-sm" onclick="viewInfo('${id}', '${this.escapeHtml(script.name)}')">info</button>
                        <button class="btn btn-sm" onclick="editScript('${id}')">settings</button>
                        <button class="btn btn-sm btn-danger" onclick="deleteScript('${id}')">delete</button>
                    </div>
                </div>
            </div>
        `;
    },

    ansiToHtml(text) {
        const ansiColors = {
            30: '#555', 31: '#f87171', 32: '#4ade80', 33: '#fbbf24',
            34: '#60a5fa', 35: '#c084fc', 36: '#22d3ee', 37: '#d4d4d4',
            90: '#777', 91: '#fca5a5', 92: '#86efac', 93: '#fde68a',
            94: '#93c5fd', 95: '#d8b4fe', 96: '#67e8f9', 97: '#fff'
        };
        const escaped = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        let result = '';
        let stack = [];
        let i = 0;
        const parts = escaped.split(/(\x1b\[[0-9;]*m|\[\d+m)/g);

        const raw = text;
        result = '';
        const segments = raw.split(/(\x1b\[[0-9;]*[mK])/);
        let openSpans = 0;

        for (const seg of segments) {
            const match = seg.match(/^\x1b\[([0-9;]*)([mK])$/);
            if (match) {
                const codes = match[1].split(';').map(Number);
                for (const code of codes) {
                    if (code === 0) {
                        result += '</span>'.repeat(openSpans);
                        openSpans = 0;
                    } else if (code === 1) {
                        result += '<span style="font-weight:bold">';
                        openSpans++;
                    } else if (code === 2) {
                        result += '<span style="opacity:0.5">';
                        openSpans++;
                    } else if (code === 3) {
                        result += '<span style="font-style:italic">';
                        openSpans++;
                    } else if (ansiColors[code]) {
                        result += `<span style="color:${ansiColors[code]}">`;
                        openSpans++;
                    } else if (code >= 40 && code <= 47) {
                        const bg = ansiColors[code - 10];
                        if (bg) { result += `<span style="background:${bg};color:#000">`;  openSpans++; }
                    }
                }
            } else {
                result += seg.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            }
        }
        result += '</span>'.repeat(openSpans);
        return result;
    },

    renderLogs(logs) {
        return logs.map(log => {
            const time = new Date(log.time).toLocaleTimeString();
            const msg = this.ansiToHtml(log.message);
            return `<div class="log-entry log-${log.type}"><span class="log-time">[${this.escapeHtml(time)}]</span> <span class="log-msg">${msg}</span></div>`;
        }).join('');
    }
};

const charts = {
    init() {
        if (state.cpuChart) state.cpuChart.destroy();
        if (state.memChart) state.memChart.destroy();

        const chartOpts = (label, color) => ({
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label,
                    data: [],
                    borderColor: color,
                    backgroundColor: color.replace(')', ', 0.1)').replace('rgb', 'rgba'),
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, grid: { color: '#333' }, ticks: { color: '#aaa' } },
                    x: { grid: { color: '#333' }, ticks: { color: '#aaa', maxTicksLimit: 10 } }
                },
                plugins: { legend: { labels: { color: '#aaa' } } }
            }
        });

        state.cpuChart = new Chart(document.getElementById('cpuChart'), chartOpts('CPU %', 'rgb(128, 128, 255)'));
        state.memChart = new Chart(document.getElementById('memChart'), chartOpts('Memory (MB)', 'rgb(74, 222, 128)'));
        state.cpuChart.options.scales.y.max = 100;
        state.cpuChart.update();
    },

    update(data) {
        if (!data || data.length === 0) return;
        const labels = data.map(d => new Date(d.time).toLocaleTimeString());
        state.cpuChart.data.labels = labels;
        state.cpuChart.data.datasets[0].data = data.map(d => d.cpu.toFixed(2));
        state.cpuChart.update('none');
        state.memChart.data.labels = labels;
        state.memChart.data.datasets[0].data = data.map(d => d.memory.toFixed(2));
        state.memChart.update('none');
    },

    destroy() {
        if (state.cpuChart) state.cpuChart.destroy();
        if (state.memChart) state.memChart.destroy();
        state.cpuChart = null;
        state.memChart = null;
    }
};

function showConfirm(message) {
    return new Promise(resolve => {
        state.confirmResolve = resolve;
        document.getElementById('confirmMessage').textContent = message;
        document.getElementById('confirmModal').classList.add('active');
    });
}

async function loadScripts() {
    const data = await api.getScripts();
    const grid = document.getElementById('scriptsGrid');
    if (grid) {
        grid.innerHTML = Object.entries(data).map(([id, script]) => ui.renderScriptCard(id, script)).join('');
    }
}

async function startScript(id) { await api.startScript(id); loadScripts(); }
async function stopScript(id) { await api.stopScript(id); loadScripts(); }

async function deleteScript(id) {
    const confirmed = await showConfirm('delete this script?');
    if (!confirmed) return;
    await api.deleteScript(id);
    loadScripts();
}

async function viewInfo(id, name) {
    if (state.infoInterval) { clearInterval(state.infoInterval); state.infoInterval = null; }
    state.currentInfoScript = id;
    document.getElementById('infoTitle').textContent = `info - ${name}`;
    document.getElementById('infoModal').classList.add('active');
    document.getElementById('logsContent').innerHTML = '';
    charts.init();
    await updateInfo();
    state.infoInterval = setInterval(updateInfo, 1000);
}

async function updateInfo() {
    if (!state.currentInfoScript) return;
    try {
        const [logs, resources] = await Promise.all([
            api.getLogs(state.currentInfoScript),
            api.getResources(state.currentInfoScript)
        ]);
        const content = document.getElementById('logsContent');
        const wasAtBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 20;
        content.innerHTML = ui.renderLogs(logs);
        if (wasAtBottom) content.scrollTop = content.scrollHeight;
        charts.update(resources);
    } catch {}
}

async function editScript(id) {
    const scripts = await api.getScripts();
    const script = scripts[id];
    if (!script) return;
    state.editingScript = id;
    document.getElementById('editName').value = script.name;
    document.getElementById('editScriptPath').value = script.scriptPath;
    document.getElementById('editWorkingDirectory').value = script.workingDirectory;
    document.getElementById('editAutoStart').checked = script.autoStart;
    document.getElementById('editModal').classList.add('active');
}

function openCreateModal() {
    document.getElementById('createModal').classList.add('active');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
    if (id === 'infoModal') {
        clearInterval(state.infoInterval);
        state.currentInfoScript = null;
        charts.destroy();
    }
    if (id === 'editModal') state.editingScript = null;
}

async function submitCreate() {
    const data = {
        name: document.getElementById('createName').value.trim(),
        scriptPath: document.getElementById('createScriptPath').value.trim(),
        workingDirectory: document.getElementById('createWorkingDir').value.trim(),
        autoStart: document.getElementById('createAutoStart').checked
    };
    if (!data.name || !data.scriptPath || !data.workingDirectory) return;
    await api.createScript(data);
    closeModal('createModal');
    document.getElementById('createName').value = '';
    document.getElementById('createScriptPath').value = '';
    document.getElementById('createWorkingDir').value = '';
    document.getElementById('createAutoStart').checked = false;
    loadScripts();
}

async function submitEdit() {
    const data = {
        name: document.getElementById('editName').value.trim(),
        scriptPath: document.getElementById('editScriptPath').value.trim(),
        workingDirectory: document.getElementById('editWorkingDirectory').value.trim(),
        autoStart: document.getElementById('editAutoStart').checked
    };
    if (!data.name || !data.scriptPath || !data.workingDirectory) return;
    await api.updateScript(state.editingScript, data);
    closeModal('editModal');
    loadScripts();
}

document.getElementById('confirmYes').addEventListener('click', () => {
    document.getElementById('confirmModal').classList.remove('active');
    if (state.confirmResolve) state.confirmResolve(true);
});

document.getElementById('confirmNo').addEventListener('click', () => {
    document.getElementById('confirmModal').classList.remove('active');
    if (state.confirmResolve) state.confirmResolve(false);
});

function showAuth(isRegister = false) {
    clearInterval(state.scriptsInterval);
    document.getElementById('app').style.display = 'none';
    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('authTitle').textContent = isRegister ? 'create password' : 'login';
    document.getElementById('authSubmit').textContent = isRegister ? 'create' : 'login';
    document.getElementById('authPassword').value = '';
    document.getElementById('authError').textContent = '';
    document.getElementById('authPassword').focus();
    document.getElementById('authScreen').dataset.mode = isRegister ? 'register' : 'login';
}

function showApp() {
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    loadScripts();
    state.scriptsInterval = setInterval(loadScripts, 1000);
}

async function authSubmit() {
    const password = document.getElementById('authPassword').value;
    const mode = document.getElementById('authScreen').dataset.mode;
    const errEl = document.getElementById('authError');
    errEl.textContent = '';

    if (!password) { errEl.textContent = 'enter a password'; return; }

    const result = mode === 'register'
        ? await api.register(password)
        : await api.login(password);

    if (result.success) {
        showApp();
    } else {
        errEl.textContent = result.message || 'error';
    }
}

async function logout() {
    await api.logout();
    showAuth(false);
}

document.getElementById('authPassword').addEventListener('keydown', e => {
    if (e.key === 'Enter') authSubmit();
});

async function init() {
    const status = await api.authStatus();
    if (!status.hasPassword) {
        showAuth(true);
    } else if (!status.authenticated) {
        showAuth(false);
    } else {
        showApp();
    }
}

init();
