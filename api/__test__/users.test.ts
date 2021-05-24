import dayjs from 'dayjs';
import { isUserCacheTimeout } from '../routes/users';
import { CachedUser } from '../User';

test('Cache taken in less than 24 hours ago is not timeout', () => {
  const user = { cached_at: dayjs().add(-24, 'hours').add(1, 'minute') };
  expect(isUserCacheTimeout((user as unknown) as CachedUser)).toBe(false);
});

test('Cache taken in 24 hours ago or more is timeout', () => {
  const user = { cached_at: dayjs().add(-24, 'hours') };
  expect(isUserCacheTimeout((user as unknown) as CachedUser)).toBe(true);
});
