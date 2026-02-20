
// verify_sync.js

async function testSync() {
    const baseUrl = 'http://localhost:3001';

    // 1. Create Quote
    console.log('1. Creating Quote...');

    // We need a unique user ID to avoid clashing with existing data if possible, or just use a test one.
    const uniqueUser = `user_${Date.now()}@test.com`;

    const createRes = await fetch(`${baseUrl}/api/my/quotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            userId: uniqueUser,
            customerName: 'Test Company',
            items: [{ name: 'Test Item', quantity: 1, unitPrice: 1000, amount: 1000 }]
        })
    });
    const quote = await createRes.json();
    console.log('Created Quote ID:', quote.id);

    // 2. Admin Updates Quote (Simulate AdminQuoteDetail.tsx)
    console.log('2. Admin Updating Quote...');
    const updatePayload = {
        status: 'PROCESSED',
        adminResponse: {
            confirmedPrice: 1000,
            deliveryDate: '2026-12-31',
            note: 'This is a test admin note.'
        }
    };

    await fetch(`${baseUrl}/api/my/quotations/${quote.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload)
    });

    // 3. User Fetches Quote (Simulate MyPage.tsx)
    console.log('3. User Fetching Quote...');
    const listRes = await fetch(`${baseUrl}/api/my/quotations?userId=${uniqueUser}`);
    const quotes = await listRes.json();
    const fetchedQuote = quotes.find(q => q.id === quote.id);

    console.log('Fetched Quote Status:', fetchedQuote.status);
    console.log('Fetched Admin Response:', JSON.stringify(fetchedQuote.adminResponse, null, 2));

    if (fetchedQuote.adminResponse && fetchedQuote.adminResponse.note === 'This is a test admin note.') {
        console.log('SUCCESS: Admin response matches.');
    } else {
        console.error('FAILURE: Admin response missing or incorrect.');
        process.exit(1);
    }
}

testSync().catch(console.error);
