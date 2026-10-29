# tse-ingest

Baixa os **boletins de urna** do Portal de Dados Abertos do TSE (um zip por UF/turno) e grava em MySQL, **por seção**, incluindo horários de abertura/encerramento.

## Uso

```bash
cp .env.example .env        # ajuste as credenciais do MySQL
mysql -e "CREATE DATABASE tse CHARACTER SET utf8mb4"
npm install
npm run migrate

npm run discover -- --ano 2026                  # confirma o id do dataset
npm run ingest -- --ano 2026 --turno 1 --uf SE  # teste com um estado pequeno
npm run ingest -- --ano 2026                    # tudo
npm run status
```

Dataset padrão: `resultados-<ano>-boletim-de-urna`. Se o `discover` mostrar outro id, use `--dataset`.

## Controle de duplicidade

- `ingest_arquivos`: status por zip (`pendente`, `processando`, `concluido`, `erro`). Zip concluído nunca é reprocessado.
- `secoes.processado_em`: preenchido só quando o arquivo termina. Em nova execução, linhas de seções já marcadas são ignoradas.
- Se cair no meio do arquivo, nada é marcado como concluído; ao rodar de novo, os inserts são idempotentes (chave primária + upsert), então não duplica.

## Tabelas

- `secoes`: 1 linha por seção (zona, seção, município, local, aptos, comparecimento, `dt_abertura`, `dt_encerramento`, `dt_bu_recebido`...).
- `votos`: 1 linha por seção/cargo/votável (candidato, branco, nulo, legenda).

## Exemplos para o dashboard

```sql
-- Seções encerradas por hora
SELECT HOUR(dt_encerramento) hora, COUNT(*) secoes
FROM secoes WHERE ano=2026 AND turno=1 GROUP BY hora ORDER BY hora;

-- Votos por candidato em um cargo
SELECT nm_votavel, SUM(qt_votos) votos
FROM votos WHERE ano=2026 AND turno=1 AND cd_cargo=1 GROUP BY nr_votavel, nm_votavel ORDER BY votos DESC;
```

## Aviso

Os nomes das colunas do CSV foram escritos de memória a partir de edições anteriores. O parser lê pelo cabeçalho; se faltar uma coluna obrigatória, ele para e lista as colunas encontradas. Colunas opcionais ausentes ficam `NULL`.

## Dashboard

```bash
node src/server.js        # ou: npm run dashboard
# abra http://127.0.0.1:3000
```

Filtros: eleição/turno, UF, município e faixa de horário de encerramento (ex.: 17:00–17:30, depois das 19h). O gráfico mostra a distribuição completa e destaca as faixas dentro do filtro; a tabela lista as seções, com paginação.

Por padrão o servidor só escuta em `127.0.0.1`. Se mudar `HOST` para expor na rede, adicione autenticação antes.
