const fs = require('fs');

const raw = JSON.parse(fs.readFileSync('./src/data/customers_raw.json', 'utf8'));

function mapRegion(addr) {
    if (!addr) return '기타/미정';
    if (addr.includes('서울') || addr.includes('인천') || addr.includes('경기') || addr.includes('부천') || addr.includes('시흥') || addr.includes('수원') || addr.includes('안산')) return '경기도';
    if (addr.includes('부산') || addr.includes('울산') || addr.includes('대구') || addr.includes('경남') || addr.includes('경북') || addr.includes('창원') || addr.includes('김해') || addr.includes('포항')) return '경상도';
    if (addr.includes('광주') || addr.includes('전남') || addr.includes('전북') || addr.includes('전주') || addr.includes('군산')) return '전라도';
    if (addr.includes('강원') || addr.includes('춘천') || addr.includes('원주') || addr.includes('강릉')) return '강원도';
    if (addr.includes('대전') || addr.includes('세종') || addr.includes('충남') || addr.includes('충북') || addr.includes('천안') || addr.includes('청주')) return '충청도';
    if (addr.includes('제주')) return '제주도';
    return '기타/미정';
}

const sanitized = raw.map((c, i) => {
    const address = c['사업장주소1'] || c['실제주소1'] || '';
    return {
        id: c['코드'] || 'CUST_' + i,
        companyName: c['거래처명'] || c['상호명'] || '무명거래처',
        ceo: c['대표자명'] || '',
        businessNumber: c['사업자(주민)번호'] || '',
        address: address,
        region: mapRegion(address),
        salesType: c['유형'] || '',
        industry: c['업태'] || '',
        items: c['종목'] || '',
        contactName: c['거래처담당자1_담당자명'] || '',
        phone: c['거래처담당자1_전화'] || c['전화'] || '',
        email: c['거래처담당자1_이메일'] || '',
        isDeleted: false
    };
});

fs.writeFileSync('./data/customers.json', JSON.stringify(sanitized, null, 2));
console.log(`Saved ${sanitized.length} customers to data/customers.json`);
