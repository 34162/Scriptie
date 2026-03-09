import {
    getScripts,
    addScript,
    deleteScript,
    startScript,
    stopScript,
    getLogs,
    getResources,
    saveConfig,
    updateScript,
} from "../services/scriptManager.js";

export default async function scriptRoutes(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;
    const parts = pathname.split("/").filter(Boolean);
    const method = req.method.toUpperCase();

    if (parts.length === 2 && parts[0] === "api" && parts[1] === "scripts") {
        if (method === "GET") {
            return new Response(JSON.stringify(getScripts()), {
                headers: { "Content-Type": "application/json" },
            });
        }
        if (method === "POST") {
            const body = await req.json();
            const result = await addScript(body);
            if (result.success) await saveConfig();
            return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
        }
    }

    if (parts.length === 4 && parts[0] === "api" && parts[1] === "scripts" && parts[3] === "logs" && method === "GET") {
        return new Response(JSON.stringify(getLogs(parts[2])), { headers: { "Content-Type": "application/json" } });
    }

    if (parts.length === 4 && parts[0] === "api" && parts[1] === "scripts" && parts[3] === "resources" && method === "GET") {
        return new Response(JSON.stringify(getResources(parts[2])), { headers: { "Content-Type": "application/json" } });
    }

    if (parts.length === 4 && parts[0] === "api" && parts[1] === "scripts" && parts[3] === "start" && method === "POST") {
        return new Response(JSON.stringify(startScript(parts[2])), { headers: { "Content-Type": "application/json" } });
    }

    if (parts.length === 4 && parts[0] === "api" && parts[1] === "scripts" && parts[3] === "stop" && method === "POST") {
        return new Response(JSON.stringify(stopScript(parts[2])), { headers: { "Content-Type": "application/json" } });
    }

    if (parts.length === 3 && parts[0] === "api" && parts[1] === "scripts") {
        const id = parts[2];
        if (method === "DELETE") {
            const result = await deleteScript(id);
            if (result.success) await saveConfig();
            return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
        }
        if (method === "PUT") {
            const body = await req.json();
            const result = await updateScript(id, body);
            if (result.success) await saveConfig();
            return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
        }
    }

    return new Response("Not Found", { status: 404 });
}
