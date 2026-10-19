#!/usr/bin/env node
// 사용법: node scripts/validate.js [data/polls.json]
'use strict';
const fs = require('fs');
const path = require('path');
const file = process.argv[2] || path.join(__dirname, '..', 'data', 'polls.json');
const errors = [], warns = [];
const err = (m) => errors.push(m), warn = (m) => warns.push(m);
const isoOk = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const hex = (s) => /^#[0-9a-f]{6}$/i.test(s);

let d;
try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error('JSON 파싱 실패:', e.message); process.exit(1); }
if (!isoOk(d.updated)) err('updated 가 YYYY-MM-DD 형식이 아님');
if (!Array.isArray(d.pollsters) || !d.pollsters.length) err('pollsters 배열 없음');
if (!Array.isArray(d.polls) || !d.polls.length) err('polls 배열 없음');
const ids = new Set();
for (const p of d.pollsters || []) {
  for (const k of ['id', 'name', 'color', 'colorDark', 'cadence', 'sourceHome']) if (!p[k]) err(`pollster ${p.id}: ${k} 누락`);
  if (!hex(p.color) || !hex(p.colorDark)) err(`pollster ${p.id}: 색상 형식 오류`);
  if (ids.has(p.id)) err(`pollster id 중복: ${p.id}`);
  ids.add(p.id);
}
const KEYS = ['pollster', 'start', 'end', 'approve', 'disapprove', 'n', 'method', 'moe', 'sourceUrl', 'sourceType', 'nesdcId', 'note'];
const seen = new Set(), last = {};
(d.polls || []).forEach((p, i) => {
  const tag = `#${i} ${p.pollster} ${p.start}`;
  for (const k of KEYS) if (!(k in p)) err(`${tag}: 필드 ${k} 누락`);
  for (const k of Object.keys(p)) if (!KEYS.includes(k)) warn(`${tag}: 알 수 없는 필드 ${k}`);
  if (!ids.has(p.pollster)) err(`${tag}: 등록되지 않은 pollster`);
  if (!isoOk(p.start) || !isoOk(p.end)) err(`${tag}: 날짜 형식 오류`);
  else {
    if (p.start > p.end) err(`${tag}: start > end`);
    const days = (Date.parse(p.end) - Date.parse(p.start)) / 864e5;
    if (days > 6) err(`${tag}: 조사기간 ${days + 1}일 (정례조사로 보기 어려움)`);
    if (d.updated && p.end > d.updated) err(`${tag}: 조사 종료일이 updated(${d.updated}) 이후`);
  }
  if (typeof p.approve !== 'number' || p.approve < 0 || p.approve > 100) err(`${tag}: approve 범위 오류`);
  if (p.disapprove != null && (typeof p.disapprove !== 'number' || p.disapprove < 0 || p.disapprove > 100)) err(`${tag}: disapprove 범위 오류`);
  if (typeof p.approve === 'number' && typeof p.disapprove === 'number' && p.approve + p.disapprove > 100.5) err(`${tag}: 긍정+부정 > 100`);
  if (!Number.isInteger(p.n) || p.n < 300) err(`${tag}: n 오류 (${p.n})`);
  if (typeof p.moe !== 'number' || p.moe <= 0 || p.moe > 10) err(`${tag}: moe 오류`);
  if (!p.method) err(`${tag}: method 비어 있음`);
  if (!/^https?:\/\//.test(p.sourceUrl || '')) err(`${tag}: sourceUrl 오류`);
  if (!['primary', 'nesdc', 'news'].includes(p.sourceType)) err(`${tag}: sourceType 은 primary|nesdc|news`);
  if (p.sourceType === 'nesdc' && !p.nesdcId) err(`${tag}: nesdc 출처인데 nesdcId 없음`);
  if (p.nesdcId != null && !/^\d+$/.test(String(p.nesdcId))) err(`${tag}: nesdcId 형식 오류`);
  if (p.sourceType === 'news') warn(`${tag}: 보도 기반(news) — 원자료 확인 시 교체 권장`);
  const key = `${p.pollster}|${p.start}`;
  if (seen.has(key)) err(`${tag}: 중복`);
  seen.add(key);
  const prev = last[p.pollster];
  if (prev) {
    if (p.start < prev.start) err(`${tag}: 기관 내 정렬 순서 오류`);
    else if (p.start <= prev.end) err(`${tag}: 직전 조사(${prev.start}~${prev.end})와 기간 겹침`);
  }
  last[p.pollster] = p;
});
const cnt = {};
for (const p of d.polls || []) { cnt[p.pollster] ??= { total: 0 }; cnt[p.pollster].total++; cnt[p.pollster][p.sourceType] = (cnt[p.pollster][p.sourceType] || 0) + 1; }
console.log(`파일: ${file}\nupdated: ${d.updated}`);
for (const [k, v] of Object.entries(cnt)) console.log(`  ${k}: ${JSON.stringify(v)} · 최신 ${last[k].start}~${last[k].end} ${last[k].approve}%`);
if (process.argv.includes('--verbose')) warns.forEach((w) => console.log('경고:', w));
else if (warns.length) console.log(`경고 ${warns.length}건 (--verbose 로 표시)`);
if (errors.length) { errors.forEach((e) => console.error('오류:', e)); console.error(`실패: 오류 ${errors.length}건`); process.exit(1); }
console.log('통과: 오류 없음');
