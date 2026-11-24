import test from 'node:test';
import assert from 'node:assert/strict';
import {formatDate} from '../src/dates.ts';

test('文献日期保留跨年辨识和原始精度',()=>{
  assert.equal(formatDate('2025-12-31'),'2025-12-31');
  assert.equal(formatDate('2026-01-01'),'2026-01-01');
  assert.equal(formatDate('2026-11'),'2026-11');
  assert.equal(formatDate('2026'),'2026');
  assert.equal(formatDate('2026 Nov-Dec'),'2026 Nov-Dec');
});

test('服务端时间戳按北京时间展示，跨日跨年正确',()=>{
  assert.equal(formatDate('2025-12-31T18:10:00.000Z'),'2026-01-01');
  assert.equal(formatDate('2026-11-18T00:00:00+08:00'),'2026-11-18');
});
