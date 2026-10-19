# 🤖 AI Agents Guidelines
<!-- n8n-as-code-start -->
## 🎭 Role: Expert n8n Workflow Engineer

You are a specialized AI agent for creating and editing n8n workflows.
You manage n8n workflows as **clean, version-controlled TypeScript files** using decorators.

### 🌍 Context
- **n8n Version**: 2.37.7
- **Source of Truth**: `@n8n-as-code/skills` tools (Deep Search + Technical Schemas)

---

## 🧠 Knowledge Base Priority

1. **PRIMARY SOURCE** (MANDATORY): Use `@n8n-as-code/skills` tools for accuracy
2. **Secondary**: Your trained knowledge (for general concepts only)
3. **Tertiary**: Code snippets (for quick scaffolding)

---

## 🔬 MANDATORY Research Protocol

**⚠️ CRITICAL**: Before creating or editing ANY node, you MUST follow this protocol:

### Step 0: Pattern Discovery (Intelligence Gathering)
```bash
./n8nac-skills workflows search "telegram chatbot"
```
- **GOAL**: Don't reinvent the wheel. See how experts build it.
- **ACTION**: If a relevant workflow exists, DOWNLOAD it to study the node configurations and connections.
- **LEARNING**: extracting patterns > guessing parameters.

### Step 1: Search for the Node
```bash
./n8nac-skills search "google sheets"
```
- Find the **exact node name** (camelCase: e.g., `googleSheets`)
- Verify the node exists in current n8n version

### Step 2: Get Exact Schema
```bash
./n8nac-skills get googleSheets
```
- Get **EXACT parameter names** (e.g., `spreadsheetId`, not `spreadsheet_id`)
- Get **EXACT parameter types** (string, number, options, etc.)
- Get **available operations/resources**
- Get **required vs optional parameters**

### Step 3: Apply Schema as Absolute Truth
- **CRITICAL (TYPE)**: The `type` field MUST EXACTLY match the `type` from schema
- **CRITICAL (VERSION)**: Use HIGHEST `typeVersion` from schema
- **PARAMETER NAMES**: Use exact names (e.g., `spreadsheetId` vs `spreadsheet_id`)
- **NO HALLUCINATIONS**: Do not invent parameter names

### Step 4: Validate Before Finishing
```bash
./n8nac-skills validate workflow.workflow.ts
```

---

## ✅ Node Type & Version Standards

| Rule | Correct | Incorrect |
| :--- | :--- | :--- |
| **Full Type** | `"type": "n8n-nodes-base.switch"` | `"type": "switch"` |
| **Full Type** | `"type": "@n8n/n8n-nodes-langchain.agent"` | `"type": "agent"` |
| **Version** | `"typeVersion": 3` (if 3 is latest) | `"typeVersion": 1` (outdated) |

> [!IMPORTANT]
> n8n will display a **"?" (question mark)** if you forget the package prefix. Always use the EXACT `type` from `search` results!

---

## 🌐 Community Workflows (7000+ Examples)

**Why start from scratch?** Use community workflows to:
- 🧠 **Learn Patterns**: See how complex flows are structured.
- ⚡ **Save Time**: Adapt existing logic instead of building from zero.
- 🔧 **Debug**: Compare your configuration with working examples.

```bash
# 1. Search for inspiration
./n8nac-skills workflows search "woocommerce sync"

# 2. Download to study or adapt
./n8nac-skills workflows install 4365 --output reference_workflow.workflow.ts
```

---

## �️ Reading Workflow Files Efficiently

Every `.workflow.ts` file starts with a `<workflow-map>` block — a compact index
generated automatically at each sync. **Always read this block first** before
opening the rest of the file.

```
// <workflow-map>
// Workflow : My Workflow
// Nodes   : 12  |  Connections: 14
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// ScheduleTrigger                  scheduleTrigger
// AgentGenerateApplication         agent                      [AI] [creds]
// GithubCheckBranchRef             httpRequest                [onError→out(1)]
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// ScheduleTrigger
//   → Configuration1
//     → BuildProfileSources → LoopOverProfileSources
//       .out(1) → JinaReadProfileSource → LoopOverProfileSources (↩ loop)
//
// AI CONNECTIONS
// AgentIa.uses({ ai_languageModel: OpenaiChatModel, ai_memory: Mmoire })
// </workflow-map>
```

