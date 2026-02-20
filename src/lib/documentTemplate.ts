import type { DocumentPayload } from '../types/document';
import { formatCurrency } from './utils';

export const renderDocumentHTML = (payload: DocumentPayload): string => {
    const { document_type, meta, supplier, customer, items, totals, footer } = payload;

    // Unified Template Logic
    const isPurchaseOrder = document_type === 'PURCHASE_ORDER';
    const isTransaction = document_type === 'TRANSACTION';
    const isOrder = document_type === 'ORDER' || isPurchaseOrder || document_type === 'ORDER_RECEIPT' || isTransaction;

    let title = '견적서 (QUOTATION)';
    if (document_type === 'ORDER') title = '주문서 (ORDER SHEET)';
    if (document_type === 'PURCHASE_ORDER') title = '발주서 (PURCHASE ORDER)';
    if (document_type === 'ORDER_RECEIPT') title = '발주 접수증 (ORDER RECEIPT)';
    if (document_type === 'TRANSACTION') title = '거래명세서 (TRANSACTION STATEMENT)';

    // Theme Color (Indigo for PO, Slate for others)
    const colorTheme = isPurchaseOrder ? '#312e81' : (isTransaction ? '#0f766e' : '#1e293b');


    return `
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
                padding: 20px; /* Mobile Friendly Padding */
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact; 
                background-color: #f8fafc; /* Light gray background for screen */
            }

            .container { 
                width: 100%; 
                max-width: 210mm; 
                margin: 0 auto; 
                background-color: white;
                padding: 40px;
                box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
            }

            /* Controls for Tablet/Screen */
            .screen-controls {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                background: rgba(255, 255, 255, 0.9);
                backdrop-filter: blur(8px);
                padding: 12px 20px;
                display: flex;
                justify-content: flex-end;
                gap: 10px;
                border-bottom: 1px solid #e2e8f0;
                z-index: 1000;
                box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
            }

            .btn {
                padding: 8px 16px;
                border-radius: 6px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                border: none;
                transition: all 0.2s;
            }

            .btn-print {
                background-color: ${colorTheme};
                color: white;
            }
            .btn-print:hover { opacity: 0.9; }

            .btn-close {
                background-color: #f1f5f9;
                color: #475569;
            }
            .btn-close:hover { background-color: #e2e8f0; }

            /* Header */
            header {
                display: flex;
                justify-content: space-between;
                align-items: flex-end;
                border-bottom: 3px solid ${colorTheme};
                padding-bottom: 12px;
                margin-bottom: 20px;
            }
            .brand { font-size: 24px; font-weight: 800; color: ${colorTheme}; letter-spacing: -1px; }
            .doc-title { text-align: right; }
            .doc-title h1 { margin: 0; font-size: 24px; font-weight: 800; color: ${colorTheme}; }
            .doc-title p { margin: 4px 0 0 0; font-size: 11px; color: #666; }

            /* Info Block */
            .info-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 20px;
                margin-bottom: 20px;
                align-items: stretch;
            }
            .box { border: 1px solid #ddd; padding: 12px; border-radius: 4px; }
            .box h3 { margin: 0 0 10px 0; font-size: 13px; font-weight: 700; color: ${colorTheme}; border-bottom: 1px solid #eee; padding-bottom: 6px; }
            .row { display: flex; margin-bottom: 6px; }
            .label { width: 80px; color: #666; font-weight: 600; }
            .value { flex: 1; font-weight: 500; }

            /* Items Table */
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; table-layout: fixed; font-size: 10px; }
            thead { display: table-header-group; }
            tfoot { display: table-footer-group; }
            tr { page-break-inside: avoid; }
            
            th { 
                background-color: #f8fafc;
                color: #334155; 
                border-top: 2px solid #cbd5e1;
                border-bottom: 1px solid #cbd5e1;
                padding: 8px 4px;
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
            .th-en { font-size: 10px; font-weight: 600; color: #64748b; margin-top: 2px; }

            td { 
                border-bottom: 1px solid #e2e8f0; 
                padding: 8px 4px;
                vertical-align: middle;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            }

            .text-center { text-align: center; }
            .text-right { text-align: right; } 
            .font-mono { font-family: monospace; letter-spacing: -0.5px; }
            .font-bold { font-weight: 700; }
            
            /* Columns */
            .col-no { width: 3%; text-align: center; }
            .col-item { width: 10%; text-align: center; }
            .col-spec { width: 6%; text-align: center; }
            .col-size { width: 11%; text-align: center; }
            .col-mat { width: 11%; text-align: center; }
            
            .col-stock { width: 8%; text-align: center; } 
            .col-status { width: 10%; text-align: center; } 
            .col-loc { width: 8%; text-align: center; }
            
            .col-qty { width: 5%; text-align: center; } 
            
            .col-price { width: 11%; text-align: right; padding-right: 5px; }
            .col-amt { width: 14%; text-align: right; padding-right: 5px; }

            /* Footer Layout */
            .footer-wrapper {
                display: flex; 
                justify-content: space-between; 
                align-items: flex-start;
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
                margin-top: 30px;
                display: flex;
                justify-content: space-around;
                text-align: center;
                opacity: 0.7;
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
                body { 
                    -webkit-print-color-adjust: exact; 
                    padding: 0;
                    margin: 0;
                    background-color: white;
                }
                .container {
                    width: 100%;
                    max-width: none;
                    margin: 0;
                    padding: 0;
                    box-shadow: none;
                }
                .no-print { display: none !important; }
                .screen-controls { display: none !important; }
                @page { margin: 10mm; }
            }
        </style>
    </head>
    <body>
        <!-- Screen Controls -->
        <div class="screen-controls">
            <button onclick="window.print()" class="btn btn-print">인쇄하기 (Print)</button>
            <button onclick="window.close()" class="btn btn-close">닫기 (Close)</button>
        </div>



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
                    <div class="row"><span class="label">담당자</span><span class="value">${supplier.contact_name || '-'}</span></div>
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
                    ${isTransaction ? `
                    <col style="width: 5%">
                    <col style="width: 20%">
                    <col style="width: 10%">
                    <col style="width: 12%">
                    <col style="width: 15%">
                    <col style="width: 8%">
                    <col style="width: 15%">
                    <col style="width: 15%">
                    ` : `
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
                    `}
                </colgroup>
                <thead>
                    <tr>
                        <th>No</th>
                        <th class="col-item">품명<br><span class="sub-text">ITEM</span></th>
                        <th class="col-spec">두께<br><span class="sub-text">THK</span></th>
                        <th class="col-size">규격<br><span class="sub-text">SIZE</span></th>
                        <th class="col-mat">재질<br><span class="sub-text">MATERIAL</span></th>
                        ${!isTransaction ? `
                        <th class="col-stock">재고<br><span class="sub-text">STOCK</span></th>
                        <th class="col-status">상태<br><span class="sub-text">STAT</span></th>
                        <th class="col-loc">위치<br><span class="sub-text">LOC</span></th>
                        ` : ''}
                        <th class="col-qty">수량<br><span class="sub-text">QTY</span></th>
                        <th class="col-price">단가<br><span class="sub-text">PRICE</span></th>
                        <th class="col-amt">금액<br><span class="sub-text">AMT</span></th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map(item => `
                    <tr>
                        <td class="text-center">${item.no}</td>
                        <td class="col-item">${item.item_name}</td>
                        <td class="col-spec">${item.thickness || '-'}</td>
                        <td class="col-size">${item.size || '-'}</td>
                        <td class="col-mat">${item.material || '-'}</td>
                        ${!isTransaction ? `
                        <td class="col-stock">${item.stock_qty !== undefined ? item.stock_qty.toLocaleString() : '-'}</td>
                        <td class="col-status">${item.stock_status || '-'}</td>
                        <td class="col-loc">${item.location_maker || '-'}</td>
                        ` : ''}
                        <td class="col-qty">${item.qty}</td>
                        <td class="col-price text-right">${formatCurrency(item.unit_price)}</td>
                        <td class="col-amt text-right">${formatCurrency(item.amount)}</td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>

            <div class="footer-wrapper">
                <div class="delivery-section">
                ${isPurchaseOrder ? `
                    ${customer.memo ? `
                        <div style="margin-bottom: 12px;">
                            <span class="delivery-title">배송 요청사항 (Delivery Request)</span>
                            <div class="delivery-content">${customer.memo}</div>
                        </div>
                    ` : ''}
                     ${supplier.note ? `
                        <div style="margin-bottom: 12px; padding: 8px; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 4px;">
                            <span class="delivery-title" style="color:#15803d;">비고 (Note)</span>
                            <div class="delivery-content" style="white-space: pre-wrap; color: #166534;">${supplier.note}</div>
                        </div>
                    ` : ''}
                ` : `
                    ${(() => {
            // Estimated Delivery Logic
            // [MOD] Hide Estimated Delivery if Confirmed Delivery exists
            if (meta.delivery_date) return '';

            let deliveryText = '당일~1일내 출고 가능'; // Default (Available/Marking Wait)
            const hasOutOfStock = items.some(i => i.stock_status?.includes('재고없음'));
            const hasPartialCheck = items.some(i => i.stock_status?.includes('일부 주문생산'));

            if (hasOutOfStock) {
                deliveryText = '25~30일 이내';
            } else if (hasPartialCheck) {
                deliveryText = '15~20일 이내';
            }

            return `
                            <div style="margin-bottom: 12px;">
                                <span class="delivery-title">예상 납기 (Est. Delivery)</span>
                                <div class="delivery-content" style="font-weight:700; color:#1e293b;">${deliveryText}</div>
                            </div>
                        `;
        })()}
                    ${meta.delivery_date ? `
                            <div style="margin-bottom: 12px;">
                                <span class="delivery-title" style="color:#0f766e;">확정 납기 (Confirmed Delivery)</span>
                                <div class="delivery-content" style="font-weight:800; color:#0f766e; font-size: 14px;">
                                    ${new Date(meta.delivery_date).toLocaleDateString()}
                                </div>
                            </div>
                    ` : ''}

                    ${supplier.note ? `
                        <div style="margin-bottom: 12px; padding: 8px; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 4px;">
                            <span class="delivery-title" style="color:#15803d;">관리자 답변 (Supplier Note)</span>
                            <div class="delivery-content" style="white-space: pre-wrap; color: #166534;">${supplier.note}</div>
                        </div>
                    ` : ''}

                    ${customer.memo ? `
                        <span class="delivery-title">${isOrder ? '물건 받으실 방법 (Delivery Request)' : '문의 및 요청사항 (Inquiries & Requests)'}</span>
                        <div class="delivery-content">${customer.memo}</div>
                    ` : ''}
                `}
                </div>

                <div class="totals-section">
                    ${totals.additional_charges ? totals.additional_charges.map(charge => `
                    <div class="total-row" style="font-size: 11px; color: #555;">
                        <span>${charge.name}</span>
                        <span style="font-weight: 600;">${formatCurrency(charge.amount)}</span>
                    </div>
                    `).join('') : ''}
                    <div class="total-row" style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed #ddd;">
                        ${isTransaction && totals.vat_amount !== undefined ? `
                            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:5px; width:100%;">
                                <div style="display:flex; gap:15px; font-size:12px; color:#555;">
                                    <span>공급가액 (Supply Price)</span>
                        <span>${formatCurrency((totals.final_amount ?? 0) - (totals.vat_amount ?? 0))}</span>
                                </div>
                                ${totals.global_discount_rate ? `
                                <div style="display:flex; gap:15px; font-size:12px; color:#e11d48;">
                                    <span>전체 할인 (Discount ${totals.global_discount_rate}%)</span>
                                    <span>-${formatCurrency(totals.global_discount_amount ?? 0)}</span>
                                </div>
                                ` : ''}
                                <div style="display:flex; gap:15px; font-size:12px; color:#555;">
                                    <span>부가세 (VAT 10%)</span>
                                    <span>${formatCurrency(totals.vat_amount ?? 0)}</span>
                                </div>
                                <div style="display:flex; gap:15px; align-items:center; margin-top:5px;">
                                    <span style="font-weight:700;">총 합계금액 (Total)</span>
                                    <span class="big-total">${formatCurrency(totals.final_amount ?? 0)}</span>
                                </div>
                            </div>
                        ` : `
                            <span>총 합계금액 (부가세 제외)</span>
                            <span class="big-total">${formatCurrency(totals.total_amount)}</span>
                        `}
                    </div>
                </div>
            </div>

            <div class="disclaimer">
                ${isPurchaseOrder
            ? '재고 부족품이 있는경우, 납기 확인하셔서 연락부탁드립니다.'
            : isTransaction
                ? '' // [MOD] No disclaimer for Transaction Statement
                : isOrder
                    ? '본 주문서는 정식 주문 확정 문서입니다.<br><span style="color:#e11d48; font-weight:bold;">재고 부족 품목이 있는 경우, 담당자가 확인 후 연락드리겠습니다.</span>'
                    : '본 견적서는 현재 시점의 재고 및 단가 기준이며, 실제 주문 시점에 변동될 수 있습니다.<br>유효기간: 견적일로부터 3일<br><span style="color:#e11d48; font-weight:bold;">요청사항에 문의 남겨주시면, 담당자가 10분이내에 연락 드릴 수 있도록 하겠습니다.</span>'}
            </div>

            ${footer ? `
            <div class="footer-extra" style="margin-top: 15px; border-top: 1px dotted #ddd; padding-top: 10px;">
                ${footer.message ? `<p style="font-size: 10px; color: #555; text-align: center; margin-bottom: 5px;">${footer.message}</p>` : ''}
                ${footer.terms && footer.terms.length > 0 ? `
                <ul style="font-size: 9px; color: #777; padding-left: 20px; text-align: left;">
                    ${footer.terms.map(term => `<li>${term}</li>`).join('')}
                </ul>
                ` : ''}
            </div>
            ` : ''}

            ${isOrder && !isPurchaseOrder && !isTransaction ? `
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
