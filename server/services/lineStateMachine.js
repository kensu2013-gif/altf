/**
 * 0-C. 주문 라인 경로(S/D/M)·상태·연결키 상태 전이 엔진 (Line State Machine)
 * 
 * - 경로: S (시화 재고), D (대경 직송), M (대경/외주 제작)
 * - 라인 상태: RECEIVED -> CONFIRMED -> ROUTED -> [S or D/M Branch] -> STATEMENT/CERT -> PACKAGED -> SENT -> SETTLED
 * - 비정상 상태 전이 원천 차단 및 감사 이벤트(Audit Log) 기록
 * - 운임, DC 등 비품목 라인 판별 (isNonProductLine, certRequired: false)
 * - 전 라인 출고/발송 완료 검증 (isOrderFullySettled)
 */

export const ROUTES = {
    S: 'S', // 시화 재고
    D: 'D', // 대경 직송
    M: 'M'  // 대경/외주 제작
};

export const ROUTE_LABELS = {
    S: '시화재고',
    D: '대경직송',
    M: '주문제작'
};

export const LINE_STATUSES = [
    'RECEIVED',
    'CONFIRMED',
    'ROUTED',
    // S Branch
    'PICK_REQUESTED',
    'PACKED',
    'MES_SHIPPED',
    // D/M Branch
    'SUPPLIER_PO_SENT',
    'SUPPLIER_CONFIRMED',
    'IN_PRODUCTION',
    'DIRECT_SHIPPED',
    // Tail Branch
    'STATEMENT_READY',
    'CERT_READY',
    'PACKAGED',
    'SENT',
    'SETTLED'
];

export const STATUS_LABELS = {
    RECEIVED: '접수완료',
    CONFIRMED: '주문확인',
    ROUTED: '경로확정',
    PICK_REQUESTED: '출고요청',
    PACKED: '포장완료',
    MES_SHIPPED: 'MES출고완료',
    SUPPLIER_PO_SENT: '매입발주완료',
    SUPPLIER_CONFIRMED: '매입확인',
    IN_PRODUCTION: '제작중',
    DIRECT_SHIPPED: '직송출고완료',
    STATEMENT_READY: '명세표준비',
    CERT_READY: '성적서준비',
    PACKAGED: '패키징완료',
    SENT: '발송완료',
    SETTLED: '정산종료'
};

/**
 * 상태 전이 허용 테이블 (State Transition Graph)
 */
const TRANSITION_MAP = {
    RECEIVED: ['CONFIRMED'],
    CONFIRMED: ['ROUTED'],
    ROUTED: {
        S: ['PICK_REQUESTED'],
        D: ['SUPPLIER_PO_SENT'],
        M: ['SUPPLIER_PO_SENT']
    },
    // S Branch
    PICK_REQUESTED: ['PACKED'],
    PACKED: ['MES_SHIPPED'],
    MES_SHIPPED: ['STATEMENT_READY', 'CERT_READY', 'PACKAGED'],
    // D/M Branch
    SUPPLIER_PO_SENT: ['SUPPLIER_CONFIRMED'],
    SUPPLIER_CONFIRMED: {
        D: ['DIRECT_SHIPPED'],
        M: ['IN_PRODUCTION', 'DIRECT_SHIPPED']
    },
    IN_PRODUCTION: ['DIRECT_SHIPPED'],
    DIRECT_SHIPPED: ['STATEMENT_READY', 'CERT_READY', 'PACKAGED'],
    // Tail Branch (명세표/성적서 준비 -> 서류 패키징 -> 발송 -> 정산)
    STATEMENT_READY: ['CERT_READY', 'PACKAGED'],
    CERT_READY: ['STATEMENT_READY', 'PACKAGED'],
    PACKAGED: ['SENT'],
    SENT: ['SETTLED'],
    SETTLED: []
};

/**
 * 상태 전이 가능 여부 및 사유 검증
 * @param {string} currentStatus 
 * @param {string} nextStatus 
 * @param {string|null} route ('S' | 'D' | 'M' | null)
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function canTransition(currentStatus, nextStatus, route = null) {
    if (!currentStatus) currentStatus = 'RECEIVED';
    if (currentStatus === nextStatus) {
        return { allowed: true }; // 동일 상태는 변경 없음 허용
    }

    if (!LINE_STATUSES.includes(nextStatus)) {
        return { allowed: false, reason: `알 수 없는 다음 상태입니다: "${nextStatus}"` };
    }

    const transitions = TRANSITION_MAP[currentStatus];
    if (!transitions) {
        return { allowed: false, reason: `현재 상태 "${currentStatus}"에서는 다음 단계로 이동할 수 없습니다.` };
    }

    let allowedNextList = [];

    if (Array.isArray(transitions)) {
        allowedNextList = transitions;
    } else if (typeof transitions === 'object') {
        // 경로별 분기 상태 (e.g. ROUTED, SUPPLIER_CONFIRMED)
        if (!route) {
            return {
                allowed: false,
                reason: `경로(S/D/M)가 지정되지 않아 상태 전이를 수행할 수 없습니다. (현재: ${currentStatus})`
            };
        }
        allowedNextList = transitions[route] || [];
        if (allowedNextList.length === 0) {
            return {
                allowed: false,
                reason: `경로 "${route}"에서는 현재 상태 "${currentStatus}"의 전이 규칙이 정의되어 있지 않습니다.`
            };
        }
    }

    if (allowedNextList.includes(nextStatus)) {
        return { allowed: true };
    }

    return {
        allowed: false,
        reason: `상태 전이 불가: [${currentStatus}] -> [${nextStatus}] (경로: ${route || '미지정'}). 허용된 다음 상태: [${allowedNextList.join(', ')}]`
    };
}

/**
 * 상태 전이 가능 여부 (Boolean)
 */
