"use client";

/**
 * WebContainer host page (cross-origin isolated).
 *
 * This page is served with COOP/COEP headers (see next.config.ts) so it can
 * boot a real Node.js + Vite dev server inside the browser via @webcontainer/api.
 *
 * It is loaded as an iframe from /app/studio (not navigated to directly),
 * and communicates with its parent via postMessage:
 *
 *   parent → host  { type: "wc:boot",   files: { "/path": "contents", ... } }
 *   parent → host  { type: "wc:write",  files: { ... } }
 *   host   → parent{ type: "wc:status", phase: "...", message?: "..." }
 *   host   → parent{ type: "wc:server-ready", url: "https://..." }
 *   host   → parent{ type: "wc:log",    stream: "install"|"dev", chunk: "..." }
 *   host   → parent{ type: "wc:error",  message: "..." }
 */

import { useEffect, useRef, useState } from "react";
import { WebContainer, type FileSystemTree } from "@webcontainer/api";

type IncomingMessage =
    | { type: "wc:boot"; files: Record<string, string> }
    | { type: "wc:write"; files: Record<string, string> }
    | { type: "wc:restart" };

function post(message: Record<string, unknown>) {
    window.parent?.postMessage({ source: "dreyv-wc-host", ...message }, "*");
}

function postStatus(phase: string, message?: string) {
    post({ type: "wc:status", phase, message });
}

function postLog(stream: "install" | "dev" | "system", chunk: string) {
    post({ type: "wc:log", stream, chunk });
}

function postError(message: string) {
    post({ type: "wc:error", message });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => {
            window.setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
        }),
    ]);
}

/** Convert a flat path→content map into the nested FileSystemTree WebContainer expects. */
function buildTree(files: Record<string, string>): FileSystemTree {
    const tree: FileSystemTree = {};
    for (const [rawPath, contents] of Object.entries(files)) {
        const segments = rawPath.replace(/^\/+/, "").split("/").filter(Boolean);
        if (segments.length === 0) continue;
        let cursor: FileSystemTree = tree;
        for (let i = 0; i < segments.length - 1; i++) {
            const segment = segments[i];
            const existing = cursor[segment];
            if (!existing || !("directory" in existing)) {
                cursor[segment] = { directory: {} };
            }
            cursor = (cursor[segment] as { directory: FileSystemTree }).directory;
        }
        cursor[segments[segments.length - 1]] = { file: { contents } };
    }
    return tree;
}

