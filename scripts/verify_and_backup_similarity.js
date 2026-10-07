/**
 * ALTF 전체 견적 유사도 일괄 검증 & 안전 백업 엔진 (Verify & Backup Similarity Engine)
 * 
 * 1. 안전 백업: 실행 전 data/db.json의 타임스탬프 스냅샷 백업 생성
 * 2. 고속 검증: similarity-engine.js를 통해 전체 견적(700+건)의 유사도를 1년(365일) 및 50점 이상 기준으로 일괄 평가
 * 3. 사전 계산 영속화: 각 견적 객체의 similarity 필드에 사전 계산 결과 저장 (프론트엔드 $O(1)$ 즉시 렌더링 지원)
 * 4. 검증 리포트 생성: data/similarity_analysis_report.md에 상세 통계 및 검출 사례 기록
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { computeDocumentSimilaritySummary } from '../similarity-engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
    console.log(`======================================================`);
    console.log(`🚀 ALTF 전체 견적 유사도 검증 & 안전 백업 배치 시작`);
    console.log(`======================================================`);

    const dbPath = path.resolve(__dirname, '../data/db.json');
    if (!fs.existsSync(dbPath)) {
        console.error(`❌ DB 파일을 찾을 수 없습니다: ${dbPath}`);
        return;
    }

    const rawData = fs.readFileSync(dbPath, 'utf8');
    const db = JSON.parse(rawData);
    const quotations = db.quotations || [];
    console.log(`📂 DB 로드 완료: 전체 견적 ${quotations.length}건`);

    // 1. 안전 백업 디렉터리 및 스냅샷 백업 생성
    const backupDir = path.resolve(__dirname, '../data/backups');
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `db_backup_${timestamp}.json`);
    fs.writeFileSync(backupFile, rawData, 'utf8');
    console.log(`🛡️ [안전 백업] 원본 DB 백업 완료: ${backupFile}`);

    // 2. 전체 견적 고속 일괄 검증
    console.log(`⚡ 전체 견적 유사도 평가 및 동기화 진행 중...`);
    const t0 = Date.now();

    const stats = {
        DUPLICATE: 0,
        SAME_PROJECT: 0,
        REPEAT: 0,
        NONE: 0
    };
    const sampleDetections = [];
    let updatedCount = 0;

    quotations.forEach((q, idx) => {
        if (q.isDeleted) return;

        // similarity-engine.js의 최신 규칙(1년 이내, 50점 이상, 대형 가중치) 적용
        const sim = computeDocumentSimilaritySummary(q, quotations);
        q.similarity = sim;
        updatedCount++;

        if (sim && sim.topType !== 'NONE') {
            stats[sim.topType] = (stats[sim.topType] || 0) + 1;
            if (sampleDetections.length < 30) {
                sampleDetections.push({
                    id: q.id,
                    customer: q.customerName || q.customerInfo?.companyName || '무명',
                    type: sim.topType,
                    score: sim.topScore,
                    relatedId: sim.relatedDocNo,
                    targetCustomer: sim.targetCustomer
                });
            }
        } else {
            stats.NONE++;
        }
    });

    const elapsed = Date.now() - t0;
    console.log(`✅ ${updatedCount}건 검증 완료 (소요 시간: ${elapsed}ms, 건당 ${(elapsed / updatedCount).toFixed(2)}ms)`);

    // 3. 사전 계산된 유사도 데이터를 포함하여 DB 갱신 저장
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
    console.log(`💾 [캐시 영속화] data/db.json에 사전 계산 결과가 성공적으로 동기화되었습니다.`);

    // 4. 상세 마크다운 분석 리포트 발행
    const reportPath = path.resolve(__dirname, '../data/similarity_analysis_report.md');
    let md = `# 📊 ALTF 견적 유사도 평가 실측 검증 & 백업 리포트\n\n`;
    md += `- **생성 시각**: ${new Date().toISOString()}\n`;
    md += `- **검증 대상 문서**: 총 **${updatedCount}건**\n`;
    md += `- **총 평가 소요 시간**: **${elapsed}ms** (건당 ${(elapsed / updatedCount).toFixed(2)}ms, 초고속 처리)\n`;
    md += `- **안전 백업 파일**: \`${backupFile}\`\n\n`;

    md += `## 1. 유형별 검출 통계 (50점 이상 & 1년 이내 기준)\n\n`;
    md += `| 유사도 판정 유형 | 감지 건수 | 핵심 기준 요약 |\n`;
    md += `| :--- | :---: | :--- |\n`;
    md += `| **REPEAT** (동일 고객 반복/유사 견적) | **${stats.REPEAT}건** | 동일 고객, 종합 점수 ≥ 50점, 1년(365일) 이내 |\n`;
    md += `| **DUPLICATE** (동일 고객 중복 접수) | **${stats.DUPLICATE}건** | 동일 고객, 종합 점수 ≥ 80점, 최근 30일 이내 |\n`;
    md += `| **SAME_PROJECT** (타 고객 유사 프로젝트) | **${stats.SAME_PROJECT}건** | 타 고객, 종합 점수 ≥ 50점, 180일 이내 |\n`;
    md += `| **독립 견적 (유사도 없음)** | **${stats.NONE}건** | 50점 미만 또는 1년 초과 |\n\n`;

    md += `## 2. 주요 유사도 검출 사례 (Top Samples)\n\n`;
    sampleDetections.forEach((d, idx) => {
        md += `${idx + 1}. **[${d.type} - ${d.score}점]** \`${d.id}\` (${d.customer})\n`;
        md += `   - 🔗 매칭 대상: \`${d.relatedId}\` (${d.targetCustomer || d.customer})\n\n`;
    });

    fs.writeFileSync(reportPath, md, 'utf8');
    console.log(`📄 [리포트 생성] 상세 리포트가 발행되었습니다: ${reportPath}`);
    console.log(`\n======================================================`);
    console.log(`🎉 모든 작업이 안전하고 완벽하게 완료되었습니다!`);
    console.log(`======================================================`);
}

run().catch(console.error);
