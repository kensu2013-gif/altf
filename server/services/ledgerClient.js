/**
 * 🏛️ ALTF Single Source of Truth Ledger Client (단일 원장 클라이언트)
 * 
 * [0-B 원칙 준수]:
 * 1. 봇/에이전트는 절대로 db.json이나 S3를 직접 overwrite하지 않습니다.
 * 2. 모든 상태 전이, 라인 수정, 출고 이벤트는 ledgerClient를 통해서만 수행합니다.
 * 3. 동일 프로세스 내에서는 Internal DB(updateDb)를 직접 사용하여 트랜잭션과 실시간성을 보장하고,
 *    외부 프로세스(워커, 스크립트)에서는 HTTP REST API (/api/agent/orders) 및 서비스 토큰을 사용합니다.
 */

import http from 'http';
import { canTransition, isOrderFullySettled } from './lineStateMachine.js';

const AGENT_SERVICE_TOKEN = process.env.AGENT_SERVICE_TOKEN || 'altf-agent-token-2026-secure';
const API_PORT = process.env.PORT || 3001;

class LedgerClient {
    constructor() {
        this.internalContext = null; // { db, updateDb } when running inside local-api-server.js
        this.apiBaseUrl = `http://localhost:${API_PORT}`;
        this.serviceToken = AGENT_SERVICE_TOKEN;
    }

    /**
     * 동일 Node.js 프로세스(local-api-server) 내부에서 db 객체와 updateDb 함수를 주입
     */
    bindInternalContext(context) {
        this.internalContext = context;
        console.log('🏛️ [LedgerClient] Internal memory-mapped database context bound.');
    }

    get isInternal() {
        return Boolean(this.internalContext && this.internalContext.db && typeof this.internalContext.updateDb === 'function');
    }

