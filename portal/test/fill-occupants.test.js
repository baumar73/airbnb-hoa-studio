import test from 'node:test';
import assert from 'node:assert/strict';
import { leaseApplicationAdditionalOccupants } from '../functions/lib/fill.js';

test('lease application lists minors as additional occupants without treating them as adult applicants', () => {
  const data = {
    adults: [{ firstName: 'DemoGivenNameB', lastName: 'DemoSurnameE' }],
    children: [{ name: 'DemoNameR DemoSurnameE', birthDate: '2009-01-01' }],
  };
  assert.deepEqual(leaseApplicationAdditionalOccupants(data), [
    { name: 'DemoNameR DemoSurnameE', birthDate: '2009-01-01' },
  ]);
});

test('additional occupants combine adults beyond the two applicant blocks with minors', () => {
  const data = {
    adults: [
      { firstName: 'One', lastName: 'Adult' },
      { firstName: 'Two', lastName: 'Adult' },
      { firstName: 'Three', middleName: 'M', lastName: 'Adult', birthDate: '1990-01-01' },
    ],
    children: [{ name: 'Minor Guest', birthDate: '2010-02-03' }],
  };
  assert.deepEqual(leaseApplicationAdditionalOccupants(data), [
    { name: 'Three M Adult', birthDate: '1990-01-01' },
    { name: 'Minor Guest', birthDate: '2010-02-03' },
  ]);
});
