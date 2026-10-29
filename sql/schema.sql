-- Controle por arquivo (um zip por UF/turno)
CREATE TABLE IF NOT EXISTS ingest_arquivos (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  dataset VARCHAR(120) NOT NULL,
  ano SMALLINT UNSIGNED NOT NULL,
  turno TINYINT UNSIGNED NOT NULL,
  sg_uf CHAR(2) NOT NULL,
  url VARCHAR(600) NOT NULL,
  url_hash CHAR(64) NOT NULL,
  status ENUM('pendente','processando','concluido','erro') NOT NULL DEFAULT 'pendente',
  linhas_lidas BIGINT UNSIGNED NOT NULL DEFAULT 0,
  secoes_novas INT UNSIGNED NOT NULL DEFAULT 0,
  secoes_ignoradas INT UNSIGNED NOT NULL DEFAULT 0,
  erro TEXT NULL,
  iniciado_em DATETIME NULL,
  concluido_em DATETIME NULL,
  UNIQUE KEY uq_url (url_hash),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Uma linha por seção eleitoral. processado_em IS NOT NULL = seção já carregada por completo.
CREATE TABLE IF NOT EXISTS secoes (
  ano SMALLINT UNSIGNED NOT NULL,
  turno TINYINT UNSIGNED NOT NULL,
  sg_uf CHAR(2) NOT NULL,
  cd_municipio MEDIUMINT UNSIGNED NOT NULL,
  nr_zona SMALLINT UNSIGNED NOT NULL,
  nr_secao SMALLINT UNSIGNED NOT NULL,
  nm_municipio VARCHAR(100) NULL,
  nr_local_votacao INT UNSIGNED NULL,
  nm_local_votacao VARCHAR(255) NULL,
  ds_local_endereco VARCHAR(255) NULL,
  qt_aptos INT UNSIGNED NULL,
  qt_comparecimento INT UNSIGNED NULL,
  qt_abstencoes INT UNSIGNED NULL,
  qt_eleitores_biometria_nh INT UNSIGNED NULL,
  ds_tipo_urna VARCHAR(60) NULL,
  nr_urna_efetivada VARCHAR(30) NULL,
  dt_abertura DATETIME NULL,
  dt_encerramento DATETIME NULL,
  dt_bu_recebido DATETIME NULL,
  dt_emissao_bu DATETIME NULL,
  processado_em DATETIME NULL,
  PRIMARY KEY (ano, turno, sg_uf, cd_municipio, nr_zona, nr_secao),
  KEY idx_encerramento (ano, turno, dt_encerramento),
  KEY idx_processado (ano, turno, sg_uf, processado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Votos por seção/cargo/votável (candidato, legenda, branco, nulo)
CREATE TABLE IF NOT EXISTS votos (
  ano SMALLINT UNSIGNED NOT NULL,
  turno TINYINT UNSIGNED NOT NULL,
  sg_uf CHAR(2) NOT NULL,
  cd_municipio MEDIUMINT UNSIGNED NOT NULL,
  nr_zona SMALLINT UNSIGNED NOT NULL,
  nr_secao SMALLINT UNSIGNED NOT NULL,
  cd_cargo SMALLINT UNSIGNED NOT NULL,
  nr_votavel INT UNSIGNED NOT NULL,
  ds_cargo VARCHAR(60) NULL,
  ds_tipo_votavel VARCHAR(40) NULL,
  nm_votavel VARCHAR(150) NULL,
  qt_votos INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (ano, turno, sg_uf, cd_municipio, nr_zona, nr_secao, cd_cargo, nr_votavel),
  KEY idx_candidato (ano, turno, cd_cargo, nr_votavel)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
