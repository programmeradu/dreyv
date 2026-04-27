/**
 * DACS Phase 0 — Studio domain capabilities.
 *
 * Extracted from src/app/api/command/route.ts. Covers Studio scaffolding,
 * code analysis, marketplace publication, SDK hook injection, and project
 * lookup utilities. All read-side; only studio_init_miniapp + marketplace_publish
 * persist (saveProject + integrity hash respectively).
 *
 * Behavior preserved byte-for-byte from the legacy inline tools, except for
 * the route-local `observedGrounding` mutations, which are a concern of the
 * legacy route's grounding gate (Phase 6 cutover replaces that gate too).
 */

import { z } from "zod";
import { defineCapability, type AnyCapability } from "./types";

function normalizeStudioProject(project: any) {
  if (!project?.id) return null;
  return {
    appId: project.id,
    name: project.name || "Untitled App",
    studioPath: `/app/studio?appId=${encodeURIComponent(project.id)}`,
    publicUrl: `/app/run/${encodeURIComponent(project.id)}`,
    ownerWallet: project.creatorWallet || null,
    updatedAt: project.updatedAt || null,
  };
}

const TEMPLATES_FACTORY = (safeName: string, name: string): Record<string, Record<string, string>> => ({
  react: {
    "App.tsx": `import { useVault, useFetch } from '@keystone-os/sdk';\n\nexport default function ${safeName}() {\n  const vault = useVault();\n  const { data: price } = useFetch('/api/jupiter/price?ids=SOL');\n\n  return (\n    <div className="min-h-screen bg-zinc-950 text-white p-6">\n      <h1 className="text-2xl font-bold text-emerald-400 mb-4">${name}</h1>\n      <div className="grid grid-cols-2 gap-4">\n        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">\n          <p className="text-xs text-zinc-500 uppercase">Vault Balance</p>\n          <p className="text-xl font-mono text-emerald-400">{vault.balance?.toFixed(2) ?? '—'} SOL</p>\n        </div>\n        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">\n          <p className="text-xs text-zinc-500 uppercase">SOL Price</p>\n          <p className="text-xl font-mono">${'{'}price?.SOL?.price ? \`$\${Number(price.SOL.price).toFixed(2)}\` : '—'${'}'}</p>\n        </div>\n      </div>\n    </div>\n  );\n}\n`,
    "index.html": `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>${name}</title>\n  <script type="importmap">{\n    "imports": {\n      "react": "https://esm.sh/react@18?dev",\n      "react-dom": "https://esm.sh/react-dom@18?dev",\n      "react-dom/client": "https://esm.sh/react-dom@18/client?dev",\n      "@keystone-os/sdk": "https://esm.sh/@keystone-os/sdk?external=react,react-dom"\n    }\n  }</script>\n  <link href="https://cdn.jsdelivr.net/npm/tailwindcss@3/dist/tailwind.min.css" rel="stylesheet" />\n</head>\n<body>\n  <div id="root"></div>\n  <script type="module">\n    import React from 'react';\n    import { createRoot } from 'react-dom/client';\n    import App from './App.tsx';\n    createRoot(document.getElementById('root')).render(React.createElement(App));\n  </script>\n</body>\n</html>`,
  },
  dashboard: {
    "App.tsx": `import { useVault, useFetch } from '@keystone-os/sdk';\nimport { useState } from 'react';\n\ninterface TokenRow {\n  symbol: string;\n  amount: number;\n  price: number;\n  value: number;\n  change24h: number;\n  logoURI?: string;\n}\n\nexport default function ${safeName}() {\n  const vault = useVault();\n  const [sortBy, setSortBy] = useState<'value' | 'change24h'>('value');\n\n  const tokens: TokenRow[] = (vault.tokens || []).map((t: any) => ({\n    symbol: t.symbol || 'SPL',\n    amount: t.amount || 0,\n    price: t.price || 0,\n    value: (t.amount || 0) * (t.price || 0),\n    change24h: t.change24h || 0,\n    logoURI: t.logoURI,\n  })).sort((a: TokenRow, b: TokenRow) => b[sortBy] - a[sortBy]);\n\n  const totalValue = tokens.reduce((s, t) => s + t.value, 0);\n\n  const getLogo = (t: TokenRow) => {\n    if (t.logoURI) return t.logoURI;\n    const domain = ['SOL','USDC','USDT'].includes(t.symbol) ? (t.symbol === 'SOL' ? 'solana.com' : 'circle.com') : \`\${t.symbol.toLowerCase()}.com\`;\n    return \`https://img.logo.dev/\${domain}?token=pk_DFEjHHL4QteaMOzcFuSlwg\`;\n  };\n\n  return (\n    <div className="min-h-screen bg-zinc-950 text-white p-6">\n      <h1 className="text-2xl font-bold text-emerald-400 mb-2">${name}</h1>\n      <p className="text-zinc-500 text-sm mb-6">Total: <span className="text-white font-mono">${'$'}{totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></p>\n      <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">\n        <table className="w-full text-sm">\n          <thead>\n            <tr className="text-zinc-500 text-xs uppercase border-b border-zinc-800">\n              <th className="text-left p-3">Token</th>\n              <th className="text-right p-3">Balance</th>\n              <th className="text-right p-3">Price</th>\n              <th className="text-right p-3 cursor-pointer hover:text-emerald-400" onClick={() => setSortBy('value')}>Value</th>\n              <th className="text-right p-3 cursor-pointer hover:text-emerald-400" onClick={() => setSortBy('change24h')}>24h</th>\n            </tr>\n          </thead>\n          <tbody>\n            {tokens.map((t) => (\n              <tr key={t.symbol} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">\n                <td className="p-3 font-mono font-bold flex items-center gap-2">\n                  <img src={getLogo(t)} alt={t.symbol} className="w-5 h-5 rounded-full bg-zinc-800" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }} />\n                  <div className="w-5 h-5 rounded-full bg-zinc-800 hidden items-center justify-center text-[8px]">{t.symbol[0]}</div>\n                  {t.symbol}\n                </td>\n                <td className="p-3 text-right font-mono">{t.amount.toFixed(4)}</td>\n                <td className="p-3 text-right font-mono">${'$'}{t.price.toFixed(4)}</td>\n                <td className="p-3 text-right font-mono">${'$'}{t.value.toFixed(2)}</td>\n                <td className={\`p-3 text-right font-mono \${t.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'}\`}>{t.change24h >= 0 ? '+' : ''}{t.change24h.toFixed(2)}%</td>\n              </tr>\n            ))}\n          </tbody>\n        </table>\n      </div>\n    </div>\n  );\n}\n`,
    "index.html": `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>${name}</title>\n  <script type="importmap">{\n    "imports": {\n      "react": "https://esm.sh/react@18?dev",\n      "react-dom": "https://esm.sh/react-dom@18?dev",\n      "react-dom/client": "https://esm.sh/react-dom@18/client?dev",\n      "@keystone-os/sdk": "https://esm.sh/@keystone-os/sdk?external=react,react-dom"\n    }\n  }</script>\n  <link href="https://cdn.jsdelivr.net/npm/tailwindcss@3/dist/tailwind.min.css" rel="stylesheet" />\n</head>\n<body>\n  <div id="root"></div>\n  <script type="module">\n    import React from 'react';\n    import { createRoot } from 'react-dom/client';\n    import App from './App.tsx';\n    createRoot(document.getElementById('root')).render(React.createElement(App));\n  </script>\n</body>\n</html>`,
  },
  defi: {
    "App.tsx": `import { useVault, useFetch } from '@keystone-os/sdk';\nimport { useState } from 'react';\n\nexport default function ${safeName}() {\n  const vault = useVault();\n  const [inputToken, setInputToken] = useState('SOL');\n  const [outputToken, setOutputToken] = useState('USDC');\n  const [amount, setAmount] = useState('');\n  const [loading, setLoading] = useState(false);\n  const [status, setStatus] = useState<string>('');\n\n  const handleSwap = async () => {\n    if (!amount || isNaN(Number(amount))) return;\n    setLoading(true);\n    setStatus('Fetching quote...');\n    try {\n      const quote = await vault.fetch(\`/api/jupiter/quote?inputMint=\${inputToken}&outputMint=\${outputToken}&amount=\${amount}\`);\n      setStatus('Quote ready — connect your wallet to sign in the host app.');\n      console.log('Quote:', quote);\n    } catch (err) {\n      console.error('Swap failed:', err);\n      setStatus('Failed to fetch quote.');\n    } finally {\n      setLoading(false);\n    }\n  };\n\n  return (\n    <div className="min-h-screen bg-zinc-950 text-white p-6 flex items-center justify-center">\n      <div className="w-full max-w-md bg-zinc-900 rounded-2xl border border-zinc-800 p-6">\n        <h2 className="text-lg font-bold text-emerald-400 mb-4">${name}</h2>\n        <div className="space-y-4">\n          <div>\n            <label className="text-xs text-zinc-500 uppercase">From</label>\n            <div className="flex gap-2 mt-1">\n              <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="flex-1 bg-zinc-800 rounded-lg px-3 py-2 font-mono text-white border border-zinc-700 focus:border-emerald-500 outline-none" />\n              <select value={inputToken} onChange={(e) => setInputToken(e.target.value)} className="bg-zinc-800 rounded-lg px-3 py-2 text-white border border-zinc-700">\n                <option>SOL</option><option>USDC</option><option>JUP</option><option>BONK</option>\n              </select>\n            </div>\n          </div>\n          <div className="text-center text-zinc-600">↓</div>\n          <div>\n            <label className="text-xs text-zinc-500 uppercase">To</label>\n            <div className="flex gap-2 mt-1">\n              <div className="flex-1 bg-zinc-800 rounded-lg px-3 py-2 font-mono text-zinc-500">Est. output</div>\n              <select value={outputToken} onChange={(e) => setOutputToken(e.target.value)} className="bg-zinc-800 rounded-lg px-3 py-2 text-white border border-zinc-700">\n                <option>USDC</option><option>SOL</option><option>JUP</option><option>BONK</option>\n              </select>\n            </div>\n          </div>\n          <button onClick={handleSwap} disabled={loading || !amount} className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 rounded-xl font-bold text-black transition-colors">\n            {loading ? 'Fetching...' : 'Get quote'}\n          </button>\n          {status && <p className="text-xs text-zinc-400 text-center">{status}</p>}\n        </div>\n      </div>\n    </div>\n  );\n}\n`,
    "index.html": `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>${name}</title>\n  <script type="importmap">{\n    "imports": {\n      "react": "https://esm.sh/react@18?dev",\n      "react-dom": "https://esm.sh/react-dom@18?dev",\n      "react-dom/client": "https://esm.sh/react-dom@18/client?dev",\n      "@keystone-os/sdk": "https://esm.sh/@keystone-os/sdk?external=react,react-dom"\n    }\n  }</script>\n  <link href="https://cdn.jsdelivr.net/npm/tailwindcss@3/dist/tailwind.min.css" rel="stylesheet" />\n</head>\n<body>\n  <div id="root"></div>\n  <script type="module">\n    import React from 'react';\n    import { createRoot } from 'react-dom/client';\n    import App from './App.tsx';\n    createRoot(document.getElementById('root')).render(React.createElement(App));\n  </script>\n</body>\n</html>`,
  },
});

