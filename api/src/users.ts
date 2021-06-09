import express from 'express';
import mysql2 from 'mysql2/promise';
import dayjs from 'dayjs';
import Twitter from 'twitter';
import qs from 'qs';
import User, { CachedUser, TwitterResponseUser } from './User';

const router = express.Router();

const CACHE_TIMEOUT_HOUR = 24; // 名前や表示IDのキャッシュ時間

const DB_SETTING = {
  host: process.env.RDS_HOSTNAME ?? 'RDS_HOSTNAME',
  user: process.env.RDS_USERNAME ?? 'RDS_USERNAME',
  password: process.env.RDS_PASSWORD ?? 'RDS_PASSWORD',
  database: process.env.RDS_DB_NAME ?? 'RDS_DB_NAME',
};
const CONSUMER_KEYSET = {
  consumer_key: process.env.TWITTER_CONSUMER_KEY ?? 'TWITTER_CONSUMER_KEY',
  consumer_secret:
    process.env.TWITTER_CONSUMER_SECRET ?? 'TWITTER_CONSUMER_SECRET',
};
const TWITTER_KEYSET = {
  ...CONSUMER_KEYSET,
  bearer_token: process.env.TWITTER_BEARER_TOKEN ?? 'TWITTER_BEARER_TOKEN',
};
const ACCESS_TOKEN = {
  access_token_key: process.env.TWITTER_ACCESS_TOKEN ?? 'TWITTER_ACCESS_TOKEN',
  access_token_secret:
    process.env.TWITTER_ACCESS_TOKEN_SECRET ?? 'TWITTER_ACCESS_TOKEN_SECRET',
};
const SCREEN_NAME = process.env.TWITTER_SCREEN_NAME ?? 'TWITTER_SCREEN_NAME';

/**
 * ユーザのキャッシュが期限切れかどうか判定する
 * 取得日時から24時間以上経過していれば、期限切れとする
 * @param {CachedUser} user キャッシュ日時情報付きのユーザ
 */
export function isUserCacheTimeout(user: CachedUser) {
  return dayjs(user.cached_at).add(CACHE_TIMEOUT_HOUR, 'hours') <= dayjs();
}

interface ArgumentError extends Error {}

/**
 * 最新のユーザ情報をTwitterから取得して返す
 * @param {User[]} users ユーザの配列 長さ100を超えてはいけません
 * @returns {(Promise<User[] |  ArgumentError | Error>)} 更新されたユーザの配列 または  ArgumentError または Error
 */
export async function fetchUsers(
  users: User[]
): Promise<User[] | ArgumentError | Error> {
  if (users.length === 0) return [];
  if (users.length > 100)
    return new TypeError('users length must be between 1 and 100');
  const client = new Twitter(TWITTER_KEYSET);
  try {
    // const ids = users.map((user) => user.id).join(',');
    // console.log(ids);

    const detailed_users = (await client.get('users/lookup', {
      user_id: users.map((user) => user.id).join(','),
      include_entities: false,
    })) as TwitterResponseUser[];
    if (!detailed_users) return new Error("couldn't fetch users");

    // users配列をidで取れるようにMapに変換
    const users_map = new Map<string, User>(
      users.map((user) => [user.id, user])
    );
    const responce_users = detailed_users.map((user: TwitterResponseUser) => {
      const tweet_user = users_map.get(user.id_str) as User;
      const detailed_user: User = {
        id: user.id_str,
        tweet_id: tweet_user?.tweet_id,
        name: user.name,
        screen_name: user.screen_name,
        img_url: user.profile_image_url_https,
        content: tweet_user?.content,
        created_at: tweet_user?.created_at,
      };
      return detailed_user;
    });
    return responce_users;
  } catch (error) {
    if (error instanceof Array && error[0].code === 17) {
      return [];
    }
    return new Error(
      `Unknown twitter error occured at fetchUsers, code:${error[0].code} message:${error[0].message}`
    );
  }
}

// キャッシュしたユーザの配列から、必要に応じて最新データに更新したユーザ一覧を返却する
export async function getUsers(users: CachedUser[]) {
  if (users.length === 0) return new TypeError('Users array cannot be empty');
  if (
    // どのユーザも期限切れでなければそのまま返す
    !users.some((user) => isUserCacheTimeout(user))
  ) {
    console.log('use cache');
    return users;
  }

  // 返却順を保証するために、何番目がキャッシュを利用するユーザであるか保存しておく
  const cached_users: CachedUser[] = [];
  const old_users: CachedUser[] = [];
  const user_indexes: ('cache' | 'old')[] = [];
  users.forEach((user) => {
    if (isUserCacheTimeout(user)) {
      old_users.push(user);
      user_indexes.push('old');
    } else {
      cached_users.push(user);
      user_indexes.push('cache');
    }
  });

  // 更新が必要なユーザのみ取得する
  const latest_users = await fetchUsers(old_users);
  if (latest_users instanceof Error) {
    return latest_users;
  }

  // データベース上のキャッシュを更新する
  const connection = await mysql2.createConnection(DB_SETTING);
  await connection.connect();
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  console.log('now', now);

  latest_users.forEach((user) =>
    connection.execute(
      `UPDATE users SET name=?, screen_name=?, img_url=?, cached_at=? WHERE id=?`,
      [user.name, user.screen_name, user.img_url, now, user.id]
    )
  );
  connection.end();

  // 更新したユーザとキャッシュしたユーザの配列を結合して返す
  const res_users: CachedUser[] = [];
  for (let i = 0; i < user_indexes.length; i += 1) {
    if (user_indexes[i] === 'old') {
      const user = latest_users.shift();
      if (user) res_users.push({ ...user, cached_at: now });
    } else {
      const user = cached_users.shift();
      if (user) res_users.push(user);
    }
  }
  return res_users;
}

