// Ønskje: ønskjelister med deling og reservasjonar, lagra i Cloudflare D1.
// Appen ligg på GitHub Pages og snakkar med denne workeren.
//
// Kontoar: første gong nokon lagar ei liste, får eininga ein anonym konto (berre ein token).
// Seinare kan kontoen få namn og passord, så listene kan opnast på fleire einingar.
// Delelenkjer: alle med lenkja kan sjå lista og reservere ønske. Eigaren ser aldri reservasjonane.

const OPPHAV = ['https://lillerud-land1.github.io', 'http://localhost:8768', 'http://127.0.0.1:8768'];
const ITER = 100000;
const OKT_LEVETID = 400 * 864e5;
const MAKS_FEIL = 8;
const FEIL_VINDAUGE = 15 * 60e3;
const MAKS_LISTER = 60;
const MAKS_TING = 300;
const MAKS_FOLGJER = 200;
const FARGAR = ['bringebaer', 'hav', 'furu', 'plomme', 'rav', 'blekk'];
const ANLEDNINGAR = ['jul', 'bursdag', 'konfirmasjon', 'bryllaup', 'baby', 'anna'];
const UA = 'Mozilla/5.0 (compatible; Onskje/1.0; +https://lillerud-land1.github.io/onskje/)';

class Feil extends Error {
  constructor(status, melding) { super(melding); this.status = status; }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const cors = OPPHAV.includes(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    let res;
    try {
      res = await rute(req, env, url);
    } catch (e) {
      if (!(e instanceof Feil)) console.error(e);
      res = svar({ feil: e instanceof Feil ? e.message : 'Noko gjekk gale på serveren. Prøv igjen om litt.' }, e instanceof Feil ? e.status : 500);
    }
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
};

const ID = '[A-Za-z0-9]{8,32}';
const DELID = '[A-Za-z0-9]{12}';

async function rute(req, env, url) {
  const p = url.pathname.replace(/\/+$/, '');
  const m = req.method;
  let r;

  if (m === 'GET' && p === '') return svar({ ok: true, app: 'onskje' });
  if (m === 'POST' && p === '/konto/start') return startKonto(req, env);
  if (m === 'POST' && p === '/logg-inn') return loggInn(req, env);
  if (m === 'POST' && p === '/nytt-passord') return nyttPassordMedKode(req, env);

  if (m === 'GET' && (r = /^\/bilete\/([0-9a-f]{32})$/.exec(p))) return hentBilete(env, r[1]);

  // Offentleg: delte lister og reservasjonar
  if (m === 'GET' && (r = new RegExp(`^/del/(${DELID})$`).exec(p))) return hentDelt(req, env, r[1]);
  if (m === 'POST' && (r = new RegExp(`^/del/(${DELID})/reserver$`).exec(p))) return reserver(req, env, r[1]);
  if (m === 'POST' && (r = /^\/reservasjon\/([A-Za-z0-9]{16})\/angre$/.exec(p))) return angreReservasjon(req, env, r[1]);

  const b = await krevInnlogging(req, env);
  if (m === 'GET' && p === '/meg') return meg(env, b);
  if (m === 'POST' && p === '/konto/namn') return settNamn(req, env, b);
  if (m === 'POST' && p === '/passord') return bytPassord(req, env, b);
  if (m === 'POST' && p === '/gjenopprettingskode') {
    krevNamn(b);
    return svar({ kode: await lagKode(env, b.id) }, 201);
  }
  if (m === 'POST' && p === '/logg-ut') {
    await env.DB.prepare('DELETE FROM okter WHERE tokenhash = ?').bind(b.h).run();
    return svar({ ok: true });
  }
  if (m === 'DELETE' && p === '/konto') return slettKonto(env, b);
  if (m === 'GET' && p === '/forhandsvis') return forhandsvis(env, b, url);
  if (m === 'POST' && p === '/bilete') return lastOppBilete(req, env, b, url);
  if (m === 'POST' && p === '/rekkjefolgje') return sorterLister(req, env, b);
  if (m === 'POST' && p === '/folgjer') return folg(req, env, b);
  if (m === 'DELETE' && (r = new RegExp(`^/folgjer/(${DELID})$`).exec(p))) {
    await env.DB.prepare('DELETE FROM folgjer WHERE brukar = ? AND delid = ?').bind(b.id, r[1]).run();
    return svar({ ok: true });
  }
  if ((r = new RegExp(`^/lister/(${ID})$`).exec(p))) {
    if (m === 'PUT') return lagreListe(req, env, b, r[1]);
    if (m === 'DELETE') return slettListe(env, b, r[1]);
  }
  if (m === 'POST' && (r = new RegExp(`^/lister/(${ID})/rekkjefolgje$`).exec(p))) return sorterTing(req, env, b, r[1]);
  if ((r = new RegExp(`^/lister/(${ID})/ting/(${ID})$`).exec(p))) {
    if (m === 'PUT') return lagreTing(req, env, b, r[1], r[2]);
    if (m === 'DELETE') return slettTing(env, b, r[1], r[2]);
  }
  throw new Feil(404, 'Fann ikkje denne adressa.');
}

// ---------- Kontoar ----------
function rensNamn(s) {
  const namn = String(s || '').trim().toLowerCase();
  if (!/^[a-z0-9æøå._-]{3,30}$/.test(namn)) throw new Feil(400, 'Brukarnamnet må vere 3–30 teikn: bokstavar, tal, punktum, bindestrek eller understrek.');
  return namn;
}
function rensPassord(s) {
  const passord = String(s || '');
  if (passord.length < 6) throw new Feil(400, 'Passordet må ha minst 6 teikn.');
  if (passord.length > 200) throw new Feil(400, 'Passordet er for langt.');
  return passord;
}
function krevNamn(b) {
  if (!b.namn) throw new Feil(409, 'Vel brukarnamn og passord først.');
}
async function grense(env, nokkel) {
  if (!env.GRENSE) return;
  const { success } = await env.GRENSE.limit({ key: nokkel });
  if (!success) throw new Feil(429, 'For mange forsøk på kort tid. Vent eitt minutt og prøv igjen.');
}
const ip = req => req.headers.get('CF-Connecting-IP') || 'ukjend';

async function startKonto(req, env) {
  await grense(env, 'start:' + ip(req));
  const id = lagId(16);
  await env.DB.prepare('INSERT INTO brukarar (id, laga) VALUES (?, ?)').bind(id, Date.now()).run();
  return svar({ token: await lagOkt(env, id), namn: null }, 201);
}

// Anonym konto får namn og passord. Listene blir verande der dei er.
async function settNamn(req, env, b) {
  if (b.namn) throw new Feil(409, 'Kontoen har alt eit brukarnamn.');
  await grense(env, 'konto:' + ip(req));
  const body = await lesJson(req);
  const namn = rensNamn(body.namn);
  const passord = rensPassord(body.passord);
  const finst = await env.DB.prepare('SELECT 1 FROM brukarar WHERE namn = ?').bind(namn).first();
  if (finst) throw new Feil(409, 'Brukarnamnet er teke. Vel eit anna, eller logg inn om kontoen er din.');
  const salt = tilfeldig(16);
  try {
    await env.DB.prepare('UPDATE brukarar SET namn = ?, salt = ?, hash = ?, iter = ? WHERE id = ?')
      .bind(namn, hex(salt), await hashPassord(passord, salt, ITER), ITER, b.id).run();
  } catch {
    throw new Feil(409, 'Brukarnamnet er teke. Vel eit anna.');
  }
  return svar({ namn, kode: await lagKode(env, b.id) });
}

async function loggInn(req, env) {
  await grense(env, 'inn:' + ip(req));
  const body = await lesJson(req);
  const namn = rensNamn(body.namn);
  const passord = String(body.passord || '');
  const no = Date.now();
  await env.DB.prepare('DELETE FROM forsok WHERE ts < ?').bind(no - FEIL_VINDAUGE).run();
  const feil = await env.DB.prepare('SELECT COUNT(*) AS n FROM forsok WHERE namn = ?').bind(namn).first();
  if (feil && feil.n >= MAKS_FEIL) throw new Feil(429, 'For mange feil passord. Vent eit kvarter og prøv igjen.');
  const brukar = await env.DB.prepare('SELECT id, salt, hash, iter FROM brukarar WHERE namn = ?').bind(namn).first();
  const rett = brukar && brukar.hash && likt(await hashPassord(passord, fraHex(brukar.salt), brukar.iter), brukar.hash);
  if (!rett) {
    await env.DB.prepare('INSERT INTO forsok (namn, ts) VALUES (?, ?)').bind(namn, no).run();
    throw new Feil(401, 'Feil brukarnamn eller passord.');
  }
  await env.DB.prepare('DELETE FROM forsok WHERE namn = ?').bind(namn).run();
  // Hadde eininga ein anonym konto med lister? Då blir dei flytta inn i kontoen.
  const anon = String(body.anon || '');
  if (/^[A-Za-z0-9_-]{20,100}$/.test(anon)) await flett(env, anon, brukar.id);
  return svar({ namn, token: await lagOkt(env, brukar.id) });
}

async function flett(env, anonToken, til) {
  const okt = await env.DB.prepare('SELECT o.brukar FROM okter o JOIN brukarar b ON b.id = o.brukar WHERE o.tokenhash = ? AND b.namn IS NULL')
    .bind(await sha256(anonToken)).first();
  if (!okt || okt.brukar === til) return;
  const fra = okt.brukar;
  const til0 = await env.DB.prepare('SELECT COALESCE(MIN(pos), 0) AS p FROM lister WHERE brukar = ?').bind(til).first();
  const fra0 = await env.DB.prepare('SELECT COALESCE(MAX(pos), 0) AS p FROM lister WHERE brukar = ?').bind(fra).first();
  await env.DB.batch([
    // Dei flytta listene kjem øvst, i same innbyrdes rekkjefølgje.
    env.DB.prepare('UPDATE lister SET brukar = ?, pos = pos - ? WHERE brukar = ?').bind(til, fra0.p - til0.p + 1, fra),
    env.DB.prepare('INSERT OR IGNORE INTO folgjer (brukar, delid, laga) SELECT ?, delid, laga FROM folgjer WHERE brukar = ?').bind(til, fra),
    env.DB.prepare('DELETE FROM folgjer WHERE brukar = ?').bind(fra),
    env.DB.prepare('UPDATE bilete SET brukar = ? WHERE brukar = ?').bind(til, fra),
    env.DB.prepare('DELETE FROM okter WHERE brukar = ?').bind(fra),
    env.DB.prepare('DELETE FROM brukarar WHERE id = ?').bind(fra),
  ]);
}

// ---------- Passord og gjenopprettingskode ----------
// Koden er 16 teikn frå eit alfabet utan teikn som er lette å blande (0/O, 1/I/L). Ein ny kode gjer den gamle ugyldig.
const KODE_ALFABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const rensKode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function lagKode(env, brukar) {
  const tal = tilfeldig(16);
  const rein = Array.from(tal, x => KODE_ALFABET[x % KODE_ALFABET.length]).join('');
  await env.DB.prepare('INSERT INTO gjenoppretting (brukar, hash, laga) VALUES (?, ?, ?) ON CONFLICT (brukar) DO UPDATE SET hash = excluded.hash, laga = excluded.laga')
    .bind(brukar, await sha256(rein), Date.now()).run();
  return rein.match(/.{4}/g).join('-');
}

async function settPassord(env, brukar, passord) {
  const salt = tilfeldig(16);
  const hash = await hashPassord(passord, salt, ITER);
  await env.DB.prepare('UPDATE brukarar SET salt = ?, hash = ?, iter = ? WHERE id = ?').bind(hex(salt), hash, ITER, brukar).run();
}

async function bytPassord(req, env, b) {
  krevNamn(b);
  await grense(env, 'passord:' + ip(req));
  const body = await lesJson(req);
  await settPassord(env, b.id, rensPassord(body.passord));
  await env.DB.prepare('DELETE FROM okter WHERE brukar = ? AND tokenhash != ?').bind(b.id, b.h).run();
  return svar({ ok: true });
}

async function nyttPassordMedKode(req, env) {
  await grense(env, 'nytt:' + ip(req));
  const body = await lesJson(req);
  const namn = rensNamn(body.namn);
  const kode = rensKode(body.kode);
  const passord = rensPassord(body.passord);
  const no = Date.now();
  await env.DB.prepare('DELETE FROM forsok WHERE ts < ?').bind(no - FEIL_VINDAUGE).run();
  const feil = await env.DB.prepare('SELECT COUNT(*) AS n FROM forsok WHERE namn = ?').bind(namn).first();
  if (feil && feil.n >= MAKS_FEIL) throw new Feil(429, 'For mange feil forsøk. Vent eit kvarter og prøv igjen.');
  const rad = await env.DB.prepare('SELECT b.id, g.hash FROM brukarar b JOIN gjenoppretting g ON g.brukar = b.id WHERE b.namn = ?').bind(namn).first();
  if (!rad || kode.length !== 16 || !likt(await sha256(kode), rad.hash)) {
    await env.DB.prepare('INSERT INTO forsok (namn, ts) VALUES (?, ?)').bind(namn, no).run();
    throw new Feil(401, 'Feil brukarnamn eller gjenopprettingskode.');
  }
  await settPassord(env, rad.id, passord);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM okter WHERE brukar = ?').bind(rad.id),
    env.DB.prepare('DELETE FROM forsok WHERE namn = ?').bind(namn),
  ]);
  return svar({ namn, token: await lagOkt(env, rad.id), kode: await lagKode(env, rad.id) });
}