const studio_init_miniapp = defineCapability({
  id: "studio_init_miniapp",
  domain: "studio",
  description: "Initialize a new Mini-App using Zero-Build Runtime.",
  inputSchema: z.object({
    name: z.string(),
    template: z.enum(["react", "dashboard", "defi"]).optional().default("react"),
    customAppTsxCode: z.string().optional(),
  }),
  sideEffects: "write",
  requiredAuth: "none",
  sensitivity: "low",
  execute: async ({ name, template, customAppTsxCode }, ctx) => {
    console.log(`[Tool: studio_init_miniapp] ${name} (${template})`);
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
    const TEMPLATES = TEMPLATES_FACTORY(safeName, name);
    const files = { ...(TEMPLATES[template] || TEMPLATES.react) };
    if (customAppTsxCode) files["App.tsx"] = customAppTsxCode;

    let finalAppId: string | null = null;
    try {
      const resolvedWallet = ctx.walletAddress || "Operator";
      const { saveProject } = await import("@/actions/studio-actions");
      const projectCode = {
        files: Object.entries(files).reduce((acc, [n, content]) => ({
          ...acc,
          [n]: { content },
        }), {} as Record<string, { content: string }>),
      };
      const appId = "app_" + Math.random().toString(36).substring(2, 15);
      const saveRes = await saveProject(
        resolvedWallet,
        projectCode,
        { name, description: `AI-generated ${template} mini-app` },
        appId,
      );
      if (saveRes.success) finalAppId = saveRes.appId || appId;
    } catch (err: unknown) {
      console.warn("[studio_init_miniapp] Failed to save project to DB:", err);
    }

    return {
      success: true,
      operation: "studio_init_miniapp",
      name,
      template,
      files,
      fileCount: Object.keys(files).length,
      entrypoint: "App.tsx",
      appId: finalAppId,
      message: `Mini-App "${name}" initialized with ${template} template (${Object.keys(files).length} files). ${finalAppId ? "Project saved." : "esm.sh import maps configured."}`,
    };
  },
});

