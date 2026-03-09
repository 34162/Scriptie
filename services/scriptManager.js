import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

const BASE_DIR = (() => {
    const execDir = path.dirname(process.execPath);
    if (!execDir.startsWith('/$bunfs')) return execDir;
    return process.cwd();
})();
const CONFIG_FILE = path.join(BASE_DIR, 'scripts.json');
const AUTH_FILE = path.join(BASE_DIR, 'auth.json');

let scripts = {};
let processes = {};
let logs = {};
let resourceData = {};
let saveQueue = Promise.resolve();
const starting = new Set();

export function hashPassword(password) {
    return createHash('sha256').update(password + 'akutsu_sha256').digest('hex');
}

export async function loadAuth() {
    try {
        if (!fs.existsSync(AUTH_FILE)) return null;
        const data = await fs.promises.readFile(AUTH_FILE, 'utf8');
        return JSON.parse(data);
    } catch {
        return null;
    }
}

export async function saveAuth(passwordHash) {
    await fs.promises.writeFile(AUTH_FILE, JSON.stringify({ passwordHash }, null, 2));
}

export async function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            scripts = {};
            await saveConfig();
            return;
        }
        const data = await fs.promises.readFile(CONFIG_FILE, 'utf8');
        scripts = JSON.parse(data);
    } catch {
        scripts = {};
        await saveConfig();
    }
}

export async function saveConfig() {
    saveQueue = saveQueue.then(async () => {
        try {
            await fs.promises.writeFile(CONFIG_FILE, JSON.stringify(scripts, null, 2));
        } catch (err) {
            console.error(err);
        }
    });
    return saveQueue;
}

function resolveScriptPath(script) {
    const base = script.workingDirectory || BASE_DIR;
    const pathOnly = (script.scriptPath || '').trim().split(/\s+/)[0];
    return path.resolve(base, pathOnly);
}

export function startScript(id) {
    if (processes[id] || starting.has(id)) return { success: false, message: 'Already running' };

    const script = scripts[id];
    if (!script) return { success: false, message: 'Script not found' };

    starting.add(id);
    script.status = 'running';

    if (!logs[id]) logs[id] = [];
    if (!resourceData[id]) resourceData[id] = [];

    logs[id].push({ time: new Date().toISOString(), type: 'info', message: 'Script started' });
    saveConfig();

    const resolvedPath = resolveScriptPath(script);
    const workingDir = script.workingDirectory || BASE_DIR;
    const argParts = (script.scriptPath || '').trim().split(/\s+/);
    const extraArgs = argParts.slice(1);

    try {
        if (!fs.existsSync(workingDir)) fs.mkdirSync(workingDir, { recursive: true });
        if (!fs.existsSync(resolvedPath)) {
            fs.writeFileSync(resolvedPath, '#!/bin/bash\necho "Default script"\n', { mode: 0o755 });
        } else {
            try { fs.chmodSync(resolvedPath, 0o755); } catch {}
        }
    } catch (err) {
        starting.delete(id);
        script.status = 'error';
        logs[id].push({ time: new Date().toISOString(), type: 'error', message: err.message });
        saveConfig();
        return { success: false, message: err.message };
    }

    let spawnCmd, spawnArgs;
    try {
        const magic = Buffer.alloc(4);
        const fd = fs.openSync(resolvedPath, 'r');
        fs.readSync(fd, magic, 0, 4, 0);
        fs.closeSync(fd);
        const isElf = magic[0] === 0x7f && magic[1] === 0x45 && magic[2] === 0x4c && magic[3] === 0x46;
        if (isElf) {
            spawnCmd = resolvedPath;
            spawnArgs = extraArgs;
        } else {
            spawnCmd = '/bin/bash';
            spawnArgs = [resolvedPath, ...extraArgs];
        }
    } catch {
        spawnCmd = '/bin/bash';
        spawnArgs = [resolvedPath, ...extraArgs];
    }

    const proc = spawn(spawnCmd, spawnArgs, {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true
    });

    processes[id] = proc;
    starting.delete(id);

    proc.stdout.on('data', data => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
            if (line === '') continue;
            logs[id].push({ time: new Date().toISOString(), type: 'stdout', message: line });
        }
        if (logs[id].length > 2000) logs[id].splice(0, logs[id].length - 2000);
    });

    proc.stderr.on('data', data => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
            if (line === '') continue;
            logs[id].push({ time: new Date().toISOString(), type: 'stderr', message: line });
        }
        if (logs[id].length > 2000) logs[id].splice(0, logs[id].length - 2000);
    });

    proc.on('close', code => {
        logs[id].push({ time: new Date().toISOString(), type: 'info', message: `Process exited with code ${code}` });
        delete processes[id];
        starting.delete(id);
        if (scripts[id]) {
            scripts[id].status = code === 0 ? 'stopped' : 'exited';
            saveConfig();
        }
    });

    proc.on('error', err => {
        logs[id].push({ time: new Date().toISOString(), type: 'error', message: `Spawn error: ${err.message}` });
        delete processes[id];
        starting.delete(id);
        if (scripts[id]) {
            scripts[id].status = 'error';
            saveConfig();
        }
    });

    startResourceMonitoring(id);

    return { success: true, message: 'Started' };
}

