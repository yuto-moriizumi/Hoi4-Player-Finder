import express from 'express';
import mysql2 from 'mysql2/promise';
import dayjs from 'dayjs';
import Twitter from 'twitter';
import User, { CachedUser, TwitterResponseUser } from '../User';

const router = express.Router();

const CACHE_TIMEOUT_HOUR = 24; // 名前や表示IDのキャッシュ時間

const DB_SETTING = {
  uri: process.env.RDS_HOSTNAME ?? 'RDS_HOSTNAME',
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

// ユーザのキャッシュが有効か判定する
function isUserCacheTimeout(user: CachedUser) {
  return dayjs(user.cached_at)
    .add(CACHE_TIMEOUT_HOUR, 'hours')
    .isBefore(dayjs());
}

// 引数に与えられたユーザの最新情報をTwitterから取得する
async function fetchUsers(users: User[]) {
  if (users.length === 0 || users.length > 100)
    return new TypeError('users length must be between 1 and 100');
  const client = new Twitter(TWITTER_KEYSET);
  try {
    const ids = users.map((user) => user.id).join(',');
    console.log(ids);

    const detailed_users = await client.get('users/lookup', {
      user_id: users.map((user) => user.id).join(','),
      include_entities: false,
    });
    if (!detailed_users) return new Error("couldn't fetch users");
    console.log('FETCHED USERS');
    // users配列をidで取れるようにMapに変換
    const users_map = new Map<string, CachedUser>(
      users.map((user) => [user.id, user])
    );
    const responce_users = detailed_users.map((user: TwitterResponseUser) => {
      const tweet_user = users_map.get(user.id_str);
      const detailed_user = {
        id: user.id_str,
        name: user.name,
        screen_name: user.screen_name,
        img_url: user.profile_image_url_https,
        content: tweet_user?.content,
        created_at: tweet_user?.created_at,
      } as User;
      return detailed_user;
    }) as User[];
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
async function getUsers(users: CachedUser[]) {
  if (users.length === 0) return new TypeError('Users array cannot be empty');
  if (
    // どのユーザも期限切れでなければそのまま返す
    !users.some((user) => isUserCacheTimeout(user))
  ) {
    console.log('use cache');
    return users;
  }

  // 返却順を保証するために、何番目がキャッシュを利用するユーザであるか保存しておく
  const cached_users = [] as User[];
  const old_users = [] as User[];
  const user_indexes = [] as ('cache' | 'old')[];
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
  latest_users.forEach((user) =>
    connection.execute(
      `UPDATE users SET name=?, screen_name=?, img_url=?, cached_at=now() WHERE id=?`,
      [user.name, user.screen_name, user.img_url, user.id]
    )
  );
  connection.end();

  // 更新したユーザとキャッシュしたユーザの配列を結合して返す
  const res_users = [] as User[];
  for (let i = 0; i < user_indexes.length; i += 1) {
    if (user_indexes[i] === 'old') {
      const user = latest_users.shift();
      if (user) res_users.push(user);
    } else {
      const user = cached_users.shift();
      if (user) res_users.push(user);
    }
  }
  return res_users;
}

// 登録ユーザ一覧を返す
router.get('/', async (req, res) => {
  const connection = await mysql2.createConnection(DB_SETTING);
  try {
    await connection.connect();
    const [usersArr] = await connection.query(
      `SELECT * FROM users ORDER BY created_at DESC`
    );
    const users = usersArr as User[];
    const detailed_users = await getUsers(users);
    res.send(detailed_users);
  } catch (error) {
    console.log(error);
    res.status(500).send();
  }
  connection.end();
});

router.post('/follow', async (req, res) => {
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
    res.status(201).send();
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

// cron用 ツイートを検索してDBに追加する
router.get('/update', async (req, res) => {
  try {
    const API_TYPE = req.query.type; // "30day" or "fullarchive"
    const IS_PREMIUM_API = API_TYPE === 'fullarchive' || API_TYPE === '30day';
    console.log('type', API_TYPE);
    const NEXT = req.query.next; // for pagination, provided by api responce
    const client = new Twitter(TWITTER_KEYSET);

    // エンドポイントURLの決定
    let endpoint = 'search/tweets';
    if (API_TYPE === 'fullarchive')
      endpoint = 'tweets/search/fullarchive/test2';
    if (API_TYPE === '30day') endpoint = 'tweets/search/30day/test';

    let request = {};
    if (IS_PREMIUM_API) {
      request = {
        query: '#hoi4 lang:ja',
        toDate: 202102200000,
      };
      if (NEXT) {
        Object.defineProperty(request, 'next', {
          value: NEXT,
        });
      }
    } else {
      request = {
        q: '#hoi4 lang:ja',
        result_type: 'recent',
        count: 100,
        include_entities: false,
      };
    }
    const responce = await client.get(endpoint, request);
    const { next } = responce;
    const tweets = (IS_PREMIUM_API ? responce.results : responce.statuses) as {
      id_str: string;
      name: string;
      text: string;
      user: TwitterResponseUser;
      created_at: string;
      retweeted_status?: {};
    }[];
    const users = tweets
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

    // DBに登録
    const connection = await mysql2.createConnection(DB_SETTING);
    await connection.connect();
    const success = [] as {}[];
    const skip = [] as {}[];
    const error = [] as {}[];
    users.forEach((user) => {
      connection
        .execute('INSERT users VALUES (?, ?, ?, ?, ?, ?, ?, now(), 0)', [
          user.id,
          user.tweet_id,
          user.content,
          user.created_at,
          user.name,
          user.screen_name,
          user.img_url,
        ])
        .then(() => {
          // console.log("success", { user_id: user.id, name: user.name });
          success.push({ user_id: user.id, name: user.name });
        })
        .catch((err: { code: string; sqlMessage: string }) => {
          if (err.code === 'ER_DUP_ENTRY') {
            // console.log("skip", { user_id: user.id, name: user.name });
            skip.push({ user_id: user.id, name: user.name });
            return;
          }
          console.log('error', { user_id: user.id, name: user.name });
          error.push({
            code: err.code,
            message: err.sqlMessage,
            user_id: user.id,
            name: user.name,
          });
          console.log(err);
        });
    });
    await connection.end();
    const result = {
      total: users.length,
      next,
      success: {
        total: success.length,
        entries: success,
      },
      skip: {
        total: skip.length,
        entries: skip,
      },
      error: {
        total: error.length,
        entries: error,
      },
    };
    if (error.length === 0) {
      res.send(result);
      console.log(
        `user insertion cron success, inserted:${success.length} skipped:${skip.length}`
      );
      return;
    }
    res.status(500).send(result);
    console.log(
      `user insertion cron failed, inserted:${success.length} skipped:${skip.length}, error:${error.length}`
    );
  } catch (error) {
    console.log(error);
    res.status(500).send();
  }
});

export default router;