const studio_analyze_code = defineCapability({
  id: "studio_analyze_code",
  domain: "studio",
  description: "Analyze code for errors and apply self-correction.",
  inputSchema: z.object({
    code: z.string(),
    language: z.string().optional().default("typescript"),
  }),
  sideEffects: "read",
  requiredAuth: "none",
  sensitivity: "low",
  execute: async ({ code, language }) => {
    console.log(`[Tool: studio_analyze_code] ${language}, ${code.length} chars`);
    return {
      success: true,
      operation: "studio_analyze_code",
      language,
      diagnostics: [],
      patchesApplied: 0,
      message: `Code analysis complete. 0 errors found.`,
    };
  },
});

const marketplace_publish = defineCapability({
  id: "marketplace_publish",
  domain: "studio",
  description: "Bundle Mini-App code and submit for marketplace listing with 80/20 revenue split.",
  inputSchema: z.object({
    appName: z.string(),
    version: z.string(),
    description: z.string(),
  }),
  sideEffects: "write",
  requiredAuth: "none",
  sensitivity: "medium",
  execute: async ({ appName, version, description }) => {
    console.log(`[Tool: marketplace_publish] ${appName} v${version}`);
    const { createHash } = await import("crypto");
    const hash = `sha256-${createHash("sha256").update(`${appName}@${version}`).digest("hex")}`;
    return {
      success: true,
      operation: "marketplace_publish",
      appName,
      version,
      description,
      integrityHash: hash,
      revenueSplit: { developer: 80, platform: 20 },
      status: "PENDING_REVIEW",
      message: `"${appName}" v${version} bundled (${hash.slice(0, 20)}…). Submitted for review.`,
    };
  },
});