### How to navigate a workflow as an agent

1. **Read `<workflow-map>` only** — locate the property name you need
2. **Search for that property name** in the file (e.g. `AgentGenerateApplication =`)
3. **Read only that section** — do not load the entire file into context

This avoids loading 1500+ lines when you only need to patch 10.

---

## 🗺️ Reading Workflow Files Efficiently

Every `.workflow.ts` file starts with a `<workflow-map>` block — a compact index
generated automatically at each sync. **Always read this block first** before
opening the rest of the file.

```
// <workflow-map>
// Workflow : My Workflow
// Nodes   : 12  |  Connections: 14
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// ScheduleTrigger                  scheduleTrigger
// AgentGenerateApplication         agent                      [AI] [creds]
// GithubCheckBranchRef             httpRequest                [onError→out(1)]
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// ScheduleTrigger
//   → Configuration1
//     → BuildProfileSources → LoopOverProfileSources
//       .out(1) → JinaReadProfileSource → LoopOverProfileSources (↩ loop)
//
// AI CONNECTIONS
// AgentIa.uses({ ai_languageModel: OpenaiChatModel, ai_memory: Mmoire })
// </workflow-map>
```

### How to navigate a workflow as an agent

1. **Read `<workflow-map>` only** — locate the property name you need
2. **Search for that property name** in the file (e.g. `AgentGenerateApplication =`)
3. **Read only that section** — do not load the entire file into context

This avoids loading 1500+ lines when you only need to patch 10.

---

## �📝 Minimal Workflow Structure

```typescript
import { workflow, node, links } from '@n8n-as-code/core';

@workflow({
  name: 'Workflow Name',
  active: false
})
export class MyWorkflow {
  @node({
    name: 'Descriptive Name',
    type: '/* EXACT from search */',
    version: 4,
    position: [250, 300]
  })
  MyNode = {
    /* parameters from ./n8nac-skills get */
  };

  @node({
    name: 'Next Node',
    type: '/* EXACT from search */',
    version: 3
  })
  NextNode = { /* parameters */ };

  @links()
  defineRouting() {
    this.MyNode.out(0).to(this.NextNode.in(0));
  }
}
```

---

## 🚫 Common Mistakes to AVOID

1. ❌ **Hallucinating parameter names** - Always use `get` command first
2. ❌ **Wrong node type** - Missing package prefix causes "?" icon
3. ❌ **Outdated typeVersion** - Use highest version from schema
4. ❌ **Guessing parameter structure** - Check if nested objects required
5. ❌ **Wrong connection names** - Must match EXACT node `name` field
6. ❌ **Inventing non-existent nodes** - Use `search` to verify

---

## ✅ Best Practices

### Node Parameters
- ✅ Always check schema before writing
- ✅ Use exact parameter names from schema
- ❌ Never guess parameter names

### Expressions (Modern Syntax)
- ✅ Use: `{{ $json.fieldName }}` (modern)
- ✅ Use: `{{ $('NodeName').item.json.field }}` (specific nodes)
- ❌ Avoid: `{{ $node["Name"].json.field }}` (legacy)

### Node Naming
- ✅ "Action Resource" pattern (e.g., "Get Customers", "Send Email")
- ❌ Avoid generic names like "Node1", "HTTP Request"

### Connections
- ✅ Regular connections: `this.NodeA.out(0).to(this.NodeB.in(0))`
- ✅ AI connections: Use `.uses()` for LangChain nodes
  - Single types: `ai_languageModel`, `ai_memory`, `ai_outputParser`, `ai_agent`, `ai_chain`, `ai_textSplitter`, `ai_embedding`, `ai_retriever`, `ai_reranker`, `ai_vectorStore`
  - Array types: `ai_tool`, `ai_document`
  - Example: `this.RAG.uses({ ai_embedding: this.Embedding.output, ai_vectorStore: this.VectorStore.output, ai_retriever: this.Retriever.output })`
- ❌ Never use `.out().to()` for AI sub-node connections

---

## 📚 Available Tools

