import 'dotenv/config';
import path from 'node:path';

export const config = {
  db: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'tse',
  },
  ckanUrl: process.env.TSE_CKAN_URL ?? 'https://dadosabertos.tse.jus.br/api/3/action',
  dataDir: path.resolve(process.env.DATA_DIR ?? './data'),
  batchSize: Number(process.env.BATCH_SIZE ?? 5000),
  // Dashboard
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '127.0.0.1', // só acessível nesta máquina
};
