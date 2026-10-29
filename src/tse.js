import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from './config.js';

const HEADERS = { 'User-Agent': 'tse-ingest/1.0 (estudo de dados)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ckan(action, params = {}) {
  const url = new URL(`${config.ckanUrl}/${action}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`CKAN ${action}: HTTP ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(`CKAN ${action}: ${JSON.stringify(json.error)}`);
  return json.result;
}

// Lista datasets cujo nome/título casa com a busca (para descobrir o id correto)
export async function searchDatasets(q) {
  const r = await ckan('package_search', { q, rows: 50 });
  return r.results.map((d) => ({ name: d.name, title: d.title, recursos: d.resources.length }));
}

// Lista os zips bweb_<turno>t_<UF>_*.zip de um dataset de boletim de urna
export async function listArquivos(datasetId, ano) {
  const pkg = await ckan('package_show', { id: datasetId });
  return pkg.resources
    .filter((r) => /\.zip(\?|$)/i.test(r.url ?? ''))
    .map((r) => {
      const m = r.url.match(/bweb_(\d)t_([A-Za-z]{2})/i);
      if (!m) return null;
      return { dataset: datasetId, ano, turno: Number(m[1]), sg_uf: m[2].toUpperCase(), url: r.url };
    })
    .filter(Boolean);
}

export function urlHash(url) {
  return crypto.createHash('sha256').update(url).digest('hex');
}

export async function downloadFile(url, dest, tries = 4) {
  try {
    await fsp.access(dest);
    return dest; // já baixado
  } catch {}
  await fsp.mkdir(config.dataDir, { recursive: true });
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(`${dest}.part`));
      await fsp.rename(`${dest}.part`, dest);
      return dest;
    } catch (e) {
      if (attempt === tries) throw new Error(`Falha ao baixar ${url}: ${e.message}`);
      await sleep(2000 * attempt);
    }
  }
}