// 登録ユーザ一覧を返す
router.get('/', async (req, res) => {
  console.log(DB_SETTING);

  const connection = await mysql2.createConnection(DB_SETTING);
  try {
    await connection.connect();
    const [usersArr] = await connection.query(
      `SELECT * FROM users ORDER BY created_at DESC`
    );
    const users = usersArr as CachedUser[];
    const detailed_users = await getUsers(users);
    res.send(detailed_users);
  } catch (error) {
    console.log(error);
    res.status(500).send();
  }
  connection.end();
});

router.get('/follow', async (req, res) => {
  try {
    const connection = await mysql2.createConnection(DB_SETTING);
    // 検索条件に応じてDBを検索
    await connection.connect();
    // クエリ実行
    const result_set = await connection.query(
      `SELECT * FROM users ORDER BY created_at DESC`
    );
    if (!result_set) {
      // 検索結果0件の場合
      res.status(200).send([]);
      return;
    }
    const [users_temp] = result_set;
    let users = users_temp as User[];

    // フォローしているユーザ一覧を取得する
    // Twitterインスタンス化
    const client = new Twitter({
      ...CONSUMER_KEYSET,
      ...ACCESS_TOKEN,
    });

    // フォローしているユーザID一覧を取得
    const followings = await client.get('friends/ids', {
      screen_name: SCREEN_NAME,
      count: 5000,
      stringify_ids: true,
    });
    const following_ids = followings.ids as Array<string>;
    // フォローしているユーザを除外する
    users = users.filter((user) => following_ids.indexOf(user.id) === -1);
    // フォローするユーザを決定する
    const user = users[Math.floor(Math.random() * users.length)];

    const result = await client.post('friendships/create', {
      user_id: user.id,
    });
    if (result instanceof Array) {
      // エラーオブジェクトの配列が返された場合
      const error = result[0] as { code: number; message: string };
      if (error.code === 88) {
        res.status(429).send(error); // APIレート制限
        return;
      }
      if (error.code === 326) {
        res.status(423).send(error); // アカウントがロックされている
        return;
      }
      console.warn('other error occured');
      res.status(500).send(error); // その他のエラー
      return;
    }
    // DBに使用状況を登録
    res.status(201).send(`user followed:${user.screen_name}`);
    connection.end();
  } catch (error) {
    if (error instanceof Array) {
      if (error[0].code === 160) {
        res.status(202).send(error[0]); // リクエスト承認待ち
        return;
      }
      if (error[0].code === 161) {
        res.status(429).send(error[0]); // フォローレート制限
        return;
      }
      if (error[0].code === 162) {
        res.status(403).send(error[0]); // 対象のユーザにブロックされている
        return;
      }
    }
    console.error(error);
    res.status(500).send({ error });
  }
});

// 公差1の等差数列を返すジェネレータ
function* gfn(from: number, to: number) {
  let cur = from;
  while (cur <= to) {
    cur += 1;
    yield cur;
  }
}

class Result {
  total = 0;

  next = '';

  success = {
    get total() {
      return this.entries.length;
    },
    entries: [] as {}[],
  };

  skip = {
    get total() {
      return this.entries.length;
    },
    entries: [] as {}[],
  };

  error = {
    get total() {
      return this.entries.length;
    },
    entries: [] as {}[],
  };

  updateTotal() {
    this.total = this.success.total + this.skip.total + this.error.total;
  }
}
function registerUsers(con: mysql2.Connection, users: User[], result: Result) {
  // DBに登録
  users.forEach((user) => {
    con
      .execute('INSERT users VALUES (?, ?, ?, ?, ?, ?, ?, now())', [
        user.id,
        user.tweet_id,
        user.content,
        user.created_at,
        user.name,
        user.screen_name,
        user.img_url,
      ])
      .then(() => {
        console.log('success', { user_id: user.id, name: user.name });
        result.success.entries.push({
          user_id: user.id,
          name: user.name,
        });
      })
      .catch((err: { code: string; sqlMessage: string }) => {
        if (err.code === 'ER_DUP_ENTRY') {
          console.log(
            'skip',
            { user_id: user.id, name: user.name },
            result.skip.entries.length
          );
          result.skip.entries.push({ user_id: user.id, name: user.name });
          return;
        }
        console.log('error', { user_id: user.id, name: user.name });
        result.error.entries.push({
          code: err.code,
          message: err.sqlMessage,
          user_id: user.id,
          name: user.name,
        });
        console.log(err);
      });
  });
}

