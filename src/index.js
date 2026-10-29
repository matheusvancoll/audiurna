import { createPool, migrate } from './db.js';
import { listArquivos, searchDatasets, urlHash } from './tse.js';
import { ingestArquivo } from './ingest.js';

function parseArgs(list) {
  const out = {};
  for (let i = 0; i < list.length; i++) {
    if (list[i].startsWith('--')) {
      const k = list[i].slice(2);
      const next = list[i + 1];
      if (next && !next.startsWith('--')) { out[k] = next; i++; } else out[k] = true;
    }
  }
  return out;
}

const [, , cmd, ...rest] = process.argv;
const args = parseArgs(rest);

async function main() {
  if (cmd === 'discover') {
    const ano = args.ano ?? new Date().getFullYear();
    const lista = await searchDatasets(`boletim de urna ${ano}`);
    console.table(lista);
    return;
  }

  const pool = createPool();
  try {
    if (cmd === 'migrate') {
      await migrate(pool);
      console.log('Tabelas criadas/atualizadas.');
    } else if (cmd === 'ingest') {
      await migrate(pool);
      const ano = Number(args.ano);
      if (!ano) throw new Error('Informe --ano (ex.: npm run ingest -- --ano 2026)');
      const dataset = args.dataset ?? `resultados-${ano}-boletim-de-urna`;

      const arquivos = await listArquivos(dataset, ano);
      if (!arquivos.length) {
        console.log(`Nenhum zip bweb_* encontrado em "${dataset}". Rode "npm run discover -- --ano ${ano}" para ver os ids.`);
        return;
      }
      for (const a of arquivos) {
        await pool.query(
          'INSERT INTO ingest_arquivos (dataset, ano, turno, sg_uf, url, url_hash) VALUES (?,?,?,?,?,?) ' +
            'ON DUPLICATE KEY UPDATE dataset=dataset',
          [a.dataset, a.ano, a.turno, a.sg_uf, a.url, urlHash(a.url)]
        );
      }

      const where = ['dataset=?', "status<>'concluido'"];
      const params = [dataset];
      if (args.turno) { where.push('turno=?'); params.push(Number(args.turno)); }
      if (args.uf) {
        const ufs = String(args.uf).toUpperCase().split(',');
        where.push(`sg_uf IN (${ufs.map(() => '?').join(',')})`);
        params.push(...ufs);
      }
      const [pendentes] = await pool.query(
        `SELECT * FROM ingest_arquivos WHERE ${where.join(' AND ')} ORDER BY turno, sg_uf`,
        params
      );
      console.log(`${pendentes.length} arquivo(s) para processar.`);

      let erros = 0;
      for (const arq of pendentes) if (!(await ingestArquivo(pool, arq))) erros++;
      console.log(erros ? `Finalizado com ${erros} erro(s). Rode de novo para tentar só os que falharam.` : 'Finalizado.');
    } else if (cmd === 'status') {
      const [a] = await pool.query(
        'SELECT status, COUNT(*) arquivos, SUM(linhas_lidas) linhas, SUM(secoes_novas) secoes FROM ingest_arquivos GROUP BY status'
      );
      console.table(a);
      const [b] = await pool.query(
        'SELECT ano, turno, sg_uf, COUNT(*) secoes, SUM(processado_em IS NOT NULL) processadas, MAX(dt_encerramento) ultimo_encerramento ' +
          'FROM secoes GROUP BY ano, turno, sg_uf ORDER BY ano, turno, sg_uf'
      );
      console.table(b);
    } else {
      console.log('Comandos: migrate | discover --ano 2026 | ingest --ano 2026 [--turno 1] [--uf SP,RJ] [--dataset id] | status');
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
