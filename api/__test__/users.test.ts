import dayjs from 'dayjs';
import Twitter from 'twitter';
import { fetchUsers, isUserCacheTimeout } from '../routes/users';
import { CachedUser } from '../User';

test('Cache taken in less than 24 hours ago is not timeout', () => {
  const user = { cached_at: dayjs().add(-24, 'hours').add(1, 'minute') };
  expect(isUserCacheTimeout((user as unknown) as CachedUser)).toBe(false);
});

test('Cache taken in 24 hours ago or more is timeout', () => {
  const user = { cached_at: dayjs().add(-24, 'hours') };
  expect(isUserCacheTimeout((user as unknown) as CachedUser)).toBe(true);
});

const old_tweets = [
  {
    id: '111',
    tweet_id: '1',
    name: 'Taro Tanaka',
    screen_name: 'TaroTanaka',
    content: 'hoi4最高! #hoi4',
    created_at: '2020-01-01',
    img_url:
      'https://pbs.twimg.com/profile_images/1402039511475843073/IRl5VXHD_400x400.jpg',
  },
];
const updated_tweets = [
  {
    id: '111',
    tweet_id: '1',
    name: 'Ziro Tanaka',
    screen_name: 'ZiroTanaka',
    content: 'hoi4最高! #hoi4',
    created_at: '2020-01-01',
    img_url:
      'https://pbs.twimg.com/profile_images/1394686145703813124/6XdsjWoD_400x400.jpg',
  },
];

test('User information must be updated on fetchUsers', async () => {
  jest.spyOn(Twitter.prototype, 'get').mockImplementationOnce(
    // eslint-disable-next-line no-unused-vars
    async (path: string, params?: Twitter.RequestParams | undefined) => {
      const user_ids_str: string = params?.user_id;
      const user_ids = user_ids_str.split(',');
      const users = user_ids.map((id) => ({
        id_str: id,
        name: `Ziro Tanaka`,
        screen_name: `ZiroTanaka`,
        profile_image_url_https:
          'https://pbs.twimg.com/profile_images/1394686145703813124/6XdsjWoD_400x400.jpg',
      }));
      return (users as unknown) as Twitter.ResponseData;
    }
  );
  expect(await fetchUsers(old_tweets)).toEqual(updated_tweets);
});