async function slettKonto(env, b) {
  const sub = 'SELECT id FROM lister WHERE brukar = ?';
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM reservasjonar WHERE liste IN (${sub})`).bind(b.id),
    env.DB.prepare(`DELETE FROM ting WHERE liste IN (${sub})`).bind(b.id),
    env.DB.prepare('DELETE FROM lister WHERE brukar = ?').bind(b.id),
    env.DB.prepare('DELETE FROM folgjer WHERE brukar = ?').bind(b.id),
    env.DB.prepare('DELETE FROM bilete WHERE brukar = ?').bind(b.id),
    env.DB.prepare('DELETE FROM gjenoppretting WHERE brukar = ?').bind(b.id),
    env.DB.prepare('DELETE FROM okter WHERE brukar = ?').bind(b.id),
    env.DB.prepare('DELETE FROM brukarar WHERE id = ?').bind(b.id),
  ]);
  return svar({ ok: true });
}

async function lagOkt(env, brukar) {
  const t = b64url(tilfeldig(32));
  const no = Date.now();
  await env.DB.prepare('INSERT INTO okter (tokenhash, brukar, laga, sist) VALUES (?, ?, ?, ?)').bind(await sha256(t), brukar, no, no).run();
  return t;
}

const token = req => (/^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.headers.get('Authorization') || '') || [])[1] || '';

async function hentOkt(req, env) {
  const t = token(req);
  if (!t) return null;
  const h = await sha256(t);
  const okt = await env.DB.prepare('SELECT o.brukar, o.sist, b.namn FROM okter o JOIN brukarar b ON b.id = o.brukar WHERE o.tokenhash = ?').bind(h).first();
  const no = Date.now();
  if (!okt || no - okt.sist > OKT_LEVETID) return null;
  if (no - okt.sist > 864e5) await env.DB.prepare('UPDATE okter SET sist = ? WHERE tokenhash = ?').bind(no, h).run();
  return { id: okt.brukar, namn: okt.namn || null, h };
}

async function krevInnlogging(req, env) {
  const b = await hentOkt(req, env);
  if (!b) throw new Feil(401, token(req) ? 'Du er logga ut. Logg inn igjen.' : 'Du må logge inn.');
  return b;
}

// ---------- Eigne lister ----------
async function meg(env, b) {
  const [l, t, f] = await env.DB.batch([
    env.DB.prepare('SELECT id, delid, data, pos FROM lister WHERE brukar = ? ORDER BY pos, laga').bind(b.id),
    env.DB.prepare('SELECT t.id, t.liste, t.data, t.pos FROM ting t JOIN lister l ON l.id = t.liste WHERE l.brukar = ? ORDER BY t.pos, t.laga').bind(b.id),
    env.DB.prepare('SELECT f.delid, l.data, (SELECT COUNT(*) FROM ting t WHERE t.liste = l.id) AS n FROM folgjer f LEFT JOIN lister l ON l.delid = f.delid WHERE f.brukar = ? ORDER BY f.laga DESC').bind(b.id),
  ]);
  const lister = l.results.map(r => ({ ...JSON.parse(r.data), id: r.id, delid: r.delid, pos: r.pos, ting: [] }));
  const etterId = new Map(lister.map(x => [x.id, x]));
  for (const r of t.results) {
    const liste = etterId.get(r.liste);
    if (liste) liste.ting.push({ ...JSON.parse(r.data), id: r.id, pos: r.pos });
  }
  const folgjer = f.results.map(r => {
    const d = r.data ? JSON.parse(r.data) : null;
    return { delid: r.delid, namn: d ? d.namn : null, til: d ? d.til || '' : '', farge: d ? d.farge : null, n: r.n || 0 };
  });
  return svar({ namn: b.namn, lister, folgjer });
}

function rensListe(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Feil(400, 'Ugyldige data.');
  const namn = tekst(d.namn, 80);
  if (!namn) throw new Feil(400, 'Lista må ha eit namn.');
  return {
    namn,
    til: tekst(d.til, 40),
    rangert: d.rangert !== false,
    farge: FARGAR.includes(d.farge) ? d.farge : 'bringebaer',
    anledning: ANLEDNINGAR.includes(d.anledning) ? d.anledning : '',
    dato: /^\d{4}-\d{2}-\d{2}$/.test(d.dato || '') ? d.dato : '',
    skildring: tekst(d.skildring, 500, true),
    visning: d.visning === 'rutenett' ? 'rutenett' : 'rangert',
  };
}

async function lagreListe(req, env, b, id) {
  const body = await lesJson(req, 4000);
  const data = rensListe(body);
  const rad = await env.DB.prepare('SELECT brukar, delid FROM lister WHERE id = ?').bind(id).first();
  const no = Date.now();
  if (rad) {
    if (rad.brukar !== b.id) throw new Feil(404, 'Fann ikkje lista.');
    await env.DB.prepare('UPDATE lister SET data = ?, endra = ? WHERE id = ?').bind(JSON.stringify(data), no, id).run();
    return svar({ id, delid: rad.delid });
  }
  const { n, p } = await env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(MIN(pos), 1) AS p FROM lister WHERE brukar = ?').bind(b.id).first();
  if (n >= MAKS_LISTER) throw new Feil(409, `Du kan ha opptil ${MAKS_LISTER} lister. Slett nokre gamle først.`);
  const delid = lagId(12);
  const pos = p - 1; // nye lister kjem øvst
  await env.DB.prepare('INSERT INTO lister (id, brukar, delid, data, pos, laga, endra) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, b.id, delid, JSON.stringify(data), pos, no, no).run();
  return svar({ id, delid, pos }, 201);
}

async function slettListe(env, b, id) {
  const rad = await env.DB.prepare('SELECT 1 FROM lister WHERE id = ? AND brukar = ?').bind(id, b.id).first();
  if (!rad) return svar({ ok: true });
  await env.DB.batch([
    env.DB.prepare('DELETE FROM reservasjonar WHERE liste = ?').bind(id),
    env.DB.prepare('DELETE FROM ting WHERE liste = ?').bind(id),
    env.DB.prepare('DELETE FROM lister WHERE id = ?').bind(id),
  ]);
  await ryddBilete(env, b.id);
  return svar({ ok: true });
}

function idar(body, maks) {
  return Array.isArray(body.ids) ? body.ids.filter(x => typeof x === 'string' && /^[A-Za-z0-9]{8,32}$/.test(x)).slice(0, maks) : [];
}

async function sorterLister(req, env, b) {
  const ids = idar(await lesJson(req, 4000), MAKS_LISTER);
  if (ids.length) await env.DB.batch(ids.map((id, i) => env.DB.prepare('UPDATE lister SET pos = ? WHERE id = ? AND brukar = ?').bind(i + 1, id, b.id)));
  return svar({ ok: true });
}

async function eigListe(env, b, lid) {
  const liste = await env.DB.prepare('SELECT brukar FROM lister WHERE id = ?').bind(lid).first();
  if (!liste || liste.brukar !== b.id) throw new Feil(404, 'Fann ikkje lista.');
}

async function sorterTing(req, env, b, lid) {
  const ids = idar(await lesJson(req, 12000), MAKS_TING);
  await eigListe(env, b, lid);
  if (ids.length) await env.DB.batch(ids.map((id, i) => env.DB.prepare('UPDATE ting SET pos = ? WHERE id = ? AND liste = ?').bind(i + 1, id, lid)));
  return svar({ ok: true });
}

// ---------- Ønske ----------
function lenkje(s) {
  const t = String(s || '').trim();
  if (!t || t.length > 1500) return '';
  try {
    const u = new URL(t);
    return /^https?:$/.test(u.protocol) ? u.toString() : '';
  } catch { return ''; }
}

function rensTing(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Feil(400, 'Ugyldige data.');
  const tittel = tekst(d.tittel, 200);
  if (!tittel) throw new Feil(400, 'Skriv kva du ønskjer deg.');
  let pris = d.pris === null || d.pris === '' || d.pris === undefined ? null : tal(d.pris);
  if (pris !== null && !(Number.isFinite(pris) && pris >= 0 && pris < 1e8)) pris = null;
  if (pris !== null) pris = Math.round(pris * 100) / 100;
  return {
    tittel,
    url: lenkje(d.url),
    bilete: lenkje(d.bilete),
    pris,
    valuta: pris === null ? '' : (/^[A-Z]{3}$/.test(d.valuta || '') ? d.valuta : 'NOK'),
    butikk: tekst(d.butikk, 60),
    notat: tekst(d.notat, 500, true),
    antal: Math.min(99, Math.max(1, Math.round(Number(d.antal) || 1))),
    favoritt: !!d.favoritt,
  };
}

async function lagreTing(req, env, b, lid, tid) {
  const body = await lesJson(req, 6000);
  const data = rensTing(body);
  await eigListe(env, b, lid);
  const rad = await env.DB.prepare('SELECT t.liste, l.brukar FROM ting t JOIN lister l ON l.id = t.liste WHERE t.id = ?').bind(tid).first();
  const no = Date.now();
  const nestePos = async () => {
    const { n, p } = await env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(pos), 0) AS p FROM ting WHERE liste = ?').bind(lid).first();
    if (n >= MAKS_TING) throw new Feil(409, `Ei liste kan ha opptil ${MAKS_TING} ønske.`);
    return p + 1;
  };
  if (rad) {
    if (rad.brukar !== b.id) throw new Feil(404, 'Fann ikkje ønsket.');
    if (rad.liste !== lid) {
      // Flytt til ei anna av eigne lister: kjem nedst der.
      const pos = await nestePos();
      await env.DB.batch([
        env.DB.prepare('UPDATE ting SET liste = ?, data = ?, pos = ?, endra = ? WHERE id = ?').bind(lid, JSON.stringify(data), pos, no, tid),
        env.DB.prepare('UPDATE reservasjonar SET liste = ? WHERE ting = ?').bind(lid, tid),
      ]);
      return svar({ id: tid, pos });
    }
    await env.DB.prepare('UPDATE ting SET data = ?, endra = ? WHERE id = ?').bind(JSON.stringify(data), no, tid).run();
    return svar({ id: tid });
  }
  const pos = await nestePos();
  await env.DB.prepare('INSERT INTO ting (id, liste, data, pos, laga, endra) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(tid, lid, JSON.stringify(data), pos, no, no).run();
  return svar({ id: tid, pos }, 201);
}

async function slettTing(env, b, lid, tid) {
  await eigListe(env, b, lid);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM reservasjonar WHERE ting = ? AND liste = ?').bind(tid, lid),
    env.DB.prepare('DELETE FROM ting WHERE id = ? AND liste = ?').bind(tid, lid),
  ]);
  await ryddBilete(env, b.id);
  return svar({ ok: true });
}

// ---------- Delte lister ----------
async function hentDelt(req, env, delid) {
  const l = await env.DB.prepare('SELECT id, brukar, data FROM lister WHERE delid = ?').bind(delid).first();
  if (!l) throw new Feil(404, 'Fann ikkje lista. Ho kan vere sletta, eller lenkja er feil.');
  const b = await hentOkt(req, env);
  const eigar = !!b && b.id === l.brukar;
  const { results } = await env.DB.prepare('SELECT id, data, pos FROM ting WHERE liste = ? ORDER BY pos, laga').bind(l.id).all();
  const ting = results.map(r => ({ ...JSON.parse(r.data), id: r.id, pos: r.pos }));
  // Eigaren får aldri reservasjonane, så overraskinga held.
  let reservert = null;
  if (!eigar) {
    reservert = {};
    const res = await env.DB.prepare('SELECT id, ting, namn, antal FROM reservasjonar WHERE liste = ? ORDER BY laga').bind(l.id).all();
    for (const r of res.results) (reservert[r.ting] ||= []).push({ id: r.id, namn: r.namn, antal: r.antal });
  }
  return svar({ liste: { ...JSON.parse(l.data), delid }, ting, reservert, eigar, listeid: eigar ? l.id : null });
}

async function reserver(req, env, delid) {
  await grense(env, 'res:' + ip(req));
  const body = await lesJson(req);
  const namn = tekst(body.namn, 40);
  if (!namn) throw new Feil(400, 'Skriv namnet ditt, så dei andre ser kven som kjøper.');
  const l = await env.DB.prepare('SELECT id, brukar FROM lister WHERE delid = ?').bind(delid).first();
  if (!l) throw new Feil(404, 'Fann ikkje lista.');
  const b = await hentOkt(req, env);
  if (b && b.id === l.brukar) throw new Feil(403, 'Du kan ikkje reservere frå di eiga liste.');
  const t = await env.DB.prepare('SELECT data FROM ting WHERE id = ? AND liste = ?').bind(String(body.ting || ''), l.id).first();
  if (!t) throw new Feil(404, 'Ønsket finst ikkje lenger.');
  const onskt = JSON.parse(t.data).antal || 1;
  const { s } = await env.DB.prepare('SELECT COALESCE(SUM(antal), 0) AS s FROM reservasjonar WHERE ting = ?').bind(String(body.ting)).first();
  const antal = Math.max(1, Math.min(99, Math.round(Number(body.antal) || 1)));
  if (s + antal > onskt) throw new Feil(409, s >= onskt ? 'Nokon har alt reservert dette.' : `Berre ${onskt - s} att å reservere.`);
  const id = lagId(16);
  const nokkel = b64url(tilfeldig(24));
  await env.DB.prepare('INSERT INTO reservasjonar (id, ting, liste, namn, antal, nokkelhash, laga) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, String(body.ting), l.id, namn, antal, await sha256(nokkel), Date.now()).run();
  return svar({ id, nokkel, namn, antal }, 201);
}

async function angreReservasjon(req, env, id) {
  const body = await lesJson(req);
  const rad = await env.DB.prepare('SELECT nokkelhash FROM reservasjonar WHERE id = ?').bind(id).first();
  if (!rad) return svar({ ok: true });
  if (!likt(await sha256(String(body.nokkel || '')), rad.nokkelhash)) throw new Feil(403, 'Berre den som reserverte, kan angre.');
  await env.DB.prepare('DELETE FROM reservasjonar WHERE id = ?').bind(id).run();
  return svar({ ok: true });
}

async function folg(req, env, b) {
  const body = await lesJson(req);
  const delid = String(body.delid || '');
  if (!/^[A-Za-z0-9]{12}$/.test(delid)) throw new Feil(400, 'Ugyldig lenkje.');
  const l = await env.DB.prepare('SELECT brukar FROM lister WHERE delid = ?').bind(delid).first();
  if (!l || l.brukar === b.id) return svar({ ok: true });
  await env.DB.prepare('INSERT OR IGNORE INTO folgjer (brukar, delid, laga) VALUES (?, ?, ?)').bind(b.id, delid, Date.now()).run();
  await env.DB.prepare('DELETE FROM folgjer WHERE brukar = ? AND delid NOT IN (SELECT delid FROM folgjer WHERE brukar = ? ORDER BY laga DESC LIMIT ?)')
    .bind(b.id, b.id, MAKS_FOLGJER).run();
  return svar({ ok: true });
}

// ---------- Eigne bilete ----------
// Appen skalerer biletet ned (maks 900 px) før opplasting, så det held med ei lita grense her.
const MAKS_BILETE = 400;
const MAKS_BILETE_BYTES = 700000;
const BILETTYPAR = {
  'image/jpeg': b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/webp': b => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45,
};

async function lastOppBilete(req, env, b, url) {
  await grense(env, 'bilete:' + b.id);
  const buf = new Uint8Array(await req.arrayBuffer());
  if (!buf.length) throw new Feil(400, 'Biletet er tomt.');
  if (buf.length > MAKS_BILETE_BYTES) throw new Feil(413, 'Biletet er for stort.');
  const type = Object.keys(BILETTYPAR).find(t => BILETTYPAR[t](buf));
  if (!type) throw new Feil(415, 'Berre JPEG-, PNG- og WebP-bilete er lov.');
  await ryddBilete(env, b.id);
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM bilete WHERE brukar = ?').bind(b.id).first();
  if (n >= MAKS_BILETE) throw new Feil(409, `Du kan ha opptil ${MAKS_BILETE} eigne bilete. Slett nokre gamle ønske først.`);
  const id = hex(tilfeldig(16));
  await env.DB.prepare('INSERT INTO bilete (id, brukar, type, data, laga) VALUES (?, ?, ?, ?, ?)').bind(id, b.id, type, buf, Date.now()).run();
  return svar({ id, url: `${url.origin}/bilete/${id}` }, 201);
}

async function hentBilete(env, id) {
  const rad = await env.DB.prepare('SELECT type, data FROM bilete WHERE id = ?').bind(id).first();
  if (!rad) return new Response('Fann ikkje biletet.', { status: 404 });
  const data = rad.data instanceof ArrayBuffer ? rad.data : new Uint8Array(rad.data);
  return new Response(data, {
    headers: {
      'Content-Type': rad.type,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// Slett eigne bilete som ingen ønske brukar lenger (og som er meir enn ein time gamle,
// så eit bilete i eit skjema som ikkje er lagra enno, får vere i fred).
async function ryddBilete(env, brukar) {
  await env.DB.prepare(`DELETE FROM bilete WHERE brukar = ? AND laga < ? AND id NOT IN (
      SELECT substr(json_extract(t.data, '$.bilete'), -32) FROM ting t JOIN lister l ON l.id = t.liste
      WHERE l.brukar = ? AND json_extract(t.data, '$.bilete') LIKE '%/bilete/%')`)
    .bind(brukar, Date.now() - 3600e3, brukar).run();
}

// ---------- Hent namn, bilete og pris frå ei produktlenkje ----------
// Les berre den eine sida brukaren limte inn (som ei lenkjeførehandsvising i ein meldingsapp).
async function forhandsvis(env, b, url) {
  await grense(env, 'fv:' + b.id);
  let u;
  try { u = new URL(String(url.searchParams.get('url') || '').trim()); } catch { throw new Feil(400, 'Det ser ikkje ut som ei lenkje.'); }
  if (!/^https?:$/.test(u.protocol)) throw new Feil(400, 'Lenkja må byrje med https://');
  const vert = u.hostname.toLowerCase();
  if (!vert.includes('.') || /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.)/.test(vert) || vert.startsWith('[') || /\.(local|internal|localhost)$/.test(vert)) {
    throw new Feil(400, 'Den lenkja kan ikkje hentast.');
  }
  const ut = { url: u.toString(), tittel: '', bilete: '', pris: null, valuta: '', butikk: vert.replace(/^www\./, '') };
  // Når butikken stengjer for oss, kan namnet ofte lesast ut av sjølve lenkja.
  // sperra = butikken stengjer for appar (appen viser då Prisjakt og «Legg til»-knappen).
  const delvis = (melding, sperra = false) => {
    const namn = namnFraLenkje(u);
    return svar({
      ...ut, url: u.toString(), tittel: namn, bilete: '', pris: null, valuta: '', delvis: true, sperra,
      melding: namn ? `${melding} Namnet er henta frå lenkja – sjekk det og skriv inn prisen.` : `${melding} Fyll inn sjølv.`,
    });
  };
  const ctl = new AbortController();
  const tid = setTimeout(() => ctl.abort(), 8000);
  try {
    let res;
    try {
      res = await fetch(u.toString(), {
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'nb-NO,nn-NO;q=0.9,no;q=0.8,en;q=0.5' },
        redirect: 'follow',
        signal: ctl.signal,
      });
    } catch {
      return delvis('Butikken svarte ikkje.', true);
    }
    if (res.url) {
      const endeleg = new URL(res.url);
      // Sendt vidare til framsida? Då finst ikkje produktet (lenger) på den adressa.
      if (endeleg.pathname.replace(/\/+$/, '') === '' && u.pathname.replace(/\/+$/, '') !== '') {
        res.body?.cancel();
        return delvis('Butikken sende oss til framsida.', true);
      }
      ut.url = res.url;
      ut.butikk = endeleg.hostname.replace(/^www\./, '');
    }
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !/html/i.test(type)) {
      res.body?.cancel();
      return res.ok ? delvis('Lenkja er ikkje ei nettside.') : delvis('Butikken sperrar for at appar hentar sidene.', true);
    }
    const funne = await lesSide(res);
    Object.assign(ut, tolk(funne, ut.url, ut.butikk));
    if (!ut.tittel) return delvis('Fann ikkje produktnamnet på sida.');
    return svar(ut);
  } catch {
    return delvis('Klarte ikkje å lese sida.');
  } finally {
    clearTimeout(tid);
  }
}

// «/hodetelefoner/apple-airpods-pro-3/980632» → «Apple airpods pro 3»
function namnFraLenkje(u) {
  const deler = u.pathname.split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return s; } });
  let funne = '';
  for (const d of deler) {
    const t = d.replace(/\.(html?|php|aspx?)$/i, '');
    if (/[a-zæøåäöü]{3,}[^/]*[-_+][a-zæøåäöü0-9]/i.test(t)) funne = t; // siste del med fleire ord
  }
  if (!funne) return '';
  const ord = funne.split(/[-_+]+/).filter(Boolean);
  const kode = o => /^(?=.*\d)(?=.*[a-z])[a-z0-9]{5,}$/i.test(o) || /^[a-z]{1,2}\d{1,4}$/i.test(o) || /^\d{5,}$/.test(o);
  while (ord.length > 1 && kode(ord[ord.length - 1])) ord.pop();
  const t = ord.join(' ').trim();
  if (t.length < 3) return '';
  return (t[0].toUpperCase() + t.slice(1)).slice(0, 200);
}

async function lesSide(res) {
  const meta = {};
  const ld = [];
  const lenkjebilete = [];
  const bilete = [];
  let tittel = '';
  let iLd = false;
  const forsteSrcset = s => {
    // Vel det største biletet i srcset («a.jpg 400w, b.jpg 800w»).
    const val = String(s || '').split(',').map(x => x.trim().split(/\s+/)).filter(x => x[0]);
    if (!val.length) return '';
    val.sort((a, b) => (parseFloat(b[1]) || 0) - (parseFloat(a[1]) || 0));
    return val[0][0];
  };
  const rw = new HTMLRewriter()
    .on('link', {
      element(e) {
        const rel = (e.getAttribute('rel') || '').toLowerCase();
        if (rel.includes('image_src')) lenkjebilete.push(e.getAttribute('href') || '');
        else if (rel.includes('preload') && (e.getAttribute('as') || '').toLowerCase() === 'image') {
          lenkjebilete.push(forsteSrcset(e.getAttribute('imagesrcset')) || e.getAttribute('href') || '');
        }
      },
    })
    .on('img', {
      element(e) {
        if (bilete.length >= 60) return;
        const src = e.getAttribute('data-src') || e.getAttribute('data-lazy-src') || e.getAttribute('data-original') || e.getAttribute('data-zoom-image')
          || forsteSrcset(e.getAttribute('data-srcset')) || forsteSrcset(e.getAttribute('srcset')) || e.getAttribute('src') || '';
        const b = parseInt(e.getAttribute('width'), 10);
        const h = parseInt(e.getAttribute('height'), 10);
        bilete.push({ src, alt: e.getAttribute('alt') || '', liten: (b > 0 && b < 120) || (h > 0 && h < 120) });
      },
    })
    .on('meta', {
      element(e) {
        const k = (e.getAttribute('property') || e.getAttribute('name') || e.getAttribute('itemprop') || '').toLowerCase().trim();
        const v = e.getAttribute('content');
        if (k && v != null && !(k in meta)) meta[k] = v;
      },
    })
    .on('[itemprop="price"]', {
      element(e) {
        const v = e.getAttribute('content');
        if (v && !meta['itemprop:price']) meta['itemprop:price'] = v;
      },
    })
    .on('head > title', {
      text(t) { if (tittel.length < 400) tittel += t.text; },
    })
    .on('script', {
      element(e) {
        iLd = /ld\+json/i.test(e.getAttribute('type') || '');
        if (iLd && ld.length < 30) ld.push('');
        else iLd = false;
      },
      text(t) {
        if (iLd && ld[ld.length - 1].length < 500000) ld[ld.length - 1] += t.text;
        if (t.lastInTextNode) iLd = false;
      },
    });
  await rw.transform(res).arrayBuffer();
  return { meta, ld, tittel, lenkjebilete, bilete };
}

// Første bilete på sida som ser ut som eit produktbilete (ikkje logo, ikon, sporingspiksel o.l.).
// Bilete med alt-tekst som liknar produktnamnet kjem først.
const IKKJE_PRODUKT = /logo|icon|ikon|sprite|favicon|flag|payment|betal|klarna|vipps|visa|mastercard|badge|banner|placeholder|pixel|tracking|avatar|rating|stars?[-_.]|trustpilot|spinner|loader|blank|transparent|1x1|apple-touch|social|facebook|instagram|youtube|tiktok/i;
function forsteProduktbilete(bilete, namn, sideUrl) {
  const ord = String(namn || '').toLowerCase().split(/[^a-zæøåäöü0-9]+/).filter(o => o.length >= 4);
  const gode = [];
  for (const b of bilete) {
    let src = avkod(b.src).trim();
    if (!src || src.startsWith('data:') || b.liten) continue;
    try { src = new URL(src, sideUrl).toString(); } catch { continue; }
    if (!/^https?:/.test(src) || /\.svg(\?|$)/i.test(src) || /\.gif(\?|$)/i.test(src) || IKKJE_PRODUKT.test(src) || IKKJE_PRODUKT.test(b.alt)) continue;
    const alt = b.alt.toLowerCase();
    gode.push({ src, treff: ord.filter(o => alt.includes(o)).length });
  }
  if (!gode.length) return '';
  const best = gode.reduce((a, b) => (b.treff > a.treff ? b : a), gode[0]);
  return best.src;
}

function tolk({ meta, ld, tittel, lenkjebilete = [], bilete: alleBilete = [] }, sideUrl, vert) {
  // JSON-LD (schema.org) er best: produktnamn, bilete og pris.
  const alle = [];
  const ga = (o, d = 0) => {
    if (!o || typeof o !== 'object' || d > 7 || alle.length > 400) return;
    if (Array.isArray(o)) { for (const x of o) ga(x, d + 1); return; }
    alle.push(o);
    for (const k of ['@graph', 'mainEntity', 'hasVariant', 'offers', 'itemOffered', 'item']) if (o[k]) ga(o[k], d + 1);
  };
  for (const t of ld) { try { ga(JSON.parse(t.trim())); } catch { /* øydelagd JSON-LD */ } }
  const typar = o => [].concat(o['@type'] || []).map(String);
  const produkt = alle.find(o => typar(o).some(t => /^(Product|ProductGroup|IndividualProduct|ProductModel|Book|Vehicle|SomeProducts)$/i.test(t)));
  let pris = null;
  let valuta = '';
  for (const o of alle) {
    if (!typar(o).some(t => /Offer$/i.test(t))) continue;
    const spes = Array.isArray(o.priceSpecification) ? o.priceSpecification[0] : o.priceSpecification;
    const v = tal(o.price ?? o.lowPrice ?? spes?.price);
    if (v != null && v > 0 && (pris == null || v < pris)) {
      pris = v;
      valuta = o.priceCurrency || spes?.priceCurrency || valuta;
    }
  }
  if (pris == null) {
    pris = tal(meta['product:price:amount'] ?? meta['og:price:amount'] ?? meta['itemprop:price'] ?? meta['price']);
    valuta = meta['product:price:currency'] || meta['og:price:currency'] || meta['pricecurrency'] || '';
  }
  if (pris == null) {
    const m = /(?:pris|fra|frå|kun|nå)\s*:?\s*(\d[\d\s .]*(?:,\d{2})?)\s*(?:kr|,-)/i.exec(avkod(meta['og:description'] || meta['description'] || ''));
    if (m) { pris = tal(m[1]); valuta = 'NOK'; }
  }
  const butikk = rein(avkod(meta['og:site_name'] || ''), 40) || vert;
  let namn = produkt && typeof produkt.name === 'string' ? produkt.name : '';
  namn = namn || meta['og:title'] || meta['twitter:title'] || tittel;
  let bilete = produkt ? forsteBilete(produkt.image) : '';
  bilete = bilete || meta['og:image'] || meta['og:image:url'] || meta['og:image:secure_url'] || meta['twitter:image'] || meta['twitter:image:src'] || meta['image'] || '';
  try { bilete = bilete ? new URL(avkod(bilete), sideUrl).toString() : ''; } catch { bilete = ''; }
  if (!/^https?:/.test(bilete)) bilete = '';
  // Manglar sida eit «hovudbilete» i koden, tek vi det første produktbiletet på sida.
  if (!bilete) bilete = forsteProduktbilete(lenkjebilete.map(src => ({ src, alt: '', liten: false })), '', sideUrl);
  if (!bilete) bilete = forsteProduktbilete(alleBilete, namn, sideUrl);
  return {
    tittel: rensTittel(namn, butikk, vert),
    bilete,
    pris: pris != null && pris > 0 && pris < 1e8 ? Math.round(pris * 100) / 100 : null,
    valuta: pris != null ? (/^[A-Z]{3}$/.test(String(valuta).toUpperCase()) ? String(valuta).toUpperCase() : 'NOK') : '',
    butikk,
  };
}

function forsteBilete(img) {
  if (!img) return '';
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) return forsteBilete(img[0]);
  if (typeof img === 'object') return img.url || img.contentUrl || '';
  return '';
}

function tal(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/[\s ]/g, '').replace(/,-$/, '').replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function rensTittel(t, butikk, vert) {
  t = rein(avkod(t), 300);
  // «Produkt | Komplett.no» → «Produkt»
  const m = /^(.{6,}?)\s+[|–—-]\s+([^|–—]{2,50})$/.exec(t);
  if (m) {
    const hale = m[2].toLowerCase().replace(/\s/g, '');
    const kjerne = (vert.split('.').slice(-2, -1)[0] || '').toLowerCase();
    if ((butikk && hale.includes(butikk.toLowerCase().replace(/\s/g, ''))) || (kjerne.length > 2 && hale.includes(kjerne))) t = m[1];
  }
  return t.slice(0, 200);
}

const ENT = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', aring: 'å', Aring: 'Å', oslash: 'ø', Oslash: 'Ø',
  aelig: 'æ', AElig: 'Æ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', eacute: 'é', uuml: 'ü', ouml: 'ö', auml: 'ä', reg: '®', trade: '™', copy: '©',
};
function avkod(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, k) => {
    if (k[0] !== '#') return ENT[k] ?? m;
    const n = k[1] === 'x' || k[1] === 'X' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    try { return String.fromCodePoint(n); } catch { return m; }
  });
}
const rein = (s, maks) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, maks);

// ---------- Hjelparar ----------
function svar(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
async function lesJson(req, maks = 2000) {
  let t;
  try { t = await req.text(); } catch { throw new Feil(400, 'Ugyldige data.'); }
  if (t.length > maks) throw new Feil(413, 'For mykje tekst.');
  try { return JSON.parse(t || '{}') || {}; } catch { throw new Feil(400, 'Ugyldige data.'); }
}
function tekst(s, maks, fleireLiner) {
  let t = String(s ?? '');
  t = fleireLiner ? t.replace(/\r/g, '').replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n') : t.replace(/\s+/g, ' ');
  return t.trim().slice(0, maks);
}
const ALFA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const lagId = n => Array.from(tilfeldig(n), x => ALFA[x % 62]).join('');
const tilfeldig = n => crypto.getRandomValues(new Uint8Array(n));
const hex = buf => Array.from(new Uint8Array(buf), x => x.toString(16).padStart(2, '0')).join('');
const fraHex = s => new Uint8Array(s.match(/../g).map(h => parseInt(h, 16)));
const b64url = buf => btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function sha256(s) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}
async function hashPassord(passord, salt, iter) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(passord), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}
function likt(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
