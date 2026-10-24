import { useState, useMemo, useEffect } from 'react'
import {
  File, Copy, ExternalLink, Download, Check, Plus, MessageSquare, Trash, X, Send, Code,
  RotateCcw, ShieldCheck, ShieldAlert, CircleCheck, ChevronRight, ChevronDown, Folder, FolderOpen, Terminal, Ellipsis,
  ArrowRight, Sparkles, TriangleAlert, Search, GitBranch, GitCommitHorizontal, Split, Layers, Eye,
  FileText, CornerDownRight
} from 'lucide-react'

const KEYWORDS = new Set(['class','def','return','if','elif','else','for','while','in','import','from','as','with','try','except','raise','and','or','not','is','async','await','lambda','pass','yield','function','catch','self','let','const','var'])
const TYPES = new Set(['int','str','bool','float','tuple','list','dict','Redis','time','max','min','len','Optional','Union','null','undefined','Request','Response','Session','APIRouter','HTTPException','Depends'])
const CONSTS = new Set(['None','True','False','true','false'])
const TOKEN = /(#.*$|\/\/.*$)|((?:f|r|b)?"[^"]*"|(?:f|r|b)?'[^']*')|(\b\d+\b)|([A-Za-z_]\w*)|(\s+)|([^\s\w])/g

function highlight(code) {
  if (!code) return ''
  const out = []; let prev = null; let i = 0; TOKEN.lastIndex = 0; let m
  while ((m = TOKEN.exec(code)) !== null) {
    const [full,,str,num,ident,ws] = m
    let cls = 'text-ink dark:text-[#f5f5f7]'
    if (m[1]) cls = 'text-faint dark:text-[#8e8e93] italic'
    else if (str) cls = 'text-[#17692e] dark:text-[#34c759] font-medium'
    else if (num) cls = 'text-[#8f4700] dark:text-[#ff9f0a]'
    else if (ident) {
      if (KEYWORDS.has(ident)) cls = 'text-accent dark:text-[#4da3ff] font-semibold'
      else if (ident === 'self') cls = 'text-[#d70015] dark:text-[#ff453a] font-medium'
      else if (CONSTS.has(ident)) cls = 'text-[#8f4700] dark:text-[#ff9f0a] font-semibold'
      else if (TYPES.has(ident)) cls = 'text-accent dark:text-[#4da3ff]'
      else if (prev === 'def' || prev === 'function' || prev === 'class') cls = 'text-ink dark:text-[#f5f5f7] font-semibold'
    } else if (!ws) cls = 'text-muted dark:text-[#a1a1aa]'
    if (ident) prev = ident; else if (!ws) prev = null
    out.push(<span key={i++} className={cls}>{full}</span>)
  }
  return out
}

// =========================================================================
// CODEBASE REGISTRY: Complete authentic project file tree for the IDE
// =========================================================================
const CODEBASE_FILES = {
  // Modified files
  'src/checkout/webhook.py': {
    path: 'src/checkout/webhook.py',
    name: 'webhook.py',
    folder: 'src/checkout',
    modified: true,
    status: 'M',
    add: 48,
    rem: 6,
    header: '@@ -40,4 +40,10 @@',
    diffLines: [
      { n1: 28, n2: 28, type: 'ctx', text: 'import hmac' },
      { n1: 29, n2: 29, type: 'ctx', text: 'import hashlib' },
      { n1: 30, n2: 30, type: 'ctx', text: 'from fastapi import APIRouter, Request, HTTPException, Depends' },
      { n1: 31, n2: 31, type: 'ctx', text: 'from app.services.rate_limiter import check_rate_limit' },
      { n1: 32, n2: 32, type: 'ctx', text: '' },
      { n1: 33, n2: 33, type: 'ctx', text: 'router = APIRouter()' },
      { n1: 34, n2: 34, type: 'ctx', text: '' },
      { n1: 35, n2: 35, type: 'ctx', text: 'def verify_signature(payload: bytes, signature: str, secret: str) -> bool:' },
      { n1: 36, n2: 36, type: 'ctx', text: '    mac = hmac.new(secret.encode(), payload, hashlib.sha256)' },
      { n1: 37, n2: 37, type: 'ctx', text: '    return hmac.compare_digest(mac.hexdigest(), signature)' },
      { n1: 38, n2: 38, type: 'ctx', text: '' },
      { n1: 39, n2: 39, type: 'ctx', text: '@router.post("/v1/events/webhook")' },
      { n1: 40, n2: null, type: 'rem', text: 'async def receive_webhook(request: Request):' },
      { n1: 41, n2: null, type: 'rem', text: '    # Legacy unmetered webhook endpoint without HMAC verification' },
      { n1: 42, n2: null, type: 'rem', text: '    payload = await request.json()' },
      { n1: 43, n2: null, type: 'rem', text: '    return {"status": "accepted"}' },
      { n1: null, n2: 40, type: 'add', text: 'async def receive_webhook(request: Request, db: Session = Depends(get_db)):' },
      { n1: null, n2: 41, type: 'add', text: '    payload = await request.body()' },
      { n1: null, n2: 42, type: 'add', text: '    rate_limit_key = f"rl:{request.headers.get(\'cf-connecting-ip\', request.client.host)}"' },
      { n1: null, n2: 43, type: 'add', text: '    allowed, remaining = await check_rate_limit(rate_limit_key, limit=60, window_secs=60)' },
      { n1: null, n2: 44, type: 'add', text: '    if not allowed:' },
      { n1: null, n2: 45, type: 'add', text: '        raise HTTPException(status_code=429, detail="Rate limit exceeded", headers={"Retry-After": "60"})' },
      { n1: null, n2: 46, type: 'add', text: '    sig = request.headers.get("X-GateKeep-Signature")' },
      { n1: null, n2: 47, type: 'add', text: '    if not sig or not verify_signature(payload, sig, "whsec_live_prod"):' },
      { n1: null, n2: 48, type: 'add', text: '        raise HTTPException(status_code=401, detail="Invalid cryptographic HMAC signature")' },
      { n1: null, n2: 49, type: 'add', text: '    return {"status": "verified", "tenant": request.headers.get("X-Tenant-ID"), "remaining": remaining}' },
      { n1: 44, n2: 50, type: 'ctx', text: '' },
      { n1: 45, n2: 51, type: 'ctx', text: '@router.get("/v1/events/health")' },
      { n1: 46, n2: 52, type: 'ctx', text: 'async def webhook_health():' },
      { n1: 47, n2: 53, type: 'ctx', text: '    return {"status": "healthy", "service": "webhook-ingress"}' },
    ],
  },
  'tests/test_webhook.py': {
    path: 'tests/test_webhook.py',
    name: 'test_webhook.py',
    folder: 'tests',
    modified: true,
    status: 'A',
    add: 15,
    rem: 0,
    header: '@@ -1,0 +1,15 @@',
    diffLines: [
      { n1: null, n2: 1, type: 'add', text: 'import pytest' },
      { n1: null, n2: 2, type: 'add', text: 'from httpx import AsyncClient' },
      { n1: null, n2: 3, type: 'add', text: 'from app.main import app' },
      { n1: null, n2: 4, type: 'add', text: '' },
      { n1: null, n2: 5, type: 'add', text: '@pytest.mark.asyncio' },
      { n1: null, n2: 6, type: 'add', text: 'async def test_webhook_rate_limit_throttle():' },
      { n1: null, n2: 7, type: 'add', text: '    async with AsyncClient(app=app, base_url="http://test") as ac:' },
      { n1: null, n2: 8, type: 'add', text: '        headers = {"X-GateKeep-Signature": "valid_mock_sig", "X-Tenant-ID": "test_merchant"}' },
      { n1: null, n2: 9, type: 'add', text: '        for _ in range(60):' },
      { n1: null, n2: 10, type: 'add', text: '            res = await ac.post("/v1/events/webhook", json={"evt": "ping"}, headers=headers)' },
      { n1: null, n2: 11, type: 'add', text: '            assert res.status_code == 200' },
      { n1: null, n2: 12, type: 'add', text: '        # 61st request must trigger HTTP 429' },
      { n1: null, n2: 13, type: 'add', text: '        res = await ac.post("/v1/events/webhook", json={"evt": "ping"}, headers=headers)' },
      { n1: null, n2: 14, type: 'add', text: '        assert res.status_code == 429' },
      { n1: null, n2: 15, type: 'add', text: '        assert res.headers["Retry-After"] == "60"' },
    ],
  },
  'config/settings.py': {
    path: 'config/settings.py',
    name: 'settings.py',
    folder: 'config',
    modified: true,
    status: 'M',
    add: 4,
    rem: 1,
    header: '@@ -1,4 +1,7 @@',
    diffLines: [
      { n1: 1, n2: 1, type: 'ctx', text: '# GateKeep Webhook & Throttle Runtime Configuration' },
      { n1: 2, n2: 2, type: 'ctx', text: 'GATEKEEP_ENVIRONMENT = "production"' },
      { n1: null, n2: 3, type: 'add', text: 'RATE_LIMIT_ENABLED = True' },
      { n1: null, n2: 4, type: 'add', text: 'RATE_LIMIT_DEFAULT_PER_MIN = 60' },
      { n1: null, n2: 5, type: 'add', text: 'AIR_GAPPED_SANDBOX_ENFORCED = True' },
      { n1: null, n2: 6, type: 'add', text: 'AUDIT_CHAIN_ALGORITHM = "SHA-256"' },
      { n1: 3, n2: null, type: 'rem', text: 'RATE_LIMIT_ENABLED = False' },
      { n1: 4, n2: 7, type: 'ctx', text: 'LOG_LEVEL = "INFO"' },
    ],
  },
  'src/middleware/throttle.py': {
    path: 'src/middleware/throttle.py',
    name: 'throttle.py',
    folder: 'src/middleware',
    modified: true,
    status: 'M',
    add: 22,
    rem: 4,
    header: '@@ -12,4 +12,12 @@',
    diffLines: [
      { n1: 12, n2: 12, type: 'ctx', text: 'class SlidingWindowLimiter:' },
      { n1: 13, n2: 13, type: 'ctx', text: '    def __init__(self, redis_client):' },
      { n1: 14, n2: 14, type: 'ctx', text: '        self.redis = redis_client' },
      { n1: 15, n2: null, type: 'rem', text: '    async def check(self, key: str, limit: int) -> bool:' },
      { n1: 16, n2: null, type: 'rem', text: '        return True  # TODO: implement limiter' },
      { n1: null, n2: 15, type: 'add', text: '    async def check(self, key: str, limit: int, window: int = 60) -> tuple[bool, int]:' },
      { n1: null, n2: 16, type: 'add', text: '        now = int(time.time())' },
      { n1: null, n2: 17, type: 'add', text: '        pipe = self.redis.pipeline()' },
      { n1: null, n2: 18, type: 'add', text: '        pipe.zremrangebyscore(key, 0, now - window)' },
      { n1: null, n2: 19, type: 'add', text: '        pipe.zadd(key, {str(now): now})' },
      { n1: null, n2: 20, type: 'add', text: '        pipe.zcard(key)' },
      { n1: null, n2: 21, type: 'add', text: '        pipe.expire(key, window)' },
      { n1: null, n2: 22, type: 'add', text: '        res = await pipe.execute()' },
      { n1: null, n2: 23, type: 'add', text: '        count = res[2]' },
      { n1: null, n2: 24, type: 'add', text: '        return count <= limit, max(0, limit - count)' },
      { n1: 17, n2: 25, type: 'ctx', text: '' },
      { n1: 18, n2: 26, type: 'ctx', text: '    def format_key(self, tenant_id: str) -> str:' },
      { n1: 19, n2: 27, type: 'ctx', text: '        return f"throttle:{tenant_id}"' },
    ],
  },
  'src/deps/redis.py': {
    path: 'src/deps/redis.py',
    name: 'redis.py',
    folder: 'src/deps',
    modified: true,
    status: 'M',
    add: 12,
    rem: 3,
    header: '@@ -5,3 +5,10 @@',
    diffLines: [
      { n1: 5, n2: 5, type: 'ctx', text: 'import redis.asyncio as aioredis' },
      { n1: 6, n2: null, type: 'rem', text: 'def get_redis():' },
      { n1: 7, n2: null, type: 'rem', text: '    return aioredis.from_url("redis://localhost")' },
      { n1: null, n2: 6, type: 'add', text: 'async def get_redis_pool() -> aioredis.Redis:' },
      { n1: null, n2: 7, type: 'add', text: '    return aioredis.ConnectionPool.from_url(' },
      { n1: null, n2: 8, type: 'add', text: '        settings.RATE_LIMIT_REDIS_URL,' },
      { n1: null, n2: 9, type: 'add', text: '        max_connections=20,' },
      { n1: null, n2: 10, type: 'add', text: '        decode_responses=True' },
      { n1: null, n2: 11, type: 'add', text: '    )' },
      { n1: 8, n2: 12, type: 'ctx', text: '' },
    ],
  },

  // Clean codebase files (available to browse like an authentic IDE)
  'src/checkout/service.py': {
    path: 'src/checkout/service.py',
    name: 'service.py',
    folder: 'src/checkout',
    modified: false,
    status: 'clean',
    diffLines: [
      { n1: 1, n2: 1, type: 'ctx', text: '# Checkout Event Processing Service' },
      { n1: 2, n2: 2, type: 'ctx', text: 'from app.models import Order, Payment' },
      { n1: 3, n2: 3, type: 'ctx', text: 'from app.db import SessionLocal' },
      { n1: 4, n2: 4, type: 'ctx', text: '' },
      { n1: 5, n2: 5, type: 'ctx', text: 'async def dispatch_checkout_event(order_id: str, event_type: str):' },
      { n1: 6, n2: 6, type: 'ctx', text: '    with SessionLocal() as session:' },
      { n1: 7, n2: 7, type: 'ctx', text: '        order = session.query(Order).filter_by(id=order_id).first()' },
      { n1: 8, n2: 8, type: 'ctx', text: '        if not order:' },
      { n1: 9, n2: 9, type: 'ctx', text: '            raise ValueError(f"Order {order_id} not found")' },
      { n1: 10, n2: 10, type: 'ctx', text: '        order.status = event_type' },
      { n1: 11, n2: 11, type: 'ctx', text: '        session.commit()' },
      { n1: 12, n2: 12, type: 'ctx', text: '        return {"order_id": order_id, "status": "processed"}' },
    ],
  },
  'src/checkout/schemas.py': {
    path: 'src/checkout/schemas.py',
    name: 'schemas.py',
    folder: 'src/checkout',
    modified: false,
    status: 'clean',
    diffLines: [
      { n1: 1, n2: 1, type: 'ctx', text: 'from pydantic import BaseModel, Field' },
      { n1: 2, n2: 2, type: 'ctx', text: 'from typing import Optional, Dict, Any' },
      { n1: 3, n2: 3, type: 'ctx', text: '' },
      { n1: 4, n2: 4, type: 'ctx', text: 'class WebhookPayload(BaseModel):' },
      { n1: 5, n2: 5, type: 'ctx', text: '    event: str = Field(..., description="Webhook event name")' },
      { n1: 6, n2: 6, type: 'ctx', text: '    timestamp: int' },
      { n1: 7, n2: 7, type: 'ctx', text: '    data: Dict[str, Any]' },
      { n1: 8, n2: 8, type: 'ctx', text: '    tenant_id: Optional[str] = None' },
    ],
  },
  'src/middleware/auth.py': {
    path: 'src/middleware/auth.py',
    name: 'auth.py',
    folder: 'src/middleware',
    modified: false,
    status: 'clean',
    diffLines: [
      { n1: 1, n2: 1, type: 'ctx', text: 'from fastapi import Security, HTTPException' },
      { n1: 2, n2: 2, type: 'ctx', text: 'from fastapi.security.api_key import APIKeyHeader' },
      { n1: 3, n2: 3, type: 'ctx', text: '' },
      { n1: 4, n2: 4, type: 'ctx', text: 'api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)' },
      { n1: 5, n2: 5, type: 'ctx', text: '' },
      { n1: 6, n2: 6, type: 'ctx', text: 'async def get_api_key(key: str = Security(api_key_header)):' },
      { n1: 7, n2: 7, type: 'ctx', text: '    if not key:' },
      { n1: 8, n2: 8, type: 'ctx', text: '        raise HTTPException(status_code=403, detail="Missing API Key")' },
      { n1: 9, n2: 9, type: 'ctx', text: '    return key' },
    ],
  },
  'tests/test_throttle.py': {
    path: 'tests/test_throttle.py',
    name: 'test_throttle.py',
    folder: 'tests',
    modified: false,
    status: 'clean',
    diffLines: [
      { n1: 1, n2: 1, type: 'ctx', text: 'import pytest' },
      { n1: 2, n2: 2, type: 'ctx', text: 'from app.middleware.throttle import SlidingWindowLimiter' },
      { n1: 3, n2: 3, type: 'ctx', text: '' },
      { n1: 4, n2: 4, type: 'ctx', text: 'def test_limiter_initialization():' },
      { n1: 5, n2: 5, type: 'ctx', text: '    limiter = SlidingWindowLimiter(None)' },
      { n1: 6, n2: 6, type: 'ctx', text: '    assert limiter is not None' },
    ],
  },
  'tests/conftest.py': {
    path: 'tests/conftest.py',
    name: 'conftest.py',
    folder: 'tests',
    modified: false,
    status: 'clean',
    diffLines: [
      { n1: 1, n2: 1, type: 'ctx', text: 'import pytest' },
      { n1: 2, n2: 2, type: 'ctx', text: 'from unittest.mock import AsyncMock' },
      { n1: 3, n2: 3, type: 'ctx', text: '' },
      { n1: 4, n2: 4, type: 'ctx', text: '@pytest.fixture' },
      { n1: 5, n2: 5, type: 'ctx', text: 'def mock_redis():' },
      { n1: 6, n2: 6, type: 'ctx', text: '    mock = AsyncMock()' },
      { n1: 7, n2: 7, type: 'ctx', text: '    mock.pipeline.return_value.execute.return_value = [1, 1, 10, 1]' },
      { n1: 8, n2: 8, type: 'ctx', text: '    return mock' },
    ],
  },
  'README.md': {
    path: 'README.md',
    name: 'README.md',
    folder: '',
    modified: false,
    status: 'clean',
    diffLines: [
      { n1: 1, n2: 1, type: 'ctx', text: '# Commerce Core API Service' },
      { n1: 2, n2: 2, type: 'ctx', text: 'High-throughput event ingress and webhook dispatch system governed by GateKeep.' },
      { n1: 3, n2: 3, type: 'ctx', text: '' },
      { n1: 4, n2: 4, type: 'ctx', text: '## Security & Governance' },
      { n1: 5, n2: 5, type: 'ctx', text: '- All inbound webhooks verify HMAC-SHA256 signatures.' },
      { n1: 6, n2: 6, type: 'ctx', text: '- Egress-isolated container execution verified on all PR builds.' },
    ],
  },
  'pyproject.toml': {
    path: 'pyproject.toml',
    name: 'pyproject.toml',
    folder: '',
    modified: false,
    status: 'clean',
    diffLines: [
      { n1: 1, n2: 1, type: 'ctx', text: '[project]' },
      { n1: 2, n2: 2, type: 'ctx', text: 'name = "commerce-core"' },
      { n1: 3, n2: 3, type: 'ctx', text: 'version = "2.4.0"' },
      { n1: 4, n2: 4, type: 'ctx', text: 'dependencies = [' },
      { n1: 5, n2: 5, type: 'ctx', text: '    "fastapi>=0.110.0",' },
      { n1: 6, n2: 6, type: 'ctx', text: '    "redis>=5.0.0",' },
      { n1: 7, n2: 7, type: 'ctx', text: '    "pytest>=8.0.0",' },
      { n1: 8, n2: 8, type: 'ctx', text: ']' },
    ],
  },
}

// =========================================================================
// RUN DIFF NORMALIZATION
// run.diff arrives in three shapes: the GateKeep object ({file, lines, by_file}),
// raw unified-diff text, or an array of per-file entries. All become
// { files: [{path, status, add, rem}], linesByFile: {path: diffLines} }.
// =========================================================================
const DEMO_TABS = ['src/checkout/webhook.py', 'tests/test_webhook.py', 'config/settings.py', 'src/middleware/throttle.py']

function parseUnifiedDiff(text) {
  const byFile = {}
  let cur = null
  let oldN = 0
  let newN = 0
  let inHunk = false
  for (const line of String(text).replace(/\n$/, '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      const path = line.split(' b/').slice(1).join(' b/')
      cur = byFile[path] = { path, status: 'M', add: 0, rem: 0, lines: [] }
      inHunk = false
      continue
    }
    if (!cur && line.startsWith('+++ ')) {
      // Plain `diff -u` output without a "diff --git" header.
      const path = line.slice(4).replace(/^b\//, '').split('\t')[0]
      cur = byFile[path] = { path, status: 'M', add: 0, rem: 0, lines: [] }
      continue
    }
    if (!cur) continue
    if (!inHunk) {
      if (line.startsWith('new file mode')) cur.status = 'A'
      else if (line.startsWith('deleted file mode')) cur.status = 'D'
    }
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/)
    if (hunk) { oldN = +hunk[1]; newN = +hunk[2]; inHunk = true; continue }
    if (!inHunk || line.startsWith('\\')) continue
    if (line.startsWith('+')) { cur.add++; cur.lines.push({ n1: null, n2: newN++, type: 'add', text: line.slice(1) }) }
    else if (line.startsWith('-')) { cur.rem++; cur.lines.push({ n1: oldN++, n2: null, type: 'rem', text: line.slice(1) }) }
    else cur.lines.push({ n1: oldN++, n2: newN++, type: 'ctx', text: line.slice(1) })
  }
  return Object.values(byFile)
}

function normalizeRunDiff(run) {
  const linesByFile = {}
  const derived = []
  const diff = run?.diff
  const addEntry = (entry) => {
    const path = entry.path || entry.file
    if (!path) return
    const parsed = typeof entry.diff === 'string' ? parseUnifiedDiff(entry.diff)[0] : null
    const lines = entry.lines || parsed?.lines || []
    linesByFile[path] = lines
    derived.push({
      path,
      status: entry.status || parsed?.status || 'M',
      add: entry.add ?? parsed?.add ?? lines.filter((l) => l.type === 'add').length,
      rem: entry.rem ?? parsed?.rem ?? lines.filter((l) => l.type === 'rem').length,
    })
  }
  if (typeof diff === 'string') parseUnifiedDiff(diff).forEach(addEntry)
  else if (Array.isArray(diff)) diff.forEach(addEntry)
  else if (diff && typeof diff === 'object') {
    if (diff.by_file) Object.entries(diff.by_file).forEach(([path, entry]) => addEntry({ ...entry, path }))
    else addEntry(diff)
  }
  const files = run?.files?.length ? run.files : derived
  return { files, linesByFile }
}

export default function CodeReview({
  run,
  reviewerRole = 'Engineer',
  onAddComment,
  onDeleteComment,
  onDecide,
  canAct,
  onTamper,
  showInspector = true,
}) {
  const [copied, setCopied] = useState(false)
  const [fullFileModal, setFullFileModal] = useState(false)
  const [viewMode, setViewMode] = useState('unified') // 'unified' | 'split'
  const runDiff = useMemo(() => normalizeRunDiff(run), [run])
  const realFiles = runDiff.files
  const hasRealFiles = realFiles.length > 0

  const [selectedFilePath, setSelectedFilePath] = useState(() => (hasRealFiles ? realFiles[0].path : DEMO_TABS[0]))

  // IDE Open Tabs across the codebase
  const [openTabs, setOpenTabs] = useState(() => (hasRealFiles ? realFiles.slice(0, 4).map((f) => f.path) : DEMO_TABS))

  // Quick Open Modal (⌘P)
  const [quickOpenOpen, setQuickOpenOpen] = useState(false)
  const [quickSearch, setQuickSearch] = useState('')

  // Breadcrumb dropdown state
  const [activeDropdown, setActiveDropdown] = useState(null) // 'repo' | 'branch' | 'folder' | 'file' | null

  // Comment state
  const [activeCommentLine, setActiveCommentLine] = useState(null)
  const [commentText, setCommentText] = useState('')
  const [anchoredCardDismissed, setAnchoredCardDismissed] = useState(false)

  // Explorer search & folder expansion
  const [explorerFilter, setExplorerFilter] = useState('')
  const [expandedFolders, setExpandedFolders] = useState(() => {
    const defaultFolders = new Set(['src', 'src/checkout', 'src/middleware', 'src/deps', 'tests', 'config'])
    if (hasRealFiles) {
      realFiles.forEach((f) => {
        const parts = f.path.split('/')
        for (let i = 1; i < parts.length; i++) {
          defaultFolders.add(parts.slice(0, i).join('/'))
        }
      })
    }
    return defaultFolders
  })

  // Keyboard shortcut for Quick Open (⌘P or Ctrl+P)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setQuickOpenOpen((v) => !v)
      } else if (e.key === 'Escape') {
        setQuickOpenOpen(false)
        setActiveDropdown(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Close dropdown on click outside
  useEffect(() => {
    const closeMenu = () => setActiveDropdown(null)
    window.addEventListener('click', closeMenu)
    return () => window.removeEventListener('click', closeMenu)
  }, [])

  // A run with recorded files shows only those files; the demo codebase is for runs without any.
  const allCodebaseFiles = useMemo(() => {
    if (!hasRealFiles) return { ...CODEBASE_FILES }
    const registry = {}
    realFiles.forEach((rf) => {
      const lines = runDiff.linesByFile[rf.path]
      registry[rf.path] = {
        path: rf.path,
        name: rf.path.split('/').pop(),
        folder: rf.path.split('/').slice(0, -1).join('/'),
        modified: true,
        status: rf.status || 'M',
        add: rf.add || 0,
        rem: rf.rem || 0,
        header: rf.status === 'A' ? 'new file' : null,
        diffLines: lines?.length ? lines : [{ n1: null, n2: null, type: 'ctx', text: 'No diff recorded for this file.' }],
      }
    })
    return registry
  }, [realFiles, runDiff, hasRealFiles])

  // Open the run's own files when switching to a run that has them.
  useEffect(() => {
    if (!hasRealFiles) {
      setSelectedFilePath(DEMO_TABS[0])
      setOpenTabs(DEMO_TABS)
      return
    }
    const paths = realFiles.map((f) => f.path)
    setSelectedFilePath((prev) => (paths.includes(prev) ? prev : paths[0]))
    setOpenTabs((prev) => {
      const filtered = prev.filter((p) => paths.includes(p))
      return filtered.length > 0 ? filtered : paths.slice(0, 4)
    })
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      paths.forEach((p) => {
        const parts = p.split('/')
        for (let i = 1; i < parts.length; i++) {
          next.add(parts.slice(0, i).join('/'))
        }
      })
      return next
    })
  }, [run?.id, hasRealFiles]) // eslint-disable-line react-hooks/exhaustive-deps

  // Real files grouped by folder for the explorer.
  const realFolders = useMemo(() => {
    const groups = {}
    Object.values(allCodebaseFiles).forEach((f) => { (groups[f.folder] ||= []).push(f) })
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
  }, [allCodebaseFiles])

  const fileList = useMemo(() => Object.values(allCodebaseFiles), [allCodebaseFiles])
  const modifiedFiles = useMemo(() => fileList.filter((f) => f.modified), [fileList])
  const activeFile = allCodebaseFiles[selectedFilePath] || fileList[0] || {
    path: '',
    name: '',
    folder: '',
    status: 'clean',
    diffLines: [],
  }
  const diffLines = activeFile.diffLines || []

  const totalAdd = modifiedFiles.reduce((acc, f) => acc + (f.add || 0), 0)
  const totalRem = modifiedFiles.reduce((acc, f) => acc + (f.rem || 0), 0)

  // Open a file in IDE tabs
  const handleOpenFile = (path) => {
    if (!openTabs.includes(path)) {
      setOpenTabs((prev) => [...prev, path])
    }
    setSelectedFilePath(path)
    setQuickOpenOpen(false)
  }

  // Close a tab
  const handleCloseTab = (e, path) => {
    e.stopPropagation()
    const remaining = openTabs.filter((t) => t !== path)
    if (remaining.length > 0) {
      setOpenTabs(remaining)
      if (selectedFilePath === path) {
        setSelectedFilePath(remaining[remaining.length - 1])
      }
    }
  }

  const toggleFolder = (folderPath) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(folderPath)) next.delete(folderPath)
      else next.add(folderPath)
      return next
    })
  }

  const handleCopyCode = () => {
    const text = diffLines.map((l) => l.text).join('\n')
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownloadPatch = () => {
    let patch = `--- a/${activeFile.path}\n+++ b/${activeFile.path}\n`
    diffLines.forEach((l) => {
      const pfx = l.type === 'add' ? '+' : l.type === 'rem' ? '-' : ' '
      patch += `${pfx}${l.text}\n`
    })
    const blob = new Blob([patch], { type: 'text/x-diff' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${run?.id || 'RUN'}-${activeFile.name.replace(/[/.]/g, '_')}.patch`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Submit to Agent Rework from line 42 anchored card
  const handleReworkFromCard = () => {
    if (onDecide) {
      onDecide(
        'reject',
        'Line 42: Rate limiter key should use hashed tenant ID instead of raw IP to prevent spoofing behind Cloudflare proxies.'
      )
    }
  }

  // Custom user line comment
  const handleSubmitCustomLineComment = (lineNo) => {
    if (!commentText.trim()) return
    if (onAddComment) {
      onAddComment({
        line: lineNo,
        file: activeFile.path,
        text: commentText.trim(),
        role: reviewerRole,
      })
    }
    if (onDecide) {
      onDecide('reject', `Line ${lineNo} (${activeFile.path}): ${commentText.trim()}`)
    }
    setActiveCommentLine(null)
    setCommentText('')
  }

  // Filtered files for Quick Open modal
  const filteredQuickFiles = useMemo(() => {
    if (!quickSearch.trim()) return fileList
    const q = quickSearch.toLowerCase()
    return fileList.filter((f) => f.path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q))
  }, [fileList, quickSearch])

  // Breadcrumb path components
  const pathParts = (activeFile.path || '').split('/')
  const fileName = pathParts.pop() || ''
  const folderParts = pathParts

  return (
    <div className="flex h-full w-full flex-col overflow-hidden select-none bg-white font-sans dark:bg-[#000000]">
      {/* ========================================================================= */}
      {/* 1. IDE CODEBASE HEADER BAR (40px) — Collision-Proof Responsive Header    */}
      {/* ========================================================================= */}
      <div className="flex h-[40px] shrink-0 items-center justify-between border-b border-black/[0.08] bg-[#fbfbfd] surface-ide-bar px-3.5 select-none z-20 gap-3 dark:border-white/[0.08] dark:bg-[#0b0b0d]">
        {/* Left: Interactive Codebase Breadcrumb Path (Auto-shrinks, never overflows) */}
        <div className="flex items-center gap-1 text-[12px] text-muted min-w-0 flex-1 overflow-hidden dark:text-[#a1a1aa]">
          {/* Repo selector dropdown */}
          <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setActiveDropdown(activeDropdown === 'repo' ? null : 'repo')}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1 font-semibold text-ink hover:bg-black/[0.05] transition-colors dark:text-[#f5f5f7] dark:hover:bg-white/[0.08]"
              title="Codebase Repository"
            >
              <span className="flex h-4 w-4 items-center justify-center rounded bg-black/10 text-ink text-[10px] dark:bg-white/10 dark:text-white">
                📦
              </span>
              <span className="truncate max-w-[120px]">{run?.repo || 'commerce-core'}</span>
              <ChevronDown size={11} className="text-faint dark:text-[#8e8e93]" />
            </button>
            {activeDropdown === 'repo' && (
              <div className="absolute left-0 top-full mt-1 w-56 rounded-xl border border-black/[0.08] bg-white p-1 shadow-pop z-50 animate-rise text-[12px] dark:border-white/[0.12] dark:bg-[#18181b]">
                <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-faint dark:text-[#8e8e93]">
                  Active Codebase
                </div>
                <div className="rounded-lg bg-accent/10 px-2.5 py-1.5 font-semibold text-accent flex items-center justify-between">
                  <span>{run?.repo || 'commerce-core'}</span>
                  <Check size={12} />
                </div>
                <div className="mt-1 border-t border-black/[0.04] pt-1 text-[11px] text-faint px-2.5 py-1 dark:border-white/[0.06] dark:text-[#8e8e93]">
                  Commit: {run?.commit || (hasRealFiles ? 'not shipped yet' : '9f3c2e1')}
                </div>
              </div>
            )}
          </div>

          <span className="text-faint shrink-0 dark:text-[#8e8e93]">/</span>

          {/* Branch switcher dropdown */}
          <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setActiveDropdown(activeDropdown === 'branch' ? null : 'branch')}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-ink font-medium hover:bg-black/[0.05] transition-colors dark:text-[#f5f5f7] dark:hover:bg-white/[0.08]"
              title="Git Branch"
            >
              <GitBranch size={12} className="text-accent shrink-0" />
              <span className="truncate max-w-[130px]">{run?.branch || (hasRealFiles ? 'main' : 'feat/webhook-throttle')}</span>
              <ChevronDown size={11} className="text-faint dark:text-[#8e8e93]" />
            </button>
            {activeDropdown === 'branch' && (
              <div className="absolute left-0 top-full mt-1 w-64 rounded-xl border border-black/[0.08] bg-white p-1 shadow-pop z-50 animate-rise text-[12px] dark:border-white/[0.12] dark:bg-[#18181b]">
                <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-faint dark:text-[#8e8e93]">
                  Branches
                </div>
                <div className="rounded-lg bg-accent/10 px-2.5 py-1.5 font-semibold text-accent flex items-center justify-between">
                  <span>{run?.branch || (hasRealFiles ? 'main' : 'feat/webhook-throttle')}</span>
                  <span className="font-mono text-[10px] text-accent">HEAD</span>
                </div>
                <div className="rounded-lg px-2.5 py-1.5 text-muted hover:bg-black/[0.03] transition-colors dark:text-[#a1a1aa] dark:hover:bg-white/[0.05]">
                  <span>main</span>
                </div>
              </div>
            )}
          </div>

          {folderParts.map((folder, idx) => (
            <span key={idx} className="hidden sm:flex items-center gap-1 shrink-0">
              <span className="text-faint dark:text-[#8e8e93]">/</span>
              <span className="rounded px-1.5 py-0.5 text-faint hover:text-ink cursor-pointer dark:text-[#8e8e93] dark:hover:text-[#f5f5f7]">{folder}</span>
            </span>
          ))}

          <span className="text-faint shrink-0 dark:text-[#8e8e93]">/</span>

          {/* Active File Switcher with Sibling Files */}
          <div className="relative min-w-0 shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setActiveDropdown(activeDropdown === 'file' ? null : 'file')}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1 font-semibold text-accent bg-accent/10 hover:bg-accent/15 transition-colors"
              title="Click to switch sibling file"
            >
              <File size={12} className="shrink-0" />
              <span className="truncate max-w-[140px]">{fileName}</span>
              {activeFile.modified && (
                <span className={`rounded px-1 font-mono text-[9.5px] font-bold shrink-0 ${
                  activeFile.status === 'A' ? 'bg-[#34c759]/20 text-[#17692e] dark:text-[#34c759]'
                    : activeFile.status === 'D' ? 'bg-[#ff3b30]/15 text-[#c4161c] dark:text-[#ff453a]'
                      : 'bg-[#ff9500]/20 text-[#8f4700] dark:text-[#ff9f0a]'
                }`}>
                  {activeFile.status === 'A' || activeFile.status === 'D' ? activeFile.status : 'M'}
                </span>
              )}
              <ChevronDown size={11} className="text-accent shrink-0" />
            </button>
            {activeDropdown === 'file' && (
              <div className="absolute left-0 top-full mt-1 w-60 rounded-xl border border-black/[0.08] bg-white p-1 shadow-pop z-50 animate-rise text-[12px] dark:border-white/[0.12] dark:bg-[#18181b]">
                <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-faint dark:text-[#8e8e93]">
                  Files in this Folder
                </div>
                {fileList
                  .filter((f) => f.folder === activeFile.folder)
                  .map((f) => (
                    <button
                      key={f.path}
                      type="button"
                      onClick={() => { handleOpenFile(f.path); setActiveDropdown(null) }}
                      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                        f.path === activeFile.path ? 'bg-accent/10 text-accent font-semibold' : 'text-ink hover:bg-black/[0.04] dark:text-[#f5f5f7] dark:hover:bg-white/[0.06]'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <File size={12} className={f.path === activeFile.path ? 'text-accent' : 'text-faint dark:text-[#8e8e93]'} />
                        <span className="truncate">{f.name}</span>
                      </div>
                      {f.modified && (
                        <span className="font-mono text-[10px] font-semibold text-[#17692e] dark:text-[#34c759]">
                          +{f.add} -{f.rem}
                        </span>
                      )}
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* Center: Quick Search / Codebase Jumper Button */}
        <button
          type="button"
          onClick={() => setQuickOpenOpen(true)}
          className="flex h-7 items-center justify-between rounded-xl bg-black/[0.04] px-2.5 text-muted hover:bg-black/[0.07] border border-black/[0.04] text-[12px] transition-colors shrink-0 dark:border-white/[0.08] dark:bg-white/[0.06] dark:text-[#a1a1aa] dark:hover:bg-white/[0.1]"
        >
          <div className="flex items-center gap-2">
            <Search size={12} className="text-faint dark:text-[#8e8e93]" />
            <span className="text-faint hidden lg:inline dark:text-[#8e8e93]">Find file in codebase...</span>
          </div>
          <kbd className="rounded border border-black/[0.08] bg-white px-1.5 py-0.5 font-mono text-[9px] text-faint shadow-xs ml-2 dark:border-white/[0.12] dark:bg-white/10 dark:text-[#a1a1aa]">
            ⌘P
          </kbd>
        </button>

        {/* Right: Codebase Stats & View Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Codebase stats badge */}
          <div className="hidden 2xl:flex items-center gap-1.5 font-mono text-[11px] text-muted mr-1 dark:text-[#a1a1aa]">
            <span className="font-semibold text-ink dark:text-[#f5f5f7]">{modifiedFiles.length} modified</span>
            <span>·</span>
            <span className="text-[#17692e] font-semibold dark:text-[#34c759]">+{totalAdd}</span>
            <span className="text-[#d70015] font-semibold dark:text-[#ff453a]">-{totalRem}</span>
          </div>

          <button
            type="button"
            onClick={handleDownloadPatch}
            className="flex items-center gap-1 rounded-lg border border-black/[0.08] bg-white hover:bg-black/[0.03] px-2.5 py-1 text-[11px] font-medium text-ink transition-colors shadow-2xs dark:border-white/[0.1] dark:bg-white/[0.06] dark:text-[#f5f5f7] dark:hover:bg-white/[0.1]"
            title="Download unified diff patch for this run"
          >
            <Download size={11} className="text-muted dark:text-[#a1a1aa]" />
            <span className="hidden sm:inline">Patch</span>
          </button>

          <button
            type="button"
            onClick={handleCopyCode}
            className="flex items-center gap-1 rounded-lg border border-black/[0.08] bg-white hover:bg-black/[0.03] px-2.5 py-1 text-[11px] font-medium text-ink transition-colors shadow-2xs dark:border-white/[0.1] dark:bg-white/[0.06] dark:text-[#f5f5f7] dark:hover:bg-white/[0.1]"
            title="Copy current code to clipboard"
          >
            {copied ? <Check size={11} className="text-green dark:text-[#34c759]" /> : <Copy size={11} className="text-muted dark:text-[#a1a1aa]" />}
            <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. IDE OPEN TABS STRIP (36px) — Horizontal Browser of Codebase Files     */}
      {/* ========================================================================= */}
      <div className="flex h-[36px] shrink-0 items-center border-b border-black/[0.06] bg-[#f5f5f7] surface-ide-bar px-2 gap-1 overflow-x-auto select-none dark:border-white/[0.08] dark:bg-[#0b0b0d]">
        {openTabs.map((tabPath) => {
          const file = allCodebaseFiles[tabPath] || { name: tabPath.split('/').pop(), modified: false, status: 'clean' }
          const isActive = tabPath === selectedFilePath

          return (
            <div
              key={tabPath}
              onClick={() => setSelectedFilePath(tabPath)}
              className={`group flex h-[28px] items-center gap-2 rounded-lg px-2.5 text-[12px] font-medium transition-all cursor-pointer ${
                isActive
                  ? 'bg-white text-ink font-semibold shadow-xs border border-black/[0.06] dark:border-white/[0.1] dark:bg-[#1a1a1d] dark:text-white'
                  : 'text-muted hover:bg-black/[0.04] hover:text-ink dark:text-[#a1a1aa] dark:hover:bg-white/[0.06] dark:hover:text-white'
              }`}
            >
              <File size={13} className={isActive ? 'text-accent' : 'text-faint dark:text-[#8e8e93]'} />
              <span className="truncate max-w-[140px]">{file.name}</span>
              {file.modified && (
                <span className={`rounded px-1 font-mono text-[9px] font-bold ${
                  file.status === 'A' ? 'bg-[#34c759]/20 text-[#17692e] dark:text-[#34c759]' : 'bg-[#ff9500]/20 text-[#8f4700] dark:text-[#ff9f0a]'
                }`}>
                  {file.status || 'M'}
                </span>
              )}
              {openTabs.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => handleCloseTab(e, tabPath)}
                  className="rounded p-0.5 text-faint hover:bg-black/[0.08] hover:text-ink transition-colors opacity-0 group-hover:opacity-100 dark:text-[#8e8e93] dark:hover:bg-white/[0.1] dark:hover:text-white"
                  title="Close tab"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          )
        })}

        {/* Plus button to open any file */}
        <button
          type="button"
          onClick={() => setQuickOpenOpen(true)}
          className="flex h-[26px] w-[26px] items-center justify-center rounded-lg text-faint hover:bg-black/[0.05] hover:text-ink transition-colors dark:text-[#8e8e93] dark:hover:bg-white/[0.08] dark:hover:text-white"
          title="Open another file from codebase (⌘P)"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* ========================================================================= */}
      {/* 3. MAIN WORKSPACE: 3-Pane Layout (Explorer + Diff/Editor + Inspector)     */}
      {/* ========================================================================= */}
      <div className="flex flex-1 min-w-0 overflow-hidden bg-white dark:bg-[#000000]">
        {/* PANEL 1: Whole Codebase File Explorer (Left 250px) */}
        <div className="flex w-[250px] shrink-0 flex-col border-r border-black/[0.08] bg-[#fbfbfd]/70 surface-ide-panel text-[12px] dark:border-white/[0.08] dark:bg-[#0b0b0d]/90">
          {/* Explorer Title */}
          <div className="flex items-center justify-between border-b border-black/[0.06] px-3.5 py-2 dark:border-white/[0.08]">
            <span className="font-semibold uppercase tracking-wider text-[10.5px] text-faint dark:text-[#8e8e93]">
              Explorer: {run?.repo || 'commerce-core'}
            </span>
            <span className="font-mono text-[10px] text-faint dark:text-[#8e8e93]">
              {fileList.length} files
            </span>
          </div>

          {/* Explorer Quick Filter */}
          <div className="p-2 border-b border-black/[0.04] dark:border-white/[0.06]">
            <input
              value={explorerFilter}
              onChange={(e) => setExplorerFilter(e.target.value)}
              placeholder="Filter codebase..."
              className="w-full rounded-lg bg-black/[0.04] px-2.5 py-1 text-[11.5px] text-ink outline-none placeholder:text-faint focus:bg-white focus:ring-1 focus:ring-accent dark:bg-white/[0.06] dark:text-white dark:placeholder-[#71717a] dark:focus:bg-[#18181b]"
            />
          </div>

          {/* Tree View of the Entire Codebase */}
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5 font-mono text-[11.5px]">
            {explorerFilter.trim() ? (
              <div className="space-y-1">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-faint dark:text-[#8e8e93]">
                  Filtered ({filteredQuickFiles.length})
                </div>
                {filteredQuickFiles.map((f) => {
                  const isSelected = selectedFilePath === f.path
                  return (
                    <button
                      key={f.path}
                      type="button"
                      onClick={() => handleOpenFile(f.path)}
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-1 text-left transition-colors ${
                        isSelected ? 'bg-accent/15 dark:bg-accent/20 text-accent dark:text-[#4da3ff] font-semibold' : 'text-muted dark:text-[#a1a1aa] hover:bg-black/[0.04] hover:text-ink dark:hover:bg-white/[0.06] dark:hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <File size={12} className={isSelected ? 'text-accent dark:text-[#4da3ff]' : 'text-faint dark:text-[#8e8e93]'} />
                        <span className="truncate">{f.name}</span>
                      </div>
                      {f.modified && (
                        <span className="font-mono text-[9px] font-semibold text-[#17692e] dark:text-[#34c759]">
                          +{f.add}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            ) : hasRealFiles ? (
              <div className="space-y-2">
                {realFolders.map(([folder, files]) => (
                  <div key={folder || '.'}>
                    <div className="flex items-center gap-1.5 px-1.5 py-1 text-ink dark:text-[#f5f5f7]">
                      <Folder size={13} className="text-accent" />
                      <span className="font-sans font-semibold">{folder || '(root)'}</span>
                    </div>
                    <div className="pl-3 ml-2 border-l border-black/[0.06] space-y-0.5 dark:border-white/[0.08]">
                      {files.map((f) => {
                        const isSelected = selectedFilePath === f.path
                        return (
                          <button
                            key={f.path}
                            type="button"
                            onClick={() => handleOpenFile(f.path)}
                            className={`flex w-full items-center justify-between rounded-lg px-2 py-1 text-left transition-colors ${
                              isSelected ? 'bg-accent/15 dark:bg-accent/20 text-accent dark:text-[#4da3ff] font-semibold' : 'text-muted dark:text-[#a1a1aa] hover:bg-black/[0.04] hover:text-ink dark:hover:bg-white/[0.06] dark:hover:text-white'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 truncate">
                              <File size={12} className={isSelected ? 'text-accent dark:text-[#4da3ff]' : 'text-faint dark:text-[#8e8e93]'} />
                              <span className="truncate">{f.name}</span>
                              {f.status === 'A' && <span className="font-sans text-[9px] font-semibold text-[#17692e] dark:text-[#34c759]">NEW</span>}
                            </div>
                            <span className="font-mono text-[9px] font-semibold text-[#17692e] dark:text-[#34c759]">
                              +{f.add}{f.rem ? ` -${f.rem}` : ''}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* Project Root Folder */
              <div className="space-y-0.5">
              {/* src folder */}
              <div>
                <button
                  type="button"
                  onClick={() => toggleFolder('src')}
                  className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-ink hover:bg-black/[0.04] dark:text-[#f5f5f7] dark:hover:bg-white/[0.06]"
                >
                  <ChevronDown size={12} className={`text-faint transition-transform dark:text-[#8e8e93] ${expandedFolders.has('src') ? '' : '-rotate-90'}`} />
                  <Folder size={13} className="text-accent" />
                  <span className="font-sans font-semibold">src</span>
                </button>

                {expandedFolders.has('src') && (
                  <div className="pl-3 ml-2 border-l border-black/[0.06] space-y-0.5 dark:border-white/[0.08]">
                    {/* checkout subfolder */}
                    <div>
                      <button
                        type="button"
                        onClick={() => toggleFolder('src/checkout')}
                        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-ink hover:bg-black/[0.04] dark:text-[#f5f5f7] dark:hover:bg-white/[0.06]"
                      >
                        <ChevronDown size={11} className={`text-faint transition-transform dark:text-[#8e8e93] ${expandedFolders.has('src/checkout') ? '' : '-rotate-90'}`} />
                        <Folder size={12} className="text-accent/80" />
                        <span className="font-sans">checkout</span>
                      </button>
                      {expandedFolders.has('src/checkout') && (
                        <div className="pl-3 ml-2 border-l border-black/[0.06] space-y-0.5 dark:border-white/[0.08]">
                          {['src/checkout/webhook.py', 'src/checkout/service.py', 'src/checkout/schemas.py'].map((path) => {
                            const f = allCodebaseFiles[path]
                            if (!f) return null
                            const isSelected = selectedFilePath === f.path
                            return (
                              <button
                                key={f.path}
                                type="button"
                                onClick={() => handleOpenFile(f.path)}
                                className={`flex w-full items-center justify-between rounded-lg px-2 py-1 text-left transition-colors ${
                                  isSelected ? 'bg-accent/15 dark:bg-accent/20 text-accent dark:text-[#4da3ff] font-semibold' : 'text-muted dark:text-[#a1a1aa] hover:bg-black/[0.04] hover:text-ink dark:hover:bg-white/[0.06] dark:hover:text-white'
                                }`}
                              >
                                <div className="flex items-center gap-1.5 truncate">
                                  <File size={12} className={isSelected ? 'text-accent dark:text-[#4da3ff]' : 'text-faint dark:text-[#8e8e93]'} />
                                  <span className="truncate">{f.name}</span>
                                </div>
                                {f.modified && (
                                  <span className="font-mono text-[9px] font-semibold text-[#17692e] dark:text-[#34c759]">
                                    +{f.add}
                                  </span>
                                )}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    {/* middleware subfolder */}
                    <div>
                      <button
                        type="button"
                        onClick={() => toggleFolder('src/middleware')}
                        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-ink hover:bg-black/[0.04] dark:text-[#f5f5f7] dark:hover:bg-white/[0.06]"
                      >
                        <ChevronDown size={11} className={`text-faint transition-transform dark:text-[#8e8e93] ${expandedFolders.has('src/middleware') ? '' : '-rotate-90'}`} />
                        <Folder size={12} className="text-accent/80" />
                        <span className="font-sans">middleware</span>
                      </button>
                      {expandedFolders.has('src/middleware') && (
                        <div className="pl-3 ml-2 border-l border-black/[0.06] space-y-0.5 dark:border-white/[0.08]">
                          {['src/middleware/throttle.py', 'src/middleware/auth.py'].map((path) => {
                            const f = allCodebaseFiles[path]
                            if (!f) return null
                            const isSelected = selectedFilePath === f.path
                            return (
                              <button
                                key={f.path}
                                type="button"
                                onClick={() => handleOpenFile(f.path)}
                                className={`flex w-full items-center justify-between rounded-lg px-2 py-1 text-left transition-colors ${
                                  isSelected ? 'bg-accent/15 dark:bg-accent/20 text-accent dark:text-[#4da3ff] font-semibold' : 'text-muted dark:text-[#a1a1aa] hover:bg-black/[0.04] hover:text-ink dark:hover:bg-white/[0.06] dark:hover:text-white'
                                }`}
                              >
                                <div className="flex items-center gap-1.5 truncate">
                                  <File size={12} className={isSelected ? 'text-accent dark:text-[#4da3ff]' : 'text-faint dark:text-[#8e8e93]'} />
                                  <span className="truncate">{f.name}</span>
                                </div>
                                {f.modified && (
                                  <span className="font-mono text-[9px] font-semibold text-[#17692e] dark:text-[#34c759]">
                                    +{f.add}
                                  </span>
                                )}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    {/* deps subfolder */}
                    <div>
                      <button
                        type="button"
                        onClick={() => toggleFolder('src/deps')}
                        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-ink hover:bg-black/[0.04] dark:text-[#f5f5f7] dark:hover:bg-white/[0.06]"
                      >
                        <ChevronDown size={11} className={`text-faint transition-transform dark:text-[#8e8e93] ${expandedFolders.has('src/deps') ? '' : '-rotate-90'}`} />
                        <Folder size={12} className="text-accent/80" />
                        <span className="font-sans">deps</span>
                      </button>
                      {expandedFolders.has('src/deps') && (
                        <div className="pl-3 ml-2 border-l border-black/[0.06] space-y-0.5 dark:border-white/[0.08]">
                          {['src/deps/redis.py', 'src/deps/database.py'].map((path) => {
                            const f = allCodebaseFiles[path]
                            if (!f) return null
                            const isSelected = selectedFilePath === f.path
                            return (
                              <button
                                key={f.path}
                                type="button"
                                onClick={() => handleOpenFile(f.path)}
                                className={`flex w-full items-center justify-between rounded-lg px-2 py-1 text-left transition-colors ${
                                  isSelected ? 'bg-accent/15 dark:bg-accent/20 text-accent dark:text-[#4da3ff] font-semibold' : 'text-muted dark:text-[#a1a1aa] hover:bg-black/[0.04] hover:text-ink dark:hover:bg-white/[0.06] dark:hover:text-white'
                                }`}
                              >
                                <div className="flex items-center gap-1.5 truncate">
                                  <File size={12} className={isSelected ? 'text-accent dark:text-[#4da3ff]' : 'text-faint dark:text-[#8e8e93]'} />
                                  <span className="truncate">{f.name}</span>
                                </div>
                                {f.modified && (
                                  <span className="font-mono text-[9px] font-semibold text-[#17692e] dark:text-[#34c759]">
                                    +{f.add}
                                  </span>
                                )}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* tests folder */}
              <div>
                <button
                  type="button"
                  onClick={() => toggleFolder('tests')}
                  className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-ink hover:bg-black/[0.04] dark:text-[#f5f5f7] dark:hover:bg-white/[0.06]"
                >
                  <ChevronDown size={12} className={`text-faint transition-transform dark:text-[#8e8e93] ${expandedFolders.has('tests') ? '' : '-rotate-90'}`} />
                  <Folder size={13} className="text-accent" />
                  <span className="font-sans font-semibold">tests</span>
                </button>
                {expandedFolders.has('tests') && (
                  <div className="pl-3 ml-2 border-l border-black/[0.06] space-y-0.5 dark:border-white/[0.08]">
                    {['tests/test_webhook.py', 'tests/test_throttle.py', 'tests/conftest.py'].map((path) => {
                      const f = allCodebaseFiles[path]
                      if (!f) return null
                      const isSelected = selectedFilePath === f.path
                      return (
                        <button
                          key={f.path}
                          type="button"
                          onClick={() => handleOpenFile(f.path)}
                          className={`flex w-full items-center justify-between rounded-lg px-2 py-1 text-left transition-colors ${
                            isSelected ? 'bg-accent/15 dark:bg-accent/20 text-accent dark:text-[#4da3ff] font-semibold' : 'text-muted dark:text-[#a1a1aa] hover:bg-black/[0.04] hover:text-ink dark:hover:bg-white/[0.06] dark:hover:text-white'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 truncate">
                            <File size={12} className={isSelected ? 'text-accent dark:text-[#4da3ff]' : 'text-faint dark:text-[#8e8e93]'} />
                            <span className="truncate">{f.name}</span>
                          </div>
                          {f.modified && (
                            <span className="font-mono text-[9px] font-semibold text-[#17692e] dark:text-[#34c759]">
                              +{f.add}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* config folder */}
              <div>
                <button
                  type="button"
                  onClick={() => toggleFolder('config')}
                  className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-ink hover:bg-black/[0.04] dark:text-[#f5f5f7] dark:hover:bg-white/[0.06]"
                >
                  <ChevronDown size={12} className={`text-faint transition-transform dark:text-[#8e8e93] ${expandedFolders.has('config') ? '' : '-rotate-90'}`} />
                  <Folder size={13} className="text-accent" />
                  <span className="font-sans font-semibold">config</span>
                </button>
                {expandedFolders.has('config') && (
                  <div className="pl-3 ml-2 border-l border-black/[0.06] space-y-0.5 dark:border-white/[0.08]">
                    {['config/settings.py'].map((path) => {
                      const f = allCodebaseFiles[path]
                      if (!f) return null
                      const isSelected = selectedFilePath === f.path
                      return (
                        <button
                          key={f.path}
                          type="button"
                          onClick={() => handleOpenFile(f.path)}
                          className={`flex w-full items-center justify-between rounded-lg px-2 py-1 text-left transition-colors ${
                            isSelected ? 'bg-accent/15 dark:bg-accent/20 text-accent dark:text-[#4da3ff] font-semibold' : 'text-muted dark:text-[#a1a1aa] hover:bg-black/[0.04] hover:text-ink dark:hover:bg-white/[0.06] dark:hover:text-white'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 truncate">
                            <File size={12} className={isSelected ? 'text-accent dark:text-[#4da3ff]' : 'text-faint dark:text-[#8e8e93]'} />
                            <span className="truncate">{f.name}</span>
                          </div>
                          {f.modified && (
                            <span className="font-mono text-[9px] font-semibold text-[#17692e] dark:text-[#34c759]">
                              +{f.add} -{f.rem}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Root files */}
              {['README.md', 'pyproject.toml'].map((path) => {
                const f = allCodebaseFiles[path]
                if (!f) return null
                const isSelected = selectedFilePath === f.path
                return (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => handleOpenFile(f.path)}
                    className={`flex w-full items-center justify-between rounded-lg px-2 py-1 text-left transition-colors ${
                      isSelected ? 'bg-accent/15 dark:bg-accent/20 text-accent dark:text-[#4da3ff] font-semibold' : 'text-muted dark:text-[#a1a1aa] hover:bg-black/[0.04] hover:text-ink dark:hover:bg-white/[0.06] dark:hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <File size={12} className={isSelected ? 'text-accent dark:text-[#4da3ff]' : 'text-faint dark:text-[#8e8e93]'} />
                      <span className="truncate">{f.name}</span>
                    </div>
                  </button>
                )
              })}
            </div>
            )}
          </div>
        </div>

        {/* PANEL 2: Center Code Diff & Source Editor */}
        <div className="flex flex-1 min-w-0 flex-col bg-white overflow-hidden dark:bg-[#000000]">
          {/* Subheader / Status Bar of the Active File */}
          <div className="flex h-[32px] shrink-0 items-center justify-between border-b border-black/[0.06] bg-black/[0.015] px-4 text-[11.5px] gap-2 min-w-0 dark:border-white/[0.08] dark:bg-white/[0.02]">
            <div className="flex items-center gap-2 font-mono text-muted min-w-0 truncate dark:text-[#a1a1aa]">
              <span className="font-semibold text-ink truncate dark:text-[#f5f5f7]">{activeFile.path}</span>
              {activeFile.header && <span className="text-faint shrink-0 dark:text-[#8e8e93]">{activeFile.header}</span>}
              {!activeFile.modified && (
                <span className="rounded bg-black/[0.04] px-1.5 py-0.5 text-[10px] text-faint shrink-0 dark:bg-white/[0.06] dark:text-[#8e8e93]">
                  Clean · Unmodified
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setFullFileModal(true)}
                className="text-muted hover:text-ink flex items-center gap-1 transition-colors text-[11px] dark:text-[#a1a1aa] dark:hover:text-white"
              >
                <Eye size={12} /> Full view
              </button>
            </div>
          </div>

          {/* Diff & Code Surface */}
          <div className="relative flex-1 overflow-auto bg-white font-mono text-[12px] leading-[1.65] dark:bg-[#000000]">
            <div className="py-2 min-w-full">
              {diffLines.map((line, idx) => {
                const lineNo = line.n2 || line.n1 || idx + 1
                const isRem = line.type === 'rem'
                const isAdd = line.type === 'add'

                // Diff line highlighting
                const bg = isRem ? 'bg-[#ff3b30]/10 dark:bg-[#ff453a]/15' : isAdd ? 'bg-[#34c759]/10 dark:bg-[#34c759]/15' : ''
                const sign = isRem ? '-' : isAdd ? '+' : ' '
                const signColor = isRem ? 'text-[#d70015] dark:text-[#ff453a] font-bold' : isAdd ? 'text-[#17692e] dark:text-[#34c759] font-bold' : 'text-transparent'

                // Anchored floating review card on Line 42 of webhook.py (demo only)
                const isTargetLine42 = !hasRealFiles && activeFile.path.includes('webhook.py') && lineNo === 42 && isAdd
                const showAnchoredCard = isTargetLine42 && !anchoredCardDismissed
                const isDraftingComment = activeCommentLine === lineNo

                return (
                  <div key={idx} className="relative group">
                    <div className={`flex items-stretch hover:bg-black/[0.02] dark:hover:bg-white/[0.04] ${bg}`}>
                      {/* Line Number Gutter with Hover Comment Button */}
                      <div className="w-14 shrink-0 select-none px-2 text-right font-mono text-[11px] text-faint flex items-center justify-end gap-1.5 dark:text-[#a1a1aa]">
                        <button
                          type="button"
                          onClick={() => setActiveCommentLine(isDraftingComment ? null : lineNo)}
                          title="Click to comment on this line for agent rework"
                          className="opacity-0 group-hover:opacity-100 text-accent hover:scale-125 transition-all p-0.5 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.1]"
                        >
                          <Plus size={11} strokeWidth={2.5} />
                        </button>
                        <span className="w-7 text-right">{lineNo}</span>
                      </div>

                      {/* Sign (+ / -) */}
                      <span className={`w-5 shrink-0 select-none text-center font-mono text-[12px] ${signColor}`}>
                        {sign}
                      </span>

                      {/* Code Syntax Highlight */}
                      <code className="min-w-0 flex-1 whitespace-pre pr-4 font-mono text-[12px]">
                        {highlight(line.text)}
                      </code>
                    </div>

                    {/* Anchored Review Card on Line 42 */}
                    {showAnchoredCard && (
                      <div className="relative my-2 ml-16 mr-8 rounded-2xl border border-black/[0.08] bg-white p-4 shadow-pop animate-rise z-20 dark:border-white/[0.12] dark:bg-[#18181b]">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-b from-[#1d1d1f] to-[#3a3a3c] dark:from-[#48484a] dark:to-[#2c2c2e] font-bold text-white text-[10px] shadow-xs">
                              AS
                            </span>
                            <div>
                              <span className="font-semibold text-ink text-[12px] dark:text-[#f5f5f7]">Reviewer ({reviewerRole})</span>
                              <span className="ml-2 font-mono text-[10px] text-faint dark:text-[#8e8e93]">Line 42</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setAnchoredCardDismissed(true)}
                            className="text-faint hover:text-ink p-1 rounded-md hover:bg-black/[0.04] dark:text-[#8e8e93] dark:hover:text-white dark:hover:bg-white/[0.08]"
                            title="Dismiss review note"
                          >
                            <X size={13} />
                          </button>
                        </div>

                        <div className="mt-2.5 text-[12.5px] font-sans leading-relaxed text-ink pl-8 dark:text-[#e4e4e7]">
                          Rate limiter key should use hashed tenant ID instead of raw IP to prevent spoofing behind Cloudflare proxies.
                        </div>

                        <div className="mt-3.5 flex items-center justify-end gap-2 border-t border-black/[0.05] pt-2.5 dark:border-white/[0.08]">
                          <button
                            type="button"
                            onClick={() => setAnchoredCardDismissed(true)}
                            className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-muted hover:bg-black/[0.04] hover:text-ink transition-colors dark:text-[#a1a1aa] dark:hover:bg-white/[0.08] dark:hover:text-white"
                          >
                            Resolve
                          </button>
                          <button
                            type="button"
                            onClick={handleReworkFromCard}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white px-3 py-1 text-[11.5px] font-semibold transition-all active:scale-[0.98] shadow-xs"
                            title="Send feedback directly to the autonomous agent and run rework iteration"
                          >
                            <RotateCcw size={12} />
                            <span>Submit to Agent Rework</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Custom Line Comment Drawer */}
                    {isDraftingComment && (
                      <div className="border-y border-accent/20 bg-accent/[0.03] p-3 pl-16 space-y-2 dark:bg-accent/[0.06]">
                        <div className="flex items-center justify-between">
                          <span className="text-[11.5px] font-semibold text-accent flex items-center gap-1.5 font-sans">
                            <MessageSquare size={12} />
                            Add Review Instruction on Line {lineNo}
                          </span>
                          <button
                            type="button"
                            onClick={() => setActiveCommentLine(null)}
                            className="text-faint hover:text-ink dark:text-[#8e8e93] dark:hover:text-white"
                          >
                            <X size={12} />
                          </button>
                        </div>
                        <textarea
                          value={commentText}
                          onChange={(e) => setCommentText(e.target.value)}
                          placeholder="Explain required changes or rework instructions for the agent..."
                          rows={2}
                          className="w-full rounded-xl border border-black/[0.1] bg-white p-2.5 text-[12px] font-sans text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-white/[0.12] dark:bg-[#121214] dark:text-white dark:placeholder-[#71717a]"
                        />
                        <div className="flex justify-end gap-2 font-sans">
                          <button
                            type="button"
                            onClick={() => setActiveCommentLine(null)}
                            className="rounded-lg border border-black/[0.08] px-2.5 py-1 text-[11px] font-medium text-ink hover:bg-black/[0.04] dark:border-white/[0.1] dark:text-[#f5f5f7] dark:hover:bg-white/[0.08]"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSubmitCustomLineComment(lineNo)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1 text-[11px] font-semibold text-white shadow-xs hover:bg-accent-hover"
                          >
                            <RotateCcw size={11} />
                            <span>Submit for Agent Rework</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* PANEL 3: Right Inspector Rail (260px) */}
        {showInspector && (
          <div className="flex w-[260px] shrink-0 flex-col border-l border-black/[0.08] bg-[#fbfbfd]/80 surface-ide-panel p-4 gap-4 overflow-y-auto select-none font-sans dark:border-white/[0.08] dark:bg-[#0b0b0d]/90">
            {/* Pipeline Stage Timeline */}
            <div className="rounded-2xl border border-black/[0.06] bg-white p-4 shadow-card dark:border-white/[0.08] dark:bg-[#141416]">
              <div className="text-[11.5px] font-semibold uppercase tracking-wider text-faint mb-3 dark:text-[#8e8e93]">
                Pipeline Stage
              </div>
              <div className="relative space-y-3 text-[12px]">
                <div className="absolute left-[9px] top-3 bottom-3 w-0.5 bg-black/[0.08] -z-0 dark:bg-white/[0.1]" />
                {(run?.steps || []).map((step) => {
                  const isGate = step.key?.startsWith('g')
                  const done = step.state === 'approved'
                  const active = step.state === 'active'
                  const rejected = step.state === 'rejected'
                  const label = done ? (isGate ? 'Approved' : 'Passed')
                    : rejected ? 'Rejected'
                      : active ? (isGate ? 'Awaiting' : 'Running')
                        : 'Pending'
                  return (
                    <div key={step.key} className="relative z-10 flex items-center justify-between" title={step.at || ''}>
                      <div className="flex min-w-0 items-center gap-2">
                        {done ? (
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#34c759] text-white shadow-xs">
                            <Check size={12} strokeWidth={2.5} />
                          </span>
                        ) : rejected ? (
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#ff3b30] text-white shadow-xs">
                            <X size={12} strokeWidth={2.5} />
                          </span>
                        ) : active ? (
                          <span className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0071e3] text-white shadow-[0_0_12px_rgba(0,113,227,0.65)] ring-4 ring-[#0071e3]/25 animate-pulse">
                            <span className="h-1.5 w-1.5 rounded-full bg-white" />
                          </span>
                        ) : (
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-black/[0.12] bg-white dark:border-white/[0.2] dark:bg-[#1e1e22]" />
                        )}
                        <span className={`truncate ${active ? 'font-semibold text-accent dark:text-[#4da3ff]' : done || rejected ? 'font-medium text-ink dark:text-[#f5f5f7]' : 'text-muted dark:text-[#a1a1aa]'}`}>
                          {step.label}{isGate && step.role ? ` (${step.role})` : ''}
                        </span>
                      </div>
                      <span className={`shrink-0 font-mono text-[10px] font-semibold ${
                        done ? 'text-[#17692e] dark:text-[#34c759]' : rejected ? 'text-[#c4161c] dark:text-[#ff453a]' : active ? 'text-accent dark:text-[#4da3ff]' : 'text-faint dark:text-[#8e8e93]'
                      }`}>{label}</span>
                    </div>
                  )
                })}
                {!run?.steps?.length && <div className="text-[12px] text-muted dark:text-[#a1a1aa]">No pipeline data for this run.</div>}
              </div>
            </div>

            {/* SHA-256 Ledger Card */}
            <div className="rounded-2xl border border-black/[0.06] bg-white p-4 shadow-card dark:border-white/[0.08] dark:bg-[#141416]">
              <div className="flex items-center gap-3">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                  run?.verified !== false ? 'bg-[#34c759]/10 text-[#17692e] dark:text-[#34c759]' : 'bg-[#ff3b30]/10 text-[#d70015] dark:text-[#ff453a]'
                }`}>
                  {run?.verified !== false ? <ShieldCheck size={20} strokeWidth={2} /> : <ShieldAlert size={20} strokeWidth={2} />}
                </span>
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="text-[12.5px] font-semibold text-ink dark:text-[#f5f5f7]">
                    {run?.verified !== false ? 'SHA-256 Verified' : 'Chain Broken'}
                  </div>
                  <div className="text-[11px] text-faint dark:text-[#8e8e93]">Tamper-evident ledger</div>
                </div>
              </div>

              {onTamper && (
                <button
                  type="button"
                  onClick={() => onTamper(2)}
                  className="mt-3 w-full rounded-lg border border-black/[0.08] bg-black/[0.025] hover:bg-black/[0.06] py-1.5 text-[11px] font-medium text-ink transition-colors flex items-center justify-center gap-1.5 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-[#f5f5f7] dark:hover:bg-white/[0.08]"
                  title="Test cryptographic audit failure by modifying event #2 directly in database"
                >
                  <TriangleAlert size={12} className="text-[#ff9500]" />
                  <span>Simulate Tamper Test</span>
                </button>
              )}
            </div>

            {/* Approve Gate Action Button */}
            {canAct && (
              <div className="rounded-2xl border border-accent/25 bg-accent/[0.03] p-3 text-center space-y-2 shadow-xs dark:bg-accent/[0.06]">
                <div className="text-[11.5px] font-medium text-accent">
                  Gate ready for reviewer decision
                </div>
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => onDecide?.('approve')}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm hover:bg-accent-hover active:scale-[0.98] transition-all"
                  >
                    <Check size={14} />
                    <span>Approve Gate</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDecide?.('reject')}
                    className="control-danger inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-black/[0.08] bg-white px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-black/[0.04] active:scale-[0.98] transition-all dark:border-white/[0.1] dark:bg-white/[0.06] dark:text-[#f5f5f7] dark:hover:bg-white/[0.1]"
                  >
                    <RotateCcw size={12} />
                    <span>Request Changes</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 4. QUICK OPEN MODAL (⌘P) — Instant File Jumper Across Whole Codebase      */}
      {/* ========================================================================= */}
      {quickOpenOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/40 p-4 backdrop-blur-sm"
          onClick={() => setQuickOpenOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-2xl border border-black/[0.1] bg-white shadow-pop overflow-hidden animate-rise dark:border-white/[0.12] dark:bg-[#18181b]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-black/[0.06] px-4 py-3 dark:border-white/[0.08]">
              <Search size={16} className="text-muted dark:text-[#a1a1aa]" />
              <input
                autoFocus
                value={quickSearch}
                onChange={(e) => setQuickSearch(e.target.value)}
                placeholder="Type the name of a file to open in the IDE..."
                className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-faint dark:text-white dark:placeholder-[#71717a]"
              />
              <kbd className="rounded border border-black/[0.08] bg-black/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-faint dark:border-white/[0.12] dark:bg-white/10 dark:text-[#a1a1aa]">
                ESC
              </kbd>
            </div>

            <div className="max-h-80 overflow-y-auto p-2 space-y-1">
              {filteredQuickFiles.map((f) => (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => handleOpenFile(f.path)}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition-colors ${
                    f.path === selectedFilePath ? 'bg-accent/10 text-accent font-semibold' : 'text-ink hover:bg-black/[0.04] dark:text-[#f5f5f7] dark:hover:bg-white/[0.06]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <File size={14} className={f.path === selectedFilePath ? 'text-accent' : 'text-faint dark:text-[#8e8e93]'} />
                    <span className="text-[13px]">{f.name}</span>
                    <span className="font-mono text-[11px] text-faint truncate dark:text-[#8e8e93]">{f.path}</span>
                  </div>
                  {f.modified ? (
                    <span className="rounded bg-[#ff9500]/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#8f4700] dark:text-[#ff9f0a]">
                      +{f.add} -{f.rem}
                    </span>
                  ) : (
                    <span className="text-[11px] text-faint dark:text-[#8e8e93]">clean</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Full File Modal */}
      {fullFileModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6 backdrop-blur-md"
          onClick={() => setFullFileModal(false)}
        >
          <div
            className="flex h-[80vh] w-full max-w-4xl flex-col rounded-3xl border border-black/[0.08] bg-white shadow-pop overflow-hidden dark:border-white/[0.12] dark:bg-[#18181b]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-black/[0.06] bg-black/[0.015] px-6 py-3.5 dark:border-white/[0.08] dark:bg-white/[0.04]">
              <div className="flex items-center gap-2">
                <File size={16} className="text-accent" />
                <span className="font-mono text-[13px] font-semibold text-ink dark:text-[#f5f5f7]">{activeFile.path}</span>
                <span className="rounded-full bg-black/[0.05] px-2 py-0.5 font-mono text-[11px] text-faint dark:bg-white/10 dark:text-[#a1a1aa]">Full Source</span>
              </div>
              <button
                type="button"
                onClick={() => setFullFileModal(false)}
                className="rounded-full p-1 text-muted hover:bg-black/[0.06] hover:text-ink transition-colors dark:text-[#a1a1aa] dark:hover:bg-white/[0.08] dark:hover:text-white"
              >
                <X size={17} />
              </button>
            </div>
            <div className="flex-1 overflow-auto bg-[#f8f9fa] dark:bg-[#090b0e] p-5 font-mono text-[12px] leading-relaxed text-[#24292f] dark:text-[#e6edf3]">
              <pre className="whitespace-pre">
                {diffLines.map((l, i) => (
                  <div key={i} className="flex">
                    <span className="w-12 select-none text-right pr-4 text-gray-500 font-mono text-[11px]">
                      {l.n2 || l.n1 || i + 1}
                    </span>
                    <span>{l.text}</span>
                  </div>
                ))}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
