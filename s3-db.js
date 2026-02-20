import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config();

const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'ap-northeast-2'
    // credentials will be loaded automatically if AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are in .env
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'altf-web-data-prod';
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
        console.error('[S3] Failed to load from S3:', error);
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
    } catch (error) {
        console.error('[S3] Failed to save to S3:', error);
        throw error;
    }
}
