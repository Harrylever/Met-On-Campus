import { expect, test } from 'vitest'
import { NO_DEPARTMENT, deptLabel } from './dept'

test('a student with no department yet shows as pending, and a real department is shown as it is', () => {
  expect(deptLabel(NO_DEPARTMENT)).toBe('Department pending')
  expect(deptLabel('Computer Science')).toBe('Computer Science')
})