/** Default scaffold layered under user files: vite + react + tailwind ready to go. */
function scaffoldFiles(): Record<string, string> {
    return {
        "package.json": JSON.stringify(
            {
                name: "dreyv-mini-app",
                private: true,
                type: "module",
                scripts: {
                    dev: "vite --host 0.0.0.0 --port 5173",
                    build: "vite build",
                    preview: "vite preview",
                },
                dependencies: {
                    react: "^18.3.1",
                    "react-dom": "^18.3.1",
                },
                devDependencies: {
                    "@vitejs/plugin-react": "^4.3.4",
                    typescript: "^5.6.3",
                    vite: "^5.4.10",
                    tailwindcss: "^3.4.14",
                    postcss: "^8.4.47",
                    autoprefixer: "^10.4.20",
                    "lucide-react": "^0.454.0",
                    recharts: "^2.13.0",
                    "framer-motion": "^11.11.10",
                    "date-fns": "^4.1.0",
                },
            },
            null,
            2,
        ),
        "vite.config.ts": `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve("./src") } },
  server: { hmr: { clientPort: 443 }, host: true, port: 5173 },
});
`,
        "tailwind.config.js": `export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: { extend: { fontFamily: { sans: ["Manrope","system-ui","sans-serif"] } } },
  plugins: [],
};
`,
        "postcss.config.js": `export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
`,
        "tsconfig.json": JSON.stringify(
            {
                compilerOptions: {
                    target: "ES2020",
                    module: "ESNext",
                    moduleResolution: "bundler",
                    jsx: "react-jsx",
                    strict: false,
                    esModuleInterop: true,
                    skipLibCheck: true,
                    baseUrl: ".",
                    paths: { "@/*": ["src/*"] },
                },
                include: ["src"],
            },
            null,
            2,
        ),
        "index.html": `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
    <title>Dreyv Preview</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
        "src/main.tsx": `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
`,
        "src/index.css": `@tailwind base;
@tailwind components;
@tailwind utilities;
html, body { font-family: "Manrope", system-ui, -apple-system, sans-serif; }
`,
    };
}

/** Merge user-provided files (from the studio editor) over the scaffold. */
function mergeFiles(scaffold: Record<string, string>, user: Record<string, string>) {
    const out: Record<string, string> = { ...scaffold };
    for (const [path, content] of Object.entries(user)) {
        const normalised = path.replace(/^\/+/, "");
        out[normalised] = content;
    }
    return out;
}

export default function WebContainerHost() {
    const [phase, setPhase] = useState<string>("Idle — waiting for parent…");
    const wcRef = useRef<WebContainer | null>(null);
    const bootedRef = useRef(false);

    useEffect(() => {
        let installProcess: Awaited<ReturnType<WebContainer["spawn"]>> | null = null;
        let devProcess: Awaited<ReturnType<WebContainer["spawn"]>> | null = null;

        async function boot(userFiles: Record<string, string>) {
            if (bootedRef.current) return;
            bootedRef.current = true;
            try {
                setPhase("Booting Node.js runtime…");
                postStatus("booting", "Booting Node.js runtime…");
                if (!window.crossOriginIsolated) {
                    throw new Error(
                        "WebContainers need cross-origin isolation. Hard-reload Studio so the COOP/COEP headers apply.",
                    );
                }
                const wc = await withTimeout(
                    WebContainer.boot({ coep: "credentialless", forwardPreviewErrors: true }),
                    20_000,
                    "WebContainer boot",
                );
                wcRef.current = wc;

                wc.on("server-ready", (_port, url) => {
                    setPhase("Dev server ready");
                    post({ type: "wc:server-ready", url });
                });
                wc.on("error", (e) => postError(e.message));

                setPhase("Mounting project files…");
                postStatus("mounting", "Mounting project files…");
                const merged = mergeFiles(scaffoldFiles(), userFiles);
                await wc.mount(buildTree(merged));

                setPhase("Installing dependencies (first boot ~30s)…");
                postStatus("installing", "Installing dependencies…");
                installProcess = await wc.spawn("npm", ["install", "--no-audit", "--no-fund"]);
                installProcess.output.pipeTo(
                    new WritableStream({ write(chunk) { postLog("install", chunk); } }),
                );
                const exitCode = await withTimeout(installProcess.exit, 90_000, "Dependency install");
                if (exitCode !== 0) {
                    throw new Error(`npm install exited with code ${exitCode}`);
                }

                setPhase("Starting Vite dev server…");
                postStatus("starting", "Starting Vite dev server…");
                devProcess = await wc.spawn("npm", ["run", "dev"]);
                devProcess.output.pipeTo(
                    new WritableStream({ write(chunk) { postLog("dev", chunk); } }),
                );
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                setPhase(`Error: ${message}`);
                postError(message);
                bootedRef.current = false;
            }
        }

        async function writeFiles(userFiles: Record<string, string>) {
            const wc = wcRef.current;
            if (!wc) return;
            for (const [rawPath, contents] of Object.entries(userFiles)) {
                const path = "/" + rawPath.replace(/^\/+/, "");
                try {
                    const dir = path.substring(0, path.lastIndexOf("/"));
                    if (dir && dir !== "/") await wc.fs.mkdir(dir, { recursive: true });
                    await wc.fs.writeFile(path, contents);
                } catch (err) {
                    postLog("system", `[fs] write ${path} failed: ${err instanceof Error ? err.message : String(err)}\n`);
                }
            }
        }

        function onMessage(event: MessageEvent<IncomingMessage>) {
            const data = event.data;
            if (!data || typeof data !== "object") return;
            if (data.type === "wc:boot") {
                void boot(data.files || {});
            } else if (data.type === "wc:write") {
                void writeFiles(data.files || {});
            } else if (data.type === "wc:restart") {
                bootedRef.current = false;
                wcRef.current?.teardown();
                wcRef.current = null;
                postStatus("restart", "Tear-down complete; send wc:boot again to restart.");
            }
        }

        window.addEventListener("message", onMessage);
        post({ type: "wc:status", phase: "ready", message: "Host ready — send wc:boot." });

        return () => {
            window.removeEventListener("message", onMessage);
            try { installProcess?.kill(); } catch {}
            try { devProcess?.kill(); } catch {}
            try { wcRef.current?.teardown(); } catch {}
        };
    }, []);

    return (
        <main style={{
            margin: 0, padding: 24, minHeight: "100vh",
            fontFamily: "Manrope, system-ui, sans-serif",
            color: "#0f172a", background: "#ffffff",
        }}>
            <div style={{ maxWidth: 520 }}>
                <div style={{
                    fontSize: 11, letterSpacing: ".15em", textTransform: "uppercase",
                    color: "#7c3aed", fontWeight: 700, marginBottom: 8,
                }}>
                    Dreyv WebContainer host
                </div>
                <div style={{ fontSize: 14, color: "#475569" }}>{phase}</div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 12 }}>
                    Cross-origin isolated · Node + Vite in browser
                </div>
            </div>
        </main>
    );
}
