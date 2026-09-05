import test from 'node:test';
import assert from 'node:assert/strict';
import {caseReviewDigest,validateReviewReport} from '../functions/lib/review.js';

test('review reports require meaningful text and a structurally valid object',()=>{
  const report={status:'green',confidence:.95,findings:[],summary:'All required documents checked.',model:'synthetic-test-model'};
  assert.equal(validateReviewReport(report),true);
  assert.equal(validateReviewReport({...report,status:'yellow',findings:['Signature missing']}),true);
  for(const invalid of [null,[],true,{}, {...report,summary:''},{...report,summary:' \n '},{...report,model:' '},{...report,status:'yellow',findings:['']},{...report,findings:{}},{...report,summary:{text:'pretend'}},{...report,confidence:'1'}]) {
    assert.equal(validateReviewReport(invalid),false);
  }
});

test('review digest binds guest identity, screening route and expected minors',async()=>{
  const c={id:'synthetic',guestName:'Jane Doe',expectedMinors:0,screeningRoute:'paper'};
  const wizard={adults:[{name:'Jane Doe'}]};
  const original=await caseReviewDigest(c,wizard);
  for(const change of [{guestName:'Jane Smith'},{expectedMinors:1},{screeningRoute:'tenant-evaluation'}]) {
    assert.notEqual(await caseReviewDigest({...c,...change},wizard),original);
  }
  assert.equal(await caseReviewDigest({...c,privateNote:'not part of the paperwork'},wizard),original);
});
