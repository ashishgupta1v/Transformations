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
    logger.warn('Oracle Object Storage is not configured. Falling back to public ephemeral storage for testing.');
    return null;
  }

  return new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true, // required for Oracle's S3-compatible endpoint
  });
}

// Used for both rendered video output and user-supplied input images
// (the admin API's /api/assets/upload route accepts base images, target/
// reference images, and per-phase overrides — see admin/server.js).
function guessContentType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const map = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
  };
  return map[ext] || 'application/octet-stream';
}

/**
 * Upload a local file to Oracle Object Storage and return a presigned URL.
 * @param {string} filePath - local path to the file
 * @param {string} [keyPrefix] - optional folder prefix inside the bucket
 * @param {number} [expiresInSeconds] - presigned URL TTL (default 24h)
 */
async function uploadFile(filePath, keyPrefix = 'temp', expiresInSeconds = 86400) {
  const client = buildClient();
  const bucket = config.storage.bucket || 'local-fallback';
  const fileName = path.basename(filePath);
  const key = `${keyPrefix}/${Date.now()}_${fileName}`;
  const contentType = guessContentType(fileName);

  if (!client) {
    // Fallback to tmpfiles.org public ephemeral hosting if Oracle isn't configured
    const FormData = require('form-data');
    const axios = require('axios');
    const form = new FormData();
    form.append('file', require('fs').createReadStream(filePath));
    
    try {
      const response = await axios.post('https://tmpfiles.org/api/v1/upload', form, {
        headers: form.getHeaders()
      });
      // response.data.data.url looks like https://tmpfiles.org/1234/file.png
      // The direct download link inserts /dl/
      let url = response.data?.data?.url;
      if (url) {
        url = url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
      } else {
        throw new Error('No URL returned from tmpfiles.org');
      }
      
      logger.info('Uploaded to tmpfiles.org ephemeral storage', { url });
      return { key, bucket, url };
    } catch (err) {
      throw new Error(`Fallback upload failed: ${err.message}`);
    }
  }

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
  if (!client) return true; // Fallback mode is always "connected"
  await client.send(new HeadBucketCommand({ Bucket: config.storage.bucket }));
  return true;
}

module.exports = { uploadFile, testConnection, buildClient };