    /**
     * HTTP 요청 헬퍼 (외부 워커/스크립트용)
     */
    async _request(method, path, body = null) {
        return new Promise((resolve, reject) => {
            const url = new URL(path, this.apiBaseUrl);
            const headers = {
                'x-agent-service-token': this.serviceToken,
                'Content-Type': 'application/json'
            };

            const req = http.request(url, { method, headers }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data || '{}');
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(parsed);
                        } else {
                            reject(new Error(parsed.error || `HTTP ${res.statusCode}: ${data}`));
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse response: ${e.message} (Data: ${data})`));
                    }
                });
            });

            req.on('error', (err) => reject(err));
            if (body) {
                req.write(JSON.stringify(body));
            }
            req.end();
        });
    }

    /**
     * 주문 목록 조회
     */
    async getOrders(filter = {}) {
        if (this.isInternal) {
            let orders = this.internalContext.db.orders || [];
            if (filter.status) {
                orders = orders.filter(o => o.status === filter.status);
            }
            if (filter.customerName) {
                const q = filter.customerName.toLowerCase();
                orders = orders.filter(o => (o.customerName || '').toLowerCase().includes(q));
            }
            if (filter.limit) {
                orders = orders.slice(0, Number(filter.limit));
            }
            return orders;
        }

        const queryParams = new URLSearchParams(filter).toString();
        const path = `/api/agent/orders${queryParams ? `?${queryParams}` : ''}`;
        return await this._request('GET', path);
    }

    /**
     * 단일 주문 상세 조회
     */
    async getOrder(orderId) {
        if (this.isInternal) {
            const orders = this.internalContext.db.orders || [];
            const found = orders.find(o => o.id === orderId || o.poNumber === orderId);
            return found || null;
        }

        return await this._request('GET', `/api/agent/orders/${encodeURIComponent(orderId)}`);
    }

    /**
     * 신규 주문 등록
     */
    async createOrder(orderData) {
        if (this.isInternal) {
            return await this.internalContext.updateDb(() => {
                if (!this.internalContext.db.orders) this.internalContext.db.orders = [];
                const order = {
                    id: orderData.id || `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
                    createdAt: orderData.createdAt || new Date().toISOString(),
                    events: orderData.events || [
                        {
                            timestamp: new Date().toISOString(),
                            agentId: orderData.agentId || 'SYSTEM',
                            eventType: 'ORDER_CREATED',
                            note: '주문 단일 원장 신규 등록'
                        }
                    ],
                    ...orderData
                };
                this.internalContext.db.orders.unshift(order);
                return order;
            });
        }

        return await this._request('POST', '/api/agent/orders', orderData);
    }

    /**
     * 주문 라인 단위 부분 수정 (S/D/M 경로, 상태, LOT, 성적서 키 등)
     */
    async updateOrderLine(orderId, lineId, updates, meta = {}) {
        if (this.isInternal) {
            return await this.internalContext.updateDb(() => {
                const orders = this.internalContext.db.orders || [];
                const order = orders.find(o => o.id === orderId || o.poNumber === orderId);
                if (!order) {
                    throw new Error(`Order not found: ${orderId}`);
                }

                // items[] 또는 payload.items[] 탐색
                let line = null;
                if (Array.isArray(order.items)) {
                    line = order.items.find(i => (i.lineId && i.lineId === lineId) || (i.id && i.id === lineId) || String(i.itemNo) === String(lineId));
                }
                if (!line && order.payload && Array.isArray(order.payload.items)) {
                    line = order.payload.items.find(i => (i.lineId && i.lineId === lineId) || (i.id && i.id === lineId) || String(i.itemNo) === String(lineId));
                }

                if (!line) {
                    throw new Error(`Order line not found: ${lineId} in order ${orderId}`);
                }

                // 0-C. 상태 전이 검증 (lineStatus 변경 시)
                if (updates.lineStatus) {
                    const currentStatus = line.lineStatus || 'RECEIVED';
                    const effectiveRoute = updates.route !== undefined ? updates.route : (line.route || null);
                    const check = canTransition(currentStatus, updates.lineStatus, effectiveRoute);
                    if (!check.allowed) {
                        throw new Error(`[상태 전이 실패] ${check.reason}`);
                    }
                }

                // keys 병합
                if (updates.keys) {
                    line.keys = { ...(line.keys || {}), ...updates.keys };
                    delete updates.keys;
                }

                // 라인 업데이트 적용
                Object.assign(line, updates, { updatedAt: new Date().toISOString() });

                // 감사 이벤트 자동 기록
                if (!order.events) order.events = [];
                order.events.push({
                    timestamp: new Date().toISOString(),
                    at: new Date().toISOString(),
                    actor: meta.actor || meta.agentId || 'AGENT_LEDGER',
                    agentId: meta.agentId || meta.actor || 'AGENT_LEDGER',
                    eventType: meta.eventType || 'LINE_UPDATED',
                    type: meta.type || meta.eventType || 'LINE_UPDATED',
                    lineIds: [lineId],
                    lineId: lineId,
                    note: meta.note || `품목 라인 정보 업데이트`,
                    changes: updates,
                    detail: {
                        lineStatus: line.lineStatus,
                        route: line.route,
                        ...meta
                    }
                });

                order.updatedAt = new Date().toISOString();
                const settled = isOrderFullySettled(order);
                return { success: true, orderId: order.id, lineId, updatedLine: line, isOrderSettled: settled };
            });
        }

        return await this._request('PATCH', `/api/agent/orders/${encodeURIComponent(orderId)}/lines/${encodeURIComponent(lineId)}`, {
            updates,
            meta
        });
    }

    /**
     * 주문에 감사 이벤트 추가
     */
    async appendOrderEvent(orderId, event) {
        if (this.isInternal) {
            return await this.internalContext.updateDb(() => {
                const orders = this.internalContext.db.orders || [];
                const order = orders.find(o => o.id === orderId || o.poNumber === orderId);
                if (!order) {
                    throw new Error(`Order not found: ${orderId}`);
                }

                if (!order.events) order.events = [];
                const newEvent = {
                    timestamp: new Date().toISOString(),
                    ...event
                };
                order.events.push(newEvent);
                order.updatedAt = new Date().toISOString();
                return { success: true, event: newEvent };
            });
        }

        return await this._request('POST', `/api/agent/orders/${encodeURIComponent(orderId)}/events`, event);
    }
}

export const ledgerClient = new LedgerClient();
