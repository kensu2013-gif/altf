import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import os from 'os';

dotenv.config();

export function hasAwsCredentials() {
    return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

export const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'ap-northeast-2'
    // credentials will be loaded automatically if AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are in .env
});

export const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'altf-web-data-prod';
const DB_KEY = process.env.S3_DB_KEY || 'database/db.json';

const streamToString = (stream) =>
    new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });

export async function loadDbFromS3() {
    if (!hasAwsCredentials()) {
        console.log('[S3] No AWS credentials detected. Operating in local mode. Loading from local fallback...');
        try {
            const LOCAL_DB = './data/db.json';
            if (fs.existsSync(LOCAL_DB)) {
                const localContent = fs.readFileSync(LOCAL_DB, 'utf8');
                console.log(`[Local DB] Successfully loaded data from local fallback: ${LOCAL_DB}`);
                return JSON.parse(localContent);
            }
            console.warn('[Local DB] Local fallback DB file does not exist. Returning null to allow seeding.');
            return null;
        } catch (localError) {
            console.error('[Local DB] Failed to load from local fallback DB:', localError);
            return null;
        }
    }
    try {
        const command = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: DB_KEY
        });
        const response = await s3Client.send(command);
        const bodyContent = await streamToString(response.Body);
        console.log(`[S3] Loaded data from ${BUCKET_NAME}/${DB_KEY}`);
        return JSON.parse(bodyContent);
    } catch (error) {
        if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
            console.log(`[S3] ${DB_KEY} not found in S3. Returning null for initial seed.`);
            return null;
        }
        
        const isProd = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
        if (isProd) {
            console.error('[S3] Critical error: Failed to load database from S3 in production. Fallback to local DB is disabled to prevent data overwriting.');
            throw error;
        }

        console.warn('[S3] Failed to load from S3. Falling back to local data/db.json...', error.message);
        try {
            const fs = await import('fs');
            const LOCAL_DB = './data/db.json';
            if (fs.existsSync(LOCAL_DB)) {
                const localContent = fs.readFileSync(LOCAL_DB, 'utf8');
                console.log(`[Local DB] Successfully loaded data from local fallback: ${LOCAL_DB}`);
                return JSON.parse(localContent);
            }
            console.warn('[Local DB] Local fallback DB file does not exist. Returning null to allow seeding.');
            return null;
        } catch (localError) {
            console.error('[Local DB] Failed to load from local fallback DB:', localError);
            throw error;
        }
    }
}

