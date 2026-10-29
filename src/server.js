import express from 'express';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { createPool } from './db.js';

const pool = createPool();
const app = express();
app.disable('x-powered-by');
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const BUCKETS = [10, 15, 30, 60];

class BadRequest extends Error {}
const int = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

// Filtros "estruturais": período, UF, município
function base(q) {
  const ano = int(q.ano);
  const turno = int(q.turno);
  if (!ano || !turno) throw new BadRequest('Informe ano e turno');
  const where = ['ano=?', 'turno=?'];
  const params = [ano, turno];
  if (q.uf) {
    where.push('sg_uf=?');
    params.push(String(q.uf).toUpperCase().slice(0, 2));
  }
  const mun = int(q.municipio);
  if (mun) {
    where.push('cd_municipio=?');
    params.push(mun);
  }
  return { where, params };
}

// Soma o filtro de horário do dia: de <= hora < ate
function withTime(q, b) {
  const where = [...b.where];
  const params = [...b.params];
  if (q.de) {
    if (!TIME_RE.test(q.de)) throw new BadRequest('Horário inicial inválido (use HH:MM)');
    where.push('TIME(dt_encerramento) >= ?');
    params.push(`${q.de}:00`);
  }
  if (q.ate) {
    if (!TIME_RE.test(q.ate)) throw new BadRequest('Horário final inválido (use HH:MM)');
    where.push('TIME(dt_encerramento) < ?');
    params.push(`${q.ate}:00`);
  }
  return { sql: where.join(' AND '), params };
}

app.get('/api/periodos', wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT DISTINCT ano, turno FROM secoes ORDER BY ano DESC, turno DESC');
  res.json(rows);
}));

app.get('/api/ufs', wrap(async (req, res) => {
  const b = base(req.query);
  const [rows] = await pool.query(
    `SELECT DISTINCT sg_uf FROM secoes WHERE ano=? AND turno=? ORDER BY sg_uf`,
    b.params.slice(0, 2)
  );
  res.json(rows.map((r) => r.sg_uf));
}));

app.get('/api/municipios', wrap(async (req, res) => {
  const b = base(req.query);
  if (!req.query.uf) return res.json([]);
  const [rows] = await pool.query(
    `SELECT cd_municipio, MAX(nm_municipio) AS nm_municipio FROM secoes
     WHERE ${b.where.join(' AND ')} GROUP BY cd_municipio ORDER BY nm_municipio`,
    b.params
  );
  res.json(rows);
}));

app.get('/api/resumo', wrap(async (req, res) => {
  const b = base(req.query);
  const [[tot]] = await pool.query(
    `SELECT COUNT(*) AS total, SUM(dt_encerramento IS NULL) AS sem_horario,
            MIN(dt_encerramento) AS primeiro, MAX(dt_encerramento) AS ultimo
     FROM secoes WHERE ${b.where.join(' AND ')}`,
    b.params
  );
  const f = withTime(req.query, b);
  const [[fil]] = await pool.query(
    `SELECT COUNT(*) AS filtradas, SUM(qt_aptos) AS aptos, SUM(qt_comparecimento) AS comparecimento
     FROM secoes WHERE ${f.sql}`,
    f.params
  );
  res.json({ ...tot, ...fil });
}));

// Distribuição do encerramento por faixa de minutos (ignora o filtro de horário,
// para o gráfico sempre mostrar o quadro completo)
app.get('/api/histograma', wrap(async (req, res) => {
  const b = base(req.query);
  const bucket = int(req.query.bucket) ?? 30;
  if (!BUCKETS.includes(bucket)) throw new BadRequest('bucket inválido');
  const [rows] = await pool.query(
    `SELECT FLOOR((HOUR(dt_encerramento)*60 + MINUTE(dt_encerramento)) / ${bucket}) * ${bucket} AS minuto,
            COUNT(*) AS n
     FROM secoes WHERE ${b.where.join(' AND ')} AND dt_encerramento IS NOT NULL
     GROUP BY minuto ORDER BY minuto`,
    b.params
  );
  res.json(rows.map((r) => ({ minuto: Number(r.minuto), n: Number(r.n) })));
}));