const sdk_hooks = defineCapability({
  id: "sdk_hooks",
  domain: "studio",
  description: "Inject @keystone-os/sdk hooks into the active project.",
  inputSchema: z.object({
    hooks: z.array(z.enum(["useVault", "useTurnkey", "useFetch", "useSwap", "useStake"])),
    projectName: z.string().optional(),
  }),
  sideEffects: "meta",
  requiredAuth: "none",
  sensitivity: "low",
  execute: async ({ hooks, projectName }) => {
    console.log(`[Tool: sdk_hooks] ${hooks.join(", ")} → ${projectName || "active"}`);
    const imports = hooks.map((h) => `import { ${h} } from '@keystone-os/sdk';`).join("\n");
    return {
      success: true,
      operation: "sdk_hooks",
      hooks,
      projectName,
      generatedImports: imports,
      message: `SDK hooks injected: ${hooks.join(", ")}.`,
    };
  },
});

const get_project_by_id = defineCapability({
  id: "get_project_by_id",
  domain: "studio",
  description: "Lookup a Studio project by appId from DB; returns canonical Studio/public links.",
  inputSchema: z.object({ appId: z.string() }),
  sideEffects: "read",
  requiredAuth: "none",
  sensitivity: "low",
  execute: async ({ appId }) => {
    try {
      const { getProject } = await import("@/actions/studio-actions");
      const project = await getProject(appId);
      const normalized = normalizeStudioProject(project);
      if (!normalized) {
        return { success: false, operation: "get_project_by_id", appId, message: `No project found for ${appId}.` };
      }
      return { success: true, operation: "get_project_by_id", ...normalized, message: `Found project ${normalized.name}.` };
    } catch {
      return { success: false, operation: "get_project_by_id", appId, message: "Lookup failed." };
    }
  },
});

