import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dotenv from 'dotenv';

dotenv.config();

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
    try {
        const INVENTORY_KEY = 'public/inventory/inventory.json';
        const command = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: INVENTORY_KEY
        });
        const response = await s3Client.send(command);
        const bodyContent = await streamToString(response.Body);
        console.log(`[S3] Fetched ${INVENTORY_KEY} from S3. Last Modified: ${response.LastModified}`);
        return {
            items: JSON.parse(bodyContent),
            lastModified: response.LastModified
        };
    } catch (error) {
        console.warn('[S3] Failed to fetch inventory from S3. Trying local file fallback...', error.message);
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
            const publicUrl = 'https://altf-web-data-prod.s3.ap-northeast-2.amazonaws.com/public/inventory/inventory.json';
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

export async function saveDbToS3(dbObject) {
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
