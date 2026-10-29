import path from 'node:path';
import unzipper from 'unzipper';
import { parse } from 'csv-parse';
import { config } from './config.js';
import { downloadFile, urlHash } from './tse.js';
import { assertColumns, mapRecord, normalizeHeader, secaoKey } from './parse.js';

const SECAO_PK = ['ano', 'turno', 'sg_uf', 'cd_municipio', 'nr_zona', 'nr_secao'];
const SECAO_DATA = [
  'nm_municipio', 'nr_local_votacao', 'nm_local_votacao', 'ds_local_endereco',
  'qt_aptos', 'qt_comparecimento', 'qt_abstencoes', 'qt_eleitores_biometria_nh',
  'ds_tipo_urna', 'nr_urna_efetivada',
  'dt_abertura', 'dt_encerramento', 'dt_bu_recebido', 'dt_emissao_bu',
];
const SECAO_COLS = [...SECAO_PK, ...SECAO_DATA];

const VOTO_PK = [...SECAO_PK, 'cd_cargo', 'nr_votavel'];
const VOTO_DATA = ['ds_cargo', 'ds_tipo_votavel', 'nm_votavel', 'qt_votos'];
const VOTO_COLS = [...VOTO_PK, ...VOTO_DATA];

const upsertSql = (table, cols, dataCols) =>
  `INSERT INTO ${table} (${cols.join(',')}) VALUES ? ` +
  `ON DUPLICATE KEY UPDATE ${dataCols.map((c) => `${c}=VALUES(${c})`).join(',')}`;

const SQL_SECOES = upsertSql('secoes', SECAO_COLS, SECAO_DATA);
const SQL_VOTOS = upsertSql('votos', VOTO_COLS, VOTO_DATA);

async function flush(pool, secoes, votos) {
  if (!secoes.length && !votos.length) return;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (secoes.length) await conn.query(SQL_SECOES, [secoes.map((s) => SECAO_COLS.map((c) => s[c] ?? null))]);
    if (votos.length) await conn.query(SQL_VOTOS, [votos.map((v) => VOTO_COLS.map((c) => v[c] ?? null))]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// Seções já concluídas em execuções anteriores (para não processar 2x)
async function loadProcessed(pool, { ano, turno, sg_uf }) {
  const [rows] = await pool.query(
    'SELECT cd_municipio, nr_zona, nr_secao FROM secoes ' +
      'WHERE ano=? AND turno=? AND sg_uf=? AND processado_em IS NOT NULL',
    [ano, turno, sg_uf]
  );
  return new Set(rows.map(secaoKey));
}

export async function ingestArquivo(pool, arq) {
  const label = `${arq.ano} T${arq.turno} ${arq.sg_uf}`;
  await pool.query(
    "UPDATE ingest_arquivos SET status='processando', erro=NULL, iniciado_em=NOW() WHERE id=?",
    [arq.id]
  );

  try {
    const zipPath = path.join(config.dataDir, `${urlHash(arq.url).slice(0, 16)}_${path.basename(new URL(arq.url).pathname)}`);
    console.log(`[${label}] baixando...`);
    await downloadFile(arq.url, zipPath);

    const processed = await loadProcessed(pool, arq);
    console.log(`[${label}] ${processed.size} seções já processadas (serão ignoradas)`);

    const dir = await unzipper.Open.file(zipPath);
    const entry = dir.files.find((f) => /\.(csv|txt)$/i.test(f.path) && !/leiame/i.test(f.path));
    if (!entry) throw new Error('Nenhum CSV/TXT encontrado dentro do zip');

    const parser = entry
      .stream()
      .on('error', (e) => parser.destroy(e))
      .pipe(
        parse({
          delimiter: ';',
          columns: (h) => h.map(normalizeHeader),
          bom: true,
          encoding: 'latin1',
          relax_quotes: true,
          relax_column_count: true,
          skip_empty_lines: true,
        })
      );

    let secBatch = [];
    let votoBatch = [];
    const novas = new Set();
    const ignoradas = new Set();
    let linhas = 0;
    let checked = false;

    for await (const rec of parser) {
      if (!checked) { assertColumns(rec); checked = true; }
      linhas++;

      const { secao, voto } = mapRecord(rec, arq);
      if (secao.cd_municipio === null || secao.nr_zona === null || secao.nr_secao === null) continue;
      if (voto.cd_cargo === null || voto.nr_votavel === null) continue;

      const key = secaoKey(secao);
      if (processed.has(key)) { ignoradas.add(key); continue; }

      if (!novas.has(key)) { novas.add(key); secBatch.push(secao); }
      votoBatch.push({ ...secao, ...voto });

      if (votoBatch.length >= config.batchSize) {
        await flush(pool, secBatch, votoBatch);
        secBatch = []; votoBatch = [];
        await pool.query('UPDATE ingest_arquivos SET linhas_lidas=? WHERE id=?', [linhas, arq.id]);
        process.stdout.write(`\r[${label}] ${linhas} linhas, ${novas.size} seções novas`);
      }
    }
    await flush(pool, secBatch, votoBatch);
    process.stdout.write('\n');

    // Só aqui as seções são marcadas como concluídas
    await pool.query(
      'UPDATE secoes SET processado_em=NOW() WHERE ano=? AND turno=? AND sg_uf=? AND processado_em IS NULL',
      [arq.ano, arq.turno, arq.sg_uf]
    );
    await pool.query(
      "UPDATE ingest_arquivos SET status='concluido', linhas_lidas=?, secoes_novas=?, secoes_ignoradas=?, concluido_em=NOW() WHERE id=?",
      [linhas, novas.size, ignoradas.size, arq.id]
    );
    console.log(`[${label}] ok: ${novas.size} seções novas, ${ignoradas.size} ignoradas`);
  } catch (e) {
    await pool.query("UPDATE ingest_arquivos SET status='erro', erro=? WHERE id=?", [String(e.stack ?? e), arq.id]);
    console.error(`\n[${label}] ERRO: ${e.message}`);
    return false;
  }
  return true;
}
