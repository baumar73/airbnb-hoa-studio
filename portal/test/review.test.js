import test from 'node:test';
import assert from 'node:assert/strict';
import {caseReviewDigest,validateReviewReport} from '../functions/lib/review.js';

test('review digest binds guest identity, screening route and expected minors',async()=>{
  const c={id:'synthetic',guestName:'Jane Doe',expectedMinors:0,screeningRoute:'paper'};
  const wizard={adults:[{name:'Jane Doe'}]};
  const original=await caseReviewDigest(c,wizard);
  for(const change of [{guestName:'Jane Smith'},{expectedMinors:1},{screeningRoute:'tenant-evaluation'}]) {
    assert.notEqual(await caseReviewDigest({...c,...change},wizard),original);
  }
  assert.equal(await caseReviewDigest({...c,privateNote:'not part of the paperwork'},wizard),original);
});
