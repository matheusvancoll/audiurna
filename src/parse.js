// Funções puras de normalização do CSV do TSE (fáceis de testar).

const NULOS = new Set(['', '#NULO', '#NULO#', '#NE', '#NE#']);

export function normalizeHeader(h) {
  return String(h).replace(/^\uFEFF/, '').replace(/"/g, '').trim().toUpperCase();
}

export function clean(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().replace(/^"|"$/g, '').trim();
  return NULOS.has(s.toUpperCase()) ? null : s;
}

export function toInt(v) {
  const s = clean(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// Aceita "DD/MM/AAAA HH:MM:SS" e "AAAA-MM-DD HH:MM:SS"
export function toDateTime(v) {
  const s = clean(v);
  if (s === null) return null;
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/);
  if (m) return `${m[3]}-${m[2]}-${m[1]} ${fixTime(m[4])}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${fixTime(m[4])}`;
  return null;
}

function fixTime(t) {
  if (!t) return '00:00:00';
  return t.length === 5 ? `${t}:00` : t;
}

const REQUIRED = ['CD_MUNICIPIO', 'NR_ZONA', 'NR_SECAO', 'CD_CARGO', 'NR_VOTAVEL', 'QT_VOTOS'];

export function assertColumns(record) {
  const missing = REQUIRED.filter((c) => !(c in record));
  if (missing.length) {
    throw new Error(
      `Colunas obrigatórias ausentes: ${missing.join(', ')}.\n` +
        `Colunas encontradas: ${Object.keys(record).join(', ')}`
    );
  }
}

export function secaoKey(s) {
  return `${s.cd_municipio}|${s.nr_zona}|${s.nr_secao}`;
}

// Converte uma linha do CSV em { secao, voto }.
// Campos opcionais usam null quando a coluna não existe no arquivo.
export function mapRecord(rec, arquivo) {
  const g = (...names) => {
    for (const n of names) {
      if (n in rec) {
        const v = clean(rec[n]);
        if (v !== null) return v;
      }
    }
    return null;
  };

  const secao = {
    ano: arquivo.ano,
    turno: arquivo.turno,
    sg_uf: arquivo.sg_uf,
    cd_municipio: toInt(g('CD_MUNICIPIO')),
    nr_zona: toInt(g('NR_ZONA')),
    nr_secao: toInt(g('NR_SECAO')),
    nm_municipio: g('NM_MUNICIPIO'),
    nr_local_votacao: toInt(g('NR_LOCAL_VOTACAO')),
    nm_local_votacao: g('NM_LOCAL_VOTACAO'),
    ds_local_endereco: g('DS_LOCAL_VOTACAO_ENDERECO'),
    qt_aptos: toInt(g('QT_APTOS')),
    qt_comparecimento: toInt(g('QT_COMPARECIMENTO')),
    qt_abstencoes: toInt(g('QT_ABSTENCOES')),
    qt_eleitores_biometria_nh: toInt(g('QT_ELEITORES_BIOMETRIA_NH')),
    ds_tipo_urna: g('DS_TIPO_URNA'),
    nr_urna_efetivada: g('NR_URNA_EFETIVADA'),
    dt_abertura: toDateTime(g('DT_ABERTURA')),
    dt_encerramento: toDateTime(g('DT_ENCERRAMENTO')),
    dt_bu_recebido: toDateTime(g('DT_BU_RECEBIDO')),
    dt_emissao_bu: toDateTime(g('DT_EMISSAO_BU')),
  };

  const voto = {
    cd_cargo: toInt(g('CD_CARGO')),
    ds_cargo: g('DS_CARGO', 'DS_CARGO_PERGUNTA'),
    ds_tipo_votavel: g('DS_TIPO_VOTAVEL'),
    nr_votavel: toInt(g('NR_VOTAVEL')),
    nm_votavel: g('NM_VOTAVEL'),
    qt_votos: toInt(g('QT_VOTOS')) ?? 0,
  };

  return { secao, voto };
}
