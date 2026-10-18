/**
 * ALTF 공인 성적서 관리 대장 스키마 (대경벤드 성적서.xlsx 및 Google Sheets 100% 호환)
 * 구글 드라이브: 내 드라이브 > ALTF 통합문서 > ALTF_성적서 > 대경벤드 성적서.xlsx
 */

export interface CertificateLedgerRow {
    issueDate: string;        // A: 일 자 (예: '26/10/14')
    customer: string;         // B: Customer (예: '(주)태형산업')
    supplier: string;         // C: 공급처 (예: '(주)대경벤드')
    poNo: string;             // D: P.O No (예: 'ES261014-2869')
    certNo: string;           // E: CERT-No (예: 'YR-26-09915' / 'ALTF-26-09915')
    specMaterial: string;     // F: Spec MATERIAL (예: 'ASTM A312 TP316L')
    specInspection: string;   // G: Spec INSPECTION (예: 'KS B1543 STS316L-W /B1500')
    heatNo: string;           // H: HEAT No (예: 'SD62415')
    lotNo: string;            // I: LOT No (예: 'KJA0879')
    itemNo: number | string;  // J: ITEM No (예: 1)
    description: string;      // K: DESCRIPTION (예: '45E(L) S/10S 25A B.W')
    qty: number;              // L: Q'TY (예: 1)
    material: string;         // M: MATERIAL (예: 'WELDED PIPE')
    chemC: number;            // N: C (예: 0.017)
    chemSi: number;           // O: Si (예: 0.55)
    chemMn: number;           // P: Mn (예: 1.05)
    chemP: number;            // Q: P (예: 0.032)
    chemS: number;            // R: S (예: 0.002)
    chemNi: number;           // S: Ni (예: 10.10)
    chemCr: number;           // T: Cr (예: 16.35)
    chemMo: number;           // U: Mo (예: 2.03)
    mechYs: number;           // V: Y.S (예: 298)
    mechTs: number;           // W: T.S (예: 622)
    mechEl: number;           // X: E.L (예: 57)
    dimensionVi: string;      // Y: 외관/치수 (예: 'GOOD')
    pdfUrl: string;           // Z: PDF 원본링크 (예: '/storage/certificates/261014_알트에프...pdf')
}

// 엑셀/구글 시트 1행 헤더 매핑 정의 (사용자가 세팅한 시트와 1:1 일치)
export const CERTIFICATE_SHEET_HEADERS = [
    '일 자',
    'Customer',
    '공급처',
    'P.O No',
    'CERT-No',
    'Spec MATERIAL',
    'Spec INSPECTION',
    'HEAT No',
    'LOT No',
    'ITEM No',
    'DESCRIPTION',
    'Q\'TY',
    'MATERIAL',
    'C',
    'Si',
    'Mn',
    'P',
    'S',
    'Ni',
    'Cr',
    'Mo',
    'Y.S',
    'T.S',
    'E.L',
    '외관/치수',
    'PDF 원본링크'
] as const;

// 실측 샘플 데이터 (사진 3 대경벤드 YR-26-09915 성적서 4개 품목 정밀 매핑)
export const SAMPLE_CERTIFICATE_ROWS: CertificateLedgerRow[] = [
    {
        issueDate: '26/10/14',
        customer: '(주)태형산업',
        supplier: '(주)대경벤드',
        poNo: 'ES261014-2869',
        certNo: 'YR-26-09915',
        specMaterial: 'ASTM A312 TP316L',
        specInspection: 'KS B1543 STS316L-W /B1500',
        heatNo: 'SD62415',
        lotNo: 'KJA0879',
        itemNo: 1,
        description: '45E(L) S/10S 25A B.W',
        qty: 1,
        material: 'WELDED PIPE',
        chemC: 0.017,
        chemSi: 0.55,
        chemMn: 1.05,
        chemP: 0.032,
        chemS: 0.002,
        chemNi: 10.10,
        chemCr: 16.35,
        chemMo: 2.03,
        mechYs: 298,
        mechTs: 622,
        mechEl: 57,
        dimensionVi: 'GOOD',
        pdfUrl: '/storage/certificates/261014_알트에프.261014-2869 (10-14-31).pdf'
    },
    {
        issueDate: '26/10/14',
        customer: '(주)태형산업',
        supplier: '(주)대경벤드',
        poNo: 'ES261014-2869',
        certNo: 'YR-26-09915',
        specMaterial: 'ASTM A312 TP316L',
        specInspection: 'KS B1543 STS316L-W /B1500',
        heatNo: 'SD62415',
        lotNo: 'KJA0880',
        itemNo: 2,
        description: '90E(L) S/10S 25A B.W',
        qty: 4,
        material: 'WELDED PIPE',
        chemC: 0.017,
        chemSi: 0.55,
        chemMn: 1.05,
        chemP: 0.032,
        chemS: 0.002,
        chemNi: 10.10,
        chemCr: 16.35,
        chemMo: 2.03,
        mechYs: 298,
        mechTs: 622,
        mechEl: 57,
        dimensionVi: 'GOOD',
        pdfUrl: '/storage/certificates/261014_알트에프.261014-2869 (10-14-31).pdf'
    },
    {
        issueDate: '26/10/14',
        customer: '(주)태형산업',
        supplier: '(주)대경벤드',
        poNo: 'ES261014-2869',
        certNo: 'YR-26-09915',
        specMaterial: 'ASTM A312 TP316L',
        specInspection: 'KS B1543 STS316L-W /B1500',
        heatNo: 'SD62415',
        lotNo: 'KJA0886',
        itemNo: 8,
        description: 'TEE S/10S 25A B.W',
        qty: 2,
        material: 'WELDED PIPE',
        chemC: 0.017,
        chemSi: 0.55,
        chemMn: 1.05,
        chemP: 0.032,
        chemS: 0.002,
        chemNi: 10.10,
        chemCr: 16.35,
        chemMo: 2.03,
        mechYs: 298,
        mechTs: 622,
        mechEl: 57,
        dimensionVi: 'GOOD',
        pdfUrl: '/storage/certificates/261014_알트에프.261014-2869 (10-14-31).pdf'
    },
    {
        issueDate: '26/10/14',
        customer: '(주)태형산업',
        supplier: '(주)대경벤드',
        poNo: 'ES261014-2869',
        certNo: 'YR-26-09915',
        specMaterial: 'ASTM A312 TP316L',
        specInspection: 'KS B1543 STS316L-W /B1500',
        heatNo: 'SD62415',
        lotNo: 'KJA0887',
        itemNo: 9,
        description: 'TEE S/10S 25A * 20A B.W',
        qty: 2,
        material: 'WELDED PIPE',
        chemC: 0.017,
        chemSi: 0.55,
        chemMn: 1.05,
        chemP: 0.032,
        chemS: 0.002,
        chemNi: 10.10,
        chemCr: 16.35,
        chemMo: 2.03,
        mechYs: 298,
        mechTs: 622,
        mechEl: 57,
        dimensionVi: 'GOOD',
        pdfUrl: '/storage/certificates/261014_알트에프.261014-2869 (10-14-31).pdf'
    }
];