export function isValidTransition(currentStatus, nextStatus, route = null) {
    return canTransition(currentStatus, nextStatus, route).allowed;
}

/**
 * 운임, 할인(DC), 네고 등 비품목 라인 판별
 * @param {object} item 
 * @returns {boolean}
 */
export function isNonProductLine(item) {
    if (!item) return true;
    const name = String(item.name || item.item_name || item.description || '').trim();
    if (!name) return true;

    // 운임, 배송비, 택배, 할인, DC, 네고 등 키워드 감지
    const nonProductPattern = /(운임|배송비|운송비|화물|택배|할인|DC|D\/C|네고|기타비용|착불|선불|에누리|보정)/i;
    return nonProductPattern.test(name);
}

/**
 * 품목 라인에 0-C 기본 스키마 주입 및 보정
 * @param {object} item 
 * @param {number} index 
 * @param {string|null} defaultRoute 
 * @returns {object}
 */
export function initLineSchema(item, index = 0, defaultRoute = null) {
    const isNonProd = isNonProductLine(item);
    return {
        ...item,
        lineId: item.lineId || item.id || `line-${index + 1}`,
        route: item.route || defaultRoute || null,
        routeConfirmedBy: item.routeConfirmedBy || null,
        lineStatus: item.lineStatus || 'RECEIVED',
        certRequired: item.certRequired !== undefined ? item.certRequired : !isNonProd,
        keys: {
            customerPoNo: item.keys?.customerPoNo || null,
            supplierPoNo: item.keys?.supplierPoNo || null,
            supplierStatementNo: item.keys?.supplierStatementNo || null,
            mesOutboundNo: item.keys?.mesOutboundNo || null,
            lotNo: item.keys?.lotNo || null,
            heatNo: item.keys?.heatNo || null,
            certId: item.keys?.certId || null,
            shipmentId: item.keys?.shipmentId || null,
            ...(item.keys || {})
        }
    };
}

/**
 * 주문 전체 종결 여부 확인
 * 조건: 모든 필수 성적서/품목 라인(certRequired !== false)이 'SENT' 또는 'SETTLED' 상태인지 검사
 * @param {object} order 
 * @returns {boolean}
 */
export function isOrderFullySettled(order) {
    if (!order) return false;
    const items = Array.isArray(order.items) ? order.items : (order.payload?.items || []);
    if (!items || items.length === 0) return true;

    const productLines = items.filter(i => i.certRequired !== false && !isNonProductLine(i));
    if (productLines.length === 0) return true;

    return productLines.every(line => line.lineStatus === 'SENT' || line.lineStatus === 'SETTLED');
}

/**
 * 주문 내 라인 상태 전이 및 감사 로그 기록
 * @param {object} order 
 * @param {string} lineId 
 * @param {string} nextStatus 
 * @param {object} options { actor, route, keys, detail }
 * @returns {{ success: boolean, updatedLine: object, isOrderSettled: boolean }}
 */
export function transitionLine(order, lineId, nextStatus, options = {}) {
    if (!order) {
        throw new Error('주문 객체(order)가 제공되지 않았습니다.');
    }

    const items = Array.isArray(order.items) ? order.items : (order.payload?.items || []);
    const line = items.find(i => (i.lineId && i.lineId === lineId) || (i.id && i.id === lineId) || String(i.itemNo) === String(lineId));

    if (!line) {
        throw new Error(`주문(${order.id || order.poNumber}) 내에서 라인 ID "${lineId}"를 찾을 수 없습니다.`);
    }

    // 기본 스키마 보정
    if (!line.lineStatus) line.lineStatus = 'RECEIVED';
    if (!line.keys) line.keys = {};

    const effectiveRoute = options.route !== undefined ? options.route : (line.route || null);
    const check = canTransition(line.lineStatus, nextStatus, effectiveRoute);

    if (!check.allowed) {
        throw new Error(`[상태 전이 실패] ${check.reason}`);
    }

    const prevStatus = line.lineStatus;
    line.lineStatus = nextStatus;

    if (options.route !== undefined) {
        line.route = options.route;
        if (options.actor) {
            line.routeConfirmedBy = {
                name: options.actor,
                at: new Date().toISOString()
            };
        }
    }

    if (options.keys) {
        line.keys = { ...line.keys, ...options.keys };
    }

    // 감사 이벤트 기록
    if (!order.events) order.events = [];
    order.events.push({
        at: new Date().toISOString(),
        actor: options.actor || 'SYSTEM',
        type: 'LINE_STATUS_TRANSITION',
        lineIds: [line.lineId || line.id || lineId],
        detail: {
            prevStatus,
            nextStatus,
            route: line.route,
            lineName: line.name || line.item_name,
            ...(options.detail || {})
        }
    });

    order.updatedAt = new Date().toISOString();

    return {
        success: true,
        orderId: order.id || order.poNumber,
        lineId: line.lineId || lineId,
        updatedLine: line,
        isOrderSettled: isOrderFullySettled(order)
    };
}