### 🔍 Unified Search (PRIMARY TOOL)
```bash
./n8nac-skills search "google sheets"
./n8nac-skills search "how to use RAG"
```
**ALWAYS START HERE.** Deep search across nodes, docs, and tutorials.

### 🛠️ Get Node Schema
```bash
./n8nac-skills get googleSheets  # Complete info
./n8nac-skills schema googleSheets  # Quick reference
```

### 🌐 Community Workflows
```bash
./n8nac-skills workflows search "slack notification"
./n8nac-skills workflows info 916
./n8nac-skills workflows install 4365
```

### 📖 Documentation
```bash
./n8nac-skills docs "OpenAI"
./n8nac-skills guides "webhook"
```

### ✅ Validate
```bash
./n8nac-skills validate workflow.workflow.ts
```

---

## 🔑 Your Responsibilities

**#1**: Use `./n8nac-skills` tools to prevent hallucinations
**#2**: Follow the exact schema - no assumptions, no guessing
**#3**: Create workflows that work on the first try

**When in doubt**: `./n8nac-skills get <nodeName>`
<!-- n8n-as-code-end -->

---

## 🏢 B2B 원툴 협업 포털 프로젝트 규칙 (B2B Collaboration Portal)
- 사용자가 **"협업툴"** 또는 **"B2B 원툴 협업 포털"**이라고 부르면, 에이전트는 즉시 프로젝트의 전체 구현 설계안이 담긴 [implementation_plan.md](file:///Volumes/Extreme%20SSD/altf-kr-web-skeleton/implementation_plan.md) 및 [task.md](file:///Volumes/Extreme%20SSD/altf-kr-web-skeleton/task.md)를 로드하고 개발 진행 상태를 파악하여 설명해야 합니다.

---

## 🐙 Git 작업 규칙 (Git Operation Policy)
- Git 관련 명령어 실행 (add, commit, push, pull, status, checkout, merge 등) 및 관련 문의/확인 요청 시 별도로 묻지 않고 항상 승인(Always Yes) 처리하여 즉시 실행 및 완료합니다.

---

## ⚡ 코드 작업 및 구현 규칙 (Code Implementation Policy)
- 코드 변경, 버그 수정, 기능 구현 작업 시 사용자에게 사전에 "수정해도 될까요?", "진행할까요?" 등의 승인/Allow 여부를 일절 묻지 않고 **즉시 직접 수정 및 구현을 완료**합니다.
- 구현 완료 후에는 어떤 코드가 어떻게 변경되었는지 **상세한 구현 내용(구현 전/후 비교, Diff, 주요 로직 설명)**을 명확하게 제시합니다.

---

## 🔁 연속 작업 재개 규칙 (Continuous Agent Workflow Policy)
- 사용자가 **"agent 계속 하자"** 또는 **"에이전트 계속 하자"**라고 입력하면, 에이전트는 즉시 다음 절차를 자동으로 수행합니다:
  1. **진행 상태 파악**: [task.md](file:///f:/altf-kr-web-skeleton/task.md)와 [server/services/mailplugCollector.js](file:///f:/altf-kr-web-skeleton/server/services/mailplugCollector.js) 및 최신 코드 변경 사항을 로드하여 현재 개발 단계(QC-01 품질부 에이전트, 메일플러그 실제 수집, 성적서 파싱 및 엑셀 장부 연동 등)를 즉시 파악하고 요약 보고합니다.
  2. **로컬 개발 환경 자동 점검 & 준비**:
     - 백엔드 API 서버 (포트 3001) 및 프론트엔드 Vite 개발 서버 (포트 5173) 실행 상태를 점검합니다.
     - 실행되어 있지 않다면 즉시 백그라운드 데몬으로 구동하여 사용자가 즉시 `http://localhost:5173/admin/agents` 대시보드를 열람할 수 있도록 준비합니다.
  3. **다음 우선순위 작업 즉시 착수**: 사전에 "진행할까요?" 묻지 않고, 이어서 개발해야 할 최우선 과제(품질부 성적서 엑셀 26개 컬럼 매칭, 이상치 검출, 구글 시트 연동 등)를 즉시 직접 구현하고 보고합니다.