async function startResourceMonitoring(id) {
    const { default: pidusage } = await import('pidusage');

    const interval = setInterval(async () => {
        const proc = processes[id];
        if (!proc) { clearInterval(interval); return; }
        try {
            const stats = await pidusage(proc.pid);
            if (!resourceData[id]) resourceData[id] = [];
            resourceData[id].push({ time: Date.now(), cpu: stats.cpu, memory: stats.memory / 1024 / 1024 });
            if (resourceData[id].length > 60) resourceData[id].shift();
        } catch {
            clearInterval(interval);
        }
    }, 1000);
}

export function stopScript(id) {
    const proc = processes[id];
    if (!proc) return { success: false, message: 'Not running' };

    if (scripts[id]) { scripts[id].status = 'stopped'; saveConfig(); }

    try { process.kill(-proc.pid, 'SIGTERM'); } catch {
        try { proc.kill('SIGTERM'); } catch {}
    }

    const killTimer = setTimeout(() => {
        if (processes[id]) {
            try { process.kill(-proc.pid, 'SIGKILL'); } catch {
                try { proc.kill('SIGKILL'); } catch {}
            }
            delete processes[id];
        }
    }, 5000);

    if (killTimer.unref) killTimer.unref();
    return { success: true, message: 'Stopped' };
}

export function getScripts() {
    return Object.fromEntries(
        Object.entries(scripts).map(([id, script]) => [id, { ...script, running: !!processes[id] }])
    );
}

export async function addScript(data) {
    const { name, scriptPath, workingDirectory, autoStart } = data;
    const id = Date.now().toString();
    scripts[id] = { name, scriptPath, workingDirectory, autoStart, status: 'stopped' };
    await saveConfig();
    if (autoStart) startScript(id);
    return { success: true, id };
}

export async function updateScript(id, data) {
    if (!scripts[id]) return { success: false, message: 'Script not found' };
    const wasRunning = !!processes[id];
    if (wasRunning) stopScript(id);
    scripts[id] = { ...scripts[id], ...data };
    await saveConfig();
    if (wasRunning && data.autoStart !== false) startScript(id);
    return { success: true };
}

export async function deleteScript(id) {
    if (processes[id]) stopScript(id);
    delete scripts[id];
    delete logs[id];
    delete resourceData[id];
    await saveConfig();
    return { success: true };
}

export function getLogs(id) { return logs[id] || []; }
export function getResources(id) { return resourceData[id] || []; }

export function startAutoStartScripts() {
    for (const [id, script] of Object.entries(scripts)) {
        if (script.autoStart) startScript(id);
    }
}

setInterval(saveConfig, 5000);

process.on('SIGINT', async () => { await saveConfig(); process.exit(0); });
process.on('SIGTERM', async () => { await saveConfig(); process.exit(0); });
