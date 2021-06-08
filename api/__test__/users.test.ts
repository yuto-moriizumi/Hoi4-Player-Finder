import dayjs from 'dayjs';
import Twitter from 'twitter';
// eslint-disable-next-line import/no-extraneous-dependencies
import MockDate from 'mockdate';
import { fetchUsers, isUserCacheTimeout } from '../routes/users';
import { CachedUser } from '../User';

// テスト用に、今日の日付を2020/1/1 0:00:00とする
const date2mock = '2020/01/01';
beforeEach(() => {
  MockDate.set(date2mock);
});
afterEach(() => {
  MockDate.reset();
});

// 以下テストコード
test('Cache taken in less than 24 hours ago is not timeout', () => {
  const user = { cached_at: dayjs().add(-24, 'hours').add(1, 'minute') };
  expect(isUserCacheTimeout((user as unknown) as CachedUser)).toBe(false);
});

test('Cache taken in 24 hours ago or more is timeout', () => {
  const user = { cached_at: dayjs().add(-24, 'hours') };
  expect(isUserCacheTimeout((user as unknown) as CachedUser)).toBe(true);
});

// 情報が古くなったツイート
const today = dayjs(date2mock);
const content = 'hoi4最高! #hoi4';
const tweet_id = '1';
const user_id = '111';
const updated_image_url =
  'https://pbs.twimg.com/profile_images/1394686145703813124/6XdsjWoD_400x400.jpg';
const old_tweets = [
  {
    id: user_id,
    tweet_id,
    name: 'Taro Tanaka',
    screen_name: 'TaroTanaka',
    content,
    created_at: today.format('YYYY-MM-DD'),
    img_url:
      'https://pbs.twimg.com/profile_images/1402039511475843073/IRl5VXHD_400x400.jpg',
  },
];
// 情報が最新のツイート
const updated_tweets = [
  {
    id: user_id,
    tweet_id,
    name: 'Ziro Tanaka',
    screen_name: 'ZiroTanaka',
    content,
    created_at: today.format('YYYY-MM-DD'),
    img_url: updated_image_url,
  },
];

// Twitter.get関数のモック化
jest.spyOn(Twitter.prototype, 'get').mockImplementation(
  // eslint-disable-next-line no-unused-vars
  async (path: string, params?: Twitter.RequestParams | undefined) => {
    const user_ids_str: string = params?.user_id;
    const user_ids = user_ids_str.split(',');
    const users = user_ids.map((id) => ({
      id_str: id,
      name: `Ziro Tanaka`,
      screen_name: `ZiroTanaka`,
      profile_image_url_https: updated_image_url,
    }));
    return (users as unknown) as Twitter.ResponseData;
  }
);

test('User information must be updated on fetchUsers', async () => {
  expect(await fetchUsers(old_tweets)).toEqual(updated_tweets);
});

// test('Old user information must not be updated on getUsers', async () => {
//   const far_past_date = today.add(-48, 'hours').format('YYYY-MM-DD');
//   const old_tweets2 = old_tweets.map((tweet) => {
//     const tweet2: CachedUser = { ...tweet, cached_at: far_past_date };
//     return tweet2;
//   });
//   const updated_tweets2 = updated_tweets.map((tweet) => {
//     const tweet2: CachedUser = {
//       ...tweet,
//       cached_at: today.format('YYYY-MM-DD'),
//     };
//     return tweet2;
//   });
//   expect(await getUsers(old_tweets2)).toEqual(updated_tweets2);
// });

// test('Latest user information must not be updated on getUsers', async () => {
//   const old_tweets2: CachedUser[] = old_tweets.map((tweet) => {
//     const tweet2: CachedUser = {
//       ...tweet,
//       cached_at: today.format('YYYY-MM-DD'),
//     };
//     return tweet2;
//   });
//   expect(await getUsers(old_tweets2)).toEqual(old_tweets2);
// });
