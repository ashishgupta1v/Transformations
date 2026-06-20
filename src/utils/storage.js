// src/utils/storage.js
// Oracle Object Storage helper using the S3-compatible API (AWS SigV4 auth
// via Customer Secret Keys). This replaces the broken raw axios.put with a
// fake "Bearer" auth header that publisher.js used to ship with — Oracle's
// S3-compatible endpoint requires real SigV4 signing, which the AWS SDK
// handles for us.
//
// Setup: OCI Console -> Identity & Security -> Users -> Customer Secret Keys
// Endpoint format: https://<namespace>.compat.objectstorage.<region>.oraclecloud.com

const fs = require('fs-extra');
const path = require('path');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const logger = require('./logger');
const config = require('../../config/pipeline.config');
const { withRetry } = require('./retry');

function buildClient() {
  const { endpoint, region, accessKeyId, secretAccessKey } = config.storage;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'Oracle Object Storage is not configured — set ORACLE_S3_ENDPOINT, ' +
      'ORACLE_S3_ACCESS_KEY, ORACLE_S3_SECRET_KEY in .env'
    );
  }

  return new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true, // required for Oracle's S3-compatible endpoint
  });
}

/**
 * Upload a local file to Oracle Object Storage and return a presigned URL.
 * @param {string} filePath - local path to the file
 * @param {string} [keyPrefix] - optional folder prefix inside the bucket
 * @param {number} [expiresInSeconds] - presigned URL TTL (default 24h)
 */
async function uploadFile(filePath, keyPrefix = 'temp', expiresInSeconds = 86400) {
  const client = buildClient();
  const bucket = config.storage.bucket;
  const fileName = path.basename(filePath);
  const key = `${keyPrefix}/${Date.now()}_${fileName}`;
  const contentType = fileName.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream';

  const body = await fs.readFile(filePath);

  await withRetry(
    () => client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })),
    { label: `Oracle Object Storage upload (${fileName})` }
  );

  logger.info('Uploaded to Oracle Object Storage', { bucket, key });

  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: expiresInSeconds }
  );

  return { key, bucket, url };
}

/**
 * Verify the configured bucket is reachable — used by scripts/test-apis.js.
 */
async function testConnection() {
  const client = buildClient();
  await client.send(new HeadBucketCommand({ Bucket: config.storage.bucket }));
  return true;
}

module.exports = { uploadFile, testConnection, buildClient };
