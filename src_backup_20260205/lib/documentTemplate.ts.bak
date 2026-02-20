import type { DocumentPayload } from '../types/document';
import { formatCurrency } from './utils';

export const renderDocumentHTML = (payload: DocumentPayload): string => {
    const { document_type, meta, supplier, customer, items, totals } = payload;

    const isOrder = document_type === 'ORDER';
    const title = isOrder ? '주문서 (ORDER SHEET)' : '견적서 (QUOTATION)';
    const colorTheme = '#1e293b'; // Slate 800


    return `
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <meta charset="UTF-8">
        <title>${title} - ${meta.doc_no}</title>
        <style>
            @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css');
            @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@400..700&family=Nanum+Brush+Script&display=swap');
            
            @page {
                size: A4;
                margin: 10mm;
            }
            
            body { 
                font-family: 'Pretendard', sans-serif; 
                font-size: 10px;
                line-height: 1.4;
                color: #333;
                margin: 0;
                padding: 0;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact; 
            }

            .container { width: 100%; max-width: 210mm; margin: 0 auto; }

            /* Header */
            header {
                display: flex;
                justify-content: space-between;
                align-items: flex-end;
                border-bottom: 3px solid ${colorTheme};
                padding-bottom: 10px;
                margin-bottom: 20px;
            }
            .brand { font-size: 24px; font-weight: 800; color: ${colorTheme}; letter-spacing: -1px; }
            .doc-title { text-align: right; }
            .doc-title h1 { margin: 0; font-size: 22px; font-weight: 800; color: ${colorTheme}; }
            .doc-title p { margin: 0; font-size: 11px; color: #666; }

            /* Info Block */
            .info-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 20px;
                margin-bottom: 20px;
            }
            .box { border: 1px solid #ddd; padding: 10px; border-radius: 4px; }
            .box h3 { margin: 0 0 8px 0; font-size: 12px; font-weight: 700; color: ${colorTheme}; border-bottom: 1px solid #eee; padding-bottom: 4px; }
            .row { display: flex; margin-bottom: 4px; }
            .label { width: 70px; color: #666; font-weight: 600; }
            .value { flex: 1; font-weight: 500; }

            /* Items Table */
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; table-layout: fixed; font-size: 10px; }
            thead { display: table-header-group; }
            tfoot { display: table-footer-group; }
            tr { page-break-inside: avoid; }
            
            th { 
                background-color: #f1f5f9; 
                color: #334155; 
                border-top: 1px solid #cbd5e1;
                border-bottom: 1px solid #cbd5e1;
                padding: 6px 4px; 
                text-align: center; 
                font-weight: 700;
                vertical-align: middle;
            }
            .th-content {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                line-height: 1.2;
            }
            .th-ko { font-size: 11px; font-weight: 800; color: #1e293b; }
            .th-en { font-size: 10px; font-weight: 600; color: #64748b; margin-top: 1px; }

            td { 
                border-bottom: 1px solid #e2e8f0; 
                padding: 6px 4px; 
                vertical-align: middle;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            }

            .text-center { text-align: center; }
            .text-right { text-align: right; }
            .font-mono { font-family: monospace; letter-spacing: -0.5px; }
            .font-bold { font-weight: 700; }
            
            /* Columns - Matching Cart.tsx proportions roughly */
            /* Total width ~100% */
            .col-no { width: 5%; }
            .col-item { width: 15%; text-align: center; } /* Name */
            .col-spec { width: 7%; } /* Thickness */
            .col-size { width: 12%; } /* Size */
            .col-mat { width: 12%; } /* Material */
            .col-stock { width: 9%; } /* Stock */
            .col-status { width: 9%; } /* Status */
            .col-loc { width: 10%; } /* Location */
            .col-qty { width: 7%; } /* Qty */
            .col-price { width: 8%; } /* Price */
            .col-amt { width: 8%; } /* Amount */

            /* Footer Layout */
            .footer-wrapper {
                display: flex; 
                justify-content: space-between; 
                align-items: flex-start; /* Align top due to potential multiline text */
                margin-top: 10px; 
                border-top: 2px solid ${colorTheme};
                padding-top: 10px;
            }

            .delivery-section {
                text-align: left;
                font-size: 10px; 
                color: #333;
                line-height: 1.4;
                max-width: 65%;
            }
            .delivery-title { font-weight: 800; color: ${colorTheme}; margin-bottom: 2px; display: block; }
            .delivery-content { color: #555; white-space: pre-wrap; }

            .totals-section {
                text-align: right;
                flex: 1;
            }
            .total-row { display: flex; justify-content: flex-end; align-items: center; gap: 15px; font-size: 13px; margin-top: 5px; }
            .big-total { font-size: 16px; font-weight: 800; color: ${colorTheme}; }

            .disclaimer { margin-top: 20px; font-size: 9px; color: #888; text-align: center; line-height: 1.5; }

            .signature-block {
                margin-top: 30px; /* Reduced space */
                display: flex;
                justify-content: space-around;
                text-align: center;
                opacity: 0.7; /* Make it less prominent */
                transform: scale(0.9);
            }
            .sig-box { width: 35%; display: flex; flex-direction: column; align-items: center; font-size: 10px; }
            .sig-line { width: 100%; border-top: 1px solid #ddd; margin: 2px 0 5px 0; }
            .signature-text {
                font-family: 'Caveat', 'Nanum Brush Script', cursive;
                font-size: 28px;
                color: #1e293b;
                margin-bottom: 0px;
                line-height: 1.2;
            }
            
            @media print {
                body { -webkit-print-color-adjust: exact; }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <header>
                <div class="brand">ALT.F</div>
                <div class="doc-title">
                    <h1>${title}</h1>
                    <p>No. ${meta.doc_no} | Date. ${meta.created_at}</p>
                </div>
            </header>

            <div class="info-grid">
                <div class="box">
                    <h3>공급자 (Supplier)</h3>
                    <div class="row"><span class="label">상호</span><span class="value">${supplier.company_name}</span></div>
                    <div class="row"><span class="label">주소</span><span class="value">${supplier.address}</span></div>
                    <div class="row"><span class="label">담당자</span><span class="value">-</span></div>
                    <div class="row"><span class="label">연락처</span><span class="value">${supplier.tel} / ${supplier.email}</span></div>
                </div>
                <div class="box">
                    <h3>공급받는자 (Customer)</h3>
                    <div class="row"><span class="label">상호</span><span class="value">${customer.company_name || '-'}</span></div>
                    <div class="row"><span class="label">주소</span><span class="value">${customer.address || '-'}</span></div>
                    <div class="row"><span class="label">담당자</span><span class="value">${customer.contact_name || '-'}</span></div>
                    <div class="row"><span class="label">연락처</span><span class="value">${customer.tel || '-'} / ${customer.email || '-'}</span></div>
                </div>
            </div>

            <table>
                <colgroup>
                    <col class="col-no">
                    <col class="col-item">
                    <col class="col-spec">
                    <col class="col-size">
                    <col class="col-mat">
                    <col class="col-stock">
                    <col class="col-status">
                    <col class="col-loc">
                    <col class="col-qty">
                    <col class="col-price">
                    <col class="col-amt">
                </colgroup>
                <thead>
                    <tr>
                        <th>No</th>
                        <th><div class="th-content"><span class="th-ko">품명</span><span class="th-en">ITEM</span></div></th>
                        <th><div class="th-content"><span class="th-ko">두께</span><span class="th-en">THK</span></div></th>
                        <th><div class="th-content"><span class="th-ko">규격</span><span class="th-en">SIZE</span></div></th>
                        <th><div class="th-content"><span class="th-ko">재질</span><span class="th-en">MATERIAL</span></div></th>
                        <th><div class="th-content"><span class="th-ko">재고</span><span class="th-en">STOCK</span></div></th>
                        <th><div class="th-content"><span class="th-ko">상태</span><span class="th-en">STAT</span></div></th>
                        <th><div class="th-content"><span class="th-ko">위치</span><span class="th-en">LOC</span></div></th>
                        <th><div class="th-content"><span class="th-ko">수량</span><span class="th-en">QTY</span></div></th>
                        <th><div class="th-content"><span class="th-ko">단가</span><span class="th-en">PRICE</span></div></th>
                        <th><div class="th-content"><span class="th-ko">금액</span><span class="th-en">AMT</span></div></th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map(item => `
                    <tr>
                        <td class="text-center">${item.no}</td>
                        <td class="text-center" key="${item.item_name}">${item.item_name}</td>
                        <td class="text-center">${item.thickness}</td>
                        <td class="text-center">${item.size}</td>
                        <td class="text-center">${item.material}</td>
                        <td class="text-center font-mono">${item.stock_qty.toLocaleString()}</td>
                        <td class="text-center">${item.stock_status}</td>
                        <td class="text-center">${item.location_maker || '-'}</td>
                        <td class="text-center font-bold">${item.qty}</td>
                        <td class="text-right font-mono">${formatCurrency(item.unit_price)}</td>
                        <td class="text-right font-mono font-bold">${formatCurrency(item.amount)}</td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>

            <div class="footer-wrapper">
                <div class="delivery-section">
                    ${customer.memo ? `
                        <span class="delivery-title">물건 받으실 방법 (Delivery Request)</span>
                        <div class="delivery-content">${customer.memo}</div>
                    ` : ''}
                </div>
                <div class="totals-section">
                    <div class="total-row">
                        <span>총 합계금액 (부가세 제외)</span>
                        <span class="big-total">${formatCurrency(totals.total_amount)}</span>
                    </div>
                </div>
            </div>

            <div class="disclaimer">
                ${(() => {
            const hasStockIssue = items.some(item => item.stock_status === '재고없음' || item.stock_status === '일부 주문생산');
            const warningMessage = '<span style="color:#e11d48; font-weight:bold;">재고없는 품목 또는 일부 주문생산 품목은 담당자가 납기를 확인하고 즉시 답변드리겠습니다.</span>';

            if (isOrder) {
                return hasStockIssue
                    ? `본 주문서는 정식 주문 확정 문서입니다.<br>${warningMessage}`
                    : '본 주문서는 정식 주문 확정 문서입니다.<br><span style="font-weight:bold; color:#0f766e;">감사합니다. 담당자가 출고일정을 확인하고 연락드릴 수 있도록 하겠습니다.</span>';
            } else {
                // Quotation
                return hasStockIssue
                    ? `본 견적서는 현재 시점의 재고 및 단가 기준이며, 실제 주문 시점에 변동될 수 있습니다.<br>${warningMessage}`
                    : '본 견적서는 현재 시점의 재고 및 단가 기준이며, 실제 주문 시점에 변동될 수 있습니다.<br>유효기간: 견적일로부터 3일';
            }
        })()}
            </div>

            ${isOrder ? `
            <div class="signature-block">
                <div class="sig-box">
                    <p class="signature-text">${customer.contact_name || ''}</p>
                    <div class="sig-line"></div>
                    <p>주문자 (Customer)</p>
                    <br>
                    <p style="font-weight:bold; font-size: 12px; margin-top: -10px;">${customer.company_name || ''}</p>
                </div>
                <div class="sig-box">
                    <p class="signature-text">Alternative Future</p>
                    <div class="sig-line"></div>
                    <p>공급자 (Supplier)</p>
                    <br>
                    <p style="font-weight:bold; font-size: 12px; margin-top: -10px;">알트에프(ALTF)</p>
                </div>
            </div>
            ` : ''}

        </div>
    </body>
    </html>
    `;
};
