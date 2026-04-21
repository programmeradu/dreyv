/**
 * Build a self-contained HTML page that boots a dreyv mini-app's
 * App.tsx source via Babel-standalone for headless rendering
 * (screenshots, PDF export, smoke tests).
 *
 * Mock SDK hooks are stubbed inline so the app renders without a server.
 */
export function buildPreviewHtml(code: string): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://unpkg.com/react@18.2.0/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone@7.26.2/babel.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { margin: 0; background: #09090b; color: white; font-family: system-ui, -apple-system, sans-serif; }
    #root { min-height: 100vh; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    window.__keystoneSDK = {
      useVault: function() { return { activeVault: 'Main', balances: {}, tokens: [
        { symbol: 'SOL', name: 'Solana', balance: 124.5, price: 23.4 },
        { symbol: 'USDC', name: 'USD Coin', balance: 5400.2, price: 1.0 }
      ] }; },
      usePortfolio: function() { return { data: { tokens: [], totalValue: 8862 }, isLoading: false }; },
      useTheme: function() { return { isDark: true, theme: 'dark', toggleTheme: function(){} }; },
      useTokenPrice: function() { return { price: 23.4, loading: false }; },
      useJupiterSwap: function() { return { swap: function(){}, getQuote: function(){ return Promise.resolve({}); }, loading: false }; },
      useNotification: function() { return { notifications: [], send: function(){}, dismiss: function(){}, clearAll: function(){}, unreadCount: 0 }; },
      useStorage: function() { return { get: function(){ return null; }, set: function(){}, remove: function(){}, keys: function(){ return []; }, clear: function(){} }; },
      useImpactReport: function() { return { simulate: function(){}, report: null }; },
      useTurnkey: function() { return { signTransaction: function(){ return Promise.resolve({}); } }; }
    };
    var moduleMap = { 'react': React, 'react-dom': ReactDOM, 'react-dom/client': ReactDOM, '@keystone-os/sdk': window.__keystoneSDK, '@dreyv/sdk': window.__keystoneSDK };
    window.__ks_require = function(n) { if (moduleMap[n]) return moduleMap[n]; throw new Error('Module not found: ' + n); };
  </script>
  <script>
    try {
      var code = ${JSON.stringify(code)};
      var compiled = Babel.transform(code, { presets: ['typescript', 'react'], plugins: ['transform-modules-commonjs'], filename: 'App.tsx' });
      var _m = { exports: {} };
      new Function('require', 'module', 'exports', compiled.code)(window.__ks_require, _m, _m.exports);
      var App = _m.exports.default || _m.exports;
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
    } catch(e) {
      document.getElementById('root').innerHTML = '<div style="color:#ef4444;padding:20px;font-family:monospace"><strong>Error:</strong> ' + e.message + '</div>';
    }
  </script>
</body>
</html>`;
}