type Tweet = {
  id_str: string;
  name: string;
  text: string;
  user: TwitterResponseUser;
  created_at: string;
  retweeted_status?: {} | undefined;
};

function tweets2users(tweets: Tweet[]) {
  // ツイートの配列からユーザ配列を取り出す
  return tweets
    .filter((tweet) => tweet.retweeted_status === undefined) // RTを除外
    .map((tweet) => ({
      id: tweet.user.id_str,
      name: tweet.user.name,
      tweet_id: tweet.id_str,
      content: tweet.text,
      created_at: dayjs(tweet.created_at).format('YYYY-MM-DD HH:mm:ss'),
      screen_name: tweet.user.screen_name,
      img_url: tweet.user.profile_image_url_https,
    }));
}

// cron用 過去7日間のツイートを検索してDBに追加する
router.get('/update', async (req, res) => {
  try {
    // パラメータ取得
    let max_id = req.query.max_id as string | undefined; // for pagination, provided by api responce
    const IS_RECURSIVE =
      ((req.query.recursive as string) ?? 'false').toLowerCase() === 'true'; // 再帰的に検索するか

    // Twitterクライアント,DB接続,結果オブジェクトの初期化
    const client = new Twitter(TWITTER_KEYSET);
    const connection = await mysql2.createConnection(DB_SETTING);
    await connection.connect();
    const result = new Result();

    // eslint-disable-next-line no-restricted-syntax, no-unused-vars
    for await (const _ of gfn(0, 100)) {
      // 最大100回再帰実行する
      console.log(`search from ${max_id}`);
      const request: {
        q: string;
        result_type?: string;
        count?: number;
        include_entities?: boolean;
        max_id?: string;
      } = {
        q: '#hoi4 lang:ja exclude:retweets',
        result_type: 'recent',
        count: 100,
        include_entities: false,
        max_id,
      };
      // 検索
      const responce = await client.get('search/tweets', request);
      const users = tweets2users(responce.statuses as Tweet[]);
      registerUsers(connection, users, result); // DBにユーザを登録する
      max_id = (responce.search_metadata.next_results
        ? qs.parse(responce.search_metadata.next_results)['?max_id']
        : undefined) as string | undefined;
      result.next = max_id ?? '';
      if (!IS_RECURSIVE || max_id === undefined) break; // 再起設定が無効であるか、max_idが取得できなければ離脱
    }
    await connection.commit();
    await connection.end();
    // 分かりやすいように各配列の長さをプロパティとして設定しておく
    result.updateTotal();
    if (result.error.total === 0) {
      res.send(result);
      console.log(
        `user insertion cron success, inserted:${result.success.total} skipped:${result.skip.total}`
      );
      return;
    }
    res.status(500).send(result);
    console.log(
      `user insertion cron partially or fully failed, inserted:${result.success.total} skipped:${result.skip.total}, error:${result.error.total}`
    );
  } catch (error) {
    console.log(error);
    res.status(500).send();
  }
});

router.get('/update/premium', async (req, res) => {
  const result = new Result();
  try {
    // パラメータ取得
    const API_TYPE = req.query.type; // "30day" or "fullarchive"
    const IS_RECURSIVE =
      ((req.query.recursive as string) ?? 'false').toLowerCase() === 'true'; // 再帰的に検索するか
    let next = req.query.next as string | undefined; // for pagination, provided by api responce
    console.log('type', API_TYPE);

    // Twitterクライアント,DB接続の初期化
    const client = new Twitter(TWITTER_KEYSET);
    const connection = await mysql2.createConnection(DB_SETTING);
    await connection.connect();

    // eslint-disable-next-line no-restricted-syntax, no-unused-vars
    for await (const _ of gfn(0, 100)) {
      // 最大100回再帰実行する
      // リクエストオブジェクトの初期化
      const request: { query: string; toDate?: number; next?: string } = {
        query: '#hoi4 lang:ja -from:1055413999183966209', // hoi4やりたいbotを除外
        toDate: 202012250000,
        next,
      };
      console.log(request);

      const responce = await client.get(
        API_TYPE === 'fullarchive'
          ? 'tweets/search/fullarchive/test2'
          : 'tweets/search/30day/test',
        request
      );
      const users = tweets2users(responce.results as Tweet[]);
      registerUsers(connection, users, result); // DBにユーザを登録する
      next = responce.next;
      result.next = next ?? '';
      if (!IS_RECURSIVE || next === undefined) break; // 再起設定が無効であるか、nextが取得できなければ離脱
    }
    await connection.commit();
    await connection.end();
    // 分かりやすいように各配列の長さをプロパティとして設定しておく
    result.updateTotal();
    if (result.error.total === 0) {
      res.send(result);
      console.log(
        `user insertion cron success, inserted:${result.success.total} skipped:${result.skip.total}`
      );
      return;
    }
    res.status(500).send(result);
    console.log(
      `user insertion cron partially or fully failed, inserted:${result.success.total} skipped:${result.skip.total}, error:${result.error.total}`
    );
  } catch (error) {
    console.log(error);
    res.status(500).send(result);
  }
});

export default router;
