/**
 * Storage Strategy Utility
 * 
 * This module defines the standard paths for storing user and company data.
 * Currently it acts as a reference implementation for future AWS S3 integration.
 * 
 * Future Implementation:
 * When migrating to AWS S3, this function will return the S3 key prefix.
 */

export function getCompanyStoragePath(companyId: string): string {
    // Format: companies/{companyId}/
    // Example: companies/550e8400-e29b-41d4-a716-446655440000/
    return `companies/${companyId}/`;
}

export function getUserStoragePath(companyId: string, userId: string): string {
    // Format: companies/{companyId}/users/{userId}/
    return `${getCompanyStoragePath(companyId)}users/${userId}/`;
}

export function getDocumentStoragePath(companyId: string, docType: 'registration' | 'contracts' | 'other'): string {
    // Format: companies/{companyId}/documents/{docType}/
    return `${getCompanyStoragePath(companyId)}documents/${docType}/`;
}