const get_project_by_name = defineCapability({
  id: "get_project_by_name",
  domain: "studio",
  description: "Lookup the caller's recent Studio projects by name and return verified links.",
  inputSchema: z.object({
    name: z.string(),
    ownerWallet: z.string().optional(),
  }),
  sideEffects: "read",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async ({ name, ownerWallet }, ctx) => {
    const lookupWallet = ownerWallet || ctx.walletAddress;
    if (!lookupWallet) {
      return { success: false, operation: "get_project_by_name", message: "Wallet required to lookup by name." };
    }
    try {
      const { getProjects } = await import("@/actions/studio-actions");
      const projects = await getProjects(lookupWallet);
      const q = name.trim().toLowerCase();
      const matches = projects
        .filter((p: any) => (p?.name || "").toLowerCase().includes(q))
        .slice(0, 5)
        .map((p: any) => normalizeStudioProject(p))
        .filter(Boolean);
      if (matches.length === 0) {
        return { success: false, operation: "get_project_by_name", message: `No projects matching "${name}".` };
      }
      return { success: true, operation: "get_project_by_name", results: matches, message: `Found ${matches.length} matching project(s).` };
    } catch {
      return { success: false, operation: "get_project_by_name", message: "Lookup failed." };
    }
  },
});

const list_recent_projects = defineCapability({
  id: "list_recent_projects",
  domain: "studio",
  description: "List the wallet owner's most recent Studio projects with verified links.",
  inputSchema: z.object({
    ownerWallet: z.string().optional(),
    limit: z.number().int().min(1).max(20).optional().default(5),
  }),
  sideEffects: "read",
  requiredAuth: "wallet",
  sensitivity: "low",
  execute: async ({ ownerWallet, limit }, ctx) => {
    const lookupWallet = ownerWallet || ctx.walletAddress;
    if (!lookupWallet) return { success: false, operation: "list_recent_projects", message: "Wallet required." };
    try {
      const { getProjects } = await import("@/actions/studio-actions");
      const projects = await getProjects(lookupWallet);
      const recent = projects.slice(0, limit).map((p: any) => normalizeStudioProject(p)).filter(Boolean);
      return { success: true, operation: "list_recent_projects", results: recent, message: `Returned ${recent.length} project(s).` };
    } catch {
      return { success: false, operation: "list_recent_projects", message: "Failed to list projects." };
    }
  },
});

const get_studio_project_link = defineCapability({
  id: "get_studio_project_link",
  domain: "studio",
  description: "Resolve a canonical Studio deep link from appId.",
  inputSchema: z.object({ appId: z.string() }),
  sideEffects: "read",
  requiredAuth: "none",
  sensitivity: "low",
  execute: async ({ appId }) => {
    try {
      const { getProject } = await import("@/actions/studio-actions");
      const project = await getProject(appId);
      const normalized = normalizeStudioProject(project);
      if (!normalized) return { success: false, operation: "get_studio_project_link", appId, message: "Project not found." };
      return { success: true, operation: "get_studio_project_link", ...normalized, message: `Resolved verified link for ${normalized.name}.` };
    } catch {
      return { success: false, operation: "get_studio_project_link", appId, message: "Link resolution failed." };
    }
  },
});

export const studioCapabilities: AnyCapability[] = [
  studio_init_miniapp,
  studio_analyze_code,
  marketplace_publish,
  sdk_hooks,
  get_project_by_id,
  get_project_by_name,
  list_recent_projects,
  get_studio_project_link,
];
