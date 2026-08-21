import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinationOccupantNames } from '../functions/lib/fill.js';

test('coordination package lists minors by name without collecting birth dates', () => {
  const data = {
    adults: [{ firstName: 'DemoGivenNameB', lastName: 'DemoSurnameE' }],
    children: [{ name: 'DemoNameR DemoSurnameE' }],
  };
  assert.deepEqual(coordinationOccupantNames(data), ['DemoNameR DemoSurnameE']);
});

test('coordination occupants combine adults beyond two with minors by name only', () => {
  const data = {
    adults: [
      { firstName: 'One', lastName: 'Adult' },
      { firstName: 'Two', lastName: 'Adult' },
      { firstName: 'Three', middleName: 'M', lastName: 'Adult' },
    ],
    children: [{ name: 'Minor Guest' }],
  };
  assert.deepEqual(coordinationOccupantNames(data), ['Three M Adult', 'Minor Guest']);
});