app.get('/api/secoes', wrap(async (req, res) => {
  const b = base(req.query);
  const f = withTime(req.query, b);
  const limit = Math.min(Math.max(int(req.query.limit) ?? 50, 1), 200);
  const page = Math.max(int(req.query.page) ?? 1, 1);
  const dir = req.query.order === 'desc' ? 'DESC' : 'ASC';
  const [rows] = await pool.query(
    `SELECT sg_uf, cd_municipio, nm_municipio, nr_zona, nr_secao, nm_local_votacao,
            qt_aptos, qt_comparecimento, dt_abertura, dt_encerramento
     FROM secoes WHERE ${f.sql}
     ORDER BY dt_encerramento ${dir}, sg_uf, cd_municipio, nr_zona, nr_secao
     LIMIT ? OFFSET ?`,
    [...f.params, limit, (page - 1) * limit]
  );
  res.json(rows);
}));

// ---- Votos por candidato (cole ANTES do "app.use((err, req, res, next) => {") ----

// Filtros com alias "s" (secoes), para uso em JOIN com votos
function filtroVotos(q) {
  const ano = int(q.ano);
  const turno = int(q.turno);
  if (!ano || !turno) throw new BadRequest('Informe ano e turno');
  const where = ['s.ano=?', 's.turno=?'];
  const params = [ano, turno];
  if (q.uf) {
    where.push('s.sg_uf=?');
    params.push(String(q.uf).toUpperCase().slice(0, 2));
  }
  const mun = int(q.municipio);
  if (mun) {
    where.push('s.cd_municipio=?');
    params.push(mun);
  }
  if (q.de) {
    if (!TIME_RE.test(q.de)) throw new BadRequest('Horário inicial inválido (use HH:MM)');
    where.push('TIME(s.dt_encerramento) >= ?');
    params.push(`${q.de}:00`);
  }
  if (q.ate) {
    if (!TIME_RE.test(q.ate)) throw new BadRequest('Horário final inválido (use HH:MM)');
    where.push('TIME(s.dt_encerramento) < ?');
    params.push(`${q.ate}:00`);
  }
  return { where: where.join(' AND '), params };
}

// Cargos disponíveis na eleição/turno (ex.: Presidente, Governador...)
app.get('/api/cargos', wrap(async (req, res) => {
  const ano = int(req.query.ano);
  const turno = int(req.query.turno);
  if (!ano || !turno) throw new BadRequest('Informe ano e turno');
  const [cs] = await pool.query(
    'SELECT DISTINCT cd_cargo FROM votos WHERE ano=? AND turno=? ORDER BY cd_cargo',
    [ano, turno]
  );
  const out = [];
  for (const c of cs) {
    const [[r]] = await pool.query(
      'SELECT ds_cargo FROM votos WHERE ano=? AND turno=? AND cd_cargo=? LIMIT 1',
      [ano, turno, c.cd_cargo]
    );
    out.push({ cd_cargo: c.cd_cargo, ds_cargo: r?.ds_cargo ?? null });
  }
  res.json(out);
}));

// Votos somados por candidato, considerando só as seções que casam com os filtros
app.get('/api/votos', wrap(async (req, res) => {
  const cargo = int(req.query.cargo);
  if (!cargo) throw new BadRequest('Informe o cargo');
  const f = filtroVotos(req.query);
  const [linhas] = await pool.query(
    `SELECT v.nr_votavel, v.nm_votavel, MAX(v.ds_tipo_votavel) AS ds_tipo_votavel, SUM(v.qt_votos) AS votos
     FROM votos v
     JOIN secoes s ON s.ano=v.ano AND s.turno=v.turno AND s.sg_uf=v.sg_uf
                  AND s.cd_municipio=v.cd_municipio AND s.nr_zona=v.nr_zona AND s.nr_secao=v.nr_secao
     WHERE ${f.where} AND v.cd_cargo=?
     GROUP BY v.nr_votavel, v.nm_votavel
     ORDER BY votos DESC`,
    [...f.params, cargo]
  );
  const [[sec]] = await pool.query(`SELECT COUNT(*) AS n FROM secoes s WHERE ${f.where}`, f.params);
  res.json({ secoes: Number(sec.n), linhas: linhas.map((r) => ({ ...r, votos: Number(r.votos) })) });
}));

app.use((err, req, res, next) => {
  if (err instanceof BadRequest) return res.status(400).json({ erro: err.message });
  console.error(err);
  res.status(500).json({ erro: 'Erro interno' });
});

app.listen(config.port, config.host, () => {
  console.log(`Dashboard em http://${config.host}:${config.port}`);
});