export async function getInventoryFromS3() {
    if (!hasAwsCredentials()) {
        console.log('[S3] No AWS credentials detected. Operating in local mode. Loading inventory from local file...');
        try {
            const localPath = './public/api/inventory/inventory.json';
            if (fs.existsSync(localPath)) {
                const localData = fs.readFileSync(localPath, 'utf8');
                return {
                    items: JSON.parse(localData),
                    lastModified: fs.statSync(localPath).mtime
                };
            }
            console.warn('[Local Inventory] Local inventory file does not exist.');
        } catch (localErr) {
            console.error('[Local Inventory] Failed to read local inventory:', localErr.message);
        }
        throw new Error('Local inventory file missing and AWS credentials not configured.');
    }
    const isProd = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';

    // Prioritize local file if it exists (useful for local overrides or builds)
    // In production, skip local check and always read from S3 to ensure multi-instance consistency.
    if (!isProd) {
        try {
            const fs = await import('fs');
            const path = await import('path');
            const { fileURLToPath } = await import('url');

            const __filename = fileURLToPath(import.meta.url);
            const __dirname = path.dirname(__filename);
            const localPath = path.join(__dirname, 'public/api/inventory/inventory.json');

            if (fs.existsSync(localPath)) {
                console.log(`[Inventory Source] Prioritizing local file: ${localPath}`);
                const localData = fs.readFileSync(localPath, 'utf8');
                return {
                    items: JSON.parse(localData),
                    lastModified: fs.statSync(localPath).mtime
                };
            }
        } catch (localErr) {
            console.warn('[Inventory Source] Failed to read local inventory file first:', localErr.message);
        }
    }

    const PROCESSED_KEY = 'public/inventory/processed_inventory.json';
    const ORIGINAL_KEY = 'public/inventory/inventory.json';

    try {
        const command = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: PROCESSED_KEY
        });
        const response = await s3Client.send(command);
        const bodyContent = await streamToString(response.Body);
        console.log(`[S3] Fetched processed inventory (${PROCESSED_KEY}) from S3. Last Modified: ${response.LastModified}`);
        return {
            items: JSON.parse(bodyContent),
            lastModified: response.LastModified
        };
    } catch (error) {
        console.warn(`[S3] Failed to fetch processed inventory from S3. Trying original raw file as fallback...`, error.message);
        try {
            const command = new GetObjectCommand({
                Bucket: BUCKET_NAME,
                Key: ORIGINAL_KEY
            });
            const response = await s3Client.send(command);
            const bodyContent = await streamToString(response.Body);
            console.log(`[S3 Fallback] Fetched original raw inventory (${ORIGINAL_KEY}) from S3. Last Modified: ${response.LastModified}`);
            return {
                items: JSON.parse(bodyContent),
                lastModified: response.LastModified
            };
        } catch (fallbackError) {
            console.warn('[S3 Fallback] Failed to fetch original raw file. Trying local file fallback...', fallbackError.message);
            try {
                const fs = await import('fs');
                const path = await import('path');
                const { fileURLToPath } = await import('url');

                const __filename = fileURLToPath(import.meta.url);
                const __dirname = path.dirname(__filename);
                const localPath = path.join(__dirname, 'public/api/inventory/inventory.json');
                
                if (fs.existsSync(localPath)) {
                    console.log(`[S3 Fallback] Reading local file: ${localPath}`);
                    const localData = fs.readFileSync(localPath, 'utf8');
                    return {
                        items: JSON.parse(localData),
                        lastModified: fs.statSync(localPath).mtime
                    };
                } else {
                    console.warn(`[S3 Fallback] Local file does not exist at ${localPath}`);
                }
            } catch (localError) {
                console.error('[S3 Fallback] Failed to read local file fallback:', localError);
            }

            try {
                console.log('[S3 Fallback] Fetching inventory from public HTTP URL...');
                const publicUrl = `https://${BUCKET_NAME}.s3.ap-northeast-2.amazonaws.com/${PROCESSED_KEY}`;
                const response = await fetch(publicUrl);
                if (response.ok) {
                    const bodyContent = await response.json();
                    console.log('[S3 Fallback] Successfully fetched from public HTTP URL.');
                    return {
                        items: bodyContent,
                        lastModified: new Date()
                    };
                } else {
                    console.warn(`[S3 Fallback] HTTP fetch failed with status ${response.status}`);
                }
            } catch (fetchError) {
                console.error('[S3 Fallback] Failed to fetch from public HTTP URL:', fetchError);
            }

            throw error;
        }
    }
}

export async function saveDbToS3(dbObject) {
    if (!hasAwsCredentials()) {
        // console.log('[S3] No AWS credentials detected. Saving locally...');
        try {
            const dir = './data';
            const LOCAL_DB = path.join(dir, 'db.json');
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(LOCAL_DB, JSON.stringify(dbObject, null, 2), 'utf8');
            // console.log(`[Local DB] Successfully saved database to local fallback: ${LOCAL_DB}`);
            return;
        } catch (localError) {
            console.error('[Local DB] Critical: Failed to save to local fallback DB:', localError);
            throw localError;
        }
    }
    try {
        const command = new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: DB_KEY,
            Body: JSON.stringify(dbObject, null, 2),
            ContentType: 'application/json'
        });
        await s3Client.send(command);
        console.log('[S3] Data saved successfully to S3');
    } catch (error) {
        const isProd = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
        if (isProd) {
            console.error('[S3] Critical error: Failed to save database to S3 in production. Local fallback saving is disabled to prevent silent data loss.', error.message);
            throw error;
        }

        console.error('[S3] Failed to save to S3. Falling back to saving locally...', error.message);
        try {
            const fs = await import('fs');
            const path = await import('path');
            const dir = './data';
            const LOCAL_DB = path.join(dir, 'db.json');
            
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            fs.writeFileSync(LOCAL_DB, JSON.stringify(dbObject, null, 2), 'utf8');
            console.log(`[Local DB] Successfully saved database to local fallback: ${LOCAL_DB}`);
        } catch (localError) {
            console.error('[Local DB] Critical: Failed to save to local fallback DB:', localError);
            throw error; // Re-throw S3 error if local fallback saving also fails
        }
    }
}

