
export default {
  async fetch(req, env) {
    const repo = env.GH_REPO, path = env.GH_PATH, branch = env.GH_BRANCH || 'main';
    const apiBase = `https://api.github.com/repos/${repo}/contents/${path}`;
    const headers = { Authorization: `token ${env.GH_TOKEN}`, 'User-Agent': 'cf-worker' };

    // CORS + Origin whitelist
    const origin = req.headers.get('Origin') || '';
    const allowed = ['https://sevenoy.github.io']; // 按需添加更多允许来源
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : 'https://sevenoy.github.io',
      'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,X-Access-Key',
      'Vary': 'Origin'
    };

    if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    // 简单访问密钥，阻止直接 GET 把 JSON 读走
    const requiredKey = env.ACCESS_KEY && String(env.ACCESS_KEY).length > 0;
    const headerKey = req.headers.get('X-Access-Key');
    const isBrowserNav = !origin; // 直接地址栏访问通常没有 Origin
    if ((requiredKey && headerKey !== env.ACCESS_KEY) || isBrowserNav) {
      return new Response('Forbidden', { status: 403, headers: corsHeaders });
    }

    if (req.method === 'GET') {
      const rsp = await fetch(`${apiBase}?ref=${branch}`, { headers });
      if (!rsp.ok) return new Response('GitHub read failed', { status: 500, headers: corsHeaders });
      const j = await rsp.json();
      const data = j.content ? atob(j.content) : '{"rows":[],"cats":[],"view":{},"ver":1,"updated_at":""}';
      return new Response(data, { headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }

    if (req.method === 'PUT') {
      const body = await req.text();
      const cur = await fetch(`${apiBase}?ref=${branch}`, { headers });
      const curJ = await cur.json();
      const sha = curJ.sha;
      const payload = {
        message: `update rows ${new Date().toISOString()}`,
        content: btoa(body),
        branch, sha
      };
      const save = await fetch(apiBase, {
        method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!save.ok) return new Response('GitHub write failed', { status: 500, headers: corsHeaders });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }
};
