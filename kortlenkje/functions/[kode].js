// onskje.pages.dev/<kode> – kort delelenkje.
// Meldingsappar (Messenger, SMS, Snap …) les førehandsvisinga her: namnet på lista, kven ho er til
// og eit produktbilete. Folk som opnar lenkja, blir sende rett vidare til ønskjelista i appen.
const APP = 'https://lillerud-land1.github.io/onskje/';
const IKON = APP + 'icons/icon-512.png';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ønske = n => (n === 1 ? '1 ønske' : `${n} ønske`);

export async function onRequestGet({ params, env, request }) {
  const kode = String(params.kode || '');
  if (!/^[A-Za-z0-9]{7,12}$/.test(kode)) return Response.redirect(APP, 302);
  const mal = `${APP}#/d/${kode}`;

  let tittel = 'Ei ønskjeliste';
  let tekst = 'Sjå ønskjelista og reserver det du vil gi.';
  let bilete = IKON;
  try {
    const l = await env.DB.prepare('SELECT id, data FROM lister WHERE kort = ? OR delid = ?').bind(kode, kode).first();
    if (l) {
      const d = JSON.parse(l.data);
      tittel = d.til ? `Ønskjelista til ${d.til}: ${d.namn}` : d.namn;
      const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM ting WHERE liste = ?').bind(l.id).first();
      tekst = `${ønske(n)}. Sjå lista og reserver det du vil gi – den som eig lista, ser ikkje kva som er reservert.`;
      const { results } = await env.DB.prepare('SELECT data FROM ting WHERE liste = ? ORDER BY pos, laga LIMIT 30').bind(l.id).all();
      const medBilete = results.map(r => JSON.parse(r.data)).find(t => /^https:\/\//.test(t.bilete || ''));
      if (medBilete) bilete = medBilete.bilete;
    } else {
      tittel = 'Fann ikkje ønskjelista';
      tekst = 'Ho kan vere sletta, eller lenkja er feil.';
    }
  } catch {
    // Databasen svarte ikkje: vis ei enkel førehandsvising og send vidare likevel.
  }

  const url = new URL(request.url);
  const html = `<!doctype html>
<html lang="nn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(tittel)} – Ønskje</title>
<meta name="description" content="${esc(tekst)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Ønskje">
<meta property="og:title" content="${esc(tittel)}">
<meta property="og:description" content="${esc(tekst)}">
<meta property="og:image" content="${esc(bilete)}">
<meta property="og:url" content="${esc(url.origin + url.pathname)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#ECEFF3">
<meta http-equiv="refresh" content="0;url=${esc(mal)}">
<link rel="icon" href="${esc(APP)}icons/favicon-32.png">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#ECEFF3;color:#1C2233;font:17px/1.5 system-ui,sans-serif}a{color:#C92F5E;font-weight:700}</style>
</head>
<body>
<p><a href="${esc(mal)}">Opne ønskjelista</a></p>
<script>location.replace(${JSON.stringify(mal)})</script>
</body>
</html>`;
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