export async function getPreviousDbVersion(cutoffDateStr) {
    if (!hasAwsCredentials()) {
        return null;
    }
    try {
        const { ListObjectVersionsCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
        const versionsRes = await s3Client.send(new ListObjectVersionsCommand({
            Bucket: BUCKET_NAME,
            Prefix: DB_KEY
        }));

        if (versionsRes.Versions && versionsRes.Versions.length > 1) {
            const cutoff = new Date(cutoffDateStr);
            const pastVersions = versionsRes.Versions.filter(v => new Date(v.LastModified) < cutoff);
            if (pastVersions.length > 0) {
                pastVersions.sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));
                const targetVersion = pastVersions[0];
                console.log(`[S3] Found past DB version from ${targetVersion.LastModified} with VersionId: ${targetVersion.VersionId}`);

                const response = await s3Client.send(new GetObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: DB_KEY,
                    VersionId: targetVersion.VersionId
                }));
                
                const chunks = [];
                for await (const chunk of response.Body) {
                    chunks.push(chunk);
                }
                const bodyContent = Buffer.concat(chunks).toString('utf8');
                return JSON.parse(bodyContent);
            }
        }
        return null;
    } catch (error) {
        console.error('[S3] Failed to load previous DB version:', error);
        return null;
    }
}


/**
 * Uploads an arbitrary file (buffer) to S3 at the specified prefix/filename.
 * returns the public S3 URL.
 */
export async function uploadFileToS3(folderPath, fileName, fileBuffer, contentType) {
    if (!hasAwsCredentials()) {
        throw new Error('AWS credentials not configured. S3 upload is disabled in local mode.');
    }
    try {
        const fullKey = `${folderPath}/${Date.now()}_${fileName.replace(/[^a-zA-Z0-9.\-_]/g, '')}`;
        const command = new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: fullKey,
            Body: fileBuffer,
            ContentType: contentType
        });

        await s3Client.send(command);

        // Return Virtual Hosted Style URL
        return `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'ap-northeast-2'}.amazonaws.com/${fullKey}`;
    } catch (error) {
        console.error('[S3] Failed to upload file:', error);
        throw error;
    }
}

export async function getPresignedUrlToS3(key) {
    if (!hasAwsCredentials()) {
        throw new Error('AWS credentials not configured. Cannot generate presigned URL.');
    }
    try {
        const command = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key
        });
        const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        return url;
    } catch (error) {
        console.error('[S3] Failed to generate presigned URL:', error);
        throw error;
    }
}

export async function uploadInventoryToS3(jsonData) {
    if (!hasAwsCredentials()) {
        throw new Error('AWS credentials not configured. Cannot upload inventory to S3.');
    }
    try {
        const PROCESSED_KEY = 'public/inventory/processed_inventory.json';
        const command = new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: PROCESSED_KEY,
            Body: JSON.stringify(jsonData, null, 2),
            ContentType: 'application/json'
        });

        await s3Client.send(command);
        console.log(`[S3] Successfully uploaded processed inventory (${PROCESSED_KEY}) to S3.`);
        return true;
    } catch (error) {
        console.error('[S3] Failed to upload inventory to S3:', error.message);
        throw error;
    }
}
