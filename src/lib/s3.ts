import { S3Client } from '@aws-sdk/client-s3';
import { createLogger } from '../logger';
import { config } from '../config';

const log = createLogger('s3');

if (!config.AWS_ACCESS_KEY_ID || !config.AWS_SECRET_ACCESS_KEY) {
  log.warn('AWS credentials not set — S3 uploads will fail');
}

export const s3Client = new S3Client({
  region: config.AWS_REGION,
  credentials:
    config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: config.AWS_ACCESS_KEY_ID,
          secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
});

export const S3_BUCKET = config.AWS_S3_BUCKET;