const fs = require('fs');

const raw = JSON.parse(fs.readFileSync('./src/data/customers_raw.json', 'utf8'));
const sanitized = raw.map(c => {
    const address = c['사업장주소1'] || c['실제주소1'] || '';
    let region = '기타';
    if (address.includes('부산') || address.includes('경남') || address.includes('울산') || address.includes('양산') || address.includes('창원') || address.includes('김해')) {
        region = '부산/경남권';
    } else if (address.includes('경기') || address.includes('서울') || address.includes('시흥') || address.includes('인천') || address.includes('수원') || address.includes('안산')) {
        region = '수도권(시화권)';
    }

    return {
        id: c['코드'],
        companyName: c['거래처명'] || c['상호명'],
        ceo: c['대표자명'] || '',
        businessNumber: c['사업자(주민)번호'] || '',
        address: address,
        region: region,
        salesType: c['유형'] || '',
        industry: c['업태'] || '',
        items: c['종목'] || '',
        contactName: c['거래처담당자1_담당자명'] || '',
        phone: c['거래처담당자1_전화'] || c['전화'] || '',
        email: c['거래처담당자1_이메일'] || ''
    };
});

fs.writeFileSync('./src/data/customers.json', JSON.stringify(sanitized, null, 2));
console.log(`Generated ${sanitized.length} customers.`);
