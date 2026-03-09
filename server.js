import { serve } from "bun";
import indexHtml from "./public/index.html" with { type: "text" };
import appJs from "./public/app.js" with { type: "text" };
import styleCss from "./public/style.css" with { type: "text" };
import fontPath from "./public/font.ttf";
import scriptRoutes from "./routes/scripts";
import { loadConfig, startAutoStartScripts, loadAuth, saveAuth, hashPassword } from "./services/scriptManager";
import os from "os";
import fs from "fs";

const PORT = Number(Bun.env.PORT) || 7070;
const args = process.argv.slice(2);

const attachIdx = args.indexOf('--attach');
if (attachIdx !== -1) {
    const pid = parseInt(args[attachIdx + 1]);
    if (!pid || isNaN(pid)) {
        console.error('Usage: Akutsu --attach <PID>');
        process.exit(1);
    }

    try {
        process.kill(pid, 0);
    } catch {
        console.error(`No process found with PID ${pid}`);
        process.exit(1);
    }

    console.log(`Attaching to PID ${pid}... (Ctrl+C to detach)`);

    const { spawnSync } = await import('child_process');

    const reptyrPath = Bun.which('reptyr');
    const nsenterPath = Bun.which('nsenter');

    if (reptyrPath) {
        const result = spawnSync(reptyrPath, [String(pid)], { stdio: 'inherit' });
        process.exit(result.status ?? 0);
    } else if (nsenterPath) {
        const result = spawnSync(nsenterPath, ['-t', String(pid), '-m', '-u', '-i', '-n', '-p', '--', '/bin/bash'], { stdio: 'inherit' });
        process.exit(result.status ?? 0);
    } else {
        const { spawn } = await import('child_process');
        const fd = fs.openSync(`/proc/${pid}/fd/0`, 'r');
        fs.closeSync(fd);

        const tail = spawn('tail', ['--pid=' + pid, '-f', `/proc/${pid}/fd/1`], { stdio: ['inherit', 'inherit', 'inherit'] });

        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('data', chunk => {
            try {
                const stdinFd = fs.openSync(`/proc/${pid}/fd/0`, 'w');
                fs.writeSync(stdinFd, chunk);
                fs.closeSync(stdinFd);
            } catch {}
        });

        tail.on('close', () => {
            process.stdin.setRawMode(false);
            console.log(`\nProcess ${pid} exited.`);
            process.exit(0);
        });

        process.on('SIGINT', () => {
            tail.kill();
            process.stdin.setRawMode(false);
            console.log(`\nDetached from PID ${pid}.`);
            process.exit(0);
        });
    }
} else {
    function getLocalIP() {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === "IPv4" && !iface.internal && !iface.address.startsWith("172.")) {
                    return iface.address;
                }
            }
        }
        return "localhost";
    }

    const sessions = new Set();

    function generateToken() {
        return Array.from(crypto.getRandomValues(new Uint8Array(32)))
            .map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function isAuthenticated(req) {
        const cookie = req.headers.get('cookie') || '';
        const match = cookie.match(/session=([a-f0-9]+)/);
        return match && sessions.has(match[1]);
    }

    async function router(req) {
        const url = new URL(req.url);
        const method = req.method.toUpperCase();

        if (url.pathname === "/font.ttf") {
            const fontData = await fs.promises.readFile(fontPath);
            return new Response(fontData, { headers: { "Content-Type": "font/ttf" } });
        }

        if (url.pathname === "/api/auth/status") {
            const auth = await loadAuth();
            return new Response(JSON.stringify({
                hasPassword: !!auth?.passwordHash,
                authenticated: isAuthenticated(req)
            }), { headers: { "Content-Type": "application/json" } });
        }

        if (url.pathname === "/api/auth/register" && method === "POST") {
            const auth = await loadAuth();
            if (auth?.passwordHash) {
                return new Response(JSON.stringify({ success: false, message: 'Already registered' }), {
                    status: 403, headers: { "Content-Type": "application/json" }
                });
            }
            const { password } = await req.json();
            if (!password || password.length < 4) {
                return new Response(JSON.stringify({ success: false, message: 'Password too short' }), {
                    status: 400, headers: { "Content-Type": "application/json" }
                });
            }
            await saveAuth(hashPassword(password));
            const token = generateToken();
            sessions.add(token);
            return new Response(JSON.stringify({ success: true }), {
                headers: {
                    "Content-Type": "application/json",
                    "Set-Cookie": `session=${token}; HttpOnly; Path=/; SameSite=Strict`
                }
            });
        }

        if (url.pathname === "/api/auth/login" && method === "POST") {
            const auth = await loadAuth();
            if (!auth?.passwordHash) {
                return new Response(JSON.stringify({ success: false, message: 'No account found' }), {
                    status: 403, headers: { "Content-Type": "application/json" }
                });
            }
            const { password } = await req.json();
            if (hashPassword(password) !== auth.passwordHash) {
                return new Response(JSON.stringify({ success: false, message: 'Wrong password' }), {
                    status: 401, headers: { "Content-Type": "application/json" }
                });
            }
            const token = generateToken();
            sessions.add(token);
            return new Response(JSON.stringify({ success: true }), {
                headers: {
                    "Content-Type": "application/json",
                    "Set-Cookie": `session=${token}; HttpOnly; Path=/; SameSite=Strict`
                }
            });
        }

        if (url.pathname === "/api/auth/logout" && method === "POST") {
            const cookie = req.headers.get('cookie') || '';
            const match = cookie.match(/session=([a-f0-9]+)/);
            if (match) sessions.delete(match[1]);
            return new Response(JSON.stringify({ success: true }), {
                headers: {
                    "Content-Type": "application/json",
                    "Set-Cookie": `session=; HttpOnly; Path=/; Max-Age=0`
                }
            });
        }

        if (url.pathname === "/" || url.pathname === "/app.js" || url.pathname === "/style.css") {
            if (url.pathname === "/") return new Response(indexHtml, { headers: { "Content-Type": "text/html" } });
            if (url.pathname === "/app.js") return new Response(appJs, { headers: { "Content-Type": "application/javascript" } });
            if (url.pathname === "/style.css") return new Response(styleCss, { headers: { "Content-Type": "text/css" } });
        }

        if (url.pathname.startsWith("/api/scripts")) {
            if (!isAuthenticated(req)) {
                return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                    status: 401, headers: { "Content-Type": "application/json" }
                });
            }
            return scriptRoutes(req);
        }

        return new Response("Not Found", { status: 404 });
    }

    async function init() {
        await loadConfig();
        startAutoStartScripts();

        const localIP = getLocalIP();

        serve({ port: PORT, hostname: "0.0.0.0", fetch: router });

        console.log("==================================================")
        console.log(`Running on http://localhost:${PORT}`);
        console.log(`Also accessible at http://${localIP}:${PORT}`);
        console.log(" /\\_/\\  \n( o.o ) \n > ^ <");
        console.log("==================================================")
    }

    init();
}
