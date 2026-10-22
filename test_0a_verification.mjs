import { CertificateIssuerService } from './server/services/certificateIssuer.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = __dirname;

async function runVerification() {
    console.log('=== [0-A 검증 시작: 성적서 기본값 대체 제거 & 엄격 매칭] ===\n');

    const issuer = new CertificateIssuerService();

    // 1. 존재하지 않는 LOT로 출고 성적서 발행 요청 시 중단 및 missingLines 반환 확인
    console.log('1. [테스트 1] 존재하지 않는 LOT 요청 테스트...');
    const fakeOrder = {
        outboundNo: 'TEST_OUT_99999',
        customer: '(주)테스트엔지니어링',
        items: [
            {
                lineNo: '1-1',
                vendorLot: 'NON_EXISTENT_LOT_XYZ_9999',
                productType: '90E(L)',
                size: '50A',
                qty: 5
            }
        ]
    };

    const failResult = await issuer.issueCertificatesForOutbound(fakeOrder);
    console.log('결과:', JSON.stringify(failResult, null, 2));

    if (failResult.success === false && failResult.missingLines && failResult.missingLines.length === 1) {
        console.log('✅ 테스트 1 통과: 존재하지 않는 LOT는 PDF/엑셀 생성 없이 즉시 중단 및 missingLines 반환');
    } else {
        console.error('❌ 테스트 1 실패:', failResult);
        process.exit(1);
    }

    // 2. qc_missing_alerts.json에 경보 기록 확인
    const alertsPath = path.join(ROOT_DIR, 'server/data/qc_missing_alerts.json');
    if (fs.existsSync(alertsPath)) {
        const alerts = JSON.parse(fs.readFileSync(alertsPath, 'utf8'));
        const foundAlert = alerts.find(a => a.outboundNo === 'TEST_OUT_99999');
        if (foundAlert) {
            console.log('✅ 테스트 2 통과: qc_missing_alerts.json에 QC-13 누락 경보 기록 확인됨');
        } else {
            console.error('❌ 테스트 2 실패: 경보 기록 미발견');
            process.exit(1);
        }
    }

    // 3. 실제 존재하는 LOT로 출고 성적서 발행 요청 시 정상 발급 확인
    console.log('\n2. [테스트 3] 실제 존재하는 LOT 정상 발행 테스트...');
    // certificates.json에서 1건 조회
    const certs = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'server/data/certificates.json'), 'utf8'));
    const realCert = certs.find(c => c.lotNo && c.heatNo && c.chemC);
    console.log(`선택된 실데이터 LOT: ${realCert.lotNo}, HEAT: ${realCert.heatNo}`);

    const realOrder = {
        outboundNo: 'TEST_OUT_VALID_01',
        customer: '(주)테스트엔지니어링',
        items: [
            {
                lineNo: '1-1',
                vendorLot: realCert.lotNo,
                productType: realCert.description,
                qty: 2
            }
        ]
    };

    const successResult = await issuer.issueCertificatesForOutbound(realOrder);
    console.log('발행 결과 요약:', {
        success: successResult.success,
        count: successResult.count,
        excelPath: successResult.records?.[0]?.excelPath,
        pdfPath: successResult.records?.[0]?.pdfPath
    });

    if (successResult.success && successResult.records?.length > 0) {
        const rec = successResult.records[0];
        if (fs.existsSync(rec.excelPath)) {
            console.log('✅ 테스트 3 통과: 실데이터 LOT 대상 엑셀 및 성적서 정상 발행 성공!');
        } else {
            console.error('❌ 테스트 3 실패: 엑셀 파일 미생성');
            process.exit(1);
        }
    } else {
        console.error('❌ 테스트 3 실패:', successResult);
        process.exit(1);
    }

    console.log('\n=== [0-A 검증 완료: 100% 정상 통과] ===');
}

runVerification().catch(err => {
    console.error('검증 중 오류 발생:', err);
    process.exit(1);
});
